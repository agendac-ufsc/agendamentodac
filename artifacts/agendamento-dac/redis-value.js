function parseRedisValue(data) {
    if (data === null || data === undefined || data === '') return null;
    if (typeof data === 'boolean') return data;
    if (Array.isArray(data) || (typeof data === 'object' && data !== null)) return data;
    if (typeof data === 'string') {
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    }
    return null;
}

module.exports = { parseRedisValue };
