'use strict';

const MAX_REHEARSALS_PER_PROPOSAL = 2;
const EVENT_DAYS_WITH_RESTRICTION = new Set([0, 4, 5, 6]);

function stageItems(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function getIsoWeekday(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.getUTCDay();
}

function validateScheduleRules(stages, restrictNonRehearsalDates = false) {
    const schedule = stages && typeof stages === 'object' ? stages : {};
    const rehearsals = stageItems(schedule.ensaio);
    if (rehearsals.length > MAX_REHEARSALS_PER_PROPOSAL) {
        return 'Cada proposta pode incluir no máximo 2 ensaios.';
    }

    const eventDates = new Set(stageItems(schedule.evento)
        .map(item => String(item?.data || '').trim())
        .filter(date => getIsoWeekday(date) !== null));

    for (const rehearsal of rehearsals) {
        const date = String(rehearsal?.data || '').trim();
        const weekday = getIsoWeekday(date);
        if (weekday === null) return 'Cada ensaio precisa ter uma data válida.';
        if (weekday === 0 || (weekday === 6 && !eventDates.has(date))) {
            return 'Os ensaios podem ocorrer de segunda a sexta; aos sábados, somente na mesma data de um Evento.';
        }
    }

    if (restrictNonRehearsalDates) {
        for (const [stage, value] of Object.entries(schedule)) {
            if (stage === 'ensaio') continue;
            for (const item of stageItems(value)) {
                if (!item?.data) continue;
                const weekday = getIsoWeekday(item.data);
                if (weekday === null || !EVENT_DAYS_WITH_RESTRICTION.has(weekday)) {
                    return 'Inscrições só são aceitas para datas de quinta-feira a domingo.';
                }
            }
        }
    }

    return null;
}

module.exports = { MAX_REHEARSALS_PER_PROPOSAL, validateScheduleRules };
