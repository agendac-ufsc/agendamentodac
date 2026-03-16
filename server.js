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
        console.log(`[Brevo] Tentando enviar e-mail para: ${to}`);
        console.log(`[Brevo] Remetente configurado: ${senderEmail}`);
        
        const response = await axios.post('https://api.brevo.com/v3/smtp/email', data, {
            headers: {
                'api-key': apiKey,
                'Content-Type': 'application/json'
            }
        });
        
        console.log(`✅ [Brevo] Sucesso! ID: ${response.data.messageId}`);
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error(`❌ [Brevo] Erro da API (${error.response.status}):`, JSON.stringify(error.response.data));
            if (error.response.status === 401) {
                console.error("   -> Verifique se a BREVO_API_KEY está correta.");
            } else if (error.response.status === 400) {
                console.error("   -> Verifique se o remetente está validado e se o formato do e-mail é válido.");
            }
        } else {
            console.error(`❌ [Brevo] Erro de rede ou configuração:`, error.message);
        }
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

        console.log(`[Agendar] Nova solicitação recebida de: ${nome} (${email})`);

        const [year, month, day] = data.split('-');
        const [hours, minutes] = hora.split(':');
        const startTime = new Date(year, month - 1, day, hours, minutes);
        const dataFormatada = startTime.toLocaleDateString('pt-BR');
        
        const adminEmail = process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com';
        const proponenteEmail = email;

        // Enviar e-mails
        // Nota: Enviamos sequencialmente para garantir logs claros em caso de erro no primeiro envio
        console.log(`[Agendar] Iniciando sequência de envios...`);
        
        const emailProponente = await sendEmail(
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
        );

        const emailAdmin = await sendEmail(
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
        );

        if (emailProponente || emailAdmin) {
            res.json({ 
                success: true, 
                message: 'Agendamento realizado com sucesso.'
            });
        } else {
            res.status(500).json({ 
                error: 'O agendamento foi registrado, mas houve um erro ao enviar os e-mails de confirmação. Por favor, verifique os logs do servidor.' 
            });
        }

    } catch (error) {
        console.error('[Agendar] Erro crítico:', error.message);
        res.status(500).json({ error: 'Erro interno ao processar agendamento.' });
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
