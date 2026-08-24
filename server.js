require('dotenv').config();

// Captura qualquer crash antes de chegar nos handlers — crítico para serverless
process.on('uncaughtException', (err) => {
    console.error('❌ [process] uncaughtException:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ [process] unhandledRejection:', reason);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { google } = require('googleapis');
const { Redis } = require('@upstash/redis');

const app = express();
app.use(cors());
// O termo assinado é enviado como PDF em base64; manter margem suficiente para o anexo.
app.use(express.json({ limit: '10mb' }));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); next(); });
app.use(express.static(path.join(__dirname)));

// Configurar Google Calendar — locais disponíveis
const CALENDAR_IDS = {
    teatro: 'oto.bezerra@ufsc.br',
    igrejinha: process.env.IGREJINHA_CALENDAR_ID || 'c_e19d30c40d4de176bc7d4e11ada96bfaffd130b3ed499d9807c88785e2c71c05@group.calendar.google.com'
};
const CALENDAR_ID = CALENDAR_IDS.teatro; // retrocompatibilidade
let googleAuthClient;
let SERVICE_ACCOUNT_EMAIL = '';

// Funções para persistência com Upstash Redis (REST)
const AGENDAMENTOS_KEY = 'agendamentos_v1';

let redis;
try {
    let url = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/^["']|["']$/g, '');
    let token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').replace(/^["']|["']$/g, '');

    // Fallback: aceitar REDIS_URL em vários formatos
    // - https://default:TOKEN@HOST.upstash.io  (REST)
    // - rediss://default:TOKEN@HOST.upstash.io:PORT  (Redis TLS — formato padrão do Vercel/Upstash integration)
    // - redis://default:TOKEN@HOST:PORT
    if ((!url || !token) && process.env.REDIS_URL) {
        const raw = process.env.REDIS_URL.replace(/^["']|["']$/g, '');
        console.log(`[Redis] Tentando REDIS_URL — protocolo detectado: ${raw.split(':')[0]}`);
        try {
            const parsed = new URL(raw);
            if (parsed.protocol === 'https:') {
                url = `${parsed.protocol}//${parsed.hostname}`;
                token = parsed.password || parsed.username;
            } else if (parsed.protocol === 'rediss:' || parsed.protocol === 'redis:') {
                // Upstash via integração Vercel: rediss://default:TOKEN@host.upstash.io:PORT
                // Converter para REST: https://host.upstash.io + token = password
                url = `https://${parsed.hostname}`;
                token = parsed.password || parsed.username;
                console.log(`[Redis] REDIS_URL rediss:// convertido para REST — host: ${parsed.hostname}`);
            }
        } catch (parseErr) {
            console.error('[Redis] Erro ao parsear REDIS_URL:', parseErr.message);
        }
    }

    // Corrige caso as credenciais tenham sido salvas invertidas
    if (url && token && !url.startsWith('https://') && token.startsWith('https://')) {
        [url, token] = [token, url];
    }
    if (url && token) {
        redis = new Redis({ url, token });
        console.log('✅ [Redis] Cliente Upstash REST inicializado com sucesso.');
    } else {
        console.warn('⚠️ [Redis] Credenciais Upstash não encontradas no ambiente.');
    }
} catch (e) {
    console.error('❌ [Redis] Erro ao inicializar cliente:', e.message);
}

const parseRedisValue = (data) => {
    if (!data) return null;
    if (Array.isArray(data) || (typeof data === 'object' && data !== null)) return data;
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return null; }
    }
    return null;
};

const getAgendamentos = async () => {
    try {
        if (redis) {
            const data = await redis.get(AGENDAMENTOS_KEY);
            const parsed = parseRedisValue(data);
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch (error) {
        console.error('❌ [Redis] Erro ao buscar agendamentos:', error.message);
    }
    return [];
};

const saveAgendamento = async (novoAgendamento) => {
    try {
        if (redis) {
            const agendamentos = await getAgendamentos();
            if (!novoAgendamento.id) {
                novoAgendamento.id = `site_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }
            agendamentos.push(novoAgendamento);
            // Upstash REST serializa automaticamente — não usar JSON.stringify extra
            await redis.set(AGENDAMENTOS_KEY, agendamentos);
            console.log("✅ [Redis] Agendamento salvo com sucesso. Dados:", JSON.stringify(novoAgendamento));
            return true;
        }
    } catch (error) {
        console.error('❌ [Redis] Erro ao salvar agendamento:', error.message);
    }
    return false;
};

const updateAgendamento = async (id, campos) => {
    try {
        if (redis) {
            const agendamentos = await getAgendamentos();
            const idx = agendamentos.findIndex(a => a.id === id);
            if (idx === -1) return false;
            agendamentos[idx] = { ...agendamentos[idx], ...campos };
            await redis.set(AGENDAMENTOS_KEY, agendamentos);
            return true;
        }
    } catch (error) {
        console.error('❌ [Redis] Erro ao atualizar agendamento:', error.message);
    }
    return false;
};

const verificarEventosNoCalendario = async (agendamento) => {
    if (!googleAuthClient) await initGoogleAuth();
    try {
        const allEvents = await calendar.events.list({
            auth: googleAuthClient,
            calendarId: CALENDAR_ID,
            maxResults: 2500,
            singleEvents: true
        });
        
        const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
        const eventosEsperados = [];
        
        // Listar todos os eventos esperados para este agendamento
        for (const key in agendamento.etapas) {
            const itens = Array.isArray(agendamento.etapas[key]) ? agendamento.etapas[key] : [agendamento.etapas[key]];
            itens.forEach((item, i) => {
                const label = itens.length > 1 ? `${nomesEtapas[key]} ${i + 1}` : nomesEtapas[key];
                const eventSummary = `${label}: ${agendamento.evento}`;
                eventosEsperados.push(eventSummary);
            });
        }
        
        // Verificar se os eventos ainda existem no calendário
        // Usamos uma lógica mais flexível: se encontrarmos QUALQUER evento que mencione o e-mail do proponente
        // e tenha o nome do evento no título, consideramos que o agendamento ainda é válido.
        const eventosEncontrados = allEvents.data.items.filter(e => {
            const summaryMatch = e.summary && e.summary.toLowerCase().includes(agendamento.evento.toLowerCase());
            const descriptionMatch = e.description && e.description.toLowerCase().includes(agendamento.email.toLowerCase());
            return summaryMatch && descriptionMatch;
        });
        
        // Se nenhum evento foi encontrado, significa que foram apagados
        // Para agendamentos muito recentes (menos de 5 minutos), assumimos que existem (evita delay de propagação do Google)
        const isRecent = agendamento.id && (Date.now() - parseInt(agendamento.id)) < 300000;
        return eventosEncontrados.length > 0 || isRecent;
    } catch (error) {
        console.error('⚠️ [Google Calendar] Erro ao verificar eventos:', error.message);
        return true; // Assume que existem para não quebrar o fluxo
    }
};

const deleteAgendamentoById = async (id) => {
    try {
        if (!redis) return false;
        const agendamentos = await getAgendamentos();
        const agendamentoAExcluir = agendamentos.find(a => String(a.id) === String(id));
        if (!agendamentoAExcluir) return false;

        let eventosFalhos = 0;
        if (agendamentoAExcluir.etapas) {
            if (!googleAuthClient) await initGoogleAuth();
        }
        if (agendamentoAExcluir.etapas && googleAuthClient) {
            const calendarId = agendamentoAExcluir.calendarId
                || CALENDAR_IDS[(agendamentoAExcluir.local || 'teatro').toLowerCase()]
                || CALENDAR_IDS.teatro;
            const resposta = await calendar.events.list({
                auth: googleAuthClient,
                calendarId,
                maxResults: 2500,
                singleEvents: true
            });
            const eventos = resposta.data.items || [];
            const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
            const horaDoEvento = event => {
                const inicio = event.start?.dateTime || '';
                return {
                    data: inicio.slice(0, 10),
                    hora: inicio.includes('T') ? inicio.split('T')[1].slice(0, 5) : ''
                };
            };

            for (const [key, valores] of Object.entries(agendamentoAExcluir.etapas)) {
                const itens = Array.isArray(valores) ? valores : [valores];
                for (let i = 0; i < itens.length; i++) {
                    const item = itens[i];
                    if (!item?.data || !item?.horario) continue;
                    const label = itens.length > 1 ? `${nomesEtapas[key]} ${i + 1}` : nomesEtapas[key];
                    const [horaInicio] = String(item.horario).split(' às ');
                    const matches = eventos.filter(event => {
                        const inicio = horaDoEvento(event);
                        return event.summary === `${label}: ${agendamentoAExcluir.evento}`
                            && event.description
                            && event.description.includes(agendamentoAExcluir.email || '')
                            && inicio.data === item.data
                            && inicio.hora === horaInicio;
                    });
                    for (const event of matches) {
                        try {
                            await calendar.events.delete({ auth: googleAuthClient, calendarId, eventId: event.id });
                            console.log(`✅ [Calendar] Evento deletado: ${event.summary} (${item.data} ${horaInicio})`);
                        } catch (err) {
                            eventosFalhos++;
                            console.error(`⚠️ [Calendar] Erro ao deletar evento ${event.id}:`, err.message);
                        }
                    }
                }
            }
        }

        // Só remove o registro que corresponde ao ID selecionado no painel.
        const filtrados = agendamentos.filter(a => String(a.id) !== String(id));
        await redis.set(AGENDAMENTOS_KEY, filtrados);
        console.log(`✅ [Redis] Agendamento ${id} removido.`);

        const nomeEvento = (agendamentoAExcluir.evento || '').trim().toLowerCase().replace(/\s+/g, '_');
        const emailNorm = (agendamentoAExcluir.email || '').trim().toLowerCase();
        const formsId = `forms_${emailNorm || 'noemail'}_${nomeEvento}`;
        await addToBlacklist(formsId).catch(() => {});
        await addToBlacklist(agendamentoAExcluir.id).catch(() => {});
        return { success: true, eventosFalhos };
    } catch (error) {
        console.error('❌ [Redis] Erro ao deletar agendamento:', error.message);
    }
    return false;
};

// Compatibilidade: nunca apagar vários registros só porque compartilham o e-mail.
const deleteAgendamentoByEmail = async (email) => {
    const agendamentos = await getAgendamentos();
    const encontrados = agendamentos.filter(a => (a.email || '').trim().toLowerCase() === String(email || '').trim().toLowerCase());
    if (encontrados.length !== 1) {
        console.warn(`⚠️ [Exclusão] E-mail corresponde a ${encontrados.length} registros; exclusão bloqueada sem ID.`);
        return false;
    }
    return deleteAgendamentoById(encontrados[0].id);
};

const initGoogleAuth = async () => {
    try {
        const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        if (serviceAccountKey) {
            const credentials = JSON.parse(serviceAccountKey);
            SERVICE_ACCOUNT_EMAIL = credentials.client_email || '';
            const auth = new google.auth.GoogleAuth({
                credentials: {
                    client_email: credentials.client_email,
                    private_key: credentials.private_key,
                },
                scopes: [
                    'https://www.googleapis.com/auth/calendar',
                    'https://www.googleapis.com/auth/spreadsheets.readonly'
                ],
            });
            googleAuthClient = await auth.getClient();
            console.log('✅ [Google] Autenticação configurada com sucesso.');
        }
    } catch (error) {
        console.error('❌ [Google] Erro ao configurar autenticação:', error.message);
    }
};

initGoogleAuth().catch(err => console.error('❌ [initGoogleAuth] Falha na inicialização:', err.message));

const calendar = google.calendar({ version: 'v3' });
const sheets = google.sheets({ version: 'v4' });
let SPREADSHEET_ID = '1FFjm8WMtLGbWqFDsSwtkFfuuCaN9zNzi7RB7Z68CZAo';
let FORMS_LINK = 'https://docs.google.com/forms/d/e/1FAIpQLSemUx54pVFiR-lyYql3Imyp82SzPaecsVIMCfFDP5-VPJ97mw/viewform?usp=dialog';
let PERMITIR_DISPUTA = true; // Padrão é permitir disputa conforme comportamento atual
let HORARIOS_LIMITES = {
    ensaio: { inicio: '08:00', fim: '21:00' },
    montagem: { inicio: '08:00', fim: '21:00' },
    desmontagem: { inicio: '08:00', fim: '21:00' }
};
let DATAS_BLOQUEADAS = [];
let TITULO_PAGINA_AGENDAMENTO = 'Inscrição de Projeto';
let AVALIACOES_NECESSARIAS = 3;
const RESPONSAVEL_TERMO_NOME_PADRAO = 'Andréa Búrigo Ventura';
let RESPONSAVEL_TERMO_NOME = RESPONSAVEL_TERMO_NOME_PADRAO;
let BOTOES_HOME = {
    interno: { ativo: false, texto: 'Edital Interno' },
    externo: { ativo: true,  texto: 'Edital de Ocupação dos Espaços do DAC 2026' },
    ensaio:  { ativo: false, texto: 'Agendar Apenas Ensaio' }
};
let MENSAGEM_BOTOES_DESATIVADOS = 'As inscrições estão encerradas no momento.';
let SOMENTE_FINSEMANA = false; // Se true, inscrições só são aceitas de qui a dom

const CONFIG_KEY = 'agendamentos_config';

const getConfigs = async (caller = 'unknown') => {
    console.log(`[getConfigs] chamado por: ${caller} | redis disponível: ${!!redis}`);
    try {
        if (redis) {
            const data = await redis.get(CONFIG_KEY);
            console.log(`[getConfigs] raw Redis value type: ${typeof data} | null? ${data === null}`);
            if (data) {
                const configs = parseRedisValue(data);
                const prevSheet = SPREADSHEET_ID;
                const prevForms = FORMS_LINK;
                SPREADSHEET_ID = extractSpreadsheetId(configs.spreadsheetId) || SPREADSHEET_ID;
                FORMS_LINK = configs.formsLink || FORMS_LINK;
                PERMITIR_DISPUTA = configs.permitirDisputa !== undefined ? configs.permitirDisputa : true;
                SOMENTE_FINSEMANA = configs.somenteFinaisDeSemana !== undefined ? configs.somenteFinaisDeSemana : false;
                HORARIOS_LIMITES = configs.horariosLimites || HORARIOS_LIMITES;
                DATAS_BLOQUEADAS = configs.datasBloqueadas || [];
                TITULO_PAGINA_AGENDAMENTO = configs.tituloPaginaAgendamento || TITULO_PAGINA_AGENDAMENTO;
                if (configs.avaliacoesNecessarias !== undefined) {
                    const n = parseInt(configs.avaliacoesNecessarias, 10);
                    if (Number.isFinite(n) && n > 0) AVALIACOES_NECESSARIAS = Math.min(n, 20);
                }
                if (typeof configs.responsavelTermoNome === 'string' && configs.responsavelTermoNome.trim()) {
                    RESPONSAVEL_TERMO_NOME = configs.responsavelTermoNome.trim();
                }
                if (configs.botoesHome && typeof configs.botoesHome === 'object') {
                    BOTOES_HOME = {
                        interno: { ...BOTOES_HOME.interno, ...(configs.botoesHome.interno || {}) },
                        externo: { ...BOTOES_HOME.externo, ...(configs.botoesHome.externo || {}) },
                        ensaio:  { ...BOTOES_HOME.ensaio,  ...(configs.botoesHome.ensaio  || {}) }
                    };
                }
                if (configs.mensagemBotoesDesativados !== undefined) {
                    MENSAGEM_BOTOES_DESATIVADOS = configs.mensagemBotoesDesativados || MENSAGEM_BOTOES_DESATIVADOS;
                }
                if (prevSheet !== SPREADSHEET_ID || prevForms !== FORMS_LINK) {
                    console.log(`[getConfigs] ✅ Config carregada do Redis — sheet: ${SPREADSHEET_ID} | forms: ${FORMS_LINK?.slice(0,60)}`);
                } else {
                    console.log(`[getConfigs] ✅ Config do Redis sem mudança — sheet: ${SPREADSHEET_ID}`);
                }
                return { 
                    spreadsheetId: SPREADSHEET_ID, 
                    formsLink: FORMS_LINK,
                    permitirDisputa: PERMITIR_DISPUTA,
                    somenteFinaisDeSemana: SOMENTE_FINSEMANA,
                    horariosLimites: HORARIOS_LIMITES,
                    datasBloqueadas: DATAS_BLOQUEADAS,
                    tituloPaginaAgendamento: TITULO_PAGINA_AGENDAMENTO,
                    avaliacoesNecessarias: AVALIACOES_NECESSARIAS,
                    responsavelTermoNome: RESPONSAVEL_TERMO_NOME || RESPONSAVEL_TERMO_NOME_PADRAO,
                    botoesHome: BOTOES_HOME,
                    mensagemBotoesDesativados: MENSAGEM_BOTOES_DESATIVADOS
                };
            } else {
                console.warn(`[getConfigs] ⚠️ Nenhum valor encontrado no Redis para chave "${CONFIG_KEY}" — usando padrões em memória`);
            }
        } else {
            console.warn('[getConfigs] ⚠️ Redis indisponível — retornando valores em memória');
        }
    } catch (error) {
        console.error('[getConfigs] ❌ Erro ao buscar configurações:', error.message, error.stack);
    }
    console.log(`[getConfigs] fallback — sheet: ${SPREADSHEET_ID} | forms: ${FORMS_LINK?.slice(0,60)}`);
    return { 
        spreadsheetId: SPREADSHEET_ID, 
        formsLink: FORMS_LINK,
        permitirDisputa: PERMITIR_DISPUTA,
        somenteFinaisDeSemana: SOMENTE_FINSEMANA,
        horariosLimites: HORARIOS_LIMITES,
        datasBloqueadas: DATAS_BLOQUEADAS,
        tituloPaginaAgendamento: TITULO_PAGINA_AGENDAMENTO,
        avaliacoesNecessarias: AVALIACOES_NECESSARIAS,
        responsavelTermoNome: RESPONSAVEL_TERMO_NOME || RESPONSAVEL_TERMO_NOME_PADRAO,
        botoesHome: BOTOES_HOME,
        mensagemBotoesDesativados: MENSAGEM_BOTOES_DESATIVADOS
    };
};

const extractSpreadsheetId = (input) => {
    if (!input) return null;
    let id = input.trim();
    
    // Se for uma URL completa do Google Sheets
    if (id.includes('/d/')) {
        const match = id.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match) return match[1];
    }
    
    // Se for um link que começa direto pelo ID (ex: 1cQ0w.../edit)
    if (id.includes('/')) {
        return id.split('/')[0];
    }
    
    return id;
};

const saveConfigs = async (configs) => {
    console.log(`[saveConfigs] iniciando — redis: ${!!redis} | sheet recebido: ${configs.spreadsheetId} | forms recebido: ${(configs.formsLink||'').slice(0,60)}`);
    try {
        // Extrair o ID caso tenham colado a URL completa
        const cleanSpreadsheetId = extractSpreadsheetId(configs.spreadsheetId);
        
        // Atualiza em memória primeiro
        SPREADSHEET_ID = cleanSpreadsheetId || SPREADSHEET_ID;
        FORMS_LINK = configs.formsLink || FORMS_LINK;
        if (configs.permitirDisputa !== undefined) {
            PERMITIR_DISPUTA = configs.permitirDisputa;
        }
        if (configs.somenteFinaisDeSemana !== undefined) {
            SOMENTE_FINSEMANA = configs.somenteFinaisDeSemana;
        }
        if (configs.horariosLimites) {
            HORARIOS_LIMITES = configs.horariosLimites;
        }
        if (configs.datasBloqueadas) {
            DATAS_BLOQUEADAS = configs.datasBloqueadas;
        }
        if (configs.tituloPaginaAgendamento !== undefined) {
            TITULO_PAGINA_AGENDAMENTO = (configs.tituloPaginaAgendamento || '').trim() || 'Inscrição de Projeto';
        }
        if (configs.avaliacoesNecessarias !== undefined) {
            const n = parseInt(configs.avaliacoesNecessarias, 10);
            if (Number.isFinite(n) && n > 0) AVALIACOES_NECESSARIAS = Math.min(n, 20);
        }
        if (configs.responsavelTermoNome !== undefined) {
            const nome = String(configs.responsavelTermoNome || '').trim();
            if (nome) RESPONSAVEL_TERMO_NOME = nome;
        }
        if (configs.botoesHome && typeof configs.botoesHome === 'object') {
            const norm = (b, padraoTexto) => ({
                ativo: !!(b && b.ativo),
                texto: ((b && typeof b.texto === 'string' ? b.texto : '') || '').trim() || padraoTexto,
                dataInicio: (b && typeof b.dataInicio === 'string' && b.dataInicio) ? b.dataInicio : null
            });
            BOTOES_HOME = {
                interno: norm(configs.botoesHome.interno, 'Edital Interno'),
                externo: norm(configs.botoesHome.externo, 'Edital de Ocupação dos Espaços do DAC 2026'),
                ensaio:  norm(configs.botoesHome.ensaio,  'Agendar Apenas Ensaio')
            };
        }
        if (configs.mensagemBotoesDesativados !== undefined) {
            MENSAGEM_BOTOES_DESATIVADOS = (configs.mensagemBotoesDesativados || '').trim() || MENSAGEM_BOTOES_DESATIVADOS;
        }

        if (redis) {
            const configToSave = {
                spreadsheetId: cleanSpreadsheetId,
                formsLink: FORMS_LINK,
                permitirDisputa: PERMITIR_DISPUTA,
                somenteFinaisDeSemana: SOMENTE_FINSEMANA,
                horariosLimites: HORARIOS_LIMITES,
                datasBloqueadas: DATAS_BLOQUEADAS,
                tituloPaginaAgendamento: TITULO_PAGINA_AGENDAMENTO,
                avaliacoesNecessarias: AVALIACOES_NECESSARIAS,
                responsavelTermoNome: RESPONSAVEL_TERMO_NOME,
                botoesHome: BOTOES_HOME,
                mensagemBotoesDesativados: MENSAGEM_BOTOES_DESATIVADOS
            };
            console.log(`[saveConfigs] gravando no Redis — sheet: ${cleanSpreadsheetId} | forms: ${FORMS_LINK?.slice(0,60)}`);
            const setResult = await redis.set(CONFIG_KEY, configToSave);
            console.log(`[saveConfigs] ✅ redis.set resultado: ${JSON.stringify(setResult)}`);
            // Verificação imediata: re-lê do Redis para confirmar persistência
            const verify = await redis.get(CONFIG_KEY);
            const vParsed = parseRedisValue(verify);
            console.log(`[saveConfigs] verificação pós-set — sheet lido: ${vParsed?.spreadsheetId} | forms lido: ${(vParsed?.formsLink||'').slice(0,60)}`);
        } else {
            console.warn('[saveConfigs] ⚠️ Redis indisponível — salvo apenas em memória. Não persistirá entre reinicializações!');
        }
        return true;
    } catch (error) {
        console.error('[saveConfigs] ❌ Erro:', error.message, error.stack);
    }
    return false;
};

// Carregar configurações iniciais
getConfigs('startup').catch(err => console.error('❌ [startup] Erro ao carregar configs:', err.message));

const createCalendarEvent = async (summary, description, date, timeRange, calendarId = CALENDAR_IDS.teatro) => {
    if (!googleAuthClient) await initGoogleAuth();
    try {
        const [startTime, endTime] = timeRange.split(' às ');
        const startDateTimeStr = `${date}T${startTime}:00-03:00`;
        const endDateTimeStr = `${date}T${endTime}:00-03:00`;
        const event = {
            summary: summary,
            description: description,
            start: { dateTime: startDateTimeStr, timeZone: 'America/Sao_Paulo' },
            end: { dateTime: endDateTimeStr, timeZone: 'America/Sao_Paulo' },
            extendedProperties: { private: { dac_source: 'sistema' } }
        };
        const response = await calendar.events.insert({
            auth: googleAuthClient,
            calendarId: calendarId,
            resource: event,
        });
        return response.data;
    } catch (error) {
        console.error(`❌ [Google] Erro ao criar evento:`, error.message);
        return null;
    }
};

// Endpoint de diagnóstico — mostra estado do Redis e configuração em memória
app.get('/api/debug', async (req, res) => {
    const env = {
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ? `${process.env.UPSTASH_REDIS_REST_URL.slice(0, 30)}...` : '❌ NÃO DEFINIDO',
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ? '✅ definido' : '❌ NÃO DEFINIDO',
        GOOGLE_SERVICE_ACCOUNT_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? '✅ definido' : '❌ NÃO DEFINIDO',
        BREVO_API_KEY: process.env.BREVO_API_KEY ? '✅ definido' : '❌ NÃO DEFINIDO',
        SENDER_EMAIL: process.env.SENDER_EMAIL || '❌ NÃO DEFINIDO',
        ADMIN_EMAIL: process.env.ADMIN_EMAIL || '❌ NÃO DEFINIDO',
        NODE_ENV: process.env.NODE_ENV || 'não definido',
    };
    let redisRaw = null;
    let redisParsed = null;
    let redisError = null;
    try {
        if (redis) {
            redisRaw = await redis.get(CONFIG_KEY);
            redisParsed = parseRedisValue(redisRaw);
        }
    } catch(e) {
        redisError = e.message;
    }
    const inMemory = {
        SPREADSHEET_ID,
        FORMS_LINK: FORMS_LINK?.slice(0, 80),
        PERMITIR_DISPUTA,
        TITULO_PAGINA_AGENDAMENTO,
        AVALIACOES_NECESSARIAS,
    };
    const redisStored = redisParsed ? {
        spreadsheetId: redisParsed.spreadsheetId,
        formsLink: (redisParsed.formsLink || '').slice(0, 80),
        permitirDisputa: redisParsed.permitirDisputa,
    } : null;
    console.log('[/api/debug] estado atual:', JSON.stringify({ env, inMemory, redisStored, redisError }));
    res.json({
        ts: new Date().toISOString(),
        redis_disponivel: !!redis,
        redis_error: redisError,
        env_vars: env,
        in_memory: inMemory,
        redis_stored: redisStored,
        match: redisStored ? (redisStored.spreadsheetId === inMemory.SPREADSHEET_ID && redisStored.formsLink === inMemory.FORMS_LINK?.slice(0,80)) : null,
    });
});

// Rota para obter configurações (pública para o site poder pegar o link do forms)
app.get('/api/config', async (req, res) => {
    const configs = await getConfigs('GET /api/config');
    res.json(configs);
});

// Rota para salvar configurações (administrativa)
app.post('/api/admin/config', async (req, res) => {
    const { spreadsheetId, formsLink, permitirDisputa, somenteFinaisDeSemana, horariosLimites, datasBloqueadas, tituloPaginaAgendamento, botoesHome, avaliacoesNecessarias, responsavelTermoNome } = req.body;
    // PermitirDisputa pode ser booleano, então verificamos se é undefined
    if (!spreadsheetId || !formsLink) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
    }
    const success = await saveConfigs({ spreadsheetId, formsLink, permitirDisputa, somenteFinaisDeSemana, horariosLimites, datasBloqueadas, tituloPaginaAgendamento, botoesHome, avaliacoesNecessarias, responsavelTermoNome });
    if (!success) return res.status(500).json({ success: false, error: 'Falha ao persistir no Redis. Verifique as credenciais UPSTASH.' });
    res.json({ success });
});

// Salva somente o nome da representante, sem depender dos demais campos do painel.
// Isso evita que uma configuração antiga ou incompleta sobrescreva este valor.
app.post('/api/admin/termo-responsavel', async (req, res) => {
    const nome = String(req.body?.responsavelTermoNome || '').trim();
    if (!nome) {
        return res.status(400).json({ error: 'Informe o nome completo da representante.' });
    }

    try {
        RESPONSAVEL_TERMO_NOME = nome;
        if (!redis) {
            return res.status(500).json({ success: false, error: 'Redis indisponível; o nome não pôde ser persistido.' });
        }

        const atualRaw = await redis.get(CONFIG_KEY);
        const atual = parseRedisValue(atualRaw) || {};
        const configToSave = {
            ...atual,
            responsavelTermoNome: nome
        };
        await redis.set(CONFIG_KEY, configToSave);

        const verificado = parseRedisValue(await redis.get(CONFIG_KEY)) || {};
        if (String(verificado.responsavelTermoNome || '').trim() !== nome) {
            return res.status(500).json({ success: false, error: 'O nome não foi confirmado no armazenamento.' });
        }

        console.log(`[termo-responsavel] ✅ Nome persistido: ${nome}`);
        return res.json({ success: true, responsavelTermoNome: nome });
    } catch (error) {
        console.error('[termo-responsavel] ❌ Erro ao salvar:', error.message);
        return res.status(500).json({ success: false, error: 'Falha ao persistir o nome da representante.' });
    }
});

app.get('/api/disponibilidade', async (req, res) => {
    if (!googleAuthClient) await initGoogleAuth();
    try {
        const { start, end, local } = req.query;
        const calId = CALENDAR_IDS[(local || 'teatro').toLowerCase()] || CALENDAR_IDS.teatro;
        const response = await calendar.events.list({
            auth: googleAuthClient,
            calendarId: calId,
            timeMin: start || new Date().toISOString(),
            timeMax: end || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500
        });
        const ocupados = response.data.items.map(event => {
            const creatorEmail = event.creator && event.creator.email ? event.creator.email : '';
            const hasExtProp = event.extendedProperties && event.extendedProperties.private && event.extendedProperties.private.dac_source === 'sistema';
            const isSistema = hasExtProp || (SERVICE_ACCOUNT_EMAIL && creatorEmail === SERVICE_ACCOUNT_EMAIL);
            return {
                start: event.start.dateTime || event.start.date,
                end: event.end.dateTime || event.end.date,
                summary: event.summary,
                description: event.description || '',
                source: isSistema ? 'sistema' : 'manual'
            };
        });
        res.json(ocupados);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao consultar calendário' });
    }
});

// Função para obter a lista de exclusão (Blacklist)
const getBlacklist = async () => {
    if (!redis) return [];
    try {
        const blacklist = await redis.get('agendamentos_blacklist');
        return parseRedisValue(blacklist) || [];
    } catch (error) {
        console.warn('⚠️ Erro ao obter Blacklist:', error.message);
        return [];
    }
};

// Função para adicionar um ID à Blacklist
const addToBlacklist = async (id) => {
    if (!redis) return false;
    try {
        const blacklist = await getBlacklist();
        if (!blacklist.includes(id)) {
            blacklist.push(id);
            await redis.set('agendamentos_blacklist', blacklist);
            console.log(`✅ [Blacklist] ID ${id} adicionado à lista de exclusão`);
        }
        return true;
    } catch (error) {
        console.error('❌ Erro ao adicionar à Blacklist:', error.message);
        return false;
    }
};

// Função para limpar a Blacklist
const clearBlacklist = async () => {
    if (!redis) return false;
    try {
        await redis.del('agendamentos_blacklist');
        console.log('✅ [Blacklist] Limpa com sucesso');
        return true;
    } catch (error) {
        console.error('❌ Erro ao limpar Blacklist:', error.message);
        return false;
    }
};

const sendEmail = async (to, subject, htmlContent) => {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return null;
    const senderEmail = process.env.SENDER_EMAIL || "agendac.ufsc@gmail.com";
    const data = {
        sender: { "name": "Agendamento DAC", "email": senderEmail },
        to: Array.isArray(to) ? to.map(email => ({ "email": email })) : [{ "email": to }],
        replyTo: { "email": "pautas.dac@contato.ufsc.br", "name": "DAC - UFSC" },
        subject: subject,
        htmlContent: htmlContent
    };
    try {
        const response = await axios.post('https://api.brevo.com/v3/smtp/email', data, {
            headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }
        });
        return response.data;
    } catch (error) {
        return null;
    }
};

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const ATIVIDADES_FORMULARIO_URL = 'https://docs.google.com/forms/d/1CVycogEYCWiVRUf1HngQrfWaIScR_4KEROKc7OoJkZQ/viewform?edit_requested=true#responses';
const ATIVIDADES_FORMULARIO_LABEL = 'Formulário Atividades DAC 2026';
const ATIVIDADES_ENVIADAS_PREFIX = 'atividades_formulario_enviado:';

function adicionarDiasUteisServidor(dataInicial, quantidade) {
    const data = new Date(dataInicial);
    let adicionados = 0;
    while (adicionados < quantidade) {
        data.setDate(data.getDate() + 1);
        const dia = data.getDay();
        if (dia !== 0 && dia !== 6) adicionados++;
    }
    return data;
}

function formatarDataBrasileiraServidor(data) {
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(data);
}

function obterFimDoUltimoEvento(agendamento) {
    const eventos = Array.isArray(agendamento?.etapas?.evento)
        ? agendamento.etapas.evento
        : agendamento?.etapas?.evento
            ? [agendamento.etapas.evento]
            : [];
    const candidatos = eventos.map(item => {
        const data = String(item?.data || '');
        const horario = String(item?.horario || '');
        const dataMatch = data.match(/^(\d{4})-(\d{2})-(\d{2})$/) || data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        const horaMatch = horario.match(/(\d{1,2}:\d{2})\s*(?:às|a|-)\s*(\d{1,2}:\d{2})/i);
        if (!dataMatch || !horaMatch) return null;
        const ano = dataMatch[1].length === 4 ? dataMatch[1] : dataMatch[3];
        const mes = dataMatch[1].length === 4 ? dataMatch[2] : dataMatch[2];
        const dia = dataMatch[1].length === 4 ? dataMatch[3] : dataMatch[1];
        const fim = horaMatch[2];
        const fimIso = `${ano}-${mes}-${dia}T${fim}:00-03:00`;
        const fimDate = new Date(fimIso);
        return Number.isNaN(fimDate.getTime()) ? null : { fimDate, data, horario };
    }).filter(Boolean);
    return candidatos.sort((a, b) => a.fimDate - b.fimDate).at(-1) || null;
}

function criarMensagemFormularioAtividades(prazo) {
    return `Conforme previsto no item 13.1.9. do Edital de Ocupação dos Espaços do DAC, solicitamos, por gentileza, o envio de informações complementares sobre a realização de seu evento no DAC, para fins de elaboração do relatório das atividades realizadas, incluindo dados como número total de público, registros fotográficos, ocorrências, sugestões e demais observações.

As informações deverão ser encaminhadas por meio do preenchimento do formulário disponível no link abaixo:

${ATIVIDADES_FORMULARIO_LABEL}

Pedimos que o formulário seja preenchido até o dia ${prazo}.

Permanecemos à disposição para quaisquer esclarecimentos e agradecemos, desde já, pela colaboração.

Atenciosamente,

--
Comissão de Pauta
Departamento Artístico Cultural
Secretaria de Cultura, Arte e Esporte
Universidade Federal de Santa Catarina`;
}

function criarHtmlFormularioAtividades(nome, mensagem) {
    const mensagemHtml = escapeHtml(mensagem)
        .replace(/\n/g, '<br>')
        .replace(
            escapeHtml(ATIVIDADES_FORMULARIO_LABEL),
            `<a href="${escapeHtml(ATIVIDADES_FORMULARIO_URL)}" style="color:#2563eb;font-weight:600;text-decoration:underline" target="_blank" rel="noopener noreferrer">${escapeHtml(ATIVIDADES_FORMULARIO_LABEL)}</a>`
        );
    return `
    <div style="font-family:sans-serif;max-width:620px;margin:auto;border:1px solid #ddd;border-radius:10px;overflow:hidden;color:#333">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:22px 28px">
            <h2 style="margin:0;color:#fff;font-size:18px">DAC — Departamento Artístico Cultural</h2>
            <p style="margin:4px 0 0;color:rgba(255,255,255,.8);font-size:12px">UFSC — Secretaria de Cultura, Arte e Esporte</p>
        </div>
        <div style="padding:28px">
            <p style="font-size:15px">Olá, <strong>${escapeHtml(nome || 'Proponente')}</strong>!</p>
            <div style="font-size:14px;color:#444;line-height:1.8;margin:18px 0;white-space:pre-wrap">${mensagemHtml}</div>
            <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
            <p style="font-size:13px;color:#555">Em caso de dúvidas, entre em contato diretamente com a equipe do DAC pelo e-mail <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold;">pautas.dac@contato.ufsc.br</a>.</p>
            <p style="font-size:11px;color:#aaa;margin-top:20px">UFSC — Secretaria de Cultura, Arte e Esporte · Departamento Artístico Cultural (DAC)<br>Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC</p>
        </div>
    </div>`;
}

async function verificarEnviosAutomaticosFormulario() {
    if (!redis || !process.env.BREVO_API_KEY) return;
    try {
        const agora = new Date();
        const agendamentos = await getAgendamentos();
        for (const agendamento of agendamentos) {
            const email = String(agendamento.email || '').trim().toLowerCase();
            if (!agendamento.id || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
            const ultimoEvento = obterFimDoUltimoEvento(agendamento);
            if (!ultimoEvento) continue;
            if (agora < ultimoEvento.fimDate) continue;

            const chaveEnvio = `${ATIVIDADES_ENVIADAS_PREFIX}${agendamento.id}:${ultimoEvento.fimDate.toISOString()}`;
            if (await redis.get(chaveEnvio)) continue;

            const prazo = formatarDataBrasileiraServidor(adicionarDiasUteisServidor(agora, 5));
            const resultado = await sendEmail(
                email,
                'Formulário Atividades DAC 2026',
                criarHtmlFormularioAtividades(agendamento.nome, criarMensagemFormularioAtividades(prazo))
            );
            if (resultado) {
                await redis.set(chaveEnvio, {
                    enviadoEm: agora.toISOString(),
                    ultimoEvento: ultimoEvento.fimDate.toISOString()
                });
                console.log(`✅ [Atividades] Formulário enviado automaticamente para ${email} no fim da inscrição ${agendamento.id}.`);
            } else {
                console.error(`❌ [Atividades] Falha ao enviar formulário automático para ${email}.`);
            }
        }
    } catch (error) {
        console.error('❌ [Atividades] Erro na verificação automática:', error.message);
    }
}

app.post('/api/agendar', async (req, res) => {
    try {
        const { nome, email, telefone, evento, etapas, local, modoTeste = false } = req.body;
        if (!nome || !email || !telefone || !evento || !etapas) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }
        const eventoEtapa = etapas.evento;
        const temEvento = Array.isArray(eventoEtapa) ? eventoEtapa.length > 0 : !!eventoEtapa;
        if (!temEvento) {
            return res.status(400).json({ error: 'É obrigatório informar pelo menos uma data de Evento para finalizar a inscrição.' });
        }
        const localKey = (local || 'teatro').toLowerCase();

        // Validar dias da semana se SOMENTE_FINSEMANA estiver ativo (qui=4, sex=5, sáb=6, dom=0)
        if (SOMENTE_FINSEMANA) {
            const diasPermitidos = new Set([0, 4, 5, 6]);
            for (const tipo of Object.keys(etapas)) {
                const itens = Array.isArray(etapas[tipo]) ? etapas[tipo] : [etapas[tipo]];
                for (const item of itens) {
                    if (!item || !item.data) continue;
                    const [y, m, d] = item.data.split('-').map(Number);
                    const diaSemana = new Date(y, m - 1, d).getDay();
                    if (!diasPermitidos.has(diaSemana)) {
                        return res.status(400).json({ error: 'Inscrições só são aceitas para datas de quinta-feira a domingo.' });
                    }
                }
            }
        }

        // Validar conflitos de horário quando disputa não é permitida
        if (!PERMITIR_DISPUTA) {
            const existentes = await getAgendamentos();
            const toMin = (h) => { const [hh, mm] = (h || '00:00').split(':').map(Number); return hh * 60 + (mm || 0); };
            const parseSlot = (horario) => {
                const partes = (horario || '').split('-').map(s => s.trim());
                return { start: toMin(partes[0]), end: toMin(partes[1] || partes[0]) };
            };
            // Buffer de 30 min: dois eventos conflitam se um começa antes de 30 min após o outro terminar
            const overlaps = (a, b) => a.start < b.end + 30 && a.end + 30 > b.start;
            const conflito = existentes.some(ex => {
                if ((ex.local || 'teatro') !== localKey) return false;
                if (!ex.etapas) return false;
                for (const tipo of Object.keys(etapas)) {
                    if (!ex.etapas[tipo]) continue;
                    const novas = Array.isArray(etapas[tipo]) ? etapas[tipo] : [etapas[tipo]];
                    const existEtapas = Array.isArray(ex.etapas[tipo]) ? ex.etapas[tipo] : [ex.etapas[tipo]];
                    for (const nova of novas) {
                        if (!nova?.data || !nova?.horario) continue;
                        for (const exist of existEtapas) {
                            if (!exist?.data || !exist?.horario) continue;
                            if (nova.data !== exist.data) continue;
                            if (overlaps(parseSlot(nova.horario), parseSlot(exist.horario))) return true;
                        }
                    }
                }
                return false;
            });
            if (conflito) {
                return res.status(409).json({ error: 'Este horário já está ocupado. A disputa de horários está desativada.' });
            }
        }
        const calId = CALENDAR_IDS[localKey] || CALENDAR_IDS.teatro;
        const localNome = localKey === 'igrejinha' ? 'Igrejinha da UFSC' : 'Teatro Carmen Fossari';
        const formatarData = (dataStr) => {
            const [year, month, day] = dataStr.split('-');
            return `${day}/${month}/${year}`;
        };
        const gerarTabelaEtapas = (etapas) => {
            let html = '<table style="width: 100%; border-collapse: collapse; margin-top: 10px;">';
            html += '<tr style="background: #f8f9fa;"><th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Etapa</th><th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Data</th><th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Horário</th></tr>';
            const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
            for (const key in etapas) {
                const itens = Array.isArray(etapas[key]) ? etapas[key] : [etapas[key]];
                itens.forEach((item, index) => {
                    const label = itens.length > 1 ? `${nomesEtapas[key]} ${index + 1}` : nomesEtapas[key];
                    html += `<tr><td style="border: 1px solid #ddd; padding: 8px;"><strong>${label}</strong></td><td style="border: 1px solid #ddd; padding: 8px;">${formatarData(item.data)}</td><td style="border: 1px solid #ddd; padding: 8px;">${item.horario}</td></tr>`;
                });
            }
            html += '</table>';
            return html;
        };
        const tabelaHtml = gerarTabelaEtapas(etapas);
        const adminEmail = process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com';
        const idAgendamento = Date.now().toString();

        // Salvar no Redis ANTES dos e-mails — garante que a inscrição não se perde se o e-mail falhar
        // No ambiente de teste, esta chamada cria apenas um rascunho: e-mails,
        // painel e Google Calendar só são acionados na conclusão da inscrição.
        await saveAgendamento({
            id: idAgendamento, nome, email, telefone, evento, etapas,
            local: localKey, localNome, calendarId: calId,
            timestamp: new Date().toLocaleString('pt-BR'),
            calendarSynced: false,
            inscricaoTeste: modoTeste === true
        });

        if (modoTeste === true) {
            return res.json({ success: true, id: idAgendamento, rascunho: true });
        }

        // Enviar e-mails de forma independente — erro de e-mail não cancela a inscrição já salva
        const formsLinkEmail = FORMS_LINK || '';
        const botaoForms = formsLinkEmail
            ? `<div style="text-align:center;margin:16px 0"><a href="${formsLinkEmail}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700">Acessar a 2ª Etapa (Formulário Complementar)</a></div>`
            : `<p style="font-size:13px;color:#555">Acesse o formulário complementar disponível no site do DAC para concluir sua inscrição.</p>`;
        sendEmail(email, '📋 Registro de Datas — Inscrição Pendente (DAC/UFSC)', `<div style="font-family: sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;"><h2 style="color: #764ba2;">Olá, ${nome}!</h2><p>Este e-mail é apenas um <strong>registro das datas e horários</strong> que você escolheu para o projeto <strong>${evento}</strong> no <strong>${localNome}</strong>. Guarde para não esquecer.</p><hr style="border: 0; border-top: 1px solid #eee;"><p><strong>Datas escolhidas:</strong></p>${tabelaHtml}<hr style="border: 0; border-top: 1px solid #eee;"><div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:14px 16px;border-radius:6px;margin:16px 0"><p style="margin:0 0 8px;font-size:14px;color:#92400e"><strong>📌 Lembre-se: a inscrição só é válida com as duas etapas preenchidas.</strong><br>Se você ainda não preencheu o <strong>formulário complementar (2ª etapa)</strong>, acesse agora pelo botão abaixo para concluir sua inscrição.</p>${botaoForms}<p style="margin:8px 0 0;font-size:12px;color:#b45309"><em>Se já preencheu o formulário, pode ignorar o botão acima.</em></p></div><p>Em caso de dúvidas, entre em contato com a equipe do DAC pelo e-mail <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold;">pautas.dac@contato.ufsc.br</a>.</p><p>Atenciosamente,<br><strong>Equipe DAC</strong></p></div>`).catch(err => console.error('⚠️ [E-mail] Erro ao enviar confirmação ao proponente:', err.message));
        sendEmail(adminEmail, `📅 NOVA INSCRIÇÃO: ${evento} (${nome}) — ${localNome}`, `<div style="font-family: sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;"><h2 style="color: #333;">Nova Inscrição de Projeto</h2><p>Um novo projeto foi inscrito com o seguinte cronograma:</p><hr style="border: 0; border-top: 1px solid #eee;"><p><strong>Dados do Proponente:</strong></p><p>👤 <strong>Nome:</strong> ${nome}</p><p>📧 <strong>E-mail:</strong> ${email}</p><p>📞 <strong>Telefone:</strong> ${telefone}</p><p>🏛️ <strong>Local:</strong> ${localNome}</p><p>🎭 <strong>Evento:</strong> ${evento}</p><hr style="border: 0; border-top: 1px solid #eee;"><p><strong>Cronograma do Projeto:</strong></p>${tabelaHtml}</div>`).catch(err => console.error('⚠️ [E-mail] Erro ao enviar notificação ao admin:', err.message));

        res.json({ success: true, id: idAgendamento });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno ao processar agendamento.' });
    }
});

function criarHtmlComprovanteInscricaoTeste(dados) {
    const etapas = Object.entries(dados.etapas || {}).flatMap(([tipo, valores]) => {
        const nomes = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
        return (Array.isArray(valores) ? valores : [valores]).map((item, index) => {
            const label = (Array.isArray(valores) && valores.length > 1) ? `${nomes[tipo] || tipo} ${index + 1}` : (nomes[tipo] || tipo);
            const data = String(item?.data || '').split('-').reverse().join('/');
            return `<tr><td style="border:1px solid #ddd;padding:8px"><strong>${escapeHtml(label)}</strong></td><td style="border:1px solid #ddd;padding:8px">${escapeHtml(data)}</td><td style="border:1px solid #ddd;padding:8px">${escapeHtml(item?.horario || '')}</td></tr>`;
        });
    }).join('');
    const campos = [
        ['Tipo de proponente', dados.tipoProponente],
        ['Categoria da proposta', dados.categoriaProposta],
        ['Vínculo com a UFSC', dados.vinculoUfsc],
        ['Área/segmento', dados.areas],
        ['Finalidade', dados.finalidade],
        ['Acessibilidade comunicacional', dados.acessibilidade],
        ['Recursos de acessibilidade', dados.recursosAcessibilidade],
        ['Gratuidade do evento', dados.gratuidade],
        ['Projeto do DAC', dados.projetoDac || 'Não se aplica'],
        ['Sinopse/descrição', dados.sinopse],
        ['Relevância cultural e impacto social', dados.relevancia]
    ].filter(([, valor]) => valor !== undefined && valor !== null && valor !== '');
    const camposHtml = campos.map(([label, valor]) =>
        `<p style="margin:0 0 8px;font-size:13px"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(Array.isArray(valor) ? valor.join(', ') : valor)}</p>`
    ).join('');
    return `
    <div style="font-family:sans-serif;max-width:680px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden;color:#333">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 30px;text-align:center">
            <h2 style="margin:0;color:#fff;font-size:20px">Inscrição validada com sucesso</h2>
            <p style="margin:7px 0 0;color:rgba(255,255,255,.85);font-size:13px">Comprovante de inscrição — DAC/UFSC</p>
        </div>
        <div style="padding:28px 30px">
            <p style="font-size:15px">Olá, <strong>${escapeHtml(dados.nome)}</strong>!</p>
            <p style="font-size:14px;line-height:1.6">Sua inscrição foi registrada e validada com sucesso. Este e-mail serve como comprovante da inscrição.</p>
            <div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin:20px 0">${camposHtml}</div>
            <p style="font-size:14px;font-weight:600;margin:0 0 8px">Cronograma solicitado</p>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <tr style="background:#f8f9fa"><th style="border:1px solid #ddd;padding:8px;text-align:left">Etapa</th><th style="border:1px solid #ddd;padding:8px;text-align:left">Data</th><th style="border:1px solid #ddd;padding:8px;text-align:left">Horário</th></tr>
                ${etapas || '<tr><td colspan="3" style="border:1px solid #ddd;padding:8px">Não informado</td></tr>'}
            </table>
            <p style="font-size:13px;color:#555;margin-top:22px">Em caso de dúvidas, entre em contato com <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold">pautas.dac@contato.ufsc.br</a>.</p>
        </div>
    </div>`;
}

app.post('/api/finalizar-inscricao-teste', async (req, res) => {
    const dados = req.body || {};
    const id = String(dados.id || '');
    const email = String(dados.email || '').trim().toLowerCase();
    if (!id || !email || !dados.nome || !dados.evento || !dados.etapas) {
        return res.status(400).json({ error: 'Dados obrigatórios da inscrição não informados.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Informe um e-mail válido para receber o comprovante.' });
    }
    try {
        const agendamentos = await getAgendamentos();
        const agendamento = agendamentos.find(item => String(item.id) === id);
        if (!agendamento) return res.status(404).json({ error: 'Inscrição inicial não encontrada.' });

        const segundaEtapaTeste = {
            ...dados,
            email,
            concluidaEm: new Date().toISOString()
        };
        const jaConcluida = agendamento.inscricaoTesteConcluida === true;

        // A agenda só recebe os eventos quando a inscrição estiver 100% concluída.
        // Isso evita marcar horários apenas porque a primeira etapa foi iniciada.
        if (!jaConcluida && agendamento.calendarSynced !== true) {
            const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
            const calendarId = agendamento.calendarId || CALENDAR_IDS[(agendamento.local || 'teatro').toLowerCase()] || CALENDAR_IDS.teatro;
            for (const [tipo, valores] of Object.entries(dados.etapas)) {
                const itens = Array.isArray(valores) ? valores : [valores];
                for (let index = 0; index < itens.length; index++) {
                    const item = itens[index];
                    if (!item?.data || !item?.horario) continue;
                    const label = itens.length > 1 ? `${nomesEtapas[tipo] || tipo} ${index + 1}` : (nomesEtapas[tipo] || tipo);
                    const eventoCalendario = await createCalendarEvent(
                        `${label}: ${dados.evento}`,
                        `Inscrição validada pelo sistema de teste.\nProponente: ${dados.nome}\nE-mail: ${email}\nLocal: ${agendamento.localNome || agendamento.local || 'Teatro Carmen Fossari'}`,
                        item.data,
                        item.horario,
                        calendarId
                    );
                    if (!eventoCalendario) {
                        return res.status(502).json({ error: 'A inscrição foi salva, mas não foi possível registrá-la no Google Calendar.' });
                    }
                }
            }
        }

        const atualizada = await updateAgendamento(id, {
            email,
            inscricaoTesteConcluida: true,
            segundaEtapaTeste,
            statusInscricao: 'Validada',
            calendarSynced: true
        });
        if (!atualizada) return res.status(500).json({ error: 'Não foi possível validar a inscrição.' });

        if (!jaConcluida) {
            const comprovante = criarHtmlComprovanteInscricaoTeste({ ...agendamento, ...dados, email });
            const enviado = await sendEmail(
                [email, 'pautas.dac@contato.ufsc.br'],
                `✅ Inscrição validada: ${dados.evento} — DAC/UFSC`,
                comprovante
            );
            if (!enviado) {
                return res.status(502).json({ error: 'A inscrição foi salva, mas não foi possível enviar o comprovante por e-mail.' });
            }
        }
        return res.json({ success: true, validada: true, id });
    } catch (error) {
        console.error('❌ [/api/finalizar-inscricao-teste] erro:', error.message);
        return res.status(500).json({ error: 'Erro interno ao validar a inscrição.' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/avaliador', (req, res) => res.sendFile(path.join(__dirname, 'avaliador.html')));
app.get('/termo', (req, res) => res.sendFile(path.join(__dirname, 'termo.html')));

async function buscarDatasCalendarioLegada(nomeEvento) {
    if (!nomeEvento) return [];
    try {
        if (!googleAuthClient) await initGoogleAuth();
        const agora = new Date();
        const tMin = new Date(agora.getFullYear() - 1, 0, 1).toISOString();
        const tMax = new Date(agora.getFullYear() + 3, 11, 31).toISOString();
        const buscar = async (calendarId, local) => {
            try {
                const r = await calendar.events.list({
                    auth: googleAuthClient, calendarId, timeMin: tMin, timeMax: tMax,
                    singleEvents: true, orderBy: 'startTime', maxResults: 2500
                });
                return (r.data.items || [])
                    .filter(e => e.start && (e.start.dateTime || e.start.date))
                    .map(e => ({ ...e, _calNome: local }));
            } catch { return []; }
        };
        const eventos = [
            ...(await buscar(CALENDAR_IDS.teatro, 'Teatro Carmen Fossari')),
            ...(await buscar(CALENDAR_IDS.igrejinha, 'Igrejinha da UFSC'))
        ];
        const normalizar = s => (s || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
        const palavras = normalizar(nomeEvento).split(' ').filter(w => w.length >= 3);
        const palavrasLongas = palavras.filter(w => w.length >= 7);
        const alvo = new Set(palavras);
        const matches = eventos.filter(e => {
            const titulo = new Set(normalizar(e.summary).split(' ').filter(w => w.length >= 3));
            if (!titulo.size || !alvo.size) return false;
            const inter = [...alvo].filter(w => titulo.has(w)).length;
            const sim = inter / new Set([...alvo, ...titulo]).size;
            return sim >= 0.30 && (!palavrasLongas.length || palavrasLongas.some(w => titulo.has(w)));
        });
        return matches.map(e => {
            const ini = e.start.dateTime || e.start.date;
            const fim = e.end?.dateTime || e.end?.date || '';
            const data = ini.split('T')[0];
            const inicio = ini.includes('T') ? ini.split('T')[1].substring(0, 5) : '';
            const final = fim.includes('T') ? fim.split('T')[1].substring(0, 5) : '';
            return {
                data,
                horario: inicio && final ? `${inicio} às ${final}` : (inicio || ''),
                resumo: e.summary || '',
                local: e._calNome
            };
        });
    } catch (e) {
        console.warn('⚠️ [Calendar] Falha ao buscar datas para termo legado:', e.message);
        return [];
    }
}

async function buscarDadosInscricaoForms(id) {
    if (!String(id).startsWith('forms_')) return null;
    try {
        if (!googleAuthClient) await initGoogleAuth();
        await getConfigs('GET /api/agendamento/forms');

        let response;
        try {
            response = await sheets.spreadsheets.values.get({
                auth: googleAuthClient, spreadsheetId: SPREADSHEET_ID,
                range: 'Respostas ao formulário 1!A:ZZ'
            });
        } catch {
            const meta = await sheets.spreadsheets.get({ auth: googleAuthClient, spreadsheetId: SPREADSHEET_ID });
            const firstSheetName = meta.data?.sheets?.[0]?.properties?.title;
            if (!firstSheetName) return null;
            response = await sheets.spreadsheets.values.get({
                auth: googleAuthClient, spreadsheetId: SPREADSHEET_ID,
                range: `'${firstSheetName}'!A:ZZ`
            });
        }

        const rows = response.data.values || [];
        const headers = rows[0] || [];
        const lowerHeaders = headers.map(h => String(h || '').toLowerCase());
        const findIndex = keywords => lowerHeaders.findIndex(h => keywords.some(k => h.includes(k)));
        const emailIndex = findIndex(['endereço de e-mail', 'e-mail', 'email', 'e mail']);
        const phoneIndex = findIndex(['telefone', 'celular', 'contato', 'phone', 'whatsapp', 'mobile']);
        const eventIndex = findIndex(['nome do evento', 'título do projeto', 'event name', 'project title']);
        const nameIndex = lowerHeaders.findIndex(h =>
            (h.includes('nome completo') && !h.includes('representante')) || h.includes('full name')
        );

        const row = rows.slice(1).find(values => {
            const email = emailIndex >= 0 ? String(values[emailIndex] || '').trim().toLowerCase() : '';
            const evento = eventIndex >= 0 ? String(values[eventIndex] || '').trim() : 'Evento (Forms)';
            const candidate = `forms_${email || 'noemail'}_${evento.toLowerCase().replace(/\s+/g, '_')}`;
            return candidate === String(id);
        });
        if (!row) return null;

        const email = emailIndex >= 0 ? String(row[emailIndex] || '').trim() : '';
        const evento = eventIndex >= 0 ? String(row[eventIndex] || '').trim() : 'Evento (Forms)';
        const nome = nameIndex >= 0 ? String(row[nameIndex] || '').trim() : 'Inscrição Forms';
        const telefone = phoneIndex >= 0 ? String(row[phoneIndex] || '').trim() : '';
        const etapasMap = await getLegadasEtapas();
        const etapas = etapasMap[id] || {};
        const calendarDates = Object.keys(etapas).length ? [] : await buscarDatasCalendarioLegada(evento);
        const termoMap = await getTermosLegadas();
        const termo = termoMap[id] || {};
        const localNome = termo.espacoIgreja ? 'Igrejinha da UFSC'
            : termo.espacoTeatro ? 'Teatro Carmen Fossari'
            : calendarDates[0]?.local || 'Teatro Carmen Fossari';

        return {
            id, nome, email, telefone, evento, localNome,
            local: localNome.toLowerCase().includes('igrej') ? 'igrejinha' : 'teatro',
            etapas, calendarDates,
            termoAssinado: termo.termoAssinado === true,
            termoDados: termo.termoDados || null
        };
    } catch (e) {
        console.error('[/api/agendamento/:id] erro ao buscar inscrição Forms:', e.message);
        return null;
    }
}

async function buscarInscricaoFormsPorEmail(emailBuscado) {
    const emailAlvo = String(emailBuscado || '').trim().toLowerCase();
    if (!emailAlvo) return null;
    try {
        if (!googleAuthClient) await initGoogleAuth();
        await getConfigs('buscar termo Forms por e-mail');
        let response;
        try {
            response = await sheets.spreadsheets.values.get({
                auth: googleAuthClient, spreadsheetId: SPREADSHEET_ID,
                range: 'Respostas ao formulário 1!A:ZZ'
            });
        } catch {
            const meta = await sheets.spreadsheets.get({ auth: googleAuthClient, spreadsheetId: SPREADSHEET_ID });
            const firstSheetName = meta.data?.sheets?.[0]?.properties?.title;
            if (!firstSheetName) return null;
            response = await sheets.spreadsheets.values.get({
                auth: googleAuthClient, spreadsheetId: SPREADSHEET_ID,
                range: `'${firstSheetName}'!A:ZZ`
            });
        }
        const rows = response.data.values || [];
        const headers = (rows[0] || []).map(h => String(h || '').toLowerCase());
        const findIndex = keywords => headers.findIndex(h => keywords.some(k => h.includes(k)));
        const emailIndex = findIndex(['endereço de e-mail', 'e-mail', 'email', 'e mail']);
        const eventIndex = findIndex(['nome do evento', 'título do projeto', 'event name', 'project title']);
        if (emailIndex < 0 || eventIndex < 0) return null;
        const row = rows.slice(1).find(values =>
            String(values[emailIndex] || '').trim().toLowerCase() === emailAlvo
        );
        if (!row) return null;
        const evento = String(row[eventIndex] || '').trim() || 'Evento (Forms)';
        const id = `forms_${emailAlvo}_${evento.toLowerCase().replace(/\s+/g, '_')}`;
        return buscarDadosInscricaoForms(id);
    } catch (e) {
        console.error('❌ [Sheets] Erro ao buscar termo Forms por e-mail:', e.message);
        return null;
    }
}

// Buscar uma única inscrição pelo ID (usado pela página do termo digital)
app.get('/api/agendamento/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID não fornecido' });
    try {
        const agendamentos = await getAgendamentos();
        const ag = agendamentos.find(a => a.id === id) || await buscarDadosInscricaoForms(id);
        if (!ag) return res.status(404).json({ error: 'Inscrição não encontrada' });

        // Montar string descritiva de data/horário a partir das etapas (se existirem)
        const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
        const partes = [];
        if (ag.etapas) {
            for (const key of Object.keys(ag.etapas)) {
                const itens = Array.isArray(ag.etapas[key]) ? ag.etapas[key] : [ag.etapas[key]];
                itens.forEach((it, i) => {
                    if (it && it.data && it.horario) {
                        const label = itens.length > 1 ? `${nomesEtapas[key]} ${i + 1}` : nomesEtapas[key];
                        const dataBr = it.data.split('-').reverse().join('/');
                        partes.push(`${label}: ${dataBr}, ${it.horario}`);
                    }
                });
            }
        }
        if (!partes.length && Array.isArray(ag.calendarDates)) {
            ag.calendarDates.forEach(cd => {
                if (cd?.data) {
                    const dataBr = cd.data.split('-').reverse().join('/');
                    partes.push(`${dataBr}${cd.horario ? ', ' + cd.horario : ''}`);
                }
            });
        }
        const dataHorarioEvento = partes.join(' | ');

        res.json({
            id: ag.id,
            nome: ag.nome || '',
            email: ag.email || '',
            telefone: ag.telefone || '',
            evento: ag.evento || '',
            localNome: ag.localNome || '',
            local: ag.local || '',
            calendarId: ag.calendarId || '',
            dataHorarioEvento,
            etapas: ag.etapas || {},
            termoAssinado: ag.termoAssinado === true,
            termoDados: ag.termoDados || null
        });
    } catch (e) {
        console.error('[/api/agendamento/:id] erro:', e);
        res.status(500).json({ error: 'Erro ao buscar inscrição' });
    }
});

app.get('/api/admin/dados-unificados', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    if (!googleAuthClient) await initGoogleAuth();
    try {
                await getConfigs('GET /api/admin/dados-unificados'); // Garantir que temos o ID mais recente
        let rows = [];
        let sheetsOk = false;
        try {
            let response;
            try {
                // Tentar primeiro a aba padrão
                response = await sheets.spreadsheets.values.get({ 
                    auth: googleAuthClient, 
                    spreadsheetId: SPREADSHEET_ID, 
                    range: 'Respostas ao formulário 1!A:ZZ' 
                });
            } catch (sheetError) {
                console.warn('⚠️ [Sheets] Aba "Respostas ao formulário 1" não encontrada, tentando fallback...');
                const meta = await sheets.spreadsheets.get({ auth: googleAuthClient, spreadsheetId: SPREADSHEET_ID });
                if (meta.data && meta.data.sheets && meta.data.sheets.length > 0) {
                    const firstSheetName = meta.data.sheets[0].properties.title;
                    console.log(`[Sheets] Tentando aba: ${firstSheetName}`);
                    response = await sheets.spreadsheets.values.get({ 
                        auth: googleAuthClient, 
                        spreadsheetId: SPREADSHEET_ID, 
                        range: `'${firstSheetName}'!A:ZZ` 
                    });
                } else {
                    throw new Error('Nenhuma aba encontrada na planilha.');
                }
            }
            rows = response.data.values || [];
            sheetsOk = true;
        } catch (sheetsError) {
            console.warn('⚠️ [Sheets] Não foi possível acessar a planilha — exibindo apenas dados do Redis:', sheetsError.message);
            rows = [];
        }
        const headers = rows[0] || []; console.log("DEBUG: Headers encontrados:", headers.length, headers.slice(0, 5));
        const dataSegundaEtapa = rows.slice(1); console.log("DEBUG: Linhas de dados encontradas:", dataSegundaEtapa.length);
        // Log temporário para diagnóstico: mostra e-mails das últimas 5 linhas do Sheets
        const indicesEmailDiag = headers.reduce((acc, h, i) => { if (['endereço de e-mail','e-mail','email'].some(k => h.toLowerCase().includes(k))) acc.push(i); return acc; }, []);
        const ultimas5 = dataSegundaEtapa.slice(-5);
        console.log("DEBUG: E-mails das últimas 5 linhas do Sheets:", ultimas5.map(s => indicesEmailDiag.map(i => s[i]).filter(Boolean).join(' | ')));

        // Identificar colunas de e-mail e telefone
        const findIndices = (keywords) => headers.reduce((acc, h, i) => {
            if (keywords.some(k => h.toLowerCase().includes(k))) acc.push(i);
            return acc;
        }, []);

        const indicesEmail = findIndices(['endereço de e-mail', 'e-mail', 'email', 'e mail']);
        const indicesTelefone = findIndices(['telefone', 'celular', 'contato', 'phone', 'whatsapp', 'mobile']);
        const idxNomeEventoSheet = headers.findIndex(h => 
            h.toLowerCase().includes('nome do evento') || 
            h.toLowerCase().includes('título do projeto') ||
            h.toLowerCase().includes('event name') ||
            h.toLowerCase().includes('project title')
        );
        const idxNomeProponenteSheet = headers.findIndex(h => 
            (h.toLowerCase().includes('nome completo') && !h.toLowerCase().includes('representante')) ||
            h.toLowerCase().includes('full name')
        );

        const mapeamentoLocais = {
            'oto.bezerra@ufsc.br': 'Teatro',
            [CALENDAR_IDS.igrejinha]: 'Igrejinha',
            'teatro': 'Teatro',
            'igrejinha': 'Igrejinha'
        };
        const agendamentosPrimeiraEtapa = await getAgendamentos();
        const unificados = [];

        // Processar agendamentos da primeira etapa do mais recente para o mais antigo
        // Assim a inscrição mais nova tem prioridade na busca pela linha do Sheets correspondente,
        // evitando que inscrições antigas consumam linhas destinadas às novas.
        // usedSheetIndices garante que cada linha do Sheets case com no máximo UMA inscrição Redis.
        const usedSheetIndices = new Set();
        const agendamentosOrdenados = [...agendamentosPrimeiraEtapa].reverse();

        for (const p of agendamentosOrdenados) {
            const pEmail = (p.email || '').trim().toLowerCase();
            const pTelefone = (p.telefone || '').replace(/\D/g, '');

            // Buscar a resposta mais recente (última na planilha) que coincida com e-mail ou telefone
            // e que ainda não tenha sido usada por outra inscrição Redis
            let correspondenciaIdx = -1;
            for (let i = dataSegundaEtapa.length - 1; i >= 0; i--) {
                if (usedSheetIndices.has(i)) continue;
                const s = dataSegundaEtapa[i];
                const sEmail = indicesEmail.map(idx => (s[idx] || '').trim().toLowerCase());
                const sTelefone = indicesTelefone.map(idx => (s[idx] || '').replace(/\D/g, ''));
                const matchesEmail = pEmail && sEmail.includes(pEmail);
                const matchesTelefone = pTelefone && pTelefone.length >= 8 && sTelefone.some(st => st && st.includes(pTelefone));
                if (matchesEmail || matchesTelefone) { correspondenciaIdx = i; break; }
            }
            const correspondencia = correspondenciaIdx >= 0 ? dataSegundaEtapa[correspondenciaIdx] : null;

            const localNomeResolvido = p.localNome || mapeamentoLocais[p.local] || mapeamentoLocais[p.calendarId] || 'Teatro';
            const calIdInscricao = p.calendarId || CALENDAR_IDS[(p.local || 'teatro').toLowerCase()] || CALENDAR_IDS.teatro;

            // Inscrições concluídas pelo ambiente de teste já possuem a segunda etapa
            // salva no Redis e devem aparecer no painel sem depender do Google Forms.
            if (!correspondencia && p.inscricaoTesteConcluida === true) {
                unificados.push({
                    primeiraEtapa: { ...p, localNome: localNomeResolvido },
                    segundaEtapa: {
                        headers: ['Segunda etapa', 'Status'],
                        valores: ['Ambiente de teste', 'Concluída']
                    },
                    status: 'Completo (Teste)',
                    eventosExistem: true
                });
                continue;
            }

            if (correspondencia) {
                usedSheetIndices.add(correspondenciaIdx);
                // Etapa 2 encontrada — criar eventos no Calendar se ainda não foram criados
                if (p.calendarSynced !== true) {
                    try {
                        const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
                        const linhasEtapas = [];
                        for (const key of Object.keys(p.etapas || {})) {
                            const itens = Array.isArray(p.etapas[key]) ? p.etapas[key] : [p.etapas[key]];
                            for (let i = 0; i < itens.length; i++) {
                                const item = itens[i];
                                const label = itens.length > 1 ? `${nomesEtapas[key]} ${i + 1}` : nomesEtapas[key];
                                await createCalendarEvent(
                                    `${label}: ${p.evento}`,
                                    `Em análise\nLocal: ${localNomeResolvido}`,
                                    item.data, item.horario, calIdInscricao
                                );
                                const [ano, mes, dia] = (item.data || '').split('-');
                                const dataFormatada = ano ? `${dia}/${mes}/${ano}` : item.data;
                                linhasEtapas.push(`<tr><td style="border:1px solid #ddd;padding:8px"><strong>${label}</strong></td><td style="border:1px solid #ddd;padding:8px">${dataFormatada}</td><td style="border:1px solid #ddd;padding:8px">${item.horario || ''}</td></tr>`);
                            }
                        }
                        await updateAgendamento(p.id, { calendarSynced: true });
                        console.log(`✅ [Calendar] Eventos criados para inscrição completa: ${p.evento} (${p.email})`);

                        // Notificar administradores sobre inscrição completa
                        const tabelaEtapas = linhasEtapas.length > 0
                            ? `<table style="width:100%;border-collapse:collapse;margin-top:10px"><tr style="background:#f8f9fa"><th style="border:1px solid #ddd;padding:8px;text-align:left">Etapa</th><th style="border:1px solid #ddd;padding:8px;text-align:left">Data</th><th style="border:1px solid #ddd;padding:8px;text-align:left">Horário</th></tr>${linhasEtapas.join('')}</table>`
                            : '<p style="color:#888">Cronograma não informado na etapa 1.</p>';
                        const htmlAdmin = `
                        <div style="font-family:sans-serif;max-width:650px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden;color:#333">
                            <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 30px;text-align:center">
                                <h2 style="margin:0;color:#fff;font-size:19px">Nova Inscrição Completa — DAC/UFSC</h2>
                                <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">Etapas 1 e 2 concluídas</p>
                            </div>
                            <div style="padding:28px 30px">
                                <p style="font-size:15px;margin-top:0">Uma nova inscrição foi concluída com as duas etapas preenchidas:</p>
                                <div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin:0 0 20px">
                                    <p style="margin:0 0 6px;font-size:13px;color:#555"><strong>Proponente:</strong> ${p.nome || 'N/A'}</p>
                                    <p style="margin:0 0 6px;font-size:13px;color:#555"><strong>E-mail:</strong> ${p.email || 'N/A'}</p>
                                    <p style="margin:0 0 6px;font-size:13px;color:#555"><strong>Telefone:</strong> ${p.telefone || 'N/A'}</p>
                                    <p style="margin:0 0 6px;font-size:13px;color:#555"><strong>Nome do Evento:</strong> ${p.evento || 'N/A'}</p>
                                    <p style="margin:0;font-size:13px;color:#555"><strong>Local:</strong> ${localNomeResolvido}</p>
                                </div>
                                <p style="font-size:14px;font-weight:600;margin-bottom:6px">Cronograma solicitado:</p>
                                ${tabelaEtapas}
                                <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
                                <p style="font-size:11px;color:#aaa;text-align:center">
                                    UFSC — Secretaria de Cultura, Arte e Esporte · Departamento Artístico Cultural (DAC)<br>
                                    Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC
                                </p>
                            </div>
                        </div>`;
                        sendEmail(
                            'pautas.dac@contato.ufsc.br',
                            `📋 Inscrição Completa: ${p.evento || 'Novo Projeto'} — ${p.nome || ''} — DAC/UFSC`,
                            htmlAdmin
                        ).catch(err => console.error(`⚠️ [E-mail] Erro ao notificar admin sobre inscrição completa:`, err.message));
                    } catch (calErr) {
                        console.error(`⚠️ [Calendar] Falha ao criar eventos para ${p.email}:`, calErr.message);
                    }
                }
                unificados.push({
                    primeiraEtapa: { ...p, localNome: localNomeResolvido, calendarSynced: true },
                    segundaEtapa: { headers, valores: correspondencia },
                    status: 'Completo',
                    eventosExistem: true
                });
            } else {
                // Etapa 2 não encontrada — inscrição não existe para o painel (sem Calendar, sem listagem)
                console.log(`🚫 [Ignorada] Etapa 2 não encontrada para: ${p.evento || 'sem nome'} | email: ${p.email}`);
            }
        }

        // Adicionar o que sobrou da segunda etapa (Forms) - apenas os que não foram unificados ainda
        dataSegundaEtapa.forEach((s, idx) => {
            const emailSheet = (indicesEmail.length > 0 ? (s[indicesEmail[0]] || '').trim().toLowerCase() : '');
            const telefoneSheet = (indicesTelefone.length > 0 ? (s[indicesTelefone[0]] || '').replace(/\D/g, '') : '');

            // Usar o índice já rastreado para saber se essa linha já foi consumida por uma inscrição Redis
            if (!usedSheetIndices.has(idx)) {
                const nomeEventoSheet = (idxNomeEventoSheet >= 0 ? s[idxNomeEventoSheet] : 'Evento (Forms)') || 'Evento (Forms)';
                const nomeProponenteSheet = (idxNomeProponenteSheet >= 0 ? s[idxNomeProponenteSheet] : 'Inscrição Forms') || 'Inscrição Forms';

                const deterministicId = `forms_${(emailSheet || 'noemail')}_${nomeEventoSheet.trim().toLowerCase()}`.replace(/\s+/g, '_');

                unificados.push({
                    primeiraEtapa: { 
                        id: deterministicId,
                        nome: nomeProponenteSheet,
                        email: emailSheet || 'N/A',
                        telefone: (indicesTelefone.length > 0 ? s[indicesTelefone[0]] : 'N/A') || 'N/A',
                        evento: nomeEventoSheet,
                        etapas: {},
                        isLegada: true 
                    },
                    segundaEtapa: { headers, valores: s },
                    status: 'Completo (Forms)'
                });
            }
        });

        // Injetar etapas salvas manualmente para inscrições legadas
        const legadasEtapasMap = await getLegadasEtapas();
        const termosLegadasMap = await getTermosLegadas();
        unificados.forEach(u => {
            if (u.primeiraEtapa.isLegada && legadasEtapasMap[u.primeiraEtapa.id]) {
                u.primeiraEtapa.etapas = legadasEtapasMap[u.primeiraEtapa.id];
            }
            if (u.primeiraEtapa.isLegada && termosLegadasMap[u.primeiraEtapa.id]) {
                const termoSalvo = termosLegadasMap[u.primeiraEtapa.id];
                u.primeiraEtapa.termoAssinado = termoSalvo.termoAssinado === true;
                u.primeiraEtapa.termoDados = termoSalvo.termoDados || null;
            }
        });

        // Enriquecer entradas legadas com eventos do Google Calendar (busca por nome do evento)
        const legadas = unificados.filter(u => u.primeiraEtapa.isLegada && Object.keys(u.primeiraEtapa.etapas||{}).length === 0);
        if (legadas.length > 0) {
            try {
                const agora = new Date();
                const tMin = new Date(agora.getFullYear() - 1, 0, 1).toISOString();
                const tMax = new Date(agora.getFullYear() + 3, 11, 31).toISOString();
                const fetchCal = async (calId) => {
                    try {
                        const r = await calendar.events.list({
                            auth: googleAuthClient, calendarId: calId,
                            timeMin: tMin, timeMax: tMax,
                            singleEvents: true, orderBy: 'startTime', maxResults: 2500
                        });
                        return (r.data.items || []).filter(e => e.start && (e.start.dateTime || e.start.date));
                    } catch (err) { return []; }
                };
                const [evTeat, evIgrej] = await Promise.all([
                    fetchCal(CALENDAR_IDS.teatro),
                    fetchCal(CALENDAR_IDS.igrejinha)
                ]);
                const allCalEvents = [
                    ...evTeat.map(e => ({ ...e, _calNome: 'Teatro Carmen Fossari' })),
                    ...evIgrej.map(e => ({ ...e, _calNome: 'Igrejinha da UFSC' }))
                ];

                const normalizar = (s) => (s||'').toLowerCase()
                    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                    .replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();

                // Similaridade Jaccard entre dois conjuntos de palavras ≥3 chars
                const jaccardSim = (a, b) => {
                    const wa = new Set(a.split(' ').filter(w => w.length >= 3));
                    const wb = new Set(b.split(' ').filter(w => w.length >= 3));
                    if (wa.size === 0 || wb.size === 0) return 0;
                    const inter = [...wa].filter(w => wb.has(w)).length;
                    const union = new Set([...wa, ...wb]).size;
                    return inter / union;
                };
                // Detecta numerais romanos simples (I a XX) para exigir correspondência exata
                const romanoRe = /^(I{1,3}|IV|V|VI{1,3}|IX|X{1,2}|XI{1,3}|XIV|XV|XVI{1,3}|XIX|XX)$/i;
                const extrairRomano = (s) => {
                    const m = s.split(' ').find(w => romanoRe.test(w));
                    return m ? m.toUpperCase() : null;
                };

                for (const u of legadas) {
                    const nomeEvento = normalizar(u.primeiraEtapa.evento);
                    if (!nomeEvento || nomeEvento.length < 5) continue;

                    const romanoInscricao = extrairRomano(u.primeiraEtapa.evento || '');

                    // Palavras longas e específicas do nome da inscrição (≥7 chars)
                    const palavrasLongas = nomeEvento.split(' ').filter(w => w.length >= 7);

                    const matches = allCalEvents.filter(e => {
                        const titulo = normalizar(e.summary || '');
                        if (!titulo) return false;
                        const sim = jaccardSim(nomeEvento, titulo);
                        if (sim < 0.30) return false;
                        // Se a inscrição tem numeral romano, exige que o calendário também tenha o mesmo
                        if (romanoInscricao) {
                            const romanoEvt = extrairRomano(e.summary || '');
                            if (romanoEvt && romanoEvt !== romanoInscricao) return false;
                        }
                        // Se a inscrição tem palavras longas (≥7 chars), exige que pelo menos
                        // uma delas apareça no título do evento — evita falsos positivos com
                        // títulos genéricos curtos como "Teatro 8 ano", "Cineclube 757", etc.
                        if (palavrasLongas.length > 0) {
                            const temPalavraLonga = palavrasLongas.some(p => titulo.includes(p));
                            if (!temPalavraLonga) return false;
                        }
                        return true;
                    });

                    if (matches.length > 0) {
                        const calDates = matches.map(e => {
                            const ini = e.start.dateTime || e.start.date;
                            const fim = e.end.dateTime || e.end.date;
                            const d = ini.split('T')[0];
                            const hIni = ini.includes('T') ? ini.split('T')[1].substring(0,5) : '';
                            const hFim = fim && fim.includes('T') ? fim.split('T')[1].substring(0,5) : '';
                            return {
                                data: d,
                                horario: hIni && hFim ? `${hIni} às ${hFim}` : (hIni || ''),
                                resumo: e.summary || '',
                                local: e._calNome
                            };
                        });
                        u.primeiraEtapa.calendarDates = calDates;
                    }
                }
            } catch (calLookupErr) {
                console.warn('⚠️ [Calendar] Falha ao enriquecer legadas:', calLookupErr.message);
            }
        }

        // Filtrar registros que estao na Blacklist
        const blacklist = await getBlacklist();
        const unificadosFiltrados = unificados.filter(u => {
            const id = u.primeiraEtapa.id;
            return id && !blacklist.includes(id);
        });
        
        console.log(`[DEBUG] Gerados ${unificados.length} registros unificados. ${blacklist.length} filtrados pela Blacklist.`);
        res.json(unificadosFiltrados);
    } catch (error) {
        console.error('[DEBUG] Erro ao gerar dados unificados:', error);
        res.status(500).json({ error: 'Erro ao gerar dados unificados' });
    }
});

// Rota para adicionar um ID a Blacklist (exclusao visual)
app.post('/api/admin/blacklist/:id', async (req, res) => {
    const { id } = req.params;
    try {
        if (!id || id === 'undefined') {
            return res.status(400).json({ success: false, error: 'ID nao fornecido' });
        }
        const success = await addToBlacklist(id);
        res.json({ success, message: 'Registro adicionado a lista de exclusao' });
    } catch (error) {
        console.error('Erro ao adicionar a Blacklist:', error.message);
        res.status(500).json({ success: false, error: 'Erro ao adicionar a Blacklist' });
    }
});

app.delete('/api/admin/excluir/:email', async (req, res) => {
    const { email } = req.params;
    const success = await deleteAgendamentoByEmail(email);
    res.json({ success });
});

// Rota alternativa para compatibilidade com admin.html (usando ID em vez de email)
app.delete('/api/agendamentos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        if (!id || id === 'undefined') {
            return res.status(400).json({ success: false, error: 'ID não fornecido' });
        }

        const agendamentos = await getAgendamentos();
        const agendamento = agendamentos.find(a => a.id === id);

        if (agendamento) {
            const resultado = await deleteAgendamentoById(agendamento.id);
            res.json({
                success: resultado !== false,
                eventosFalhos: resultado?.eventosFalhos || 0,
                message: resultado?.eventosFalhos
                    ? 'Inscrição removida, mas alguns eventos não puderam ser excluídos do Google Calendar.'
                    : undefined
            });
        } else {
            // Registro não encontrado no Redis (Forms-only ou legado):
            // adicionar à blacklist para que não reapareça via Sheets
            console.log(`⚠️ [Exclusão] Registro não encontrado no Redis — adicionando à blacklist: ${id}`);
            await addToBlacklist(id);
            res.json({ success: true, message: 'Registro ocultado da visualização' });
        }
    } catch (error) {
        console.error('❌ Erro ao deletar agendamento:', error.message);
        res.status(500).json({ success: false, error: 'Erro ao deletar agendamento' });
    }
});

// Rota para exclusão geral de todos os agendamentos
app.delete('/api/admin/excluir-tudo', async (req, res) => {
    try {
        if (!googleAuthClient) await initGoogleAuth();

        // === AUDITORIA: registrar quem disparou a exclusão geral ===
        const auditTimestamp = new Date().toISOString();
        const auditIp = (req.headers['x-forwarded-for']
            || req.connection?.remoteAddress
            || req.socket?.remoteAddress
            || req.ip
            || 'unknown').toString().split(',')[0].trim();
        const auditUserAgent = req.headers['user-agent'] || 'unknown';
        console.log('🚨 [AUDITORIA] [Exclusão Geral] DISPARADA');
        console.log(`   ↳ Timestamp: ${auditTimestamp}`);
        console.log(`   ↳ IP: ${auditIp}`);
        console.log(`   ↳ User-Agent: ${auditUserAgent}`);

        // Obter todos os agendamentos
        const agendamentos = await getAgendamentos();
        console.log(`🗑️ [Exclusão Geral] Iniciando limpeza de ${agendamentos.length} agendamentos...`);
        
        // Responder imediatamente ao cliente para evitar timeout
        res.json({ 
            success: true, 
            message: 'Limpeza iniciada. O processo está sendo executado em segundo plano. Atualize a página em alguns segundos.' 
        });
        
        // Processar a exclusão em segundo plano
        (async () => {
            try {
                let eventosDeletedos = 0;
                let eventosFalhos = 0;
                const batchSize = 3;            // 3 deletes em paralelo
                const delayEntreBatches = 400;  // 400ms entre batches (evita rate limit)
                const maxRetries = 5;
                const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };

                const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                const deleteComRetry = async (calId, eventId, nomeCal) => {
                    let tentativa = 0;
                    while (tentativa < maxRetries) {
                        try {
                            await calendar.events.delete({ auth: googleAuthClient, calendarId: calId, eventId });
                            return true;
                        } catch (error) {
                            const msg = error.message || '';
                            const code = error.code || error.response?.status;
                            const isRateLimit = code === 403 || code === 429 || /rate limit|quota/i.test(msg);
                            if (isRateLimit && tentativa < maxRetries - 1) {
                                const backoff = 1000 * Math.pow(2, tentativa);
                                await sleep(backoff);
                                tentativa++;
                                continue;
                            }
                            console.warn(`⚠️ [${nomeCal}] Falha ao deletar ${eventId}:`, msg);
                            return false;
                        }
                    }
                    return false;
                };

                // Agrupar agendamentos pelo calendário e listar eventos de cada calendário UMA vez.
                // Evita chamar events.list repetidamente.
                const agendamentosPorCal = {};
                for (const ag of agendamentos) {
                    const calId = ag.calendarId || CALENDAR_IDS[ag.local] || CALENDAR_IDS.teatro;
                    if (!agendamentosPorCal[calId]) agendamentosPorCal[calId] = [];
                    agendamentosPorCal[calId].push(ag);
                }

                for (const [calId, ags] of Object.entries(agendamentosPorCal)) {
                    const nomeCal = Object.entries(CALENDAR_IDS).find(([, v]) => v === calId)?.[0] || calId;
                    try {
                        const listResp = await calendar.events.list({
                            auth: googleAuthClient,
                            calendarId: calId,
                            maxResults: 2500,
                            singleEvents: true
                        });
                        const allEvents = listResp.data.items || [];

                        // Coletar APENAS os eventos que pertencem às inscrições do sistema.
                        // Critério: summary começa com "Ensaio/Montagem/Evento/Desmontagem: <nome_do_evento>"
                        //           E description contém o e-mail do proponente.
                        const eventosADeletar = [];
                        for (const ag of ags) {
                            if (!ag.etapas || !ag.email) continue;
                            for (const key of Object.keys(ag.etapas)) {
                                const itens = Array.isArray(ag.etapas[key]) ? ag.etapas[key] : [ag.etapas[key]];
                                itens.forEach((_, i) => {
                                    const label = itens.length > 1 ? `${nomesEtapas[key]} ${i + 1}` : nomesEtapas[key];
                                    const eventSummary = `${label}: ${ag.evento}`;
                                    const matches = allEvents.filter(e =>
                                        e.summary === eventSummary &&
                                        e.description && e.description.includes(ag.email)
                                    );
                                    eventosADeletar.push(...matches);
                                });
                            }
                        }

                        // Dedup por id (pode ter batido em mais de uma etapa)
                        const unicos = Array.from(new Map(eventosADeletar.map(e => [e.id, e])).values());
                        console.log(`🗑️ [Exclusão Geral] [${nomeCal}] Deletando ${unicos.length} eventos (de ${ags.length} inscrições, total de ${allEvents.length} eventos no calendário)...`);

                        for (let i = 0; i < unicos.length; i += batchSize) {
                            const batch = unicos.slice(i, i + batchSize);
                            const results = await Promise.all(
                                batch.map(event => deleteComRetry(calId, event.id, nomeCal))
                            );
                            results.forEach(ok => ok ? eventosDeletedos++ : eventosFalhos++);
                            await sleep(delayEntreBatches);
                        }
                    } catch (calErr) {
                        console.warn(`⚠️ [Exclusão Geral] Falha no calendário ${nomeCal}:`, calErr.message);
                    }
                }

                if (eventosFalhos > 0) {
                    console.warn(`⚠️ [Exclusão Geral] ${eventosFalhos} eventos NÃO puderam ser deletados (ver erros acima).`);
                }

                // Limpar o Redis
                if (redis) {
                    await redis.del(AGENDAMENTOS_KEY);
                    console.log(`✅ [Exclusão Geral] Redis limpo com sucesso`);
                }

                // Limpar a Blacklist tambem
                await clearBlacklist();

                console.log(`✅ [Exclusão Geral] Concluído: ${eventosDeletedos} eventos removidos dos calendários, ${agendamentos.length} registros removidos do banco de dados`);
                console.log(`🚨 [AUDITORIA] [Exclusão Geral] FINALIZADA com sucesso (disparo: ${auditTimestamp}, IP: ${auditIp}, eventos: ${eventosDeletedos}, falhas: ${eventosFalhos}, inscrições: ${agendamentos.length})`);
            } catch (error) {
                console.error('❌ Erro na exclusão geral em segundo plano:', error.message);
            }
        })();
    } catch (error) {
        console.error('❌ Erro ao iniciar exclusão geral:', error.message);
        res.status(500).json({ success: false, error: 'Erro ao iniciar exclusão geral' });
    }
});

// ============================================================
// T001 — AUTENTICAÇÃO ADMIN E AVALIADORES
// ============================================================

app.post('/api/auth/admin', (req, res) => {
    const { password } = req.body;
    const adminPassword = (process.env.ADMIN_PASSWORD || 'admin.dac.ufsc').replace(/^["']|["']$/g, '');
    if (!password) return res.status(400).json({ error: 'Senha obrigatória.' });
    if (password === adminPassword) {
        res.json({ success: true, message: 'Acesso de administrador autorizado.' });
    } else {
        res.status(403).json({ success: false, message: 'Senha incorreta.' });
    }
});

app.post('/api/auth/viewer', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });
    try {
        const raw = redis ? await redis.get('avaliadores') : null;
        const avaliadores = parseRedisValue(raw) || [];
        const av = avaliadores.find(a => a.email.toLowerCase() === email.trim().toLowerCase());
        if (!av) return res.status(403).json({ success: false, message: 'E-mail não encontrado na lista de avaliadores.' });
        const senhaCorreta = (process.env.EVALUATOR_PASSWORD || 'dac.ufsc.2026').replace(/^["']|["']$/g, '');
        if (password === senhaCorreta) {
            res.json({ success: true, email: av.email, nome: av.nome || av.email });
        } else {
            res.status(403).json({ success: false, message: 'Senha incorreta.' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// ============================================================
// T003 — SISTEMA DE AVALIAÇÃO: AVALIADORES
// ============================================================

app.get('/api/evaluators', async (req, res) => {
    try {
        const raw = redis ? await redis.get('avaliadores') : null;
        res.json(parseRedisValue(raw) || []);
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar avaliadores.' });
    }
});

app.post('/api/evaluators', async (req, res) => {
    const { evaluators } = req.body;
    if (!Array.isArray(evaluators)) return res.status(400).json({ error: 'Lista de avaliadores inválida.' });
    try {
        const lista = evaluators.map(e => ({
            id: e.id || `av_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            email: (e.email || '').trim().toLowerCase(),
            nome: (e.nome || e.email || '').trim()
        })).filter(e => e.email);
        if (redis) await redis.set('avaliadores', lista);
        res.json({ success: true, count: lista.length });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao salvar avaliadores.' });
    }
});

app.delete('/api/evaluators/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const raw = redis ? await redis.get('avaliadores') : null;
        const lista = parseRedisValue(raw) || [];
        const filtrada = lista.filter(a => a.id !== id);
        if (redis) await redis.set('avaliadores', filtrada);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao remover avaliador.' });
    }
});

// ============================================================
// T003 — SISTEMA DE AVALIAÇÃO: CRITÉRIOS
// ============================================================

const CRITERIOS_DEFAULT = [
    { id: 'A', nome: 'Qualidade Artística', peso: 1 },
    { id: 'B', nome: 'Relevância Cultural', peso: 1 },
    { id: 'C', nome: 'Acessibilidade', peso: 1 },
    { id: 'D', nome: 'Viabilidade Técnica', peso: 1 }
];

app.get('/api/criteria', async (req, res) => {
    try {
        const raw = redis ? await redis.get('criterios') : null;
        res.json(parseRedisValue(raw) || CRITERIOS_DEFAULT);
    } catch (e) {
        res.json(CRITERIOS_DEFAULT);
    }
});

app.post('/api/criteria', async (req, res) => {
    const { criteria } = req.body;
    if (!Array.isArray(criteria)) return res.status(400).json({ error: 'Lista de critérios inválida.' });
    try {
        if (redis) await redis.set('criterios', criteria);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao salvar critérios.' });
    }
});

// ============================================================
// T003 — SISTEMA DE AVALIAÇÃO: AVALIAÇÕES
// ============================================================

app.post('/api/save-assessment', async (req, res) => {
    const { inscriptionId, evaluatorEmail, scoresJson } = req.body;
    if (!inscriptionId || !evaluatorEmail || !scoresJson) {
        return res.status(400).json({ error: 'Dados incompletos.' });
    }
    try {
        const key = `avaliacoes_${inscriptionId}`;
        const raw = redis ? await redis.get(key) : null;
        const avaliacoes = parseRedisValue(raw) || [];
        const idx = avaliacoes.findIndex(a => a.evaluatorEmail === evaluatorEmail);
        const entry = { inscriptionId, evaluatorEmail, scoresJson, updatedAt: new Date().toISOString() };
        if (idx >= 0) avaliacoes[idx] = entry; else avaliacoes.push(entry);
        if (redis) await redis.set(key, avaliacoes);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao salvar avaliação.' });
    }
});

app.get('/api/admin/relatorio-avaliacoes', async (req, res) => {
    try {
        const inscricoes = await getAgendamentos();
        const criteriosRaw = redis ? await redis.get('criterios') : null;
        const criterios = parseRedisValue(criteriosRaw) || [
            { id: 'A', nome: 'Qualidade Artística', peso: 1 },
            { id: 'B', nome: 'Relevância Cultural', peso: 1 },
            { id: 'C', nome: 'Acessibilidade', peso: 1 },
            { id: 'D', nome: 'Viabilidade Técnica', peso: 1 }
        ];
        const cfgRaw = redis ? await redis.get('agendamentos_config') : null;
        const cfg = parseRedisValue(cfgRaw) || {};
        const necessarias = parseInt(cfg.avaliacoesNecessarias || 3);
        const pesoTotal = criterios.reduce((s, c) => s + (parseFloat(c.peso) || 1), 0) || 1;

        const linhas = [];
        for (const p of inscricoes) {
            const id = p.id || p.email;
            if (!id) continue;
            const avRaw = redis ? await redis.get(`avaliacoes_${id}`) : null;
            const avaliacoes = parseRedisValue(avRaw) || [];

            const detalhesPorCriterio = {};
            criterios.forEach(c => { detalhesPorCriterio[c.id] = { nome: c.nome, peso: parseFloat(c.peso) || 1, soma: 0, n: 0 }; });

            let totalPontos = 0;
            avaliacoes.forEach(av => {
                const sc = av.scoresJson || {};
                criterios.forEach(c => {
                    const nota = parseFloat(sc[c.id] || 0);
                    totalPontos += nota * (parseFloat(c.peso) || 1);
                    if (nota > 0) {
                        detalhesPorCriterio[c.id].soma += nota;
                        detalhesPorCriterio[c.id].n += 1;
                    }
                });
            });

            const mediaFinal = avaliacoes.length > 0
                ? +(totalPontos / avaliacoes.length / pesoTotal).toFixed(2)
                : null;

            const mediasPorCriterio = {};
            Object.entries(detalhesPorCriterio).forEach(([cid, d]) => {
                mediasPorCriterio[cid] = {
                    nome: d.nome,
                    peso: d.peso,
                    media: d.n > 0 ? +(d.soma / d.n).toFixed(2) : null
                };
            });

            const avaliadoresList = avaliacoes.map(a => a.evaluatorEmail).filter(Boolean);
            const statusAvaliacao = avaliacoes.length === 0
                ? 'Sem avaliações'
                : (avaliacoes.length >= necessarias ? 'Concluída' : 'Em andamento');

            linhas.push({
                id,
                evento: p.evento || '',
                proponente: p.nome || '',
                email: p.email || '',
                local: p.localNome || p.local || '',
                qtdAvaliacoes: avaliacoes.length,
                necessarias,
                statusAvaliacao,
                mediaFinal,
                mediasPorCriterio,
                avaliadores: avaliadoresList
            });
        }

        linhas.sort((a, b) => {
            if (a.mediaFinal === null && b.mediaFinal === null) return 0;
            if (a.mediaFinal === null) return 1;
            if (b.mediaFinal === null) return -1;
            return b.mediaFinal - a.mediaFinal;
        });

        res.json({
            criterios: criterios.map(c => ({ id: c.id, nome: c.nome, peso: parseFloat(c.peso) || 1 })),
            necessarias,
            total: linhas.length,
            avaliadas: linhas.filter(l => l.qtdAvaliacoes > 0).length,
            ranking: linhas
        });
    } catch (e) {
        console.error('[/api/admin/relatorio-avaliacoes] erro:', e);
        res.status(500).json({ error: 'Erro ao gerar relatório de avaliações.' });
    }
});

app.get('/api/assessments/:inscriptionId', async (req, res) => {
    const { inscriptionId } = req.params;
    try {
        const key = `avaliacoes_${inscriptionId}`;
        const raw = redis ? await redis.get(key) : null;
        res.json(parseRedisValue(raw) || []);
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar avaliações.' });
    }
});

// ============================================================
// T004a — EDIÇÃO DE ETAPAS (via painel admin)
// ============================================================

// ---- Helpers para etapas de inscrições legadas (Forms-only) ----
async function getLegadasEtapas() {
    try {
        const raw = await redis.get('agendamentos_legadas_etapas');
        return parseRedisValue(raw) || {};
    } catch { return {}; }
}
async function setLegadaEtapas(id, etapas) {
    const map = await getLegadasEtapas();
    map[id] = etapas;
    await redis.set('agendamentos_legadas_etapas', JSON.stringify(map));
}

const TERMOS_LEGADAS_KEY = 'termos_assinados_legadas';
async function getTermosLegadas() {
    try {
        if (!redis) return {};
        const raw = await redis.get(TERMOS_LEGADAS_KEY);
        return parseRedisValue(raw) || {};
    } catch { return {}; }
}
async function saveTermoLegada(id, dados) {
    try {
        if (!redis) return false;
        const map = await getTermosLegadas();
        map[id] = dados;
        await redis.set(TERMOS_LEGADAS_KEY, JSON.stringify(map));
        return true;
    } catch (e) {
        console.error('❌ [Redis] Erro ao salvar termo legado:', e.message);
        return false;
    }
}

app.post('/api/admin/atualizar-termo', async (req, res) => {
    const { id, termoDados, marcarConcluido = true } = req.body || {};
    if (!id || !termoDados || typeof termoDados !== 'object' || Array.isArray(termoDados)) {
        return res.status(400).json({ error: 'ID e dados do termo são obrigatórios.' });
    }

    const camposPermitidos = [
        'espacoTeatro', 'espacoIgreja', 'nomeEvento', 'dataHorarioEvento',
        'outrasInformacoes', 'nomeCompleto', 'cpfCnpj', 'rg', 'telefone',
        'email', 'endereco', 'numero', 'apartamento', 'bairro', 'cidade'
    ];
    const dadosLimpos = {};
    camposPermitidos.forEach(campo => {
        const valor = termoDados[campo];
        if (typeof valor === 'boolean' || typeof valor === 'string') {
            dadosLimpos[campo] = typeof valor === 'string' ? valor.trim() : valor;
        }
    });

    try {
        if (String(id).startsWith('forms_')) {
            const termos = await getTermosLegadas();
            const anterior = termos[String(id)] || {};
            const success = await saveTermoLegada(String(id), {
                ...anterior,
                termoAssinado: marcarConcluido === true,
                termoDados: dadosLimpos
            });
            if (!success) return res.status(500).json({ error: 'Não foi possível salvar o termo legado.' });
            return res.json({ success: true, termoAssinado: marcarConcluido === true });
        }

        const agendamentos = await getAgendamentos();
        const agendamento = agendamentos.find(item => String(item.id) === String(id));
        if (!agendamento) return res.status(404).json({ error: 'Inscrição não encontrada.' });

        const success = await updateAgendamento(id, {
            termoAssinado: marcarConcluido === true,
            termoDados: dadosLimpos
        });
        if (!success) return res.status(500).json({ error: 'Não foi possível salvar o termo.' });
        return res.json({ success: true, termoAssinado: marcarConcluido === true });
    } catch (e) {
        console.error('❌ [/api/admin/atualizar-termo] erro:', e.message);
        return res.status(500).json({ error: 'Erro interno ao salvar o termo.' });
    }
});

app.post('/api/admin/atualizar-etapas', async (req, res) => {
    const { id, ...campos } = req.body;
    if (!id || Object.keys(campos).length === 0) {
        return res.status(400).json({ error: 'ID e campos para atualizar são obrigatórios.' });
    }

    // Inscrições legadas (Forms-only) têm IDs "forms_..." — salvar em chave separada
    if (String(id).startsWith('forms_')) {
        if (campos.etapas !== undefined) {
            await setLegadaEtapas(id, campos.etapas);
        }
        return res.json({ success: true });
    }

    // Buscar agendamento atual antes de atualizar (para ter email, evento, calendarId)
    const agendamentos = await getAgendamentos();
    const ag = agendamentos.find(a => a.id === id);
    if (!ag) return res.status(404).json({ error: 'Agendamento não encontrado.' });

    // Salvar no Redis e responder imediatamente
    const success = await updateAgendamento(id, campos);
    if (!success) return res.status(500).json({ error: 'Erro ao salvar no banco de dados.' });

    // Responde ao cliente imediatamente — Calendar é atualizado em segundo plano
    res.json({ success: true });

    // Atualizar Google Calendar de forma assíncrona (sem bloquear a resposta)
    if (campos.etapas) {
        (async () => {
            try {
                if (!googleAuthClient) await initGoogleAuth();
                const calId = ag.calendarId || CALENDAR_IDS[(ag.local || 'teatro').toLowerCase()] || CALENDAR_IDS.teatro;
                const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };

                const listResp = await calendar.events.list({
                    auth: googleAuthClient,
                    calendarId: calId,
                    maxResults: 2500,
                    singleEvents: true
                });
                const allEvents = listResp.data.items || [];

                // ── Helper: título esperado de um evento ──────────────────────
                const makeTitle = (key, idx, total) => {
                    const label = total > 1 ? `${nomesEtapas[key] || key} ${idx + 1}` : (nomesEtapas[key] || key);
                    return `${label}: ${ag.evento}`;
                };

                // ── Coletar títulos que PERMANECEM (novas etapas) ─────────────
                const titulosRestantes = new Set();
                for (const key in campos.etapas) {
                    const itens = Array.isArray(campos.etapas[key]) ? campos.etapas[key] : [campos.etapas[key]];
                    itens.forEach((it, i) => { if (it && it.data) titulosRestantes.add(makeTitle(key, i, itens.length)); });
                }

                // ── Excluir do Calendar eventos que foram REMOVIDOS ───────────
                const etapasAntigas = ag.etapas || {};
                for (const key in etapasAntigas) {
                    const itens = Array.isArray(etapasAntigas[key]) ? etapasAntigas[key] : [etapasAntigas[key]];
                    for (let i = 0; i < itens.length; i++) {
                        const titulo = makeTitle(key, i, itens.length);
                        if (titulosRestantes.has(titulo)) continue; // ainda existe — não excluir
                        const match = allEvents.find(e =>
                            e.summary === titulo &&
                            e.description && e.description.includes(ag.email)
                        );
                        if (match) {
                            try {
                                await calendar.events.delete({ auth: googleAuthClient, calendarId: calId, eventId: match.id });
                                console.log(`🗑️ [Calendar] Evento excluído: "${titulo}"`);
                            } catch (e) {
                                console.error(`❌ [Calendar] Erro ao excluir "${titulo}":`, e.message);
                            }
                        } else {
                            console.warn(`⚠️ [Calendar] Evento a excluir não encontrado: "${titulo}"`);
                        }
                    }
                }

                // ── Atualizar data/hora dos eventos que PERMANECEM ────────────
                for (const key in campos.etapas) {
                    const itens = Array.isArray(campos.etapas[key]) ? campos.etapas[key] : [campos.etapas[key]];
                    for (let i = 0; i < itens.length; i++) {
                        const it = itens[i];
                        if (!it || !it.data || !it.horario) continue;
                        const titulo = makeTitle(key, i, itens.length);
                        const match = allEvents.find(e =>
                            e.summary === titulo &&
                            e.description && e.description.includes(ag.email)
                        );
                        if (!match) {
                            console.warn(`⚠️ [Calendar] Evento não encontrado para atualizar: "${titulo}"`);
                            continue;
                        }
                        const [startTime, endTime] = it.horario.split(' às ');
                        const startDT = `${it.data}T${startTime}:00-03:00`;
                        const endDT   = `${it.data}T${endTime}:00-03:00`;
                        try {
                            await calendar.events.patch({
                                auth: googleAuthClient,
                                calendarId: calId,
                                eventId: match.id,
                                resource: {
                                    start: { dateTime: startDT, timeZone: 'America/Sao_Paulo' },
                                    end:   { dateTime: endDT,   timeZone: 'America/Sao_Paulo' }
                                }
                            });
                            console.log(`✅ [Calendar] Evento atualizado: "${titulo}" → ${it.data} ${it.horario}`);
                        } catch (e) {
                            console.error(`❌ [Calendar] Erro ao atualizar "${titulo}":`, e.message);
                        }
                    }
                }
            } catch (e) {
                console.error('❌ [Calendar] Erro geral ao atualizar eventos:', e.message);
            }
        })();
    }
});

// ============================================================
// T004b — EMAIL RÁPIDO PARA PROPONENTE (via painel admin)
// ============================================================

app.post('/api/admin/email-rapido', async (req, res) => {
    const { to, nome, assunto, mensagem, linkLabel, linkUrl } = req.body;
    if (!to || !assunto || !mensagem) {
        return res.status(400).json({ error: 'Destinatário, assunto e mensagem são obrigatórios.' });
    }
    const apiKey = (process.env.BREVO_API_KEY || '').replace(/^["']|["']$/g, '');
    const senderEmail = (process.env.SENDER_EMAIL || process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com').replace(/^["']|["']$/g, '');
    if (!apiKey) return res.status(500).json({ error: 'Serviço de e-mail não configurado.' });

    const mensagemEscapada = escapeHtml(mensagem).replace(/\n/g, '<br>');
    const mensagemHtml = linkLabel && linkUrl
        ? mensagemEscapada.replace(
            escapeHtml(linkLabel),
            `<a href="${escapeHtml(linkUrl)}" style="color:#2563eb;font-weight:600;text-decoration:underline" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a>`
        )
        : mensagemEscapada;

    const htmlContent = `
    <div style="font-family:sans-serif;max-width:620px;margin:auto;border:1px solid #ddd;border-radius:10px;overflow:hidden;color:#333">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:22px 28px">
            <h2 style="margin:0;color:#fff;font-size:18px">DAC — Departamento Artístico Cultural</h2>
            <p style="margin:4px 0 0;color:rgba(255,255,255,.8);font-size:12px">UFSC — Secretaria de Cultura, Arte e Esporte</p>
        </div>
        <div style="padding:28px">
            <p style="font-size:15px">Olá, <strong>${nome || 'Proponente'}</strong>!</p>
            <div style="font-size:14px;color:#444;line-height:1.8;margin:18px 0;white-space:pre-wrap">${mensagemHtml}</div>
            <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
            <p style="font-size:13px;color:#555">Em caso de dúvidas, entre em contato diretamente com a equipe do DAC pelo e-mail <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold;">pautas.dac@contato.ufsc.br</a>.</p>
            <p style="font-size:11px;color:#aaa;margin-top:20px">
                UFSC — Secretaria de Cultura, Arte e Esporte · Departamento Artístico Cultural (DAC)<br>
                Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC
            </p>
        </div>
    </div>`;

    try {
        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: 'DAC - UFSC', email: senderEmail },
            to: [{ email: to, name: nome || to }],
            replyTo: { email: 'pautas.dac@contato.ufsc.br', name: 'DAC - UFSC' },
            subject: assunto,
            htmlContent
        }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } });
        console.log(`✅ E-mail rápido enviado para ${to}`);
        res.json({ success: true });
    } catch (e) {
        console.error(`❌ Erro ao enviar e-mail rápido para ${to}:`, e.response?.data || e.message);
        res.status(500).json({ error: e.response?.data?.message || e.message });
    }
});

// ============================================================
// T005 — ENVIO DE TERMOS DIGITAIS POR E-MAIL (BREVO)
// ============================================================

app.post('/api/enviar-termos-digitais', async (req, res) => {
    const { inscricoes } = req.body;
    if (!Array.isArray(inscricoes) || inscricoes.length === 0) {
        return res.status(400).json({ error: 'Nenhuma inscrição selecionada.' });
    }
    const apiKey = (process.env.BREVO_API_KEY || '').replace(/^["']|["']$/g, '');
    const senderEmail = (process.env.SENDER_EMAIL || process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com').replace(/^["']|["']$/g, '');
    if (!apiKey) return res.status(500).json({ error: 'Serviço de e-mail não configurado.' });

    const locaisNomes = { teatro: 'Teatro Carmen Fossari', igrejinha: 'Igrejinha da UFSC' };
    let enviados = 0, erros = 0;

    for (const insc of inscricoes) {
        const { nome, email, evento, local } = insc;
        if (!email) { erros++; continue; }
        const localNome = locaisNomes[(local || 'teatro').toLowerCase()] || 'Teatro Carmen Fossari';

        const htmlContent = `
        <div style="font-family: sans-serif; max-width: 650px; margin: auto; border: 1px solid #ddd; padding: 30px; border-radius: 10px; color: #333;">
            <div style="text-align: center; margin-bottom: 25px;">
                <h2 style="color: #764ba2;">Termo de Autorização para Ocupação de Espaço</h2>
                <p style="color: #666; font-size: 13px;">UFSC — Departamento Artístico Cultural (DAC)</p>
            </div>
            <p>Olá, <strong>${nome || 'Proponente'}</strong>,</p>
            <p>Sua proposta <strong>"${evento || 'N/A'}"</strong> foi selecionada para o uso do espaço <strong>${localNome}</strong>.</p>
            <p>Para formalizar a ocupação, é necessário que você assine digitalmente o <strong>Termo de Autorização de Ocupação dos Espaços do DAC</strong>.</p>
            <div style="background: #f8f9fa; border: 1px solid #eee; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <h3 style="margin-top: 0; font-size: 15px; color: #333;">Próximos passos:</h3>
                <ol style="font-size: 14px; line-height: 2;">
                    <li>Acesse o link de assinatura que será enviado em seguida pela equipe do DAC.</li>
                    <li>Leia atentamente todas as cláusulas do termo.</li>
                    <li>Assine digitalmente e envie de volta para confirmação.</li>
                </ol>
            </div>
            <p>Em caso de dúvidas, entre em contato diretamente com a equipe do DAC pelo e-mail <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold;">pautas.dac@contato.ufsc.br</a>.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 25px 0;">
            <p style="font-size: 12px; color: #888;">
                UFSC — Secretaria de Cultura, Arte e Esporte<br>
                Departamento Artístico Cultural (DAC)<br>
                Praça Santos Dumont — Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC
            </p>
        </div>`;

        try {
            const resp = await axios.post('https://api.brevo.com/v3/smtp/email', {
                sender: { name: 'DAC - UFSC', email: senderEmail },
                to: [{ email: email, name: nome || email }],
                cc: [{ email: 'pautas.dac@contato.ufsc.br', name: 'DAC - UFSC' }],
                replyTo: { email: 'pautas.dac@contato.ufsc.br', name: 'DAC - UFSC' },
                subject: `📋 Termo de Autorização — ${evento || 'Seu Projeto'} — DAC/UFSC`,
                htmlContent
            }, {
                headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }
            });
            enviados++;
            console.log(`✅ Termo enviado para ${email}`);
        } catch (e) {
            erros++;
            console.error(`❌ Erro ao enviar termo para ${email}:`, e.response?.data || e.message);
        }
    }

    res.json({ success: true, enviados, erros, total: inscricoes.length });
});

// ============================================================
// T005b — ENVIO DO TERMO ASSINADO EM PDF
// ============================================================

app.post('/api/enviar-termo-assinado', async (req, res) => {
    const { id, email, nome, evento, fileName, pdfBase64, termoDados } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const apiKey = (process.env.BREVO_API_KEY || '').replace(/^["']|["']$/g, '');
    const senderEmail = (process.env.SENDER_EMAIL || process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com').replace(/^["']|["']$/g, '');

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: 'Informe um e-mail válido para o envio.' });
    }
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
        return res.status(400).json({ error: 'O PDF assinado não foi recebido.' });
    }
    if (!apiKey) {
        return res.status(500).json({ error: 'Serviço de e-mail não configurado.' });
    }

    // Quando o termo veio de uma inscrição, o destinatário deve ser o e-mail original.
    if (id) {
        const inscricoes = await getAgendamentos();
        const inscricao = inscricoes.find(item => String(item.id) === String(id))
            || await buscarDadosInscricaoForms(String(id));
        if (!inscricao) {
            return res.status(404).json({ error: 'Inscrição não encontrada.' });
        }
        const emailOriginal = String(inscricao.email || '').trim().toLowerCase();
        if (emailOriginal && emailOriginal !== normalizedEmail) {
            return res.status(400).json({ error: 'O e-mail informado não corresponde ao e-mail da inscrição.' });
        }
    }

    const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '').replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
        return res.status(400).json({ error: 'Formato do PDF inválido.' });
    }

    const pdfBuffer = Buffer.from(cleanBase64, 'base64');
    if (pdfBuffer.length === 0 || pdfBuffer.length > 8 * 1024 * 1024) {
        return res.status(400).json({ error: 'O PDF precisa ter entre 1 byte e 8 MB.' });
    }

    const safeFileName = String(fileName || 'Termo_DAC_2026.pdf')
        .replace(/[^a-zA-Z0-9_.-]/g, '_')
        .slice(0, 180) || 'Termo_DAC_2026.pdf';
    const nomeSeguro = escapeHtml(nome || 'Proponente');
    const eventoSeguro = escapeHtml(evento || 'Seu projeto');

    const htmlContent = `
    <div style="font-family:sans-serif;max-width:650px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden;color:#333">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 28px">
            <h2 style="margin:0;color:#fff;font-size:19px">Termo de Autorização Assinado</h2>
            <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:13px">UFSC — Departamento Artístico Cultural (DAC)</p>
        </div>
        <div style="padding:26px 28px">
            <p style="font-size:15px">Olá, <strong>${nomeSeguro}</strong>!</p>
            <p style="font-size:14px;color:#555;line-height:1.7">
                Conforme sua autorização, segue em anexo o PDF do Termo de Autorização assinado digitalmente
                referente ao evento <strong>${eventoSeguro}</strong>.
            </p>
            <p style="font-size:13px;color:#666">O mesmo documento foi encaminhado ao DAC para registro.</p>
            <p style="font-size:13px;color:#555">Em caso de dúvidas, entre em contato com
                <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold">pautas.dac@contato.ufsc.br</a>.
            </p>
            <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
            <p style="font-size:11px;color:#aaa">
                UFSC — Secretaria de Cultura, Arte e Esporte · Departamento Artístico Cultural (DAC)<br>
                Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC
            </p>
        </div>
    </div>`;

    try {
        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: 'DAC - UFSC', email: senderEmail },
            to: [{ email: normalizedEmail, name: nome || normalizedEmail }],
            cc: [{ email: 'pautas.dac@contato.ufsc.br', name: 'DAC - UFSC' }],
            replyTo: { email: 'pautas.dac@contato.ufsc.br', name: 'DAC - UFSC' },
            subject: `📄 Termo Assinado — ${evento || 'Projeto DAC'} — DAC/UFSC`,
            htmlContent,
            attachment: [{
                content: pdfBuffer.toString('base64'),
                name: safeFileName
            }]
        }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } });

        let statusSaved = true;
        if (id) {
            const camposPermitidos = [
                'espacoTeatro', 'espacoIgreja', 'nomeEvento', 'dataHorarioEvento',
                'outrasInformacoes', 'nomeCompleto', 'cpfCnpj', 'rg', 'telefone',
                'email', 'endereco', 'numero', 'apartamento', 'bairro', 'cidade'
            ];
            const dadosSalvos = {};
            if (termoDados && typeof termoDados === 'object') {
                camposPermitidos.forEach(campo => {
                    if (typeof termoDados[campo] === 'string' || typeof termoDados[campo] === 'boolean') {
                        dadosSalvos[campo] = termoDados[campo];
                    }
                });
            }
            const dadosTermo = {
                termoAssinado: true,
                termoAssinadoEm: new Date().toISOString(),
                termoDados: dadosSalvos
            };
            statusSaved = String(id).startsWith('forms_')
                ? await saveTermoLegada(String(id), dadosTermo)
                : await updateAgendamento(id, dadosTermo);
        }

        console.log(`✅ Termo assinado enviado para ${normalizedEmail} com cópia para o DAC`);
        res.json({ success: true, statusSaved });
    } catch (e) {
        console.error(`❌ Erro ao enviar termo assinado para ${normalizedEmail}:`, e.response?.data || e.message);
        res.status(500).json({ error: e.response?.data?.message || 'Não foi possível enviar o PDF por e-mail.' });
    }
});

app.post('/api/enviar-links-termo', async (req, res) => {
    const { emails, observacao, baseUrl, id: requestedId } = req.body || {};
    if ((!Array.isArray(emails) || emails.length === 0) && !requestedId) {
        return res.status(400).json({ error: 'Nenhum e-mail ou inscrição informada.' });
    }
    const apiKey = (process.env.BREVO_API_KEY || '').replace(/^["']|["']$/g, '');
    const senderEmail = (process.env.SENDER_EMAIL || process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com').replace(/^["']|["']$/g, '');
    if (!apiKey) return res.status(500).json({ error: 'Serviço de e-mail não configurado.' });

    const inscricoes = await getAgendamentos();
    const origin = (baseUrl || '').replace(/\/$/, '');

    let enviados = 0, erros = 0;
    const naoEncontrados = [];
    const detalhes = [];

    const destinatarios = requestedId
        ? [{ id: String(requestedId), email: '' }]
        : emails.map(email => ({ id: '', email }));

    for (const destinatario of destinatarios) {
        const email = String(destinatario.email || '').trim().toLowerCase();
        const idSolicitado = String(destinatario.id || '').trim();
        if (!email && !idSolicitado) continue;
        const insc = idSolicitado
            ? (inscricoes.find(p => String(p.id) === idSolicitado) || await buscarDadosInscricaoForms(idSolicitado))
            : inscricoes.find(p => (p.email || '').trim().toLowerCase() === email)
                || await buscarInscricaoFormsPorEmail(email);
        if (!insc) {
            naoEncontrados.push(email || idSolicitado);
            detalhes.push({ email: email || null, id: idSolicitado || null, status: 'nao_encontrado' });
            continue;
        }

        const { nome, evento, localNome, local, id } = insc;
        const emailDestino = String(insc.email || email).trim().toLowerCase();
        if (!emailDestino) {
            naoEncontrados.push(id);
            detalhes.push({ email: null, id, status: 'sem_email' });
            continue;
        }
        const localExibir = localNome || (local === 'igrejinha' ? 'Igrejinha da UFSC' : 'Teatro Carmen Fossari');
        const termoUrl = `${origin}/termo?id=${encodeURIComponent(id)}`;

        const obsBlock = observacao ? `
            <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:16px 18px;margin:20px 0">
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#92400e">⚠️ Aviso da equipe DAC:</p>
                <p style="margin:0;font-size:14px;color:#92400e;line-height:1.6">${observacao.replace(/\n/g, '<br>')}</p>
            </div>` : '';

        const htmlContent = `
        <div style="font-family:sans-serif;max-width:650px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden;color:#333">
            <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:28px 30px;text-align:center">
                <h2 style="margin:0;color:#fff;font-size:20px">Termo de Autorização de Uso</h2>
                <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">UFSC — Departamento Artístico Cultural (DAC)</p>
            </div>
            <div style="padding:28px 30px">
                <p style="font-size:15px">Olá, <strong>${nome || 'Proponente'}</strong>!</p>
                <p style="font-size:14px;color:#555;line-height:1.7">
                    Você está recebendo o link individual para preencher o <strong>Termo Digital de Autorização de Uso do DAC</strong> referente ao seu evento:
                </p>
                <div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin:20px 0">
                    <p style="margin:0 0 6px;font-size:13px;color:#666"><strong>Evento:</strong> ${evento || 'N/A'}</p>
                    <p style="margin:0;font-size:13px;color:#666"><strong>Local:</strong> ${localExibir}</p>
                </div>
                <p style="font-size:14px;color:#555;line-height:1.7">
                    Por favor, acesse o link abaixo, preencha os dados solicitados e assine digitalmente:
                </p>
                ${obsBlock}
                <div style="text-align:center;margin:28px 0">
                    <a href="${termoUrl}" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:.3px">
                        ✍️ Acessar Meu Termo Digital
                    </a>
                </div>
                <p style="font-size:12px;color:#aaa;text-align:center;word-break:break-all">
                    Ou copie o link: <a href="${termoUrl}" style="color:#764ba2">${termoUrl}</a>
                </p>
                <p style="font-size:13px;color:#555">Em caso de dúvidas, entre em contato diretamente com a equipe do DAC pelo e-mail <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold;">pautas.dac@contato.ufsc.br</a>.</p>
                <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
                <p style="font-size:11px;color:#aaa;text-align:center">
                    UFSC — Secretaria de Cultura, Arte e Esporte · Departamento Artístico Cultural (DAC)<br>
                    Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC
                </p>
            </div>
        </div>`;

        try {
            await axios.post('https://api.brevo.com/v3/smtp/email', {
                sender: { name: 'DAC - UFSC', email: senderEmail },
                to: [{ email: emailDestino, name: nome || emailDestino }],
                cc: [{ email: 'pautas.dac@contato.ufsc.br', name: 'DAC - UFSC' }],
                replyTo: { email: 'pautas.dac@contato.ufsc.br', name: 'DAC - UFSC' },
                subject: `✍️ Seu Termo Digital — ${evento || 'Projeto DAC'} — DAC/UFSC`,
                htmlContent
            }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } });
            enviados++;
            detalhes.push({ email: emailDestino, id, nome, evento, status: 'enviado' });
            console.log(`✅ Link do termo enviado para ${emailDestino} (inscrição ${id})`);
        } catch (e) {
            erros++;
            detalhes.push({ email: emailDestino, id, nome, evento, status: 'erro', msg: e.response?.data?.message || e.message });
            console.error(`❌ Erro ao enviar link para ${emailDestino}:`, e.response?.data || e.message);
        }
    }

    res.json({ success: true, enviados, erros, naoEncontrados, detalhes, total: destinatarios.length });
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
        verificarEnviosAutomaticosFormulario();
        setInterval(verificarEnviosAutomaticosFormulario, 60 * 1000);
    });
}
