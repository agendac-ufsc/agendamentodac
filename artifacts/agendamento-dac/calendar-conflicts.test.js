const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
    parseTimeRange,
    schedulesConflict,
    shouldBlockScheduleConflict,
    classifyCalendarEventSource,
    createOfficializedCalendarBlocks
} = require('./schedule-time-conflicts');

test('parseTimeRange aceita os formatos atuais e legado', () => {
    assert.deepEqual(parseTimeRange('18:00 às 19:30'), { start: 1080, end: 1170 });
    assert.deepEqual(parseTimeRange('18:00 - 19:30'), { start: 1080, end: 1170 });
    assert.equal(parseTimeRange('25:00 às 26:00'), null);
    assert.equal(parseTimeRange('19:00 às 18:00'), null);
});

test('schedulesConflict mantém o conflito entre locais como padrão', () => {
    const solicitada = { evento: { data: '2026-11-20', horario: '13:30 às 15:00' } };
    const existente = { montagem: { data: '2026-11-20', horario: '14:00 às 16:00' } };

    assert.equal(schedulesConflict(solicitada, existente), true);
});

test('schedulesConflict separa os locais quando a unificação está desativada', () => {
    const solicitada = { evento: { data: '2026-11-20', horario: '13:30 às 15:00' } };
    const existente = { montagem: { data: '2026-11-20', horario: '14:00 às 16:00' } };
    const opcoes = { compareDifferentLocations: false, firstLocation: 'teatro', secondLocation: 'Igrejinha da UFSC' };

    assert.equal(schedulesConflict(solicitada, existente, undefined, opcoes), false);
    assert.equal(schedulesConflict(solicitada, existente, undefined, { ...opcoes, secondLocation: 'Teatro Carmen Fossari' }), true);
    assert.equal(schedulesConflict(solicitada, existente, undefined, { ...opcoes, secondLocation: null }), true);
});

test('schedulesConflict permite outra data e horários além da margem de segurança', () => {
    const solicitada = {
        evento: { data: '2026-11-20', horario: '16:30 às 17:30' }
    };
    const existente = {
        ensaio: [
            { data: '2026-11-20', horario: '14:00 às 16:00' },
            { data: '2026-11-21', horario: '16:30 às 17:30' }
        ]
    };

    assert.equal(schedulesConflict(solicitada, existente), false);
});

test('horários oficializados bloqueiam conflitos mesmo com disputa permitida', () => {
    assert.equal(shouldBlockScheduleConflict({ horariosOficializados: true }, true), true);
    assert.equal(shouldBlockScheduleConflict({ horariosOficializados: false }, true), false);
    assert.equal(shouldBlockScheduleConflict({ horariosOficializados: false }, false), true);
});

test('evento de inscrição oficializada é tratado como bloqueio manual', () => {
    const event = {
        creator: { email: 'calendar-service@example.test' },
        extendedProperties: {
            private: { dac_source: 'sistema', dac_inscricao_id: 'insc-42' }
        }
    };

    assert.equal(classifyCalendarEventSource(event, new Set(), 'calendar-service@example.test'), 'sistema');
    assert.equal(classifyCalendarEventSource(event, new Set(['insc-42']), 'calendar-service@example.test'), 'manual');
    assert.equal(classifyCalendarEventSource({ summary: 'Evento manual' }, new Set(), 'calendar-service@example.test'), 'manual');
});

test('oficialização cria bloqueios manuais para todas as etapas quando faltam eventos vinculados', () => {
    const blocks = createOfficializedCalendarBlocks({
        local: 'igrejinha',
        evento: 'Mostra Cultural',
        etapas: {
            ensaio: { data: '2026-12-05', horario: '09:00 às 10:30' },
            evento: [
                { data: '2026-12-06', horario: '14:00 às 16:00' },
                { data: '2026-12-07', horario: '15:00 às 17:00' }
            ]
        }
    });

    assert.equal(blocks.length, 3);
    assert.deepEqual(blocks.map(block => block.local), ['igrejinha', 'igrejinha', 'igrejinha']);
    assert.deepEqual(blocks.map(block => block.source), ['manual', 'manual', 'manual']);
    assert.deepEqual(blocks.map(block => block.start), [
        '2026-12-05T09:00:00-03:00',
        '2026-12-06T14:00:00-03:00',
        '2026-12-07T15:00:00-03:00'
    ]);
});

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `função ${name} não encontrada`);
    const openBrace = source.indexOf('{', start);
    assert.notEqual(openBrace, -1, `corpo de ${name} não encontrado`);

    let depth = 0;
    for (let index = openBrace; index < source.length; index++) {
        if (source[index] === '{') depth++;
        if (source[index] === '}') depth--;
        if (depth === 0) return source.slice(start, index + 1);
    }

    assert.fail(`corpo de ${name} não foi fechado`);
}

for (const file of ['index-teste.html', 'index.html']) {
    test(`${file} classifica conflitos de intervalo do calendário`, () => {
        const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
        const source = extractFunction(html, 'getCalendarConflictStatus');
        const classify = vm.runInNewContext(`(${source})`);

        const eventoSistema = {
            start: '2026-11-20T14:00:00-03:00',
            end: '2026-11-20T16:00:00-03:00',
            source: 'sistema',
            local: 'igrejinha'
        };
        const eventoManual = {
            start: '2026-11-20T14:00:00-03:00',
            end: '2026-11-20T16:00:00-03:00',
            source: 'manual',
            local: 'igrejinha'
        };

        assert.equal(classify([eventoSistema], 13 * 60 + 30, 15 * 60).sistema, true);
        assert.equal(classify([eventoSistema], 16 * 60 + 30, 17 * 60 + 30).sistema, false);
        assert.equal(classify([eventoManual], 13 * 60 + 30, 15 * 60).manual, true);
    });

    test(`${file} separa disponibilidade entre locais quando configurado`, () => {
        const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
        const filterSource = extractFunction(html, 'getCalendarEventsForLocal');
        const filterByLocal = vm.runInNewContext(`(${filterSource})`);
        const classifySource = extractFunction(html, 'getCalendarConflictStatus');
        const classify = vm.runInNewContext(`(${classifySource})`);
        const eventos = [
            { start: '2026-11-20T14:00:00-03:00', end: '2026-11-20T16:00:00-03:00', source: 'sistema', local: 'igrejinha' },
            { start: '2026-11-20T14:00:00-03:00', end: '2026-11-20T16:00:00-03:00', source: 'manual', local: 'Teatro Carmen Fossari' }
        ];

        const teatroSeparado = filterByLocal(eventos, 'teatro', false);
        assert.equal(teatroSeparado.length, 1);
        assert.equal(classify(teatroSeparado, 13 * 60 + 30, 15 * 60).manual, true);
        assert.equal(classify(teatroSeparado, 13 * 60 + 30, 15 * 60).sistema, false);
        assert.equal(classify(filterByLocal(eventos, 'teatro', true), 13 * 60 + 30, 15 * 60).sistema, true);
        assert.equal(filterByLocal(eventos, 'Igrejinha da UFSC', false).length, 1);
    });
}
