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

        const tabelaHtml = gerarTabelaEtapas(etapas);
        const adminEmail = process.env.ADMIN_EMAIL || 'agendac.ufsc@gmail.com';

        // E-mail para o Proponente
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

        // E-mail para o Administrador
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
