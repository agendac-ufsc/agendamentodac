const CRITERIOS_ELIMINATORIOS = Object.freeze([
    { scoreKey: '__nivel_avaliacao', item: '8.1.1' },
    { scoreKey: '__nivel_avaliacao_812', item: '8.1.2' }
]);

function encontrarCriterioEliminatorioReprovado(scores = {}) {
    if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return null;

    for (const criterio of CRITERIOS_ELIMINATORIOS) {
        const valor = scores[criterio.scoreKey];
        if (valor === undefined || valor === null || String(valor).trim() === '') continue;
        if (Number(valor) === 0) return criterio;
    }

    return null;
}

function encontrarDesclassificacaoProposta(avaliacoes = []) {
    if (!Array.isArray(avaliacoes)) return null;

    for (const avaliacao of avaliacoes) {
        const criterio = encontrarCriterioEliminatorioReprovado(avaliacao?.scoresJson);
        if (criterio) return criterio;
    }

    return null;
}

function podeCorrigirDesclassificacao(avaliacoes = [], evaluatorEmail, scoresJson, finalize) {
    if (!encontrarDesclassificacaoProposta(avaliacoes)
        || !Array.isArray(avaliacoes)
        || !scoresJson
        || typeof scoresJson !== 'object'
        || Array.isArray(scoresJson)
        || finalize === true) {
        return false;
    }

    const emailNormalizado = String(evaluatorEmail || '').trim().toLowerCase();
    if (!emailNormalizado) return false;

    const avaliacaoPropria = avaliacoes.find(
        avaliacao => String(avaliacao?.evaluatorEmail || '').trim().toLowerCase() === emailNormalizado
    );
    if (!avaliacaoPropria) return false;

    const chavesEnviadas = Object.keys(scoresJson);
    const chavesDeNota = chavesEnviadas.filter(chave => !chave.endsWith('_label'));
    if (chavesDeNota.length !== 1) return false;

    const chaveCorrigida = chavesDeNota[0];
    const criterioProprioReprovado = CRITERIOS_ELIMINATORIOS.find(
        criterio => criterio.scoreKey === chaveCorrigida
            && Number(avaliacaoPropria.scoresJson?.[criterio.scoreKey]) === 0
    );
    if (!criterioProprioReprovado
        || chavesEnviadas.some(chave => chave !== chaveCorrigida && chave !== `${chaveCorrigida}_label`)) {
        return false;
    }

    const notaCorrigida = scoresJson[chaveCorrigida];
    if (notaCorrigida === null || notaCorrigida === undefined || String(notaCorrigida).trim() === '') {
        return false;
    }
    return [0, 1, 2].includes(Number(notaCorrigida));
}

module.exports = {
    encontrarCriterioEliminatorioReprovado,
    encontrarDesclassificacaoProposta,
    podeCorrigirDesclassificacao
};
