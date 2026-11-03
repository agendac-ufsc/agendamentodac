const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRedisValue } = require('./redis-value');

test('preserva booleanos deserializados pelo cliente Redis', () => {
    assert.equal(parseRedisValue(true), true);
    assert.equal(parseRedisValue(false), false);
});

test('continua interpretando JSON e valores já decodificados', () => {
    assert.deepEqual(parseRedisValue('{"enabled":true}'), { enabled: true });
    assert.equal(parseRedisValue('true'), true);
    assert.deepEqual(parseRedisValue([{ id: '1' }]), [{ id: '1' }]);
});

test('trata valores ausentes ou inválidos sem inventar dados', () => {
    assert.equal(parseRedisValue(null), null);
    assert.equal(parseRedisValue(undefined), null);
    assert.equal(parseRedisValue(''), null);
    assert.equal(parseRedisValue('não é JSON'), null);
});
