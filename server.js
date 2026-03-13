require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
const { Resend } = require('resend');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configurar Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Configurar Google Calendar
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    'http://localhost:3000/oauth/callback'
);

oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

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

        const calendarEvent = await calendar.events.insert({
            calendarId: 'primary',
            resource: event
        });

        // Enviar e-mail para o cliente
        await resend.emails.send({
            from: 'noreply@resend.dev',
            to: email,
            subject: '✅ Seu agendamento foi confirmado!',
            html: `
                <h2>Olá ${nome}!</h2>
                <p>Seu agendamento foi confirmado com sucesso!</p>
                <p><strong>Data:</strong> ${new Date(startTime).toLocaleDateString('pt-BR')}</p>
                <p><strong>Horário:</strong> ${hora}</p>
                <p>Obrigado por agendar conosco!</p>
            `
        });

        // Enviar e-mail para o administrador
        await resend.emails.send({
            from: 'noreply@resend.dev',
            to: process.env.ADMIN_EMAIL,
            subject: `📅 Novo agendamento - ${nome}`,
            html: `
                <h2>Novo Agendamento</h2>
                <p><strong>Nome:</strong> ${nome}</p>
                <p><strong>E-mail:</strong> ${email}</p>
                <p><strong>Telefone:</strong> ${telefone}</p>
                <p><strong>Data:</strong> ${new Date(startTime).toLocaleDateString('pt-BR')}</p>
                <p><strong>Horário:</strong> ${hora}</p>
            `
        });

        res.json({ 
            success: true, 
            message: 'Agendamento realizado com sucesso',
            eventId: calendarEvent.data.id
        });

    } catch (error) {
        console.error('Erro ao agendar:', error);
        res.status(500).json({ error: error.message });
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
