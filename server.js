require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configurar Google Calendar
const CALENDAR_ID = 'oto.bezerra@ufsc.br';
let googleAuthClient;

// Armazenamento temporário em memória para a Primeira Etapa (Agendamentos)
// Em produção real, isso deveria estar em um banco de dados como MongoDB ou PostgreSQL
// No Vercel, essa memória é efêmera por requisição/instância, mas servirá para o fluxo imediato
let agendamentosPrimeiraEtapa = [];

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
        } else {
            console.warn('⚠️ [Google] GOOGLE_SERVICE_ACCOUNT_KEY não encontrada.');
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
    if (!googleAuthClient) {
        await initGoogleAuth();
        if (!googleAuthClient) return null;
    }

    try {
        const [startTime, endTime] = timeRange.split(' às ');
        
        // Criar as datas forçando o fuso horário de Brasília (GMT-3)
        // O formato ISO com -03:00 garante que o Google entenda o horário local correto
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

        console.log(`✅ [Google] Evento criado: ${summary} - ID: ${response.data.id}`);
        return response.data;
    } catch (error) {
        console.error(`❌ [Google] Erro ao criar evento "${summary}":`, error.message);
        return null;
    }
};

// Rota para verificar disponibilidade
app.get('/api/disponibilidade', async (req, res) => {
    if (!googleAuthClient) {
        await initGoogleAuth();
        if (!googleAuthClient) return res.status(500).json({ error: 'Erro na autenticação com Google' });
    }

    try {
        const { start, end } = req.query; // Datas no formato ISO (ex: 2026-03-01T00:00:00Z)
        
        const response = await calendar.events.list({
            auth: googleAuthClient,
            calendarId: CALENDAR_ID,
            timeMin: start || new Date().toISOString(),
            timeMax: end || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // +12 meses (365 dias)
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500 // Aumentar limite de resultados para cobrir o ano todo
        });

        const ocupados = response.data.items.map(event => ({
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            summary: event.summary
        }));

        res.json(ocupados);
    } catch (error) {
        console.error('❌ [Google] Erro ao listar eventos:', error.message);
        res.status(500).json({ error: 'Erro ao consultar calendário' });
    }
});

// Configurar Brevo
const sendEmail = async (to, subject, htmlContent) => {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
        console.error('❌ ERRO: BREVO_API_KEY não configurada no ambiente.');
        return null;
    }

    const senderEmail = process.env.SENDER_EMAIL || "agendac.ufsc@gmail.com";
    const senderName = "Agendamento DAC";

    const data = {
        sender: { "name": senderName, "email": senderEmail },
        to: Array.isArray(to) ? to.map(email => ({ "email": email })) : [{ "email": to }],
        subject: subject,
        htmlContent: htmlContent
    };

    try {
        const response = await axios.post('https://api.brevo.com/v3/smtp/email', data, {
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error(`❌ [Brevo] Erro ao enviar e-mail:`, error.response ? error.response.data : error.message);
        return null;
    }
};

// Rota para agendar
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
                    html += `<tr>
                        <td style="border: 1px solid #ddd; padding: 8px;"><strong>${label}</strong></td>
                        <td style="border: 1px solid #ddd; padding: 8px;">${formatarData(item.data)}</td>
                        <td style="border: 1px solid #ddd; padding: 8px;">${item.horario}</td>
                    </tr>`;
                });
            }
            html += '</table>';
            return html;
        };

        // Criar eventos no Google Calendar
        const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
        
        console.log(`[Agendar] Iniciando criação de eventos para: ${evento} (${nome})`);
        
        // Usar Object.keys para iterar apenas sobre as propriedades próprias do objeto
        // e evitar possíveis duplicações causadas por iteração em protótipos ou comportamentos inesperados
        const chavesEtapas = Object.keys(etapas);
        for (const key of chavesEtapas) {
            const itens = Array.isArray(etapas[key]) ? etapas[key] : [etapas[key]];
            for (let i = 0; i < itens.length; i++) {
                const item = itens[i];
                const label = itens.length > 1 ? `${nomesEtapas[key]} ${i + 1}` : nomesEtapas[key];
                const summary = `${label}: ${evento}`;
                const description = `Proponente: ${nome}\nE-mail: ${email}\nTelefone: ${telefone}`;
                
                console.log(`[Agendar] Criando evento: ${summary} em ${item.data} ${item.horario}`);
                await createCalendarEvent(summary, description, item.data, item.horario);
            }
        }

        const tabelaHtml = gerarTabelaEtapas(etapas);
        const adminEmail = process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com';

        // Enviar e-mails
        const emailProponente = await sendEmail(
            email,
            '✅ Confirmação de Inscrição de Projeto - DAC',
            `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                <h2 style="color: #764ba2;">Olá ${nome}!</h2>
                <p>Sua inscrição para o evento <strong>${evento}</strong> foi recebida com sucesso.</p>
                <hr style="border: 0; border-top: 1px solid #eee;">
                <p><strong>Resumo do Cronograma:</strong></p>
                ${tabelaHtml}
                <hr style="border: 0; border-top: 1px solid #eee;">
                <p>Caso precise realizar alterações, entre em contato respondendo a este e-mail.</p>
                <p>Atenciosamente,<br><strong>Equipe DAC</strong></p>
            </div>
            `
        );

        const emailAdmin = await sendEmail(
            adminEmail,
            `📅 NOVA INSCRIÇÃO: ${evento} (${nome})`,
            `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                <h2 style="color: #333;">Nova Inscrição de Projeto</h2>
                <p>Um novo projeto foi inscrito com o seguinte cronograma:</p>
                <hr style="border: 0; border-top: 1px solid #eee;">
                <p><strong>Dados do Proponente:</strong></p>
                <p>👤 <strong>Nome:</strong> ${nome}</p>
                <p>📧 <strong>E-mail:</strong> ${email}</p>
                <p>📞 <strong>Telefone:</strong> ${telefone}</p>
                <p>🎭 <strong>Evento:</strong> ${evento}</p>
                <hr style="border: 0; border-top: 1px solid #eee;">
                <p><strong>Cronograma do Projeto:</strong></p>
                ${tabelaHtml}
            </div>
            `
        );

        if (emailProponente || emailAdmin) {
            // Salvar no "banco" em memória
            agendamentosPrimeiraEtapa.push({
                id: Date.now().toString(),
                nome,
                email,
                telefone,
                evento,
                etapas,
                timestamp: new Date().toLocaleString('pt-BR')
            });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'Erro ao enviar e-mails de confirmação.' });
        }

    } catch (error) {
        console.error('[Agendar] Erro crítico:', error.message);
        res.status(500).json({ error: 'Erro interno ao processar agendamento.' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Rota para buscar dados do Google Sheets (Segunda Etapa)
app.get('/api/admin/dados-forms', async (req, res) => {
    if (!googleAuthClient) {
        await initGoogleAuth();
        if (!googleAuthClient) return res.status(500).json({ error: 'Erro na autenticação com Google' });
    }

    try {
        const response = await sheets.spreadsheets.values.get({
            auth: googleAuthClient,
            spreadsheetId: SPREADSHEET_ID,
            range: 'Respostas ao formulário 1!A:AZ', // Range expandido para cobrir todas as colunas do formulário
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return res.json([]);
        }

        res.json(rows);
    } catch (error) {
        console.error('❌ [Google Sheets] Erro ao buscar dados:', error.message);
        res.status(500).json({ error: 'Erro ao consultar a planilha do Google Sheets' });
    }
});

// Rota Unificada para o Painel Admin (Cruzando 1ª e 2ª Etapas)
app.get('/api/admin/dados-unificados', async (req, res) => {
    if (!googleAuthClient) {
        await initGoogleAuth();
        if (!googleAuthClient) return res.status(500).json({ error: 'Erro na autenticação com Google' });
    }

    try {
        // 1. Buscar dados da Segunda Etapa (Google Sheets)
        const response = await sheets.spreadsheets.values.get({
            auth: googleAuthClient,
            spreadsheetId: SPREADSHEET_ID,
            range: 'Respostas ao formulário 1!A:AZ',
        });

        const rows = response.data.values || [];
        const headers = rows[0] || [];
        const dataSegundaEtapa = rows.slice(1);

        // 2. Unificar os dados
        // Mapear dados da segunda etapa por email para facilitar o cruzamento
        const idxEmailSheet = headers.findIndex(h => {
            const l = h.toLowerCase();
            return l.includes('endereço de e-mail') || l === 'e-mail' || l === 'email';
        });

        const unificados = agendamentosPrimeiraEtapa.map(p => {
            // Tentar encontrar correspondência na segunda etapa por e-mail ou telefone
            const correspondencia = dataSegundaEtapa.find(s => {
                const emailSheet = idxEmailSheet >= 0 ? s[idxEmailSheet] : null;
                // Busca simples por email ou telefone nos campos da planilha
                return (emailSheet && emailSheet.toLowerCase() === p.email.toLowerCase()) || 
                       s.some(val => val && (val.toString().includes(p.email) || val.toString().includes(p.telefone)));
            });

            return {
                primeiraEtapa: p,
                segundaEtapa: correspondencia ? {
                    headers: headers,
                    valores: correspondencia
                } : null,
                status: correspondencia ? 'Completo' : 'Pendente (Falta Forms)'
            };
        });

        // Adicionar também quem preencheu o forms mas não tem registro na 1ª etapa (opcional, mas bom para auditoria)
        dataSegundaEtapa.forEach(s => {
            const emailSheet = idxEmailSheet >= 0 ? s[idxEmailSheet] : null;
            const jaExiste = unificados.some(u => u.primeiraEtapa.email.toLowerCase() === (emailSheet || '').toLowerCase());
            
            if (!jaExiste) {
                unificados.push({
                    primeiraEtapa: {
                        nome: 'Não registrado na 1ª etapa',
                        email: emailSheet || 'N/A',
                        telefone: 'N/A',
                        evento: 'N/A',
                        etapas: {}
                    },
                    segundaEtapa: {
                        headers: headers,
                        valores: s
                    },
                    status: 'Incompleto (Falta Agendamento)'
                });
            }
        });

        res.json(unificados);
    } catch (error) {
        console.error('❌ [Unificados] Erro:', error.message);
        res.status(500).json({ error: 'Erro ao gerar dados unificados' });
    }
});

// Rota para deletar inscrição
app.post('/api/admin/deletar', async (req, res) => {
    const { email } = req.body;
    agendamentosPrimeiraEtapa = agendamentosPrimeiraEtapa.filter(a => a.email !== email);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
