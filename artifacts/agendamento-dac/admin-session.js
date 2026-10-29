const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const SESSION_PART_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function createAdminSessionToken(adminPassword, now = Date.now()) {
    const password = String(adminPassword || '');
    if (!password) throw new Error('Senha administrativa não configurada.');
    const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS;
    const nonce = randomBytes(32).toString('base64url');
    const signature = createHmac('sha256', password)
        .update(`dac-admin-session:${expiresAt}:${nonce}`)
        .digest('base64url');
    return `${expiresAt}.${nonce}.${signature}`;
}

function verifyAdminSessionToken(adminPassword, token, now = Date.now()) {
    const password = String(adminPassword || '');
    const partes = String(token || '').split('.');
    if (!password || partes.length !== 3) return false;

    const [expiresAtText, nonce, signature] = partes;
    if (!/^\d+$/.test(expiresAtText) || !SESSION_PART_PATTERN.test(nonce) || !SESSION_PART_PATTERN.test(signature)) {
        return false;
    }

    const expiresAt = Number(expiresAtText);
    const nowSeconds = Math.floor(now / 1000);
    if (!Number.isSafeInteger(expiresAt)
        || expiresAt <= nowSeconds
        || expiresAt > nowSeconds + ADMIN_SESSION_TTL_SECONDS) {
        return false;
    }

    const expected = createHmac('sha256', password)
        .update(`dac-admin-session:${expiresAt}:${nonce}`)
        .digest();
    const supplied = Buffer.from(signature, 'base64url');
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

module.exports = {
    ADMIN_SESSION_TTL_SECONDS,
    createAdminSessionToken,
    verifyAdminSessionToken
};
