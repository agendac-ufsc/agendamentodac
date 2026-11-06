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

function isTrustedLegacyCalendarEvent(evento, serviceAccountEmail = '') {
    const privateProps = evento?.extendedProperties?.private || {};
    if (privateProps.dac_inscricao_id) return false;
    if (privateProps.dac_source === 'sistema') return true;
    if (privateProps.dac_source) return false;

    const creatorEmail = String(evento?.creator?.email || '').trim().toLowerCase();
    if (serviceAccountEmail && creatorEmail === String(serviceAccountEmail).trim().toLowerCase()) {
        return true;
    }

    const description = String(evento?.description || '');
    return /<strong>\s*em\s+an[aá]lise\s*<\/strong>/i.test(description)
        || /^em\s+an[aá]lise\s*\r?\n\s*local:/i.test(description)
        || (/proponente:/i.test(description) && /local:/i.test(description));
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

function normalizarDataEtapa(valor) {
    const texto = String(valor || '').trim();
    let partes = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (partes) {
        const [, ano, mes, dia] = partes;
        const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
        return data.getUTCFullYear() === Number(ano)
            && data.getUTCMonth() + 1 === Number(mes)
            && data.getUTCDate() === Number(dia)
            ? `${ano}-${mes}-${dia}`
            : '';
    }

    partes = texto.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (!partes) return '';
    const [, dia, mes, ano] = partes;
    const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
    return data.getUTCFullYear() === Number(ano)
        && data.getUTCMonth() + 1 === Number(mes)
        && data.getUTCDate() === Number(dia)
        ? `${ano}-${mes}-${dia}`
        : '';
}

function chaveResumoEtapa(valor) {
    const texto = String(valor || '').trim();
    const prefixo = texto.match(
        /^(ensaio|montagem|evento|desmontagem)(?:\s+\d+)?\s*[:\-‐‑‒–—―−]\s*(.+)$/i
    );
    if (!prefixo) return normalizarTextoCalendario(texto);
    return `${normalizarTextoCalendario(prefixo[1])}|${normalizarTextoCalendario(prefixo[2])}`;
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
    const data = normalizarDataEtapa(etapa?.data);
    const hora = String(etapa?.horario || '').match(/(?:^|\D)(\d{1,2})\s*(?::|h)\s*(\d{2})(?!\d)/i);
    if (!data || !hora) return '';
    const horaNumero = Number(hora[1]);
    const minuto = Number(hora[2]);
    if (horaNumero > 23 || minuto > 59) return '';
    return `${data}T${String(horaNumero).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
}

function chaveEtapaEsperada(etapaEsperada) {
    const inicio = inicioEsperadoEtapa(etapaEsperada?.etapa);
    const resumo = chaveResumoEtapa(etapaEsperada?.summary);
    return inicio && resumo
        ? `${resumo}|${inicio}`
        : '';
}

function inicioLocalEventoCalendario(evento) {
    const valor = String(evento?.start?.dateTime || '');
    if (!valor.includes('T')) return '';

    const temFusoExplicito = /(?:Z|[+-]\d{2}:\d{2})$/i.test(valor);
    if (!temFusoExplicito) {
        return evento?.start?.timeZone === 'America/Sao_Paulo'
            ? valor.slice(0, 16)
            : '';
    }

    const timestamp = Date.parse(valor);
    if (!Number.isFinite(timestamp)) return '';
    const partes = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date(timestamp));
    const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
    if (!valores.year || !valores.month || !valores.day || !valores.hour || !valores.minute) return '';
    return `${valores.year}-${valores.month}-${valores.day}T${valores.hour}:${valores.minute}`;
}

function chaveEventoCalendario(evento) {
    const summary = chaveResumoEtapa(evento?.summary);
    const inicio = inicioLocalEventoCalendario(evento);
    if (!summary || !inicio) return '';
    return `${summary}|${inicio}`;
}

function correspondeEventoEtapa(evento, etapaEsperada) {
    const chaveEsperada = chaveEtapaEsperada(etapaEsperada);
    return Boolean(chaveEsperada && chaveEventoCalendario(evento) === chaveEsperada);
}

function eventoCalendarioCancelado(evento) {
    return ['cancelled', 'canceled'].includes(String(evento?.status || '').toLowerCase());
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
    const eventosPermitidos = (Array.isArray(eventosCalendario) ? eventosCalendario : []).filter(evento => {
        const privateProps = evento?.extendedProperties?.private || {};
        const eventRegistrationId = String(privateProps.dac_inscricao_id || '');
        if (eventRegistrationId) {
            return privateProps.dac_source === 'sistema' && eventRegistrationId === id;
        }
        if (privateProps.dac_source === 'sistema') {
            return !legacyEventIds || legacyEventIds.has(String(evento.id || ''));
        }
        return Boolean(legacyEventIds?.has(String(evento.id || '')));
    });
    const eventos = eventosPermitidos.filter(evento => !eventoCalendarioCancelado(evento));
    const eventosCancelados = eventosPermitidos.filter(evento => eventoCalendarioCancelado(evento));

    const matched = etapasEsperadas.map(etapaEsperada =>
        eventos.filter(evento => correspondeEventoEtapa(evento, etapaEsperada))
    );
    const hasAmbiguousMatch = matched.some(matches => matches.length > 1);
    const hasMissingMatch = matched.some(matches => matches.length === 0);
    if (hasAmbiguousMatch || hasMissingMatch) {
        if (hasMissingMatch && etapasEsperadas.some(etapaEsperada =>
            eventosCancelados.some(evento => correspondeEventoEtapa(evento, etapaEsperada))
        )) {
            return { elegivel: false, motivo: 'Há ocorrência correspondente cancelada no calendário.' };
        }
        if (hasAmbiguousMatch && hasMissingMatch) {
            return { elegivel: false, motivo: 'Uma ou mais etapas estão ausentes ou têm correspondência ambígua no calendário.' };
        }
        if (hasAmbiguousMatch) {
            return { elegivel: false, motivo: 'Mais de uma ocorrência do calendário corresponde à mesma etapa; a correspondência é ambígua.' };
        }
        return { elegivel: false, motivo: 'Não foi localizada uma ocorrência correspondente por título, data e horário local no calendário.' };
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

    const ultimoEventoMs = Math.max(...ends);
    if (ultimoEventoMs > agoraMs) {
        return {
            elegivel: false,
            motivo: 'Ainda há ocorrência(s) futura(s) do evento.',
            nextCheckAt: new Date(ultimoEventoMs).toISOString()
        };
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
        ultimoEventoEm: new Date(ultimoEventoMs).toISOString()
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

function criarResumoBloqueioArquivo(inscricao, motivo) {
    const eventDates = [...new Set(listaEtapasEvento(inscricao)
        .map(etapa => normalizarDataEtapa(etapa.data))
        .filter(Boolean))];
    return {
        eventName: String(inscricao?.evento || ''),
        venue: String(inscricao?.localNome || inscricao?.local || ''),
        eventDates,
        reason: String(motivo || '')
    };
}

function filtrarRegistrosArquivadosExcluidos(registros, entradas) {
    const ids = new Set((Array.isArray(entradas) ? entradas : [])
        .flatMap(entrada => entrada && typeof entrada === 'object'
            ? [entrada.id, entrada.legacyId]
            : [entrada])
        .filter(id => id !== undefined && id !== null && String(id).trim())
        .map(String));
    return (Array.isArray(registros) ? registros : []).filter(registro =>
        ![registro?.id, registro?.legacyId].some(id =>
            id !== undefined && id !== null && ids.has(String(id))
        )
    );
}

module.exports = {
    normalizarTextoCalendario,
    extrairNomeEventoCalendario,
    isTrustedLegacyCalendarEvent,
    avaliarElegibilidadeArquivo,
    etapasEsperadasArquivo,
    chaveEtapaEsperada,
    chaveEventoCalendario,
    criarRegistroArquivado,
    criarResumoBloqueioArquivo,
    filtrarRegistrosArquivadosExcluidos,
    correspondeEventoEtapa,
    dataFinalCalendario
};
