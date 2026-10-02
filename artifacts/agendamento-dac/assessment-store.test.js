const test = require('node:test');
const assert = require('node:assert/strict');
const { createAssessmentStore } = require('./assessment-store');

class MemoryRedis {
    constructor() {
        this.values = new Map();
        this.sets = new Map();
    }

    async get(key) {
        const value = this.values.get(key);
        return value === undefined ? null : structuredClone(value);
    }

    async set(key, value, options = {}) {
        if (options.nx && this.values.has(key)) return null;
        this.values.set(key, structuredClone(value));
        return 'OK';
    }

    async mget(...keys) {
        return Promise.all(keys.map(key => this.get(key)));
    }

    async scan(cursor, options = {}) {
        const prefix = String(options.match || '').replace(/\*$/, '');
        return ['0', [...this.values.keys()].filter(key => key.startsWith(prefix))];
    }

    async smembers(key) {
        return [...(this.sets.get(key) || [])];
    }

    multi() {
        const operations = [];
        const transaction = {
            set: (key, value, options = {}) => {
                operations.push(() => this.set(key, value, options));
                return transaction;
            },
            sadd: (key, ...members) => {
                operations.push(async () => {
                    const set = this.sets.get(key) || new Set();
                    const before = set.size;
                    members.forEach(member => set.add(String(member)));
                    this.sets.set(key, set);
                    return set.size - before;
                });
                return transaction;
            },
            exec: async () => Promise.all(operations.map(operation => operation()))
        };
        return transaction;
    }
}

test('avaliações de avaliadores diferentes persistem sem sobrescrever umas às outras', async () => {
    const redis = new MemoryRedis();
    const firstSession = createAssessmentStore(redis);

    await firstSession.save({
        inscriptionId: 'inscricao-42',
        evaluatorEmail: 'Avaliadora@exemplo.org',
        scoresJson: { A: 2 },
        finalized: true
    });
    await firstSession.save({
        inscriptionId: 'inscricao-42',
        evaluatorEmail: 'outro@exemplo.org',
        scoresJson: { A: 1 },
        finalized: true
    });

    const afterRestart = createAssessmentStore(redis);
    const all = await afterRestart.getByInscription('inscricao-42');
    const firstEvaluator = await afterRestart.getByEvaluator('AVALIADORA@EXEMPLO.ORG');

    assert.equal(all.length, 2);
    assert.equal(firstEvaluator.length, 1);
    assert.equal(firstEvaluator[0].scoresJson.A, 2);
    assert.equal(firstEvaluator[0].finalized, true);
});

test('migra avaliações antigas do array por inscrição para o índice persistente do avaliador', async () => {
    const redis = new MemoryRedis();
    await redis.set('avaliacoes_legacy-7', [{
        inscriptionId: 'legacy-7',
        evaluatorEmail: 'Legado@exemplo.org',
        scoresJson: { A: 2, B: 1 },
        finalized: true,
        updatedAt: '2026-09-30T12:00:00.000Z'
    }]);

    const firstSession = createAssessmentStore(redis);
    const migrated = await firstSession.getByEvaluator('legado@exemplo.org');
    assert.equal(migrated.length, 1);
    assert.deepEqual(migrated[0].scoresJson, { A: 2, B: 1 });

    // The new record remains available even if the old aggregate is later absent.
    await redis.set('avaliacoes_legacy-7', []);
    const afterRestart = createAssessmentStore(redis);
    const persisted = await afterRestart.getByEvaluator('LEGADO@EXEMPLO.ORG');
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].finalized, true);
});