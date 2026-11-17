const assert = require('node:assert/strict');
const test = require('node:test');
const { generateActivityReportPdf } = require('./activity-report-pdf');

test('generates a valid PDF containing the completed activity report', async () => {
    const pdf = await generateActivityReportPdf({
        nome: 'Pessoa Exemplo',
        email: 'exemplo@example.com',
        local: 'Teatro Carmen Fossari',
        evento: 'Competição Estadual de Poesia Falada - Slam SC',
        concluidoEm: '2026-10-23T15:00:00.000Z',
        autores: 'Equipe de produção',
        observacao: 'Atividade realizada conforme planejamento.',
        sugestao: 'Manter a divulgação antecipada.',
        eventos: [{
            label: 'Evento',
            data: '2026-10-17',
            horario: '12:00 às 18:30',
            totalPublico: 85
        }],
        arquivos: ['registro-fotografico.pdf']
    });

    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(pdf.length > 1000);
    const decodedText = [...pdf.toString('latin1').matchAll(/<([0-9a-f]+)>/gi)]
        .map(match => Buffer.from(match[1], 'hex').toString('latin1'))
        .join('')
        .replace(/\s+/g, '')
        .toLowerCase();
    assert.ok(decodedText.includes('slamsc'));
    assert.ok(decodedText.includes('registro-fotografico.pdf'));
});
