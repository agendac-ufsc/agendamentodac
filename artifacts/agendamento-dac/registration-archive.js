const ARCHIVE_RETENTION_DAYS = 30;
const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function normalizarTextoCalendario(valor) {
    return String(valor || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[‐‑‒–—―−]/g, '-')
        .replace(/\s*-\s*/g, ' - ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extrairNomeEventoCalendario(summary) {
    const prefixo = String(summary || '').trim().match(
        /^(?:ensaio|montagem|evento|desmontagem)(?:\s+\d+)?\s*[:\-‐‑‒–—―−]\s*(.+)$/i
    );
    return prefixo?.[1]?.trim() || '';
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

function etapasEsperadasArquivo(inscricao) {
    const etapas = listaEtapasEvento(inscricao);
    const nomeEvento = String(inscricao?.evento || '').trim();
    if (!nomeEvento || etapas.length === 0) return [];

    return etapas.map((etapa, index) => {
        const stage = etapas.length > 1 ? `Evento ${index + 1}` : 'Evento';
        return {
            etapa,
            stage,
            summary: normalizarTextoCalendario(
                etapa._archiveEventSummary || `${stage}: ${nomeEvento}`
            )
        };
    });
}

function inicioEsperadoEtapa(etapa) {
    const hora = String(etapa?.horario || '').match(/\b\d{1,2}:\d{2}\b/)?.[0];
    if (!etapa?.data || !hora) return '';
    const [horaNumero, minuto] = hora.split(':');
    return `${String(etapa.data).slice(0, 10)}T${horaNumero.padStart(2, '0')}:${minuto}`;
}

function chaveEtapaEsperada(etapaEsperada) {
    const inicio = inicioEsperadoEtapa(etapaEsperada?.etapa);
    return inicio && etapaEsperada?.summary
        ? `${etapaEsperada.summary}|${inicio}`
        : '';
}

function chaveEventoCalendario(evento) {
    const summary = normalizarTextoCalendario(evento?.summary);
    const inicio = evento?.start?.dateTime;
    if (!summary || !inicio || !String(inicio).includes('T')) return '';
    return `${summary}|${String(inicio).slice(0, 16)}`;
}

function correspondeEventoEtapa(evento, etapaEsperada) {
    const chaveEsperada = chaveEtapaEsperada(etapaEsperada);
    return Boolean(chaveEsperada && chaveEventoCalendario(evento) === chaveEsperada);
}

function avaliarElegibilidadeArquivo(inscricao, eventosCalendario, agora = new Date(), opcoes = {}) {
    const id = String(inscricao?.id || '');
    const etapasEsperadas = etapasEsperadasArquivo(inscricao);
    const agoraMs = agora instanceof Date ? agora.getTime() : Date.parse(agora);

    if (inscricao._archiveBlockedReason) {
        return { elegivel: false, motivo: inscricao._archiveBlockedReason };
    }
    if (!id || !String(inscricao?.evento || '').trim() || etapasEsperadas.length === 0) {
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

    const legacyEventIds = opcoes.legacyEventIds instanceof Set
        ? opcoes.legacyEventIds
        : Array.isArray(opcoes.legacyEventIds)
            ? new Set(opcoes.legacyEventIds.map(String))
            : null;
    const eventos = (Array.isArray(eventosCalendario) ? eventosCalendario : []).filter(evento => {
        const privateProps = evento?.extendedProperties?.private || {};
        if (privateProps.dac_source !== 'sistema' || evento.status === 'cancelled') return false;
        const eventRegistrationId = String(privateProps.dac_inscricao_id || '');
        if (eventRegistrationId) return eventRegistrationId === id;
        return !legacyEventIds || legacyEventIds.has(String(evento.id || ''));
    });

    const matched = etapasEsperadas.map(etapaEsperada =>
        eventos.filter(evento => correspondeEventoEtapa(evento, etapaEsperada))
    );
    if (matched.some(matches => matches.length !== 1)) {
        return { elegivel: false, motivo: 'Não há correspondência única por nome, data e horário no calendário.' };
    }

    const eventosCorrespondentes = matched.map(matches => matches[0]);
    const idsEventos = eventosCorrespondentes.map(evento => String(evento.id || ''));
    if (new Set(idsEventos).size !== idsEventos.length) {
        return { elegivel: false, motivo: 'O mesmo evento do calendário corresponde a mais de uma etapa.' };
    }
    const ends = eventosCorrespondentes.map(evento => dataFinalCalendario(evento));
    if (ends.some(end => end === null)) {
        return { elegivel: false, motivo: 'O calendário não informa a data final de todos os eventos.' };
    }

    const corte = agoraMs - ARCHIVE_RETENTION_MS;
    if (ends.some(end => end >= corte)) {
        return { elegivel: false, motivo: 'Ainda não se passaram mais de 30 dias desde o fim de todos os eventos.' };
    }

    const eventSummaries = eventosCorrespondentes.map((evento, index) => ({
        summary: String(evento.summary || ''),
        start: evento.start?.dateTime || evento.start?.date || null,
        end: evento.end?.dateTime || evento.end?.date || null,
        eventId: evento.id || null,
        stage: etapasEsperadas[index].stage
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
        legacyId: String(inscricao.legacyId || ''),
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
    normalizarTextoCalendario,
    extrairNomeEventoCalendario,
    avaliarElegibilidadeArquivo,
    etapasEsperadasArquivo,
    chaveEtapaEsperada,
    criarRegistroArquivado,
    correspondeEventoEtapa,
    dataFinalCalendario
};
