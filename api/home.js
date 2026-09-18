const fs = require('fs');
const path = require('path');

const appRoot = path.join(process.cwd(), 'artifacts', 'agendamento-dac');
const configKey = 'agendamentos_config';

function getRedisCredentials() {
  let url = String(process.env.UPSTASH_REDIS_REST_URL || '').trim();
  let token = String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

  if ((!url || !token) && process.env.REDIS_URL) {
    try {
      const parsed = new URL(String(process.env.REDIS_URL).trim());
      if (parsed.protocol === 'https:') {
        url = `${parsed.protocol}//${parsed.hostname}`;
        token = decodeURIComponent(parsed.password || parsed.username || '');
      } else if (parsed.protocol === 'redis:' || parsed.protocol === 'rediss:') {
        url = `https://${parsed.hostname}`;
        token = decodeURIComponent(parsed.password || '');
      }
    } catch (error) {
      console.error('[home] REDIS_URL inválida:', error.message);
    }
  }

  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

module.exports = async function home(req, res) {
  // O modo unificado é obrigatório por padrão. O modo legado só é permitido
  // quando o backend tiver persistido a chave explícita de emergência.
  const MODO_2_ETAPAS_CHAVE_EMERGENCIA = 'DAC-EMERGENCIA-MODO-2-ETAPAS';
  let modoInscricao = 'unificado';

  try {
    const redis = getRedisCredentials();
    if (redis) {
      const response = await fetch(`${redis.url}/get/${encodeURIComponent(configKey)}`, {
        headers: { Authorization: `Bearer ${redis.token}` }
      });
      if (!response.ok) throw new Error(`Redis respondeu HTTP ${response.status}`);
      const payload = await response.json();
      const config = parseConfig(payload.result);
      if (config.modoInscricao === 'duas-etapas'
          && String(config.modoInscricaoEmergencia || '').trim() === MODO_2_ETAPAS_CHAVE_EMERGENCIA) {
        modoInscricao = 'duas-etapas';
      }
    }
  } catch (error) {
    console.error('[home] Não foi possível carregar o modo de inscrição:', error.message);
  }

  const pagina = modoInscricao === 'unificado' ? 'index-teste.html' : 'index.html';
  const html = fs.readFileSync(path.join(appRoot, pagina), 'utf8');

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
};