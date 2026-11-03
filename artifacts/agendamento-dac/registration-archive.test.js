const test = require('node:test');
const assert = require('node:assert/strict');
const {
    avaliarElegibilidadeArquivo,
    etapasEsperadasArquivo,
    criarRegistroArquivado,
    extrairNomeEventoCalendario,
    normalizarTextoCalendario,
    correspondeEventoEtapa,
    isTrustedLegacyCalendarEvent
} = require('./registration-archive');

const agora = new Date('2026-10-09T12:00:00.000Z');
const fimEvento = new Date(agora.getTime() - 1000).toISOString();

function inscricao(overrides = {}) {
    return {
        id: 'site_123',
        nome: 'Pessoa Proponente',
        email: 'pessoa@example.org',
        telefone: '48999990000',
        evento: 'Mostra de Música',
        legacyId: 'forms_pessoa_mostra_1',
        localNome: 'Teatro Carmen Fossari',
        calendarId: 'cal-teatro',
        timestamp: '2026-01-01T10:00:00.000Z',
        calendarSynced: true,
        etapas: {
            evento: { data: '2026-08-01', horario: '19:00-21:00' },
            montagem: { data: '2026-07-31', horario: '10:00-12:00' }
        },
        ...overrides
    };
}

function evento(overrides = {}) {
    return {
        id: 'calendar-event-1',
        summary: 'Evento: Mostra de Música',
        status: 'confirmed',
        start: { dateTime: '2026-08-01T19:00:00-03:00' },
        end: { dateTime: fimEvento },
        extendedProperties: {
            private: {
                dac_source: 'sistema',
                dac_inscricao_id: 'site_123'
            }
        },
        ...overrides
    };
}

test('vincula evento novo por ID e aceita evento legado somente com nome, data e horário exatos', () => {
    const prova = avaliarElegibilidadeArquivo(inscricao(), [evento()], agora);
    assert.equal(prova.elegivel, true);

    const idDeOutraInscricao = avaliarElegibilidadeArquivo(inscricao(), [
        evento({ extendedProperties: { private: { dac_source: 'sistema', dac_inscricao_id: 'outra' } } })
    ], agora);
    assert.equal(idDeOutraInscricao.elegivel, false);

    const eventoLegado = evento({
        extendedProperties: { private: { dac_source: 'sistema' } }
    });
    assert.equal(avaliarElegibilidadeArquivo(inscricao(), [eventoLegado], agora).elegivel, true);
    assert.equal(avaliarElegibilidadeArquivo(inscricao(), [eventoLegado], agora, {
        legacyEventIds: new Set()
    }).elegivel, false);

    assert.equal(avaliarElegibilidadeArquivo(inscricao(), [
        evento({
            extendedProperties: { private: { dac_source: 'sistema' } },
            start: { dateTime: '2026-08-02T19:00:00-03:00' }
        })
    ], agora).elegivel, false);
    assert.equal(avaliarElegibilidadeArquivo(inscricao(), [
        evento({
            extendedProperties: { private: { dac_source: 'sistema' } },
            start: { dateTime: '2026-08-01T18:00:00-03:00' }
        })
    ], agora).elegivel, false);
    assert.equal(avaliarElegibilidadeArquivo(inscricao(), [
        evento({ extendedProperties: { private: {} } })
    ], agora).elegivel, false);

    const eventoAntigoSemMarcador = evento({
        extendedProperties: { private: {} },
        description: '<strong>EM ANÁLISE</strong>'
    });
    assert.equal(
        avaliarElegibilidadeArquivo(inscricao(), [eventoAntigoSemMarcador], agora, {
            legacyEventIds: new Set([eventoAntigoSemMarcador.id])
        }).elegivel,
        true
    );
    assert.equal(
        avaliarElegibilidadeArquivo(inscricao(), [eventoAntigoSemMarcador], agora, {
            legacyEventIds: new Set()
        }).elegivel,
        false
    );
});

test('valida o resumo original dos eventos de inscrições antigas do Forms', () => {
    const inscricaoForms = inscricao({
        id: 'forms_pessoa_mostra_1',
        etapas: {
            evento: [{
                data: '2026-08-01',
                horario: '19:00 às 21:00',
                _archiveEventSummary: 'Evento 1: Mostra de Música'
            }]
        }
    });
    const eventoForms = evento({
        summary: 'Evento 1: Mostra de Música',
        extendedProperties: { private: { dac_source: 'sistema' } }
    });
    assert.equal(avaliarElegibilidadeArquivo(inscricaoForms, [eventoForms], agora).elegivel, true);
});

test('reconhece títulos antigos do calendário com hífen e diferentes etapas', () => {
    const tituloFormulario = 'NECRÓPSIA - ESTUDOS PARA RESSUSCITAR UM CADÁVER';
    const tituloCalendario = 'Necrópsia – estudos para ressuscitar um cadáver';

    assert.equal(
        normalizarTextoCalendario(tituloFormulario),
        normalizarTextoCalendario(tituloCalendario)
    );
    assert.equal(
        extrairNomeEventoCalendario(`Montagem - ${tituloCalendario}`),
        tituloCalendario
    );
    assert.equal(
        extrairNomeEventoCalendario(`Evento - ${tituloCalendario}`),
        tituloCalendario
    );
    assert.equal(
        extrairNomeEventoCalendario(`Evento 2: ${tituloCalendario}`),
        tituloCalendario
    );
    assert.equal(extrairNomeEventoCalendario(tituloCalendario), '');
});

test('corresponde a resumo legado quando o tipo de hífen varia', () => {
    const titulo = 'Necrópsia - estudos para ressuscitar um cadáver';
    const inscricaoLegada = inscricao({
        evento: titulo,
        etapas: {
            evento: [{
                data: '2026-08-01',
                horario: '19:00 às 21:00',
                _archiveEventSummary: `Evento - ${titulo.replace(' - ', ' – ')}`
            }]
        }
    });
    const esperado = etapasEsperadasArquivo(inscricaoLegada)[0];
    const calendarEvent = evento({
        summary: `Evento - ${titulo}`,
        start: { dateTime: '2026-08-01T19:00:00-03:00' }
    });

    assert.equal(correspondeEventoEtapa(calendarEvent, esperado), true);
});

test('confirma origem de eventos antigos sem marcador por metadados ou descrição oficial', () => {
    assert.equal(isTrustedLegacyCalendarEvent(evento({
        extendedProperties: { private: {} },
        description: '<strong>EM ANÁLISE</strong>'
    })), true);
    assert.equal(isTrustedLegacyCalendarEvent(evento({
        extendedProperties: { private: {} },
        description: 'Em análise\nLocal: Teatro Carmen Fossari'
    })), true);
    assert.equal(isTrustedLegacyCalendarEvent(evento({
        extendedProperties: { private: {} },
        creator: { email: 'calendar-bot@example.org' }
    }), 'calendar-bot@example.org'), true);
    assert.equal(isTrustedLegacyCalendarEvent(evento({
        extendedProperties: { private: { dac_source: 'manual' } },
        description: '<strong>EM ANÁLISE</strong>'
    })), false);
    assert.equal(isTrustedLegacyCalendarEvent(evento({
        extendedProperties: { private: { dac_inscricao_id: 'another-registration' } },
        description: '<strong>EM ANÁLISE</strong>'
    })), false);
});

test('mantém a inscrição ativa enquanto qualquer evento ainda estiver no futuro', () => {
    const fimFuturo = new Date(agora.getTime() + 1).toISOString();
    const inscricaoComDoisEventos = inscricao({ etapas: { evento: [
        { data: '2026-08-01', horario: '19:00 às 21:00' },
        { data: '2026-08-02', horario: '19:00 às 21:00' }
    ] } });
    const prova = avaliarElegibilidadeArquivo(inscricaoComDoisEventos, [
        evento({ summary: 'Evento 1: Mostra de Música', end: { dateTime: fimEvento } }),
        evento({ id: 'calendar-event-2', summary: 'Evento 2: Mostra de Música',
            start: { dateTime: '2026-08-02T19:00:00-03:00' }, end: { dateTime: fimFuturo },
            extendedProperties: { private: { dac_source: 'sistema', dac_inscricao_id: 'site_123' } } })
    ], agora);
    assert.equal(prova.elegivel, false);
});

test('não arquiva sincronização incompleta, cancelamentos ou eventos sem fim', () => {
    assert.equal(avaliarElegibilidadeArquivo(inscricao({ calendarSynced: false }), [evento()], agora).elegivel, false);
    assert.equal(avaliarElegibilidadeArquivo(inscricao({ statusInscricao: 'Cancelado' }), [evento()], agora).elegivel, false);
    assert.equal(avaliarElegibilidadeArquivo(inscricao(), [evento({ end: {} })], agora).elegivel, false);
});

test('exige que todos os eventos tenham terminado e entende evento de dia inteiro', () => {
    const inscricaoNoCorte = inscricao({ etapas: { evento: { data: '2026-09-09', horario: '08:00 às 09:00' } } });
    assert.equal(avaliarElegibilidadeArquivo(inscricaoNoCorte, [evento({
        start: { dateTime: '2026-09-09T08:00:00-03:00' }, end: { dateTime: agora.toISOString() }
    })], agora).elegivel, false);
    assert.equal(avaliarElegibilidadeArquivo(inscricaoNoCorte, [evento({
        start: { dateTime: '2026-09-09T08:00:00-03:00' }, end: { dateTime: new Date(agora.getTime() - 1).toISOString() }
    })], agora).elegivel, true);
    assert.equal(avaliarElegibilidadeArquivo(inscricao(), [evento({ end: { date: '2026-08-01' } })], agora).elegivel, true);
});

test('resumo arquivado preserva o original e não copia documentos ou dados extensos', () => {
    const source = inscricao({
        documentos: [{ blobUrl: 'https://example.org/private', tamanho: 1000 }],
        segundaEtapaTeste: { cpf: '00000000000' },
        termoDados: { cpfCnpj: '00000000000', endereco: 'Rua privada' },
        termoAssinado: true,
        termoAssinadoEm: '2026-08-05T12:00:00.000Z',
        termoPdf: {
            pathname: 'termos/assinados/document.pdf',
            blobUrl: 'https://blob.example/document.pdf',
            fileName: 'termo.pdf',
            storedAt: '2026-08-05T12:00:00.000Z'
        }
    });
    const original = JSON.parse(JSON.stringify(source));
    const prova = avaliarElegibilidadeArquivo(source, [evento()], agora);
    const archived = criarRegistroArquivado(source, prova, agora);

    assert.deepEqual(source, original);
    assert.equal(archived.eventName, source.evento);
    assert.equal(archived.applicantEmail, source.email);
    assert.equal(archived.legacyId, source.legacyId);
    assert.equal(archived.termoPdf.fileName, 'termo.pdf');
    assert.equal('documentos' in archived, false);
    assert.equal('segundaEtapaTeste' in archived, false);
    assert.equal('termoDados' in archived, false);
});
