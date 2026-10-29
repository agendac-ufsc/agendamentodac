const test = require('node:test');
const assert = require('node:assert/strict');
const {
    ARCHIVE_RETENTION_MS,
    avaliarElegibilidadeArquivo,
    criarRegistroArquivado
} = require('./registration-archive');

const agora = new Date('2026-10-09T12:00:00.000Z');
const fimEvento = new Date(agora.getTime() - ARCHIVE_RETENTION_MS - 1000).toISOString();

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

test('só considera eventos do calendário vinculados pelo ID privado exato', () => {
    const prova = avaliarElegibilidadeArquivo(inscricao(), [evento()], agora);
    assert.equal(prova.elegivel, true);

    const semVinculoExato = avaliarElegibilidadeArquivo(inscricao(), [
        evento({ extendedProperties: { private: { dac_source: 'sistema', dac_inscricao_id: 'outra' } } })
    ], agora);
    assert.equal(semVinculoExato.elegivel, false);
});

test('exige que todos os eventos tenham terminado há mais de 30 dias', () => {
    const fimRecente = new Date(agora.getTime() - ARCHIVE_RETENTION_MS + 1).toISOString();
    const prova = avaliarElegibilidadeArquivo(inscricao(), [
        evento({ end: { dateTime: fimEvento } }),
        evento({
            id: 'calendar-event-2',
            summary: 'Evento 2: Mostra de Música',
            end: { dateTime: fimRecente },
            extendedProperties: { private: { dac_source: 'sistema', dac_inscricao_id: 'site_123' } }
        })
    ], agora);
    assert.equal(prova.elegivel, false);
});

test('não arquiva sincronização incompleta, cancelamentos ou eventos sem fim', () => {
    assert.equal(avaliarElegibilidadeArquivo(inscricao({ calendarSynced: false }), [evento()], agora).elegivel, false);
    assert.equal(avaliarElegibilidadeArquivo(inscricao({ statusInscricao: 'Cancelado' }), [evento()], agora).elegivel, false);
    assert.equal(avaliarElegibilidadeArquivo(inscricao(), [evento({ end: {} })], agora).elegivel, false);
});

test('usa limite estrito de mais de 30 dias e entende fim de evento de dia inteiro', () => {
    const exatamente30Dias = new Date(agora.getTime() - ARCHIVE_RETENTION_MS).toISOString();
    assert.equal(
        avaliarElegibilidadeArquivo(inscricao(), [evento({ end: { dateTime: exatamente30Dias } })], agora).elegivel,
        false
    );
    assert.equal(
        avaliarElegibilidadeArquivo(inscricao(), [evento({ end: { date: '2026-08-01' } })], agora).elegivel,
        true
    );
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
