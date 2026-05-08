require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { google } = require('googleapis');
const { Redis } = require('@upstash/redis');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configurar Google Calendar — locais disponíveis
const CALENDAR_IDS = {
    teatro: 'oto.bezerra@ufsc.br',
    igrejinha: process.env.IGREJINHA_CALENDAR_ID || 'c_e19d30c40d4de176bc7d4e11ada96bfaffd130b3ed499d9807c88785e2c71c05@group.calendar.google.com'
};
const CALENDAR_ID = CALENDAR_IDS.teatro; // retrocompatibilidade
let googleAuthClient;

// Funções para persistência com Upstash Redis (REST)
const AGENDAMENTOS_KEY = 'agendamentos_v1';

let redis;
try {
    let url = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/^["']|["']$/g, '');
    let token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').replace(/^["']|["']$/g, '');
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

const deleteAgendamentoByEmail = async (email) => {
    try {
        if (redis) {
            const agendamentos = await getAgendamentos();
            const agendamentoAExcluir = agendamentos.find(a => a.email === email);
            
            // Se encontrou o agendamento, tenta deletar os eventos do calendário
            if (agendamentoAExcluir && agendamentoAExcluir.etapas) {
                if (!googleAuthClient) await initGoogleAuth();
                try {
                    // Buscar todos os eventos do calendário para encontrar os que correspondem a este agendamento
                    const allEvents = await calendar.events.list({
                        auth: googleAuthClient,
                        calendarId: CALENDAR_ID,
                        maxResults: 2500,
                        singleEvents: true
                    });
                    
                    const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
                    const eventosADeletar = [];
                    
                    // Identificar eventos que pertencem a este agendamento
                    for (const key in agendamentoAExcluir.etapas) {
                        const itens = Array.isArray(agendamentoAExcluir.etapas[key]) ? agendamentoAExcluir.etapas[key] : [agendamentoAExcluir.etapas[key]];
                        itens.forEach((item, i) => {
                            const label = itens.length > 1 ? `${nomesEtapas[key]} ${i + 1}` : nomesEtapas[key];
                            const eventSummary = `${label}: ${agendamentoAExcluir.evento}`;
                            
                            // Procurar eventos com este resumo
                            const matchingEvents = allEvents.data.items.filter(e => 
                                e.summary === eventSummary && 
                                e.description && 
                                e.description.includes(email)
                            );
                            eventosADeletar.push(...matchingEvents);
                        });
                    }
                    
                    // Deletar os eventos encontrados
                    for (const event of eventosADeletar) {
                        try {
                            await calendar.events.delete({
                                auth: googleAuthClient,
                                calendarId: CALENDAR_ID,
                                eventId: event.id
                            });
                            console.log(`✅ [Google Calendar] Evento deletado: ${event.summary}`);
                        } catch (err) {
                            console.error(`⚠️ [Google Calendar] Erro ao deletar evento ${event.id}:`, err.message);
                        }
                    }
                } catch (calendarError) {
                    console.error('⚠️ [Google Calendar] Erro ao processar exclusão de eventos:', calendarError.message);
                }
            }
            
            const filtrados = agendamentos.filter(a => a.email !== email);
            await redis.set(AGENDAMENTOS_KEY, filtrados);
            console.log(`✅ [Redis] Agendamento de ${email} removido.`);
            return true;
        }
    } catch (error) {
        console.error('❌ [Redis] Erro ao deletar agendamento:', error.message);
    }
    return false;
};

const initGoogleAuth = async () => {
    try {
        const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
        if (serviceAccountKey) {
            const credentials = JSON.parse(serviceAccountKey);
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

initGoogleAuth();

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
let BOTOES_HOME = {
    interno: { ativo: false, texto: 'Edital Interno' },
    externo: { ativo: true,  texto: 'Edital de Ocupação dos Espaços do DAC 2026' },
    ensaio:  { ativo: false, texto: 'Agendar Apenas Ensaio' }
};

const CONFIG_KEY = 'agendamentos_config';

const getConfigs = async () => {
    try {
        if (redis) {
            const data = await redis.get(CONFIG_KEY);
            if (data) {
                const configs = parseRedisValue(data);
                // Garantir que o ID em memória esteja sempre limpo
                SPREADSHEET_ID = extractSpreadsheetId(configs.spreadsheetId) || SPREADSHEET_ID;
                FORMS_LINK = configs.formsLink || FORMS_LINK;
                PERMITIR_DISPUTA = configs.permitirDisputa !== undefined ? configs.permitirDisputa : true;
                HORARIOS_LIMITES = configs.horariosLimites || HORARIOS_LIMITES;
                DATAS_BLOQUEADAS = configs.datasBloqueadas || [];
                TITULO_PAGINA_AGENDAMENTO = configs.tituloPaginaAgendamento || TITULO_PAGINA_AGENDAMENTO;
                if (configs.avaliacoesNecessarias !== undefined) {
                    const n = parseInt(configs.avaliacoesNecessarias, 10);
                    if (Number.isFinite(n) && n > 0) AVALIACOES_NECESSARIAS = Math.min(n, 20);
                }
                if (configs.botoesHome && typeof configs.botoesHome === 'object') {
                    BOTOES_HOME = {
                        interno: { ...BOTOES_HOME.interno, ...(configs.botoesHome.interno || {}) },
                        externo: { ...BOTOES_HOME.externo, ...(configs.botoesHome.externo || {}) },
                        ensaio:  { ...BOTOES_HOME.ensaio,  ...(configs.botoesHome.ensaio  || {}) }
                    };
                }
                return { 
                    spreadsheetId: SPREADSHEET_ID, 
                    formsLink: FORMS_LINK,
                    permitirDisputa: PERMITIR_DISPUTA,
                    horariosLimites: HORARIOS_LIMITES,
                    datasBloqueadas: DATAS_BLOQUEADAS,
                    tituloPaginaAgendamento: TITULO_PAGINA_AGENDAMENTO,
                    avaliacoesNecessarias: AVALIACOES_NECESSARIAS,
                    botoesHome: BOTOES_HOME
                };
            }
        }
    } catch (error) {
        console.error('❌ [Redis] Erro ao buscar configurações:', error.message);
    }
    return { 
        spreadsheetId: SPREADSHEET_ID, 
        formsLink: FORMS_LINK,
        permitirDisputa: PERMITIR_DISPUTA,
        horariosLimites: HORARIOS_LIMITES,
        datasBloqueadas: DATAS_BLOQUEADAS,
        tituloPaginaAgendamento: TITULO_PAGINA_AGENDAMENTO,
        avaliacoesNecessarias: AVALIACOES_NECESSARIAS,
        botoesHome: BOTOES_HOME
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
    try {
        // Extrair o ID caso tenham colado a URL completa
        const cleanSpreadsheetId = extractSpreadsheetId(configs.spreadsheetId);
        
        // Atualiza em memória primeiro
        SPREADSHEET_ID = cleanSpreadsheetId || SPREADSHEET_ID;
        FORMS_LINK = configs.formsLink || FORMS_LINK;
        if (configs.permitirDisputa !== undefined) {
            PERMITIR_DISPUTA = configs.permitirDisputa;
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
        if (configs.botoesHome && typeof configs.botoesHome === 'object') {
            const norm = (b, padraoTexto) => ({
                ativo: !!(b && b.ativo),
                texto: ((b && typeof b.texto === 'string' ? b.texto : '') || '').trim() || padraoTexto
            });
            BOTOES_HOME = {
                interno: norm(configs.botoesHome.interno, 'Edital Interno'),
                externo: norm(configs.botoesHome.externo, 'Edital de Ocupação dos Espaços do DAC 2026'),
                ensaio:  norm(configs.botoesHome.ensaio,  'Agendar Apenas Ensaio')
            };
        }

        if (redis) {
            // Persistir as configurações
            const configToSave = {
                spreadsheetId: cleanSpreadsheetId,
                formsLink: FORMS_LINK,
                permitirDisputa: PERMITIR_DISPUTA,
                horariosLimites: HORARIOS_LIMITES,
                datasBloqueadas: DATAS_BLOQUEADAS,
                tituloPaginaAgendamento: TITULO_PAGINA_AGENDAMENTO,
                avaliacoesNecessarias: AVALIACOES_NECESSARIAS,
                botoesHome: BOTOES_HOME
            };
            await redis.set(CONFIG_KEY, configToSave);
            console.log('✅ [Redis] Configurações persistidas:', JSON.stringify(configToSave));
        } else {
            console.warn('⚠️ [Config] Salvo apenas em memória (Redis indisponível).');
        }
        return true;
    } catch (error) {
        console.error('❌ Erro ao salvar configurações:', error.message);
    }
    return false;
};

// Carregar configurações iniciais
getConfigs();

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

// Rota para obter configurações (pública para o site poder pegar o link do forms)
app.get('/api/config', async (req, res) => {
    const configs = await getConfigs();
    res.json(configs);
});

// Rota para salvar configurações (administrativa)
app.post('/api/admin/config', async (req, res) => {
    const { spreadsheetId, formsLink, permitirDisputa, horariosLimites, datasBloqueadas, tituloPaginaAgendamento, botoesHome, avaliacoesNecessarias } = req.body;
    // PermitirDisputa pode ser booleano, então verificamos se é undefined
    if (!spreadsheetId || !formsLink) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
    }
    const success = await saveConfigs({ spreadsheetId, formsLink, permitirDisputa, horariosLimites, datasBloqueadas, tituloPaginaAgendamento, botoesHome, avaliacoesNecessarias });
    res.json({ success });
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
        const ocupados = response.data.items.map(event => ({
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            summary: event.summary,
            description: event.description || ''
        }));
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

app.post('/api/agendar', async (req, res) => {
    try {
        const { nome, email, telefone, evento, etapas, local } = req.body;
        if (!nome || !email || !telefone || !evento || !etapas) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }
        const localKey = (local || 'teatro').toLowerCase();
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

        // Salvar no Redis ANTES dos e-mails — garante que a inscrição não se perde se o e-mail falhar
        // calendarSynced: false — eventos no Google Calendar só serão criados quando a etapa 2 (Forms) for detectada
        await saveAgendamento({ id: Date.now().toString(), nome, email, telefone, evento, etapas, local: localKey, localNome, calendarId: calId, timestamp: new Date().toLocaleString('pt-BR'), calendarSynced: false });

        // Enviar e-mails de forma independente — erro de e-mail não cancela a inscrição já salva
        sendEmail(email, '✅ Confirmação de Inscrição de Projeto - DAC', `<div style="font-family: sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;"><h2 style="color: #764ba2;">Olá ${nome}!</h2><p>Sua inscrição para o evento <strong>${evento}</strong> no <strong>${localNome}</strong> foi recebida com sucesso.</p><hr style="border: 0; border-top: 1px solid #eee;"><p><strong>Resumo do Cronograma:</strong></p>${tabelaHtml}<hr style="border: 0; border-top: 1px solid #eee;"><p>Em caso de dúvidas, entre em contato diretamente com a equipe do DAC pelo e-mail <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold;">pautas.dac@contato.ufsc.br</a>.</p><p>Atenciosamente,<br><strong>Equipe DAC</strong></p></div>`).catch(err => console.error('⚠️ [E-mail] Erro ao enviar confirmação ao proponente:', err.message));
        sendEmail(adminEmail, `📅 NOVA INSCRIÇÃO: ${evento} (${nome}) — ${localNome}`, `<div style="font-family: sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;"><h2 style="color: #333;">Nova Inscrição de Projeto</h2><p>Um novo projeto foi inscrito com o seguinte cronograma:</p><hr style="border: 0; border-top: 1px solid #eee;"><p><strong>Dados do Proponente:</strong></p><p>👤 <strong>Nome:</strong> ${nome}</p><p>📧 <strong>E-mail:</strong> ${email}</p><p>📞 <strong>Telefone:</strong> ${telefone}</p><p>🏛️ <strong>Local:</strong> ${localNome}</p><p>🎭 <strong>Evento:</strong> ${evento}</p><hr style="border: 0; border-top: 1px solid #eee;"><p><strong>Cronograma do Projeto:</strong></p>${tabelaHtml}</div>`).catch(err => console.error('⚠️ [E-mail] Erro ao enviar notificação ao admin:', err.message));

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno ao processar agendamento.' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/avaliador', (req, res) => res.sendFile(path.join(__dirname, 'avaliador.html')));
app.get('/termo', (req, res) => res.sendFile(path.join(__dirname, 'termo.html')));

// Buscar uma única inscrição pelo ID (usado pela página do termo digital)
app.get('/api/agendamento/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID não fornecido' });
    try {
        const agendamentos = await getAgendamentos();
        const ag = agendamentos.find(a => a.id === id);
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
            etapas: ag.etapas || {}
        });
    } catch (e) {
        console.error('[/api/agendamento/:id] erro:', e);
        res.status(500).json({ error: 'Erro ao buscar inscrição' });
    }
});

app.get('/api/admin/dados-unificados', async (req, res) => {
    if (!googleAuthClient) await initGoogleAuth();
    try {
                await getConfigs(); // Garantir que temos o ID mais recente
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
            try {
                // Fallback: Pegar a primeira aba disponível dinamicamente
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
            } catch (fallbackError) {
                console.error('❌ [Sheets] Erro crítico ao acessar planilha:', fallbackError.message);
                return res.status(404).json({ error: 'Não foi possível ler a planilha. Verifique se ela está compartilhada com o e-mail de serviço e se o link está correto.' });
            }
        }
        const rows = response.data.values || [];
        const headers = rows[0] || []; console.log("DEBUG: Headers encontrados:", headers.length, headers.slice(0, 5));
        const dataSegundaEtapa = rows.slice(1); console.log("DEBUG: Linhas de dados encontradas:", dataSegundaEtapa.length);

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

        // Processar agendamentos da primeira etapa (site)
        for (const p of agendamentosPrimeiraEtapa) {
            const pEmail = (p.email || '').trim().toLowerCase();
            const pTelefone = (p.telefone || '').replace(/\D/g, '');

            // Buscar a resposta mais recente (última na planilha) que coincida com e-mail ou telefone
            const correspondencia = [...dataSegundaEtapa].reverse().find(s => {
                const sEmail = indicesEmail.map(idx => (s[idx] || '').trim().toLowerCase());
                const sTelefone = indicesTelefone.map(idx => (s[idx] || '').replace(/\D/g, ''));
                
                const matchesEmail = pEmail && sEmail.includes(pEmail);
                const matchesTelefone = pTelefone && pTelefone.length >= 8 && sTelefone.some(st => st && st.includes(pTelefone));
                
                return matchesEmail || matchesTelefone;
            });

            const localNomeResolvido = p.localNome || mapeamentoLocais[p.local] || mapeamentoLocais[p.calendarId] || 'Teatro';
            const calIdInscricao = p.calendarId || CALENDAR_IDS[(p.local || 'teatro').toLowerCase()] || CALENDAR_IDS.teatro;

            if (correspondencia) {
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
                // Ainda só tem etapa 1 — não há eventos no Calendar (novo fluxo) ou pode ter (fluxo antigo)
                // Só verificar o Calendar para inscrições antigas (calendarSynced undefined = fluxo antigo)
                let eventosExistem = false;
                if (p.calendarSynced === undefined) {
                    eventosExistem = await verificarEventosNoCalendario(p);
                }
                const statusPendente = p.calendarSynced === false
                    ? 'Pendente (Falta Forms)'
                    : (eventosExistem ? 'Pendente (Falta Forms)' : 'Cancelado (Eventos Removidos)');
                unificados.push({
                    primeiraEtapa: { ...p, localNome: localNomeResolvido },
                    segundaEtapa: null,
                    status: statusPendente,
                    eventosExistem: eventosExistem
                });
            }
        }

        // Adicionar o que sobrou da segunda etapa (Forms) - apenas os que não foram unificados ainda
        dataSegundaEtapa.forEach((s, idx) => {
            const emailSheet = (indicesEmail.length > 0 ? (s[indicesEmail[0]] || '').trim().toLowerCase() : '');
            const telefoneSheet = (indicesTelefone.length > 0 ? (s[indicesTelefone[0]] || '').replace(/\D/g, '') : '');
            
            // Verificar se já foi unificado (pelo email ou telefone)
            const jaUnificado = unificados.some(u => {
                const uEmail = (u.primeiraEtapa.email || '').trim().toLowerCase();
                const uTelefone = (u.primeiraEtapa.telefone || '').replace(/\D/g, '');
                return (emailSheet && uEmail === emailSheet) || (telefoneSheet && uTelefone === telefoneSheet);
            });

            if (!jaUnificado) {
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
        // Se o ID for undefined, retornar erro
        if (!id || id === 'undefined') {
            return res.status(400).json({ success: false, error: 'ID não fornecido' });
        }
        
        const agendamentos = await getAgendamentos();
        const agendamento = agendamentos.find(a => a.id === id);
        
        if (agendamento) {
            const success = await deleteAgendamentoByEmail(agendamento.email);
            res.json({ success });
        } else {
            // Se não encontrou no Redis, pode ser um registro legado (Forms)
            // Neste caso, apenas retornar sucesso para não bloquear a interface
            console.log(`⚠️ [Exclusão] Registro legado ou não encontrado: ${id}`);
            res.json({ success: true, message: 'Registro legado removido da visualização' });
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

app.put('/api/admin/agendamentos/:id', async (req, res) => {
    const { id } = req.params;
    const campos = req.body;
    if (!id || Object.keys(campos).length === 0) {
        return res.status(400).json({ error: 'ID e campos para atualizar são obrigatórios.' });
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

                for (const key in campos.etapas) {
                    const itens = Array.isArray(campos.etapas[key]) ? campos.etapas[key] : [campos.etapas[key]];
                    for (let i = 0; i < itens.length; i++) {
                        const it = itens[i];
                        if (!it || !it.data || !it.horario) continue;
                        const label = itens.length > 1 ? `${nomesEtapas[key] || key} ${i + 1}` : (nomesEtapas[key] || key);
                        const eventSummary = `${label}: ${ag.evento}`;

                        const match = allEvents.find(e =>
                            e.summary === eventSummary &&
                            e.description && e.description.includes(ag.email)
                        );

                        if (!match) {
                            console.warn(`⚠️ [Calendar] Evento não encontrado: "${eventSummary}" (${ag.email})`);
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
                            console.log(`✅ [Calendar] Evento atualizado: "${eventSummary}" → ${it.data} ${it.horario}`);
                        } catch (e) {
                            console.error(`❌ [Calendar] Erro ao atualizar "${eventSummary}":`, e.message);
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
    const { to, nome, assunto, mensagem } = req.body;
    if (!to || !assunto || !mensagem) {
        return res.status(400).json({ error: 'Destinatário, assunto e mensagem são obrigatórios.' });
    }
    const apiKey = (process.env.BREVO_API_KEY || '').replace(/^["']|["']$/g, '');
    const senderEmail = (process.env.SENDER_EMAIL || process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com').replace(/^["']|["']$/g, '');
    if (!apiKey) return res.status(500).json({ error: 'Serviço de e-mail não configurado.' });

    const htmlContent = `
    <div style="font-family:sans-serif;max-width:620px;margin:auto;border:1px solid #ddd;border-radius:10px;overflow:hidden;color:#333">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:22px 28px">
            <h2 style="margin:0;color:#fff;font-size:18px">DAC — Departamento Artístico Cultural</h2>
            <p style="margin:4px 0 0;color:rgba(255,255,255,.8);font-size:12px">UFSC — Secretaria de Cultura, Arte e Esporte</p>
        </div>
        <div style="padding:28px">
            <p style="font-size:15px">Olá, <strong>${nome || 'Proponente'}</strong>!</p>
            <div style="font-size:14px;color:#444;line-height:1.8;margin:18px 0;white-space:pre-wrap">${mensagem.replace(/\n/g, '<br>')}</div>
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

app.post('/api/enviar-links-termo', async (req, res) => {
    const { emails, observacao, baseUrl } = req.body;
    if (!Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: 'Nenhum e-mail informado.' });
    }
    const apiKey = (process.env.BREVO_API_KEY || '').replace(/^["']|["']$/g, '');
    const senderEmail = (process.env.SENDER_EMAIL || process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com').replace(/^["']|["']$/g, '');
    if (!apiKey) return res.status(500).json({ error: 'Serviço de e-mail não configurado.' });

    const inscricoes = await getAgendamentos();
    const origin = (baseUrl || '').replace(/\/$/, '');

    let enviados = 0, erros = 0;
    const naoEncontrados = [];
    const detalhes = [];

    for (const rawEmail of emails) {
        const email = rawEmail.trim().toLowerCase();
        if (!email) continue;
        const insc = inscricoes.find(p => (p.email || '').trim().toLowerCase() === email);
        if (!insc) {
            naoEncontrados.push(email);
            detalhes.push({ email, status: 'nao_encontrado' });
            continue;
        }

        const { nome, evento, localNome, local, id } = insc;
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
                to: [{ email: insc.email, name: nome || insc.email }],
                cc: [{ email: 'pautas.dac@contato.ufsc.br', name: 'DAC - UFSC' }],
                replyTo: { email: 'pautas.dac@contato.ufsc.br', name: 'DAC - UFSC' },
                subject: `✍️ Seu Termo Digital — ${evento || 'Projeto DAC'} — DAC/UFSC`,
                htmlContent
            }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } });
            enviados++;
            detalhes.push({ email: insc.email, nome, evento, status: 'enviado' });
            console.log(`✅ Link do termo enviado para ${insc.email}`);
        } catch (e) {
            erros++;
            detalhes.push({ email: insc.email, nome, evento, status: 'erro', msg: e.response?.data?.message || e.message });
            console.error(`❌ Erro ao enviar link para ${insc.email}:`, e.response?.data || e.message);
        }
    }

    res.json({ success: true, enviados, erros, naoEncontrados, detalhes, total: emails.length });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor rodando em http://localhost:${PORT}`));
