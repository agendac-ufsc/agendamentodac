require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { google } = require('googleapis');
const Redis = require('ioredis');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configurar Google Calendar
const CALENDAR_ID = 'oto.bezerra@ufsc.br';
let googleAuthClient;

// Funções para persistência com Redis (ioredis)
const AGENDAMENTOS_KEY = 'agendamentos_v1';

let redis;
try {
    if (process.env.REDIS_URL) {
        redis = new Redis(process.env.REDIS_URL);
        console.log('✅ [Redis] Cliente ioredis inicializado com sucesso.');
    } else {
        console.warn('⚠️ [Redis] REDIS_URL não encontrada no ambiente.');
    }
} catch (e) {
    console.error('❌ [Redis] Erro ao inicializar cliente:', e.message);
}

const getAgendamentos = async () => {
    try {
        if (redis) {
            const data = await redis.get(AGENDAMENTOS_KEY);
            return data ? JSON.parse(data) : [];
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
            agendamentos.push(novoAgendamento);
            await redis.set(AGENDAMENTOS_KEY, JSON.stringify(agendamentos));
            console.log("✅ [Redis] Agendamento salvo com sucesso. Dados:", JSON.stringify(novoAgendamento));
            return true;
        }
    } catch (error) {
        console.error('❌ [Redis] Erro ao salvar agendamento:', error.message);
    }
    return false;
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
            await redis.set(AGENDAMENTOS_KEY, JSON.stringify(filtrados));
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
const SPREADSHEET_ID = '1FFjm8WMtLGbWqFDsSwtkFfuuCaN9zNzi7RB7Z68CZAo';

const createCalendarEvent = async (summary, description, date, timeRange) => {
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
            calendarId: CALENDAR_ID,
            resource: event,
        });
        return response.data;
    } catch (error) {
        console.error(`❌ [Google] Erro ao criar evento:`, error.message);
        return null;
    }
};

app.get('/api/disponibilidade', async (req, res) => {
    if (!googleAuthClient) await initGoogleAuth();
    try {
        const { start, end } = req.query;
        const response = await calendar.events.list({
            auth: googleAuthClient,
            calendarId: CALENDAR_ID,
            timeMin: start || new Date().toISOString(),
            timeMax: end || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500
        });
        const ocupados = response.data.items.map(event => ({
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            summary: event.summary
        }));
        res.json(ocupados);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao consultar calendário' });
    }
});

const sendEmail = async (to, subject, htmlContent) => {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return null;
    const senderEmail = process.env.SENDER_EMAIL || "agendac.ufsc@gmail.com";
    const data = {
        sender: { "name": "Agendamento DAC", "email": senderEmail },
        to: Array.isArray(to) ? to.map(email => ({ "email": email })) : [{ "email": to }],
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
        const { nome, email, telefone, evento, etapas } = req.body;
        if (!nome || !email || !telefone || !evento || !etapas) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }
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
        const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
        for (const key of Object.keys(etapas)) {
            const itens = Array.isArray(etapas[key]) ? etapas[key] : [etapas[key]];
            for (let i = 0; i < itens.length; i++) {
                const item = itens[i];
                const label = itens.length > 1 ? `${nomesEtapas[key]} ${i + 1}` : nomesEtapas[key];
                await createCalendarEvent(`${label}: ${evento}`, `Proponente: ${nome}\nE-mail: ${email}\nTelefone: ${telefone}`, item.data, item.horario);
            }
        }
        const tabelaHtml = gerarTabelaEtapas(etapas);
        const adminEmail = process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com';
        await sendEmail(email, '✅ Confirmação de Inscrição de Projeto - DAC', `<div style="font-family: sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;"><h2 style="color: #764ba2;">Olá ${nome}!</h2><p>Sua inscription para o evento <strong>${evento}</strong> foi recebida com sucesso.</p><hr style="border: 0; border-top: 1px solid #eee;"><p><strong>Resumo do Cronograma:</strong></p>${tabelaHtml}<hr style="border: 0; border-top: 1px solid #eee;"><p>Caso precise realizar alterações, entre em contato respondendo a este e-mail.</p><p>Atenciosamente,<br><strong>Equipe DAC</strong></p></div>`);
        await sendEmail(adminEmail, `📅 NOVA INSCRIÇÃO: ${evento} (${nome})`, `<div style="font-family: sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;"><h2 style="color: #333;">Nova Inscrição de Projeto</h2><p>Um novo projeto foi inscrito com o seguinte cronograma:</p><hr style="border: 0; border-top: 1px solid #eee;"><p><strong>Dados do Proponente:</strong></p><p>👤 <strong>Nome:</strong> ${nome}</p><p>📧 <strong>E-mail:</strong> ${email}</p><p>📞 <strong>Telefone:</strong> ${telefone}</p><p>🎭 <strong>Evento:</strong> ${evento}</p><hr style="border: 0; border-top: 1px solid #eee;"><p><strong>Cronograma do Projeto:</strong></p>${tabelaHtml}</div>`);
        await saveAgendamento({ id: Date.now().toString(), nome, email, telefone, evento, etapas, calendarId: CALENDAR_ID, timestamp: new Date().toLocaleString('pt-BR') });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro interno ao processar agendamento.' });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.get('/api/admin/dados-unificados', async (req, res) => {
    if (!googleAuthClient) await initGoogleAuth();
    try {
        const response = await sheets.spreadsheets.values.get({ auth: googleAuthClient, spreadsheetId: SPREADSHEET_ID, range: 'Respostas ao formulário 1!A:ZZ' });
        const rows = response.data.values || [];
        const headers = rows[0] || []; console.log("DEBUG: Headers encontrados:", headers.length, headers.slice(0, 5));
        const dataSegundaEtapa = rows.slice(1); console.log("DEBUG: Linhas de dados encontradas:", dataSegundaEtapa.length);

        // Identificar colunas de e-mail e telefone
        const findIndices = (keywords) => headers.reduce((acc, h, i) => {
            if (keywords.some(k => h.toLowerCase().includes(k))) acc.push(i);
            return acc;
        }, []);

        const indicesEmail = findIndices(['endereço de e-mail', 'e-mail', 'email']);
        const indicesTelefone = findIndices(['telefone', 'celular', 'contato']);
        const idxNomeEventoSheet = headers.findIndex(h => h.toLowerCase().includes('nome do evento') || h.toLowerCase().includes('título do projeto'));
        const idxNomeProponenteSheet = headers.findIndex(h => h.toLowerCase().includes('nome completo') && !h.toLowerCase().includes('representante'));

        const mapeamentoLocais = { 'oto.bezerra@ufsc.br': 'Teatro' };
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

            if (correspondencia) {
                unificados.push({
                    primeiraEtapa: { ...p, localNome: mapeamentoLocais[p.calendarId] || 'N/A' },
                    segundaEtapa: { headers, valores: correspondencia },
                    status: 'Completo'
                });
            } else {
                unificados.push({
                    primeiraEtapa: { ...p, localNome: mapeamentoLocais[p.calendarId] || 'N/A' },
                    segundaEtapa: null,
                    status: 'Pendente (Falta Forms)'
                });
            }
        }

        // Adicionar o que sobrou da segunda etapa (Forms)
        dataSegundaEtapa.forEach(s => {
            const emailSheet = indicesEmail.length > 0 ? s[indicesEmail[0]] : 'N/A';
            const telefoneSheet = indicesTelefone.length > 0 ? s[indicesTelefone[0]] : 'N/A';
            const nomeEventoSheet = idxNomeEventoSheet >= 0 ? s[idxNomeEventoSheet] : 'Evento (Forms)';
            const nomeProponenteSheet = idxNomeProponenteSheet >= 0 ? s[idxNomeProponenteSheet] : 'Inscrição Forms';

            unificados.push({
                primeiraEtapa: { 
                    nome: nomeProponenteSheet,
                    email: emailSheet,
                    telefone: telefoneSheet,
                    evento: nomeEventoSheet,
                    etapas: {},
                    isLegada: true 
                },
                segundaEtapa: { headers, valores: s },
                status: 'Completo (Forms)'
            });
        });

        console.log(`[DEBUG] Gerados ${unificados.length} registros unificados.`);
        res.json(unificados);
    } catch (error) {
        console.error('[DEBUG] Erro ao gerar dados unificados:', error);
        res.status(500).json({ error: 'Erro ao gerar dados unificados' });
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
        const agendamentos = await getAgendamentos();
        const agendamento = agendamentos.find(a => a.id === id);
        if (agendamento) {
            const success = await deleteAgendamentoByEmail(agendamento.email);
            res.json({ success });
        } else {
            res.status(404).json({ success: false, error: 'Agendamento não encontrado' });
        }
    } catch (error) {
        console.error('Erro ao deletar agendamento:', error.message);
        res.status(500).json({ success: false, error: 'Erro ao deletar agendamento' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
