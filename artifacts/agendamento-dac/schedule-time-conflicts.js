const TIME_RANGE_PATTERN = /^\s*(\d{1,2}:\d{2})\s*(?:às|[-–—])\s*(\d{1,2}:\d{2})\s*$/i;
const DEFAULT_CONFLICT_BUFFER_MINUTES = 30;

function timeToMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
}

function parseTimeRange(value) {
    const match = String(value || '').match(TIME_RANGE_PATTERN);
    if (!match) return null;

    const start = timeToMinutes(match[1]);
    const end = timeToMinutes(match[2]);
    if (start === null || end === null || end <= start) return null;
    return { start, end };
}

function intervalsConflict(first, second, bufferMinutes = DEFAULT_CONFLICT_BUFFER_MINUTES) {
    if (!first || !second) return false;
    const buffer = Number.isFinite(bufferMinutes) ? Math.max(0, bufferMinutes) : DEFAULT_CONFLICT_BUFFER_MINUTES;
    return first.start < second.end + buffer
        && first.end + buffer > second.start;
}

function flattenStageItems(stages) {
    if (!stages || typeof stages !== 'object') return [];
    return Object.values(stages)
        .flatMap(value => Array.isArray(value) ? value : [value])
        .filter(item => item && typeof item === 'object');
}

function normalizeScheduleLocation(value) {
    const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('igrej')) return 'igrejinha';
    if (normalized.includes('teatro')) return 'teatro';
    return normalized;
}

function shouldBlockScheduleConflict(registration, allowCompetition) {
    return allowCompetition !== true || registration?.horariosOficializados === true;
}

function classifyCalendarEventSource(event, officializedRegistrationIds, serviceAccountEmail = '') {
    const privateProperties = event?.extendedProperties?.private || {};
    const registrationId = String(privateProperties.dac_inscricao_id || '').trim();
    if (registrationId && officializedRegistrationIds?.has(registrationId)) return 'manual';

    const creatorEmail = String(event?.creator?.email || '').trim().toLowerCase();
    const serviceEmail = String(serviceAccountEmail || '').trim().toLowerCase();
    const isSystem = privateProperties.dac_source === 'sistema'
        || Boolean(serviceEmail && creatorEmail === serviceEmail);
    return isSystem ? 'sistema' : 'manual';
}

function createOfficializedCalendarBlocks(registration) {
    const stageNames = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };
    const local = normalizeScheduleLocation(registration?.local || registration?.localNome) || 'teatro';
    const eventName = String(registration?.evento || 'Evento');

    return Object.entries(registration?.etapas || {}).flatMap(([stage, value]) => {
        const items = Array.isArray(value) ? value : [value];
        return items.map((item, index) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item?.data || ''))) return null;
            const timeRange = parseTimeRange(item?.horario);
            if (!timeRange) return null;
            const formatTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
            const label = items.length > 1 ? `${stageNames[stage] || stage} ${index + 1}` : (stageNames[stage] || stage);
            return {
                start: `${item.data}T${formatTime(timeRange.start)}:00-03:00`,
                end: `${item.data}T${formatTime(timeRange.end)}:00-03:00`,
                summary: `${label}: ${eventName}`,
                description: 'Horário oficializado no painel administrativo.',
                local,
                source: 'manual'
            };
        }).filter(Boolean);
    });
}

function schedulesConflict(firstStages, secondStages, bufferMinutes = DEFAULT_CONFLICT_BUFFER_MINUTES, locationOptions = {}) {
    if (locationOptions.compareDifferentLocations === false) {
        const firstLocation = normalizeScheduleLocation(locationOptions.firstLocation);
        const secondLocation = normalizeScheduleLocation(locationOptions.secondLocation);
        if (firstLocation && secondLocation && firstLocation !== secondLocation) return false;
    }

    const firstItems = flattenStageItems(firstStages);
    const secondItems = flattenStageItems(secondStages);

    return firstItems.some(first => {
        if (!first.data || !first.horario) return false;
        const firstRange = parseTimeRange(first.horario);
        if (!firstRange) return false;

        return secondItems.some(second => {
            if (!second.data || !second.horario || String(first.data) !== String(second.data)) return false;
            const secondRange = parseTimeRange(second.horario);
            return intervalsConflict(firstRange, secondRange, bufferMinutes);
        });
    });
}

module.exports = {
    DEFAULT_CONFLICT_BUFFER_MINUTES,
    intervalsConflict,
    parseTimeRange,
    shouldBlockScheduleConflict,
    classifyCalendarEventSource,
    createOfficializedCalendarBlocks,
    schedulesConflict
};
