const { createHash } = require('crypto');

const LEGACY_ASSESSMENT_PREFIX = 'avaliacoes_';
const ASSESSMENT_RECORD_PREFIX = 'assessment:v1:record:';
const EVALUATOR_INDEX_PREFIX = 'assessment:v1:evaluator:';
const INSCRIPTION_INDEX_PREFIX = 'assessment:v1:inscription:';
const EVALUATOR_MIGRATION_PREFIX = 'assessment:v1:migrated:';
const MIGRATION_BATCH_SIZE = 100;

function normalizeEvaluatorEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function parseStoredValue(value) {
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return value;
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function emailHash(email) {
    return createHash('sha256').update(normalizeEvaluatorEmail(email)).digest('hex');
}

function encodedInscriptionId(inscriptionId) {
    return Buffer.from(String(inscriptionId)).toString('base64url');
}

function createAssessmentStore(redis) {
    if (!redis) throw new Error('Redis é obrigatório para criar o armazenamento de avaliações.');

    const recordKey = (inscriptionId, email) =>
        `${ASSESSMENT_RECORD_PREFIX}${encodedInscriptionId(inscriptionId)}:${emailHash(email)}`;
    const evaluatorIndexKey = email =>
        `${EVALUATOR_INDEX_PREFIX}${emailHash(email)}`;
    const inscriptionIndexKey = inscriptionId =>
        `${INSCRIPTION_INDEX_PREFIX}${encodedInscriptionId(inscriptionId)}`;
    const migrationKey = email =>
        `${EVALUATOR_MIGRATION_PREFIX}${emailHash(email)}`;
    const legacyKey = inscriptionId => `${LEGACY_ASSESSMENT_PREFIX}${inscriptionId}`;

    async function migrateLegacyRecords(entries) {
        const validEntries = (entries || []).flatMap(({ inscriptionId, record }) => {
            const id = String(inscriptionId || '').trim();
            const email = normalizeEvaluatorEmail(record?.evaluatorEmail);
            if (!id || !email) return [];
            return [{
                inscriptionId: id,
                email,
                record: {
                    ...record,
                    inscriptionId: String(record.inscriptionId || id),
                    evaluatorEmail: email
                }
            }];
        });
        if (!validEntries.length) return;

        const transaction = redis.multi();
        for (const entry of validEntries) {
            // NX prevents an older legacy value from overwriting a new save
            // arriving while the one-time migration is running.
            transaction
                .set(recordKey(entry.inscriptionId, entry.email), entry.record, { nx: true })
                .sadd(evaluatorIndexKey(entry.email), entry.inscriptionId)
                .sadd(inscriptionIndexKey(entry.inscriptionId), entry.email);
        }
        await transaction.exec();
    }

    async function getByInscription(inscriptionId) {
        const id = String(inscriptionId || '').trim();
        if (!id) return [];

        const legacyRecords = parseStoredValue(await redis.get(legacyKey(id)));
        const legacy = Array.isArray(legacyRecords) ? legacyRecords : [];
        const legacyByEmail = new Map();
        const legacyEntries = [];
        for (const record of legacy) {
            const email = normalizeEvaluatorEmail(record?.evaluatorEmail);
            if (!email) continue;
            legacyByEmail.set(email, { ...record, inscriptionId: String(record.inscriptionId || id), evaluatorEmail: email });
            legacyEntries.push({ inscriptionId: id, record });
        }
        await migrateLegacyRecords(legacyEntries);

        const indexedEmails = await redis.smembers(inscriptionIndexKey(id));
        const emails = [
            ...new Set([
            ...legacyByEmail.keys(),
            ...(Array.isArray(indexedEmails) ? indexedEmails : [])
                .map(normalizeEvaluatorEmail)
                .filter(Boolean)
            ])
        ];
        const storedRecords = emails.length
            ? await redis.mget(...emails.map(email => recordKey(id, email)))
            : [];
        const records = emails.map((email, index) =>
            parseStoredValue(storedRecords[index]) || legacyByEmail.get(email) || null
        );
        return records.filter(Boolean);
    }

    async function save(record) {
        const inscriptionId = String(record?.inscriptionId || '').trim();
        const evaluatorEmail = normalizeEvaluatorEmail(record?.evaluatorEmail);
        if (!inscriptionId || !evaluatorEmail) {
            throw new Error('Identificação da inscrição e do avaliador são obrigatórias.');
        }

        const normalizedRecord = { ...record, inscriptionId, evaluatorEmail };
        await redis.multi()
            .set(recordKey(inscriptionId, evaluatorEmail), normalizedRecord)
            .sadd(evaluatorIndexKey(evaluatorEmail), inscriptionId)
            .sadd(inscriptionIndexKey(inscriptionId), evaluatorEmail)
            .exec();
        return normalizedRecord;
    }

    async function migrateLegacyAssessmentsForEvaluator(email) {
        const evaluatorEmail = normalizeEvaluatorEmail(email);
        if (parseStoredValue(await redis.get(migrationKey(evaluatorEmail)))) return;

        const legacyKeys = [];
        let cursor = '0';
        do {
            const [nextCursor, keys] = await redis.scan(cursor, {
                match: `${LEGACY_ASSESSMENT_PREFIX}*`,
                count: MIGRATION_BATCH_SIZE
            });
            cursor = String(nextCursor);
            legacyKeys.push(...keys);
        } while (cursor !== '0');

        for (let start = 0; start < legacyKeys.length; start += MIGRATION_BATCH_SIZE) {
            const batchKeys = legacyKeys.slice(start, start + MIGRATION_BATCH_SIZE);
            const legacyValues = await redis.mget(...batchKeys);
            const legacyEntries = [];
            for (let index = 0; index < batchKeys.length; index += 1) {
                const records = parseStoredValue(legacyValues[index]);
                if (!Array.isArray(records)) continue;
                for (const record of records) {
                    if (normalizeEvaluatorEmail(record?.evaluatorEmail) === evaluatorEmail) {
                        const inscriptionId = batchKeys[index].slice(LEGACY_ASSESSMENT_PREFIX.length);
                        if (inscriptionId) legacyEntries.push({ inscriptionId, record });
                    }
                }
            }
            await migrateLegacyRecords(legacyEntries);
        }

        await redis.set(migrationKey(evaluatorEmail), '1');
    }

    async function getByEvaluator(email) {
        const evaluatorEmail = normalizeEvaluatorEmail(email);
        if (!evaluatorEmail) return [];

        await migrateLegacyAssessmentsForEvaluator(evaluatorEmail);
        const indexedIds = await redis.smembers(evaluatorIndexKey(evaluatorEmail));
        const ids = [...new Set((Array.isArray(indexedIds) ? indexedIds : [])
            .map(id => String(id || '').trim())
            .filter(Boolean))];

        const records = [];
        for (let start = 0; start < ids.length; start += MIGRATION_BATCH_SIZE) {
            const batch = ids.slice(start, start + MIGRATION_BATCH_SIZE);
            const storedRecords = await redis.mget(
                ...batch.map(id => recordKey(id, evaluatorEmail))
            );
            for (let index = 0; index < batch.length; index += 1) {
                const stored = parseStoredValue(storedRecords[index]);
                if (stored) {
                    records.push(stored);
                    continue;
                }
                const legacy = (await getByInscription(batch[index])).find(
                    record => normalizeEvaluatorEmail(record.evaluatorEmail) === evaluatorEmail
                );
                if (legacy) records.push(legacy);
            }
        }
        return records.filter(Boolean);
    }

    return { getByInscription, getByEvaluator, save };
}

module.exports = { createAssessmentStore };