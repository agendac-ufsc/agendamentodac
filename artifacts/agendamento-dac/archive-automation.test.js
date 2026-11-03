const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ARQUIVAMENTO_AUTOMATICO_KEY,
    ensureAutomaticArchiveEnabled
} = require('./archive-automation');

function createFakeRedis(initialValue = null, failWrite = false) {
    let value = initialValue;
    const writes = [];
    return {
        writes,
        async get(key) {
            assert.equal(key, ARQUIVAMENTO_AUTOMATICO_KEY);
            return value;
        },
        async set(key, nextValue) {
            assert.equal(key, ARQUIVAMENTO_AUTOMATICO_KEY);
            writes.push(nextValue);
            if (!failWrite) value = nextValue;
            return 'OK';
        }
    };
}

test('mantém ativo um booleano já deserializado pelo Redis', async () => {
    const redis = createFakeRedis(true);
    assert.equal(await ensureAutomaticArchiveEnabled(redis), true);
    assert.deepEqual(redis.writes, []);
});

test('ativa e confirma quando a configuração está ausente ou desligada', async () => {
    for (const initialValue of [null, false, 'false']) {
        const redis = createFakeRedis(initialValue);
        assert.equal(await ensureAutomaticArchiveEnabled(redis), true);
        assert.deepEqual(redis.writes, [true]);
    }
});

test('falha explicitamente se o armazenamento não confirmar a ativação', async () => {
    const redis = createFakeRedis(false, true);
    await assert.rejects(
        ensureAutomaticArchiveEnabled(redis),
        /Não foi possível confirmar/
    );
});
