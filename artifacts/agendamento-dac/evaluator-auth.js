const { createHash, randomBytes } = require('node:crypto');

const EVALUATOR_SESSION_PREFIX = 'evaluator_session:';
const EVALUATOR_SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function normalizeEvaluatorEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function evaluatorSessionKey(token) {
    const normalizedToken = String(token || '').trim();
    if (!SESSION_TOKEN_PATTERN.test(normalizedToken)) return null;
    const tokenHash = createHash('sha256').update(normalizedToken).digest('hex');
    return `${EVALUATOR_SESSION_PREFIX}${tokenHash}`;
}

async function createEvaluatorSession(redis, email, evaluatorId, ttlSeconds = EVALUATOR_SESSION_TTL_SECONDS) {
    const normalizedEmail = normalizeEvaluatorEmail(email);
    if (!redis || typeof redis.set !== 'function') {
        throw new Error('Armazenamento de sessões indisponível.');
    }
    if (!normalizedEmail) throw new Error('E-mail do avaliador obrigatório.');

    const token = randomBytes(32).toString('base64url');
    const session = {
        email: normalizedEmail,
        evaluatorId: String(evaluatorId || '').trim() || null
    };
    const result = await redis.set(evaluatorSessionKey(token), session, { ex: ttlSeconds });
    if (!result) throw new Error('Não foi possível criar a sessão do avaliador.');
    return token;
}

async function getEvaluatorSession(redis, token) {
    const key = evaluatorSessionKey(token);
    if (!redis || !key || typeof redis.get !== 'function') return null;
    const stored = await redis.get(key);
    if (!stored) return null;

    let value = stored;
    if (typeof stored === 'string') {
        try {
            value = JSON.parse(stored);
        } catch {
            value = stored;
        }
    }
    const email = normalizeEvaluatorEmail(value?.email || value);
    if (!email) return null;
    return {
        email,
        evaluatorId: String(value?.evaluatorId || '').trim() || null
    };
}

async function getEvaluatorSessionEmail(redis, token) {
    return (await getEvaluatorSession(redis, token))?.email || null;
}

async function revokeEvaluatorSession(redis, token) {
    const key = evaluatorSessionKey(token);
    if (!redis || !key || typeof redis.del !== 'function') return false;
    return (await redis.del(key)) > 0;
}

async function authenticateEvaluatorSession(redis, token, evaluators) {
    const session = await getEvaluatorSession(redis, token);
    if (!session) return { authenticated: false, evaluator: null };

    const evaluator = (Array.isArray(evaluators) ? evaluators : []).find(
        entry =>
            normalizeEvaluatorEmail(entry?.email) === session.email
            && (!session.evaluatorId || String(entry?.id || '').trim() === session.evaluatorId)
    );
    return evaluator
        ? { authenticated: true, evaluator }
        : { authenticated: false, evaluator: null };
}

function canDeleteInscricoes(evaluator) {
    return evaluator?.podeExcluirInscricoes === true;
}

module.exports = {
    EVALUATOR_SESSION_TTL_SECONDS,
    authenticateEvaluatorSession,
    canDeleteInscricoes,
    createEvaluatorSession,
    getEvaluatorSession,
    getEvaluatorSessionEmail,
    normalizeEvaluatorEmail,
    revokeEvaluatorSession
};
