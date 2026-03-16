require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Configurar Brevo
const sendEmail = async (to, subject, htmlContent) => {
    if (!process.env.BREVO_API_KEY) {
        console.warn('⚠️  BREVO_API_KEY não configurada.');
        return null;
    }

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
        return null;
    }
};

// Rota para agendar
app.post('/api/agendar', async (req, res) => {
    try {
        const { nome, email, telefone, data, hora } = req.body;

        if (!nome || !email || !telefone || !data || !hora) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        const [year, month, day] = data.split('-');
        const [hours, minutes] = hora.split(':');
        const startTime = new Date(year, month - 1, day, hours, minutes);
        const dataFormatada = startTime.toLocaleDateString('pt-BR');
        
        const adminEmail = process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com';
        const proponenteEmail = email;

        console.log(`Iniciando envio de e-mails: Admin(${adminEmail}), Proponente(${proponenteEmail})`);
        
        // Enviar e-mails em paralelo
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

        res.json({ 
            success: true, 
            message: 'Agendamento realizado com sucesso e e-mails enviados.'
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
