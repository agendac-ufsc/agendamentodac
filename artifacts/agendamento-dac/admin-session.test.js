const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ADMIN_SESSION_TTL_SECONDS,
    createAdminSessionToken,
    verifyAdminSessionToken
} = require('./admin-session');

test('admin session tokens are signed, expire, and depend on the configured password', () => {
    const now = Date.parse('2026-10-09T12:00:00.000Z');
    const token = createAdminSessionToken('correct-password', now);

    assert.match(token, /^\d+\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(verifyAdminSessionToken('correct-password', token, now), true);
    assert.equal(verifyAdminSessionToken('wrong-password', token, now), false);
    assert.equal(verifyAdminSessionToken('correct-password', token, now + ADMIN_SESSION_TTL_SECONDS * 1000), false);
});

test('admin session token rejects missing secrets, malformed tokens, and extended expiry', () => {
    const now = Date.parse('2026-10-09T12:00:00.000Z');
    const token = createAdminSessionToken('correct-password', now);
    assert.throws(() => createAdminSessionToken('', now), /não configurada/);
    assert.equal(verifyAdminSessionToken('', token, now), false);
    assert.equal(verifyAdminSessionToken('correct-password', 'invalid', now), false);

    const [expiry, nonce] = token.split('.');
    const extended = `${Number(expiry) + ADMIN_SESSION_TTL_SECONDS * 2}.${nonce}.${token.split('.')[2]}`;
    assert.equal(verifyAdminSessionToken('correct-password', extended, now), false);
});
