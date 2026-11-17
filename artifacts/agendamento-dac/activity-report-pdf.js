const PDFDocument = require('pdfkit');

function textOrFallback(value, fallback = 'Não informado') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function formatSubmittedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Data não informada';
    return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Sao_Paulo'
    }).format(date);
}

function generateActivityReportPdf(report = {}) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margin: 48,
            compress: false,
            info: {
                Title: 'Registro de atividades',
                Author: 'DAC - UFSC',
                Subject: textOrFallback(report.evento, 'Evento')
            }
        });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.once('error', reject);
        doc.once('end', () => resolve(Buffer.concat(chunks)));

        const section = title => {
            doc.moveDown(0.55);
            doc.fillColor('#5b347f').font('Helvetica-Bold').fontSize(12).text(title);
            doc.moveDown(0.18);
        };
        const field = (label, value) => {
            doc.fillColor('#333').font('Helvetica-Bold').fontSize(10).text(`${label}: `, { continued: true });
            doc.font('Helvetica').text(textOrFallback(value), { lineGap: 2 });
        };

        doc.fillColor('#5b347f').font('Helvetica-Bold').fontSize(18).text('Registro de atividades');
        doc.moveDown(0.25);
        doc.fillColor('#666').font('Helvetica').fontSize(9)
            .text(`Enviado em: ${formatSubmittedAt(report.concluidoEm)}`);

        section('Dados do evento');
        field('Proponente', report.nome);
        field('E-mail', report.email);
        field('Local', report.local);
        field('Evento', report.evento);

        section('Datas, horários e público');
        const events = Array.isArray(report.eventos) ? report.eventos : [];
        if (!events.length) {
            doc.fillColor('#333').font('Helvetica').fontSize(10).text('Nenhum evento informado.');
        } else {
            events.forEach(item => {
                const details = [
                    textOrFallback(item?.label, 'Evento'),
                    item?.data ? String(item.data) : '',
                    item?.horario ? String(item.horario) : '',
                    `Total de público: ${textOrFallback(item?.totalPublico, '0')}`
                ].filter(Boolean);
                doc.fillColor('#333').font('Helvetica').fontSize(10)
                    .text(`- ${details.join(' | ')}`, { indent: 10, lineGap: 3 });
            });
        }

        section('Autores dos registros');
        doc.fillColor('#333').font('Helvetica').fontSize(10)
            .text(textOrFallback(report.autores), { lineGap: 2 });

        section('Observação');
        doc.fillColor('#333').font('Helvetica').fontSize(10)
            .text(textOrFallback(report.observacao), { lineGap: 2 });

        section('Sugestão');
        doc.fillColor('#333').font('Helvetica').fontSize(10)
            .text(textOrFallback(report.sugestao), { lineGap: 2 });

        section('Arquivos enviados');
        const files = Array.isArray(report.arquivos) ? report.arquivos : [];
        if (!files.length) {
            doc.fillColor('#333').font('Helvetica').fontSize(10).text('Nenhum arquivo anexado.');
        } else {
            files.forEach(file => {
                const name = typeof file === 'string' ? file : file?.nome;
                doc.fillColor('#333').font('Helvetica').fontSize(10)
                    .text(`- ${textOrFallback(name, 'Arquivo')}`, { indent: 10, lineGap: 2 });
            });
        }

        doc.end();
    });
}

module.exports = { generateActivityReportPdf };
