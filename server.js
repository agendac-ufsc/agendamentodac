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
            // Garantir que o agendamento tenha um ID único
            if (!novoAgendamento.id) {
                novoAgendamento.id = `site_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }
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
        const eventosEncontrados = allEvents.data.items.filter(e => 
            eventosEsperados.includes(e.summary) && 
            e.description && 
            e.description.includes(agendamento.email)
        );
        
        // Se nenhum evento foi encontrado, significa que foram apagados
        return eventosEncontrados.length > 0;
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

// Função para obter a lista de exclusão (Blacklist)
const getBlacklist = async () => {
    if (!redis) return [];
    try {
        const blacklist = await redis.get('agendamentos_blacklist');
        return blacklist ? JSON.parse(blacklist) : [];
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
            await redis.set('agendamentos_blacklist', JSON.stringify(blacklist));
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

            // Verificar se os eventos ainda existem no Google Calendar
            const eventosExistem = await verificarEventosNoCalendario(p);
            
            if (correspondencia) {
                unificados.push({
                    primeiraEtapa: { ...p, localNome: mapeamentoLocais[p.calendarId] || 'N/A' },
                    segundaEtapa: { headers, valores: correspondencia },
                    status: eventosExistem ? 'Completo' : 'Cancelado (Eventos Removidos)',
                    eventosExistem: eventosExistem
                });
            } else {
                unificados.push({
                    primeiraEtapa: { ...p, localNome: mapeamentoLocais[p.calendarId] || 'N/A' },
                    segundaEtapa: null,
                    status: eventosExistem ? 'Pendente (Falta Forms)' : 'Cancelado (Eventos Removidos)',
                    eventosExistem: eventosExistem
                });
            }
        }

        // Adicionar o que sobrou da segunda etapa (Forms)
        dataSegundaEtapa.forEach((s, idx) => {
            const emailSheet = (indicesEmail.length > 0 ? s[indicesEmail[0]] : 'N/A') || 'N/A';
            const telefoneSheet = (indicesTelefone.length > 0 ? s[indicesTelefone[0]] : 'N/A') || 'N/A';
            const nomeEventoSheet = (idxNomeEventoSheet >= 0 ? s[idxNomeEventoSheet] : 'Evento (Forms)') || 'Evento (Forms)';
            const nomeProponenteSheet = (idxNomeProponenteSheet >= 0 ? s[idxNomeProponenteSheet] : 'Inscrição Forms') || 'Inscrição Forms';

            // Gerar um ID determinístico baseado no conteúdo para que a Blacklist funcione
            const deterministicId = `forms_${emailSheet.trim().toLowerCase()}_${nomeEventoSheet.trim().toLowerCase()}`.replace(/\s+/g, '_');

            unificados.push({
                primeiraEtapa: { 
                    id: deterministicId,
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
                // Deletar eventos do Google Calendar em paralelo (máximo 5 simultâneos)
                const allEvents = await calendar.events.list({
                    auth: googleAuthClient,
                    calendarId: CALENDAR_ID,
                    maxResults: 2500,
                    singleEvents: true
                });
                
                const events = allEvents.data.items || [];
                console.log(`🗑️ [Exclusão Geral] Deletando ${events.length} eventos do calendário...`);
                
                let eventosDeletedos = 0;
                const batchSize = 5;
                
                for (let i = 0; i < events.length; i += batchSize) {
                    const batch = events.slice(i, i + batchSize);
                    await Promise.all(
                        batch.map(event => 
                            calendar.events.delete({
                                auth: googleAuthClient,
                                calendarId: CALENDAR_ID,
                                eventId: event.id
                            }).then(() => {
                                eventosDeletedos++;
                            }).catch(error => {
                                console.warn(`⚠️ Erro ao deletar evento ${event.id}:`, error.message);
                            })
                        )
                    );
                }
                
                // Limpar o Redis
                if (redis) {
                    await redis.del(AGENDAMENTOS_KEY);
                    console.log(`✅ [Exclusão Geral] Redis limpo com sucesso`);
                }
                
                // Limpar a Blacklist tambem
                await clearBlacklist();
                
                console.log(`✅ [Exclusão Geral] Concluído: ${eventosDeletedos} eventos removidos do calendário, ${agendamentos.length} registros removidos do banco de dados`);
            } catch (error) {
                console.error('❌ Erro na exclusão geral em segundo plano:', error.message);
            }
        })();
    } catch (error) {
        console.error('❌ Erro ao iniciar exclusão geral:', error.message);
        res.status(500).json({ success: false, error: 'Erro ao iniciar exclusão geral' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
