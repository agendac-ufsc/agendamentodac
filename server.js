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
        console.warn('⚠️  BREVO_API_KEY não configurada. E-mails não serão enviados.');
        return null;
    }

    const data = {
        sender: { "name": "Agendamento DAC", "email": process.env.SENDER_EMAIL || "agendac.ufsc@gmail.com" },
        to: Array.isArray(to) ? to.map(email => ({ "email": email })) : [{ "email": to }],
        subject: subject,
        htmlContent: htmlContent
    };

    try {
        const response = await axios.post('https://api.brevo.com/v3/smtp/email', data, {
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json'
            }
        });
        console.log('E-mail enviado com sucesso via Brevo. Message ID:', response.data.messageId);
        return response.data;
    } catch (error) {
        console.error('ERRO DETALHADO BREVO:', JSON.stringify(error.response ? error.response.data : error.message));
        throw error;
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
    console.warn('⚠️  Google Calendar não configurado. Agendamentos não serão criados no calendário.');
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
                    { email: email }
                ]
            };

            try {
                const calendarEvent = await calendar.events.insert({
                    calendarId: 'primary',
                    resource: event
                });
                calendarEventId = calendarEvent.data.id;
            } catch (calendarError) {
                console.error('Erro ao criar evento no Google Calendar:', calendarError.message);
            }
        }

        // Enviar e-mails via Brevo
        try {
            const dataFormatada = new Date(startTime).toLocaleDateString('pt-BR');
            
            // Enviar e-mail para o cliente
            await sendEmail(
                email,
                '✅ Seu agendamento foi confirmado!',
                `
                <div style="font-family: sans-serif; color: #333;">
                    <h2>Olá ${nome}!</h2>
                    <p>Seu agendamento foi confirmado com sucesso!</p>
                    <p><strong>Data:</strong> ${dataFormatada}</p>
                    <p><strong>Horário:</strong> ${hora}</p>
                    <p>Obrigado por agendar conosco!</p>
                </div>
                `
            );

            // Enviar e-mail para o administrador (com cópia para o cliente conforme solicitado)
            const adminEmail = process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com';
            await sendEmail(
                [adminEmail, email],
                `📅 Novo agendamento - ${nome}`,
                `
                <div style="font-family: sans-serif; color: #333;">
                    <h2>Novo Agendamento</h2>
                    <p><strong>Nome:</strong> ${nome}</p>
                    <p><strong>E-mail:</strong> ${email}</p>
                    <p><strong>Telefone:</strong> ${telefone}</p>
                    <p><strong>Data:</strong> ${dataFormatada}</p>
                    <p><strong>Horário:</strong> ${hora}</p>
                </div>
                `
            );
        } catch (emailError) {
            console.error('Erro ao enviar e-mails:', emailError.message);
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
