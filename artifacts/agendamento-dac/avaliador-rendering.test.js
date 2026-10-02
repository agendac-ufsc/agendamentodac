const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'avaliador.html'), 'utf8');
const renderFunction = html.match(/function renderClassificacaoList\(\)\s*\{[\s\S]*?\n\}/);

test('renderiza uma avaliação concluída persistida sem interromper a lista', () => {
    assert.ok(renderFunction, 'renderClassificacaoList() deve existir no painel');

    const nodes = {
        classificacaoRows: { innerHTML: '', querySelectorAll: () => [] },
        classificacaoTabCount: { textContent: '' },
        classificacaoTotal: { textContent: '' }
    };
    const context = {
        document: { getElementById: id => nodes[id] || null },
        viewerEmail: 'avaliadora@exemplo.invalid',
        myAssessmentsCache: [{
            evaluatorEmail: 'avaliadora@exemplo.invalid',
            inscriptionId: 'regression-probe',
            finalized: true,
            scoresJson: { A: 8 },
            inscriptionSnapshot: {
                evento: 'Proposta de teste',
                numeroProposta: '42'
            }
        }],
        obterPropostasEmOrdem: () => [],
        avaliacaoFinalizada: avaliacao => avaliacao?.finalized === true,
        obterNumeroProposta: () => '42',
        calcularPontuacaoObtida: () => 8,
        escapeHtml: valor => String(valor ?? ''),
        formatarPontuacao: valor => String(valor)
    };

    vm.runInNewContext(`${renderFunction[0]}\nrenderClassificacaoList();`, context);

    assert.equal(nodes.classificacaoTabCount.textContent, '1');
    assert.match(nodes.classificacaoRows.innerHTML, /Classificação da proposta 42/);
    assert.match(nodes.classificacaoRows.innerHTML, /Proposta de teste/);
});