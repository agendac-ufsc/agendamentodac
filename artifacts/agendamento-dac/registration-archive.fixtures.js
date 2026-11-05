const referenceDate = new Date('2026-11-04T15:00:00.000Z');

const historicalRegistration = {
    id: 'fixture-registration-2026-04-15',
    evento: 'Mostra Cênica de Exemplo',
    localNome: 'Local de teste',
    calendarSynced: true,
    etapas: {
        evento: {
            data: '15/04/2026',
            horario: '19:00 às 21:00'
        }
    }
};

const historicalEvent = {
    id: 'fixture-calendar-event-2026-04-15',
    summary: 'Evento - Mostra Cênica de Exemplo',
    status: 'confirmed',
    start: { dateTime: '2026-04-15T22:00:00.000Z' },
    end: { dateTime: '2026-04-16T00:00:00.000Z' },
    extendedProperties: {
        private: {
            dac_source: 'sistema',
            dac_inscricao_id: historicalRegistration.id
        }
    }
};

const multipleOccurrenceRegistration = {
    id: 'fixture-registration-multiple-occurrences',
    evento: 'Mostra Cênica de Exemplo',
    localNome: 'Local de teste',
    calendarSynced: true,
    etapas: {
        evento: [
            { data: '2026-04-23', horario: '19:00 às 20:30' },
            { data: '2026-08-14', horario: '20:00 às 21:30' }
        ]
    }
};

const multipleOccurrenceEvents = [
    {
        id: 'fixture-calendar-event-2026-04-23',
        summary: 'Evento: Mostra Cênica de Exemplo',
        status: 'confirmed',
        start: { dateTime: '2026-04-23T19:00:00-03:00' },
        end: { dateTime: '2026-04-23T20:30:00-03:00' },
        extendedProperties: {
            private: {
                dac_source: 'sistema',
                dac_inscricao_id: multipleOccurrenceRegistration.id
            }
        }
    },
    {
        id: 'fixture-calendar-event-2026-08-14',
        summary: 'Evento 2 – Mostra Cênica de Exemplo',
        status: 'confirmed',
        start: { dateTime: '2026-08-14T23:00:00.000Z' },
        end: { dateTime: '2026-08-15T00:30:00.000Z' },
        extendedProperties: {
            private: {
                dac_source: 'sistema',
                dac_inscricao_id: multipleOccurrenceRegistration.id
            }
        }
    }
];

const futureRegistration = {
    id: 'fixture-registration-future',
    evento: 'Apresentação Futura de Exemplo',
    localNome: 'Local de teste',
    calendarSynced: true,
    etapas: {
        evento: { data: '2026-11-05', horario: '19:00 às 21:00' }
    }
};

const futureEvent = {
    id: 'fixture-calendar-event-future',
    summary: 'Evento: Apresentação Futura de Exemplo',
    status: 'confirmed',
    start: { dateTime: '2026-11-05T19:00:00-03:00' },
    end: { dateTime: '2026-11-05T21:00:00-03:00' },
    extendedProperties: {
        private: {
            dac_source: 'sistema',
            dac_inscricao_id: futureRegistration.id
        }
    }
};

module.exports = {
    referenceDate,
    historicalRegistration,
    historicalEvent,
    multipleOccurrenceRegistration,
    multipleOccurrenceEvents,
    futureRegistration,
    futureEvent
};
