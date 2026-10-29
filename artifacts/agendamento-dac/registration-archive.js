const ARCHIVE_RETENTION_DAYS = 30;
const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function normalizarTextoCalendario(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function dataFinalCalendario(evento) {
    const valor = evento?.end?.dateTime || evento?.end?.date;
    if (!valor) return null;
    const data = Date.parse(valor);
    return Number.isFinite(data) ? data : null;
}

function listaEtapasEvento(inscricao) {
    const valor = inscricao?.etapas?.evento;
    const etapas = Array.isArray(valor) ? valor : [valor];
    return etapas.filter(etapa => etapa && etapa.data && etapa.horario);
}

function avaliarElegibilidadeArquivo(inscricao, eventosCalendario, agora = new Date()) {
    const id = String(inscricao?.id || '');
    const etapas = listaEtapasEvento(inscricao);
    const nomeEvento = String(inscricao?.evento || '').trim();
    const agoraMs = agora instanceof Date ? agora.getTime() : Date.parse(agora);

    if (!id || !nomeEvento || etapas.length === 0) {
        return { elegivel: false, motivo: 'Inscrição sem ID ou etapa de evento completa.' };
    }
    if (inscricao.calendarSynced !== true) {
        return { elegivel: false, motivo: 'Inscrição não está marcada como sincronizada com o calendário.' };
    }
    if (/cancelad[oa]|cancelled|canceled/i.test(String(inscricao.statusInscricao || inscricao.status || ''))) {
        return { elegivel: false, motivo: 'Evento cancelado.' };
    }
    if (!Number.isFinite(agoraMs)) {
        return { elegivel: false, motivo: 'Data de referência inválida.' };
    }

    const expectedEvents = etapas.map((_etapa, index) => {
        const label = etapas.length > 1 ? `Evento ${index + 1}` : 'Evento';
        return normalizarTextoCalendario(`${label}: ${nomeEvento}`);
    });
    const byRegistrationId = (Array.isArray(eventosCalendario) ? eventosCalendario : []).filter(evento => {
        const privateProps = evento?.extendedProperties?.private || {};
        return String(privateProps.dac_inscricao_id || '') === id
            && privateProps.dac_source === 'sistema'
            && evento.status !== 'cancelled';
    });
    const eventStageEvents = byRegistrationId.filter(evento =>
        /^evento(?:\s+\d+)?:/.test(normalizarTextoCalendario(evento.summary))
    );
    if (eventStageEvents.length !== expectedEvents.length) {
        return { elegivel: false, motivo: 'A quantidade de eventos no calendário não corresponde à inscrição.' };
    }

    const matched = expectedEvents.map(title =>
        eventStageEvents.filter(evento => normalizarTextoCalendario(evento.summary) === title)
    );
    if (matched.some(matches => matches.length !== 1)) {
        return { elegivel: false, motivo: 'Não há correspondência única entre inscrição e calendário.' };
    }

    const eventos = matched.map(matches => matches[0]);
    const ends = eventos.map(evento => dataFinalCalendario(evento));
    if (ends.some(end => end === null)) {
        return { elegivel: false, motivo: 'O calendário não informa a data final de todos os eventos.' };
    }

    const corte = agoraMs - ARCHIVE_RETENTION_MS;
    if (ends.some(end => end >= corte)) {
        return { elegivel: false, motivo: 'Ainda não se passaram mais de 30 dias desde o fim de todos os eventos.' };
    }

    const eventSummaries = eventos.map((evento, index) => ({
        summary: String(evento.summary || ''),
        start: evento.start?.dateTime || evento.start?.date || null,
        end: evento.end?.dateTime || evento.end?.date || null,
        eventId: evento.id || null,
        stage: expectedEvents.length > 1 ? `Evento ${index + 1}` : 'Evento'
    }));

    return {
        elegivel: true,
        eventos: eventSummaries,
        ultimoEventoEm: new Date(Math.max(...ends)).toISOString()
    };
}

function criarRegistroArquivado(inscricao, prova, arquivadoEm = new Date()) {
    const termoPdf = inscricao?.termoPdf;
    const termoPdfPersistido = termoPdf?.pathname
        && String(termoPdf.pathname).startsWith('termos/assinados/')
        && termoPdf?.blobUrl
        ? {
            pathname: String(termoPdf.pathname),
            blobUrl: String(termoPdf.blobUrl),
            fileName: String(termoPdf.fileName || 'Termo_assinado.pdf'),
            storedAt: String(termoPdf.storedAt || '')
        }
        : null;

    return {
        id: String(inscricao.id),
        archivedAt: arquivadoEm instanceof Date ? arquivadoEm.toISOString() : new Date(arquivadoEm).toISOString(),
        registrationDate: String(inscricao.timestamp || inscricao.createdAt || inscricao.concluidoEm || ''),
        applicantName: String(inscricao.nome || ''),
        applicantEmail: String(inscricao.email || ''),
        applicantPhone: String(inscricao.telefone || ''),
        eventName: String(inscricao.evento || ''),
        venue: String(inscricao.localNome || inscricao.local || ''),
        calendarId: String(inscricao.calendarId || ''),
        lastEventEnd: prova.ultimoEventoEm,
        calendarEvents: prova.eventos,
        termoAssinado: inscricao.termoAssinado === true,
        termoAssinadoEm: String(inscricao.termoAssinadoEm || ''),
        termoPdf: termoPdfPersistido
    };
}

module.exports = {
    ARCHIVE_RETENTION_DAYS,
    ARCHIVE_RETENTION_MS,
    avaliarElegibilidadeArquivo,
    criarRegistroArquivado,
    dataFinalCalendario
};
