const { parseRedisValue } = require('./redis-value');

const ARQUIVAMENTO_AUTOMATICO_KEY = 'inscricoes_arquivamento_automatico_ativo';

async function ensureAutomaticArchiveEnabled(redis) {
    if (!redis) throw new Error('Armazenamento de configurações indisponível.');

    const currentValue = parseRedisValue(await redis.get(ARQUIVAMENTO_AUTOMATICO_KEY));
    if (currentValue !== true) {
        await redis.set(ARQUIVAMENTO_AUTOMATICO_KEY, true);
    }

    const savedValue = parseRedisValue(await redis.get(ARQUIVAMENTO_AUTOMATICO_KEY));
    if (savedValue !== true) {
        throw new Error('Não foi possível confirmar a ativação permanente do arquivamento automático.');
    }

    return true;
}

module.exports = {
    ARQUIVAMENTO_AUTOMATICO_KEY,
    ensureAutomaticArchiveEnabled
};
