const DEFAULT_MANUAL_EVALUATIONS = 3;
const MAX_MANUAL_EVALUATIONS = 20;

function normalizeEvaluationMode(mode) {
    return mode === 'manual' ? 'manual' : 'automatico';
}

function normalizeManualEvaluationCount(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, MAX_MANUAL_EVALUATIONS)
        : DEFAULT_MANUAL_EVALUATIONS;
}

function resolveRequiredEvaluationCount({ mode, manualCount, evaluatorCount }) {
    if (normalizeEvaluationMode(mode) === 'manual') {
        return normalizeManualEvaluationCount(manualCount);
    }
    if (evaluatorCount === null || evaluatorCount === undefined) {
        return normalizeManualEvaluationCount(manualCount);
    }
    const parsed = Number(evaluatorCount);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return normalizeManualEvaluationCount(manualCount);
    }
    return Math.max(1, Math.floor(parsed));
}

module.exports = {
    normalizeEvaluationMode,
    normalizeManualEvaluationCount,
    resolveRequiredEvaluationCount
};
