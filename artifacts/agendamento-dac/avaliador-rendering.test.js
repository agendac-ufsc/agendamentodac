const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { resolveRequiredEvaluationCount } = require('./evaluation-threshold');

const html = fs.readFileSync(path.join(__dirname, 'avaliador.html'), 'utf8');
const renderFunction = html.match(/function renderClassificacaoList\(\)\s*\{[\s\S]*?\n\}/);
const sequenceFunctionNames = [
    'criterioBloqueado',
    'obterPrimeiroCriterioPendente',
    'renderEtapaAvaliacao',
    'centralizarEtapaAvaliacao',
    'centralizarOpcoesRubrica'
];

function extractFunction(name) {
    const functionSource = html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
    assert.ok(functionSource, `${name}() deve existir no painel`);
    return functionSource[0];
}

function createSequentialEvaluationFlow(scoresSalvos = {}) {
    const keys = [
        '__nivel_avaliacao',
        '__nivel_avaliacao_812',
        '__nivel_avaliacao_813',
        '__nivel_avaliacao_814',
        '__nivel_avaliacao_815',
        '__nivel_avaliacao_818'
    ];
    const nodes = {};
    const context = {
        CHAVES_RUBRICA_NIVEIS: keys,
        ehRubricaDeNiveis: () => true,
        criterioTemNotaValida: (scores, key) => [0, 1, 2].includes(Number(scores?.[key])),
        obterSufixoRubrica: key => key === keys[0] ? '811' : key.replace('__nivel_avaliacao_', ''),
        obterScoresSalvosAvaliadorAtual: () => scoresSalvos,
        requestAnimationFrame: callback => callback(),
        document: {
            getElementById: id => nodes[id] || null
        }
    };
    const source = sequenceFunctionNames.map(extractFunction).join('\n');
    const functions = vm.runInNewContext(`${source}\n({ criterioBloqueado, obterPrimeiroCriterioPendente, renderEtapaAvaliacao, centralizarEtapaAvaliacao, centralizarOpcoesRubrica })`, context);
    return { functions, keys, nodes };
}

function renderClassificacoes({
    viewerEmail,
    scoresCache,
    myAssessmentsCache = [],
    proposals,
    avaliacoesNecessarias = 3,
    viewerCanDeleteInscricoes = false
}) {
    const nodes = {
        classificacaoRows: { innerHTML: '', querySelectorAll: () => [] },
        classificacaoTabCount: { textContent: '' },
        classificacaoTotal: { textContent: '' },
        rankingDeleteHeading: { hidden: true }
    };
    const context = {
        document: { getElementById: id => nodes[id] || null },
        RUBRICA_NIVEL_ID: '__nivel_avaliacao',
        RUBRICA_NIVEL_ID_812: '__nivel_avaliacao_812',
        viewerEmail,
        viewerCanDeleteInscricoes,
        scoresCache,
        myAssessmentsCache,
        allUnificados: proposals,
        avaliacoesNecessarias,
        obterPropostasEmOrdem: () => proposals,
        obterNumeroProposta: () => '42',
        calcularPontuacaoObtida: scores => Number(scores?.points || 0),
        escapeHtml: valor => String(valor ?? ''),
        escapeAttr: valor => String(valor ?? '').replace(/"/g, '&quot;'),
        formatarPontuacao: valor => String(valor)
    };

    const helpers = [
        extractFunction('obterCriterioEliminatorioReprovado'),
        extractFunction('obterDesclassificacaoProposta')
    ].join('\n');
    const avaliacaoFinalizada = `
        function avaliacaoFinalizada(avaliacao) {
            const scores = avaliacao?.scoresJson || {};
            return Boolean(
                obterCriterioEliminatorioReprovado(scores)
                || (avaliacao?.finalized === true && avaliacao?.complete === true)
            );
        }
    `;
    vm.runInNewContext(`${helpers}\n${avaliacaoFinalizada}\n${renderFunction[0]}\nrenderClassificacaoList();`, context);
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

test('agrupa as avaliações finalizadas e calcula a média das pontuações', () => {
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
    assert.match(nodes.classificacaoRows.innerHTML, /class="proposal-score">\s*7/);
    assert.match(nodes.classificacaoRows.innerHTML, /2\/3 avaliações finalizadas/);
    assert.match(nodes.classificacaoRows.innerHTML, /data-saved-value="Finalista"/);
    assert.doesNotMatch(nodes.classificacaoRows.innerHTML, />23</);
});

test('o mínimo automático acompanha os avaliadores cadastrados e nunca fica abaixo de um', () => {
    assert.equal(resolveRequiredEvaluationCount({ mode: 'automatico', manualCount: 3, evaluatorCount: 1 }), 1);
    assert.equal(resolveRequiredEvaluationCount({ mode: 'automatico', manualCount: 3, evaluatorCount: 4 }), 4);
    assert.equal(resolveRequiredEvaluationCount({ mode: 'automatico', manualCount: 3, evaluatorCount: 0 }), 1);
});

test('o modo manual mantém o número fixo e a classificação exibe média com um avaliador', () => {
    assert.equal(resolveRequiredEvaluationCount({ mode: 'manual', manualCount: 2, evaluatorCount: 4 }), 2);
    const nodes = renderClassificacoes({
        viewerEmail: 'avaliadora@exemplo.invalid',
        avaliacoesNecessarias: 1,
        proposals: [proposal],
        scoresCache: {
            'proposal-42': [{
                evaluatorEmail: 'avaliadora@exemplo.invalid',
                inscriptionId: 'proposal-42',
                finalized: true,
                complete: true,
                scoresJson: { points: 8 }
            }]
        }
    });
    assert.match(nodes.classificacaoRows.innerHTML, /class="proposal-score">\s*8/);
    assert.match(nodes.classificacaoRows.innerHTML, /1 avaliação finalizada \(mínimo 1\)/);
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

test('mostra a reprovação eliminatória no ranking e bloqueia classificação manual', () => {
    const nodes = renderClassificacoes({
        viewerEmail: 'outro@exemplo.invalid',
        proposals: [proposal],
        scoresCache: {
            'proposal-42': [{
                evaluatorEmail: 'avaliadora@exemplo.invalid',
                inscriptionId: 'proposal-42',
                finalized: true,
                complete: false,
                scoresJson: { __nivel_avaliacao_812: 0 },
                classification: 'Reprovada'
            }]
        }
    });

    assert.match(nodes.classificacaoRows.innerHTML, /class="proposal-score">\s*—/);
    assert.match(nodes.classificacaoRows.innerHTML, /Reprovada pelo item 8\.1\.2/);
    assert.match(nodes.classificacaoRows.innerHTML, /Reprovada · item 8\.1\.2/);
    assert.doesNotMatch(nodes.classificacaoRows.innerHTML, /ranking-classification-input/);
});

test('a lixeira da classificação só aparece para avaliador autorizado', () => {
    const common = {
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
    };

    const semPermissao = renderClassificacoes(common);
    assert.doesNotMatch(semPermissao.classificacaoRows.innerHTML, /ranking-delete-button/);
    assert.equal(semPermissao.rankingDeleteHeading.hidden, true);

    const autorizado = renderClassificacoes({ ...common, viewerCanDeleteInscricoes: true });
    assert.match(autorizado.classificacaoRows.innerHTML, /ranking-delete-button/);
    assert.match(autorizado.classificacaoRows.innerHTML, /data-inscription-id="proposal-42"/);
    assert.equal(autorizado.rankingDeleteHeading.hidden, false);
});

test('libera critérios de avaliação em sequência somente após salvar o anterior', () => {
    const { functions, keys } = createSequentialEvaluationFlow();

    assert.equal(functions.criterioBloqueado(keys[0], {}), false);
    assert.equal(functions.criterioBloqueado(keys[1], {}), true);
    assert.equal(functions.obterPrimeiroCriterioPendente({}), keys[0]);

    const firstScoreSaved = { [keys[0]]: 0 };
    assert.equal(functions.criterioBloqueado(keys[1], firstScoreSaved), false);
    assert.equal(functions.criterioBloqueado(keys[2], firstScoreSaved), true);
    assert.equal(functions.obterPrimeiroCriterioPendente(firstScoreSaved), keys[1]);

    const secondScoreSaved = { ...firstScoreSaved, [keys[1]]: 1 };
    assert.equal(functions.criterioBloqueado(keys[2], secondScoreSaved), false);
    assert.equal(functions.criterioBloqueado(keys[3], secondScoreSaved), true);
    assert.equal(functions.obterPrimeiroCriterioPendente(secondScoreSaved), keys[2]);
});

test('selecionar não atende em 8.1.1 ou 8.1.2 salva a reprovação imediatamente', () => {
    function selecionarNivel(criterionKey, value) {
        const scores = {};
        const saves = [];
        const context = {
            RUBRICA_NIVEL_ID: '__nivel_avaliacao',
            RUBRICA_NIVEL_ID_812: '__nivel_avaliacao_812',
            currentAvaliacaoIndex: 0,
            currentAvaliacaoScores: scores,
            allUnificados: [{ primeiraEtapa: { id: 'proposal-42' } }],
            desclassificacaoAutomaticaEmAndamento: null,
            criterioBloqueado: () => false,
            obterScoresSalvosAvaliadorAtual: () => ({}),
            obterSufixoRubrica: key => key.replace('__nivel_avaliacao', ''),
            obterEstadoRubrica: () => ({}),
            document: { getElementById: () => ({ dataset: { savedValue: '' } }) },
            renderAvaliacaoList: () => {},
            salvarAvaliacao: key => saves.push(key)
        };
        const helpers = [
            extractFunction('obterCriterioEliminatorioReprovado'),
            extractFunction('setRubricaNivel')
        ].join('\n');
        const functions = vm.runInNewContext(
            `${helpers}\n({ setRubricaNivel })`,
            context
        );

        functions.setRubricaNivel(criterionKey, 'A', value, 'Não atende o critério');
        return { saves, scores, pending: context.desclassificacaoAutomaticaEmAndamento };
    }

    const item811 = selecionarNivel('__nivel_avaliacao', 0);
    const item812 = selecionarNivel('__nivel_avaliacao_812', 0);
    const atendeParcialmente = selecionarNivel('__nivel_avaliacao', 1);

    assert.deepEqual(item811.saves, ['__nivel_avaliacao']);
    assert.equal(item811.pending, 'proposal-42:__nivel_avaliacao');
    assert.deepEqual(item812.saves, ['__nivel_avaliacao_812']);
    assert.equal(item812.pending, 'proposal-42:__nivel_avaliacao_812');
    assert.deepEqual(atendeParcialmente.saves, []);
});

test('bloqueia as rubricas após reprovação eliminatória salva ou recém-selecionada', () => {
    const source = [
        extractFunction('obterCriterioEliminatorioReprovado'),
        extractFunction('obterDesclassificacaoProposta'),
        extractFunction('podeContinuarAvaliacao')
    ].join('\n');
    const functions = vm.runInNewContext(
        `${source}\n({ podeContinuarAvaliacao })`,
        {
            RUBRICA_NIVEL_ID: '__nivel_avaliacao',
            RUBRICA_NIVEL_ID_812: '__nivel_avaliacao_812'
        }
    );

    assert.equal(functions.podeContinuarAvaliacao({ status: 'aprovado' }, [], { __nivel_avaliacao: 0 }), false);
    assert.equal(functions.podeContinuarAvaliacao({ status: 'aprovado' }, [
        { scoresJson: { __nivel_avaliacao_812: 0 } }
    ], { __nivel_avaliacao: 2 }), false);
    assert.equal(functions.podeContinuarAvaliacao({ status: 'aprovado' }, [], { __nivel_avaliacao: 1 }), true);
    assert.equal(functions.podeContinuarAvaliacao({ status: 'reprovado' }, [], {}), false);
});

test('mostra visual bloqueado e impede interação até o critério anterior ser salvo', () => {
    const { functions, keys } = createSequentialEvaluationFlow();
    const htmlBloqueado = functions.renderEtapaAvaliacao({}, keys[2], '<button>Avaliar</button>');
    const htmlLiberado = functions.renderEtapaAvaliacao({ [keys[0]]: 2, [keys[1]]: 1 }, keys[2], '<button>Avaliar</button>');

    assert.match(htmlBloqueado, /class="drawer-criterion-step is-locked"/);
    assert.match(htmlBloqueado, /aria-disabled="true" inert/);
    assert.match(htmlBloqueado, /Salve o critério anterior para liberar este item/);
    assert.match(htmlLiberado, /class="drawer-criterion-step"/);
    assert.match(htmlLiberado, /aria-disabled="false"/);
    assert.doesNotMatch(htmlLiberado, /\sinert/);
});

test('centraliza o próximo critério liberado após salvá-lo', () => {
    const scoresSalvos = { '__nivel_avaliacao': 2 };
    const { functions, keys, nodes } = createSequentialEvaluationFlow(scoresSalvos);
    const etapa = { scrollIntoView: options => { etapa.scrollOptions = options; } };
    nodes['criterion-step-812'] = etapa;

    functions.centralizarEtapaAvaliacao(keys[1]);

    assert.equal(etapa.scrollOptions.behavior, 'smooth');
    assert.equal(etapa.scrollOptions.block, 'center');
    assert.equal(etapa.scrollOptions.inline, 'nearest');
});

test('centraliza as três opções no viewport quando a gaveta é aberta', () => {
    const { functions, keys, nodes } = createSequentialEvaluationFlow();
    const opcoes = { hidden: false, scrollIntoView: options => { opcoes.scrollOptions = options; } };
    nodes['rubricOptions-812'] = opcoes;

    functions.centralizarOpcoesRubrica(keys[1]);

    assert.equal(opcoes.scrollOptions.behavior, 'smooth');
    assert.equal(opcoes.scrollOptions.block, 'center');
    assert.equal(opcoes.scrollOptions.inline, 'nearest');

    const toggleFunction = extractFunction('toggleRubricaOpcoes');
    const editFunction = extractFunction('iniciarEdicaoRubrica');
    assert.match(toggleFunction, /if \(abrindo\) centralizarOpcoesRubrica\(criterionKey\)/);
    assert.match(editFunction, /centralizarOpcoesRubrica\(criterionKey\)/);
});

test('move inscrições canceladas para a aba própria e mantém as ativas na fila', () => {
    const proposals = [
        { primeiraEtapa: { id: 'proposal-42', evento: 'Cancelada' } },
        { primeiraEtapa: { id: 'proposal-43', evento: 'Ativa' } },
        { primeiraEtapa: { email: 'legacy@example.invalid', evento: 'Legada' } },
        { primeiraEtapa: { evento: 'Sem identificador' } }
    ];
    const context = {
        allUnificados: proposals,
        inscricoesCanceladasAvaliador: new Set(['proposal-42'])
    };
    const helpers = vm.runInNewContext([
        extractFunction('obterIdInscricaoAvaliador'),
        extractFunction('obterInscricoesAtivas'),
        extractFunction('obterInscricoesCanceladas')
    ].join('\n') + '\n({ obterIdInscricaoAvaliador, obterInscricoesAtivas, obterInscricoesCanceladas })', context);
    const idsAtivos = Array.from(helpers.obterInscricoesAtivas(), item => helpers.obterIdInscricaoAvaliador(item));
    const idsCancelados = Array.from(helpers.obterInscricoesCanceladas(), item => helpers.obterIdInscricaoAvaliador(item));

    assert.deepEqual(idsAtivos, ['proposal-43', 'legacy@example.invalid', '']);
    assert.deepEqual(idsCancelados, ['proposal-42']);
    assert.equal(proposals.length, 4, 'a separação visual não apaga os registros');
    assert.match(html, /id="tabBtnCanceladas"/);
    assert.match(html, /id="btnCancelarInscricoesAvaliador"/);
});

test('encaminha a API de inscrições canceladas para o servidor do projeto', () => {
    const configPath = path.join(__dirname, '..', '..', 'vercel.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.ok(config.routes.some(route => route.src === '^/api/evaluator/cancelled-inscriptions$' && route.dest === '/api/[...path].js'));
});
