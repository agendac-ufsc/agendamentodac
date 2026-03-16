require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configurar Brevo
const sendEmail = async (to, subject, htmlContent) => {
    if (!process.env.BREVO_API_KEY) {
        console.warn('⚠️  BREVO_API_KEY não configurada nos logs do Vercel.');
        return null;
    }

    // Define o remetente prioritário:
    // 1. Variável de ambiente específica do remetente validado
    // 2. O e-mail informado pelo usuário como o correto
    // O remetente deve ser o e-mail validado no Brevo. 
    // Usamos SENDER_EMAIL (definido no Vercel) ou o padrão agendac.ufsc@gmail.com
    const senderEmail = process.env.SENDER_EMAIL || "agendac.ufsc@gmail.com";

    const data = {
        sender: { "name": "Agendamento DAC", "email": senderEmail },
        to: Array.isArray(to) ? to.map(email => ({ "email": email })) : [{ "email": to }],
        subject: subject,
        htmlContent: htmlContent
    };

    try {
        console.log(`Tentando enviar e-mail para ${to} usando remetente ${senderEmail}...`);
        const response = await axios.post('https://api.brevo.com/v3/smtp/email', data, {
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ E-mail enviado com sucesso para: ${to}. Response ID: ${response.data.messageId}`);
        return response.data;
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error(`❌ ERRO BREVO ao enviar para ${to}:`, JSON.stringify(errorData));
        
        if (error.response && error.response.status === 401) {
            console.error("⚠️ ERRO 401: BREVO_API_KEY pode estar inválida ou expirada.");
        }
        if (errorData.code === 'unauthorized' || (errorData.message && errorData.message.includes('sender'))) {
            console.error(`⚠️ ALERTA: O e-mail ${senderEmail} pode não estar validado no painel do Brevo.`);
        }
        return null;
    }
};

// Configurar Google Calendar
let calendar = null;
if (process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET && process.env.GOOGLE_CALENDAR_REFRESH_TOKEN) {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CALENDAR_CLIENT_ID,
        process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
        'http://localhost:3000/oauth/callback'
    );

    oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
    });

    calendar = google.calendar({ version: 'v3', auth: oauth2Client });
} else {
    console.warn('⚠️  Google Calendar não configurado.');
}

// Rota para agendar
app.post('/api/agendar', async (req, res) => {
    try {
        const { nome, email, telefone, data, hora } = req.body;

        if (!nome || !email || !telefone || !data || !hora) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        // Criar evento no Google Calendar
        const [year, month, day] = data.split('-');
        const [hours, minutes] = hora.split(':');

        const startTime = new Date(year, month - 1, day, hours, minutes);
        const endTime = new Date(startTime);
        endTime.setHours(endTime.getHours() + 1);

        let calendarEventId = null;
        if (calendar) {
            const adminEmail = process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com';
            const event = {
                summary: `Agendamento - ${nome}`,
                description: `Cliente: ${nome}\nE-mail: ${email}\nTelefone: ${telefone}`,
                start: {
                    dateTime: startTime.toISOString(),
                    timeZone: 'America/Sao_Paulo'
                },
                end: {
                    dateTime: endTime.toISOString(),
                    timeZone: 'America/Sao_Paulo'
                },
                attendees: [
                    { email: email },
                    { email: adminEmail }
                ],
                // Tenta forçar o organizador se as permissões permitirem, 
                // mas o ideal é que o Refresh Token seja da conta agendac.ufsc
                organizer: {
                    email: adminEmail,
                    displayName: "Agendamento DAC"
                }
            };

            try {
                console.log(`Tentando criar evento no Google Calendar para: ${adminEmail} e ${email}`);
                const calendarEvent = await calendar.events.insert({
                    calendarId: 'primary',
                    resource: event,
                    sendUpdates: 'all' // Garante que os convites sejam enviados por e-mail pelo Google
                });
                calendarEventId = calendarEvent.data.id;
                console.log(`✅ Evento criado no Google Calendar. ID: ${calendarEventId}`);
            } catch (calendarError) {
                console.error('❌ Erro Google Calendar:', calendarError.message);
                if (calendarError.message.includes('invalid_grant')) {
                    console.error('⚠️ O Refresh Token do Google pode ter expirado ou é da conta antiga.');
                }
            }
        }

        // Enviar e-mails via Brevo
        const dataFormatada = new Date(startTime).toLocaleDateString('pt-BR');
        
        // O adminEmail recebe a notificação do novo agendamento
        const adminEmail = process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com';
        
        // O email do proponente (vindo do formulário) recebe a confirmação
        const proponenteEmail = email;

        console.log(`Iniciando envio de e-mails: Admin(${adminEmail}), Proponente(${proponenteEmail})`);
        
        // Dispara ambos os envios
        try {
            await Promise.all([
                // E-mail para o Proponente (Confirmação)
                sendEmail(
                    proponenteEmail,
                    '✅ Confirmação de Agendamento - DAC',
                    `
                    <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                        <h2 style="color: #764ba2;">Olá ${nome}!</h2>
                        <p>Recebemos sua solicitação de agendamento e ela foi confirmada com sucesso.</p>
                        <hr style="border: 0; border-top: 1px solid #eee;">
                        <p><strong>Detalhes do Agendamento:</strong></p>
                        <p>📅 <strong>Data:</strong> ${dataFormatada}</p>
                        <p>⏰ <strong>Horário:</strong> ${hora}</p>
                        <hr style="border: 0; border-top: 1px solid #eee;">
                        <p>Caso precise cancelar ou reagendar, entre em contato respondendo a este e-mail.</p>
                        <p>Atenciosamente,<br><strong>Equipe DAC</strong></p>
                    </div>
                    `
                ),
                // E-mail para o Admin (Notificação)
                sendEmail(
                    adminEmail,
                    `📅 NOVO AGENDAMENTO: ${nome}`,
                    `
                    <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                        <h2 style="color: #333;">Novo Agendamento Recebido</h2>
                        <p>Um novo horário foi reservado através do sistema.</p>
                        <hr style="border: 0; border-top: 1px solid #eee;">
                        <p><strong>Dados do Proponente:</strong></p>
                        <p>👤 <strong>Nome:</strong> ${nome}</p>
                        <p>📧 <strong>E-mail:</strong> ${proponenteEmail}</p>
                        <p>📞 <strong>Telefone:</strong> ${telefone}</p>
                        <hr style="border: 0; border-top: 1px solid #eee;">
                        <p><strong>Horário Reservado:</strong></p>
                        <p>📅 <strong>Data:</strong> ${dataFormatada}</p>
                        <p>⏰ <strong>Horário:</strong> ${hora}</p>
                    </div>
                    `
                )
            ]);
            console.log('Todos os e-mails foram processados.');
        } catch (e) {
            console.error('Erro crítico no envio de e-mails:', e);
        }

        res.json({ 
            success: true, 
            message: 'Agendamento realizado com sucesso',
            eventId: calendarEventId
        });

    } catch (error) {
        console.error('Erro ao agendar:', error.message);
        res.status(500).json({ error: 'Erro ao processar agendamento: ' + error.message });
    }
});

// Rota raiz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
