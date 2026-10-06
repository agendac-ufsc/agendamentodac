const test = require('node:test');
const assert = require('node:assert/strict');
const {
    EVALUATOR_SESSION_TTL_SECONDS,
    authenticateEvaluatorSession,
    canDeleteInscricoes,
    createEvaluatorSession,
    getEvaluatorSessionEmail,
    revokeEvaluatorSession
} = require('./evaluator-auth');

class MemoryRedis {
    constructor() {
        this.values = new Map();
        this.setOptions = new Map();
    }

    async set(key, value, options) {
        this.values.set(key, value);
        this.setOptions.set(key, options);
        return 'OK';
    }

    async get(key) {
        return this.values.get(key) ?? null;
    }

    async del(key) {
        return this.values.delete(key) ? 1 : 0;
    }
}

test('sessão do avaliador é aleatória, expira e guarda somente o hash do token como chave', async () => {
    const redis = new MemoryRedis();
    const token = await createEvaluatorSession(redis, ' Avaliador@Exemplo.org ', 'av_123');
    const [key] = redis.values.keys();

    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(key, /^evaluator_session:[a-f0-9]{64}$/);
    assert.equal(key.includes(token), false);
    assert.deepEqual(redis.values.get(key), {
        email: 'avaliador@exemplo.org',
        evaluatorId: 'av_123'
    });
    assert.deepEqual(redis.setOptions.get(key), { ex: EVALUATOR_SESSION_TTL_SECONDS });
    assert.equal(await getEvaluatorSessionEmail(redis, token), 'avaliador@exemplo.org');
});

test('sessão só autoriza exclusão quando a permissão atual está ativa', async () => {
    const redis = new MemoryRedis();
    const token = await createEvaluatorSession(redis, 'avaliador@exemplo.org', 'av_1');
    const allowed = await authenticateEvaluatorSession(redis, token, [
        { id: 'av_1', email: 'AVALIADOR@EXEMPLO.ORG', podeExcluirInscricoes: true }
    ]);
    const denied = await authenticateEvaluatorSession(redis, token, [
        { id: 'av_1', email: 'avaliador@exemplo.org', podeExcluirInscricoes: false }
    ]);
    const readded = await authenticateEvaluatorSession(redis, token, [
        { id: 'av_2', email: 'avaliador@exemplo.org', podeExcluirInscricoes: true }
    ]);

    assert.equal(allowed.authenticated, true);
    assert.equal(canDeleteInscricoes(allowed.evaluator), true);
    assert.equal(denied.authenticated, true);
    assert.equal(canDeleteInscricoes(denied.evaluator), false);
    assert.equal(readded.authenticated, false);
    assert.equal((await authenticateEvaluatorSession(redis, 'token-invalido', [])).authenticated, false);

    await revokeEvaluatorSession(redis, token);
    assert.equal(await getEvaluatorSessionEmail(redis, token), null);
    assert.equal((await authenticateEvaluatorSession(redis, token, [
        { id: 'av_1', email: 'avaliador@exemplo.org', podeExcluirInscricoes: true }
    ])).authenticated, false);
});
