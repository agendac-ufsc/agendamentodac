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

module.exports = {
    encontrarCriterioEliminatorioReprovado,
    encontrarDesclassificacaoProposta
};
