const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'avaliador.html'), 'utf8');
const renderFunction = html.match(/function renderClassificacaoList\(\)\s*\{[\s\S]*?\n\}/);

function renderClassificacoes({ viewerEmail, scoresCache, myAssessmentsCache = [], proposals }) {
    const nodes = {
        classificacaoRows: { innerHTML: '', querySelectorAll: () => [] },
        classificacaoTabCount: { textContent: '' },
        classificacaoTotal: { textContent: '' }
    };
    const context = {
        document: { getElementById: id => nodes[id] || null },
        viewerEmail,
        scoresCache,
        myAssessmentsCache,
        allUnificados: proposals,
        avaliacoesNecessarias: 3,
        obterPropostasEmOrdem: () => proposals,
        avaliacaoFinalizada: avaliacao => avaliacao?.finalized === true && avaliacao?.complete === true,
        obterNumeroProposta: () => '42',
        calcularPontuacaoObtida: scores => Number(scores?.points || 0),
        escapeHtml: valor => String(valor ?? ''),
        formatarPontuacao: valor => String(valor)
    };

    vm.runInNewContext(`${renderFunction[0]}\nrenderClassificacaoList();`, context);
    return nodes;
}

const proposal = {
    primeiraEtapa: {
        id: 'proposal-42',
        evento: 'Proposta de teste',
        nome: 'Grupo de teste',
        numeroProposta: '42'
    }
};

test('agrupa as avaliações finalizadas de todos os avaliadores e soma as pontuações', () => {
    assert.ok(renderFunction, 'renderClassificacaoList() deve existir no painel');
    const ownAssessment = {
        evaluatorEmail: 'avaliadora@exemplo.invalid',
        inscriptionId: 'proposal-42',
        finalized: true,
        complete: true,
        scoresJson: { points: 8 },
        classification: 'Finalista'
    };
    const nodes = renderClassificacoes({
        viewerEmail: 'avaliadora@exemplo.invalid',
        proposals: [proposal],
        scoresCache: {
            'proposal-42': [
                ownAssessment,
                {
                    evaluatorEmail: 'outro@exemplo.invalid',
                    inscriptionId: 'proposal-42',
                    finalized: true,
                    complete: true,
                    scoresJson: { points: 6 },
                    classification: 'Seleção'
                },
                {
                    evaluatorEmail: 'terceiro@exemplo.invalid',
                    inscriptionId: 'proposal-42',
                    finalized: true,
                    complete: false,
                    scoresJson: { points: 90 }
                }
            ]
        },
        myAssessmentsCache: [ownAssessment]
    });

    assert.equal(nodes.classificacaoTabCount.textContent, '1');
    assert.equal(nodes.classificacaoTotal.textContent, '1');
    assert.match(nodes.classificacaoRows.innerHTML, /Proposta de teste/);
    assert.match(nodes.classificacaoRows.innerHTML, /class="proposal-score">\s*14/);
    assert.match(nodes.classificacaoRows.innerHTML, /2\/3 avaliações finalizadas/);
    assert.match(nodes.classificacaoRows.innerHTML, /data-saved-value="Finalista"/);
    assert.doesNotMatch(nodes.classificacaoRows.innerHTML, />23</);
});

test('mostra avaliações dos outros mesmo quando o avaliador atual ainda não avaliou a proposta', () => {
    const nodes = renderClassificacoes({
        viewerEmail: 'avaliadora@exemplo.invalid',
        proposals: [proposal],
        scoresCache: {
            'proposal-42': [{
                evaluatorEmail: 'outro@exemplo.invalid',
                inscriptionId: 'proposal-42',
                finalized: true,
                complete: true,
                scoresJson: { points: 12 }
            }]
        }
    });

    assert.equal(nodes.classificacaoTabCount.textContent, '1');
    assert.match(nodes.classificacaoRows.innerHTML, /class="proposal-score">\s*12/);
    assert.match(nodes.classificacaoRows.innerHTML, /disponível após sua avaliação/);
    assert.doesNotMatch(nodes.classificacaoRows.innerHTML, /ranking-classification-input/);
});