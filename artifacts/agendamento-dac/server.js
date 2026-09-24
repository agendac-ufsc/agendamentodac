
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 12px; font-weight: bold;">Falhas na exclusão de eventos</td>
                                        <td style="padding: 8px 12px; color: ${eventosFalhos > 0 ? '#c0392b' : '#27ae60'};">${eventosFalhos}</td>
                                    </tr>
                                </table>
                                <hr style="border: 0; border-top: 1px solid #eee; margin: 16px 0;">
                                <p style="font-size: 13px; color: #777;">Se você não reconhece esta ação, altere a senha do painel administrativo imediatamente.</p>
                                <p style="margin-bottom: 0;">Atenciosamente,<br><strong>Sistema DAC/UFSC</strong></p>
                            </div>`
                        );
                        if (resultado) {
                            console.log(`📧 [AUDITORIA] E-mail de notificação enviado ao(s) admin(s): ${adminEmails.join(', ')}`);
                        } else {
                            console.error(`⚠️ [AUDITORIA] Falha ao enviar e-mail de notificação ao(s) admin(s): sendEmail retornou null (verificar BREVO_API_KEY e logs anteriores)`);
                        }
                    } else {
                        console.warn('⚠️ [AUDITORIA] ADMIN_EMAIL não configurado — e-mail de notificação não enviado');
                    }
                } catch (emailErr) {
                    console.error('⚠️ [AUDITORIA] Falha ao enviar e-mail de notificação ao admin:', emailErr.message);
                }
            } catch (error) {
                console.error('❌ Erro na exclusão geral em segundo plano:', error.message);
            }
        })();
    } catch (error) {
        console.error('❌ Erro ao iniciar exclusão geral:', error.message);
        res.status(500).json({ success: false, error: 'Erro ao iniciar exclusão geral' });
    }
});

// ============================================================
// T001 — AUTENTICAÇÃO ADMIN E AVALIADORES
// ============================================================

app.post('/api/auth/admin', (req, res) => {
    const { password } = req.body;
    const adminPassword = (process.env.ADMIN_PASSWORD || 'admin.dac.ufsc').replace(/^["']|["']$/g, '');
    if (!password) return res.status(400).json({ error: 'Senha obrigatória.' });
    if (password === adminPassword) {
        res.json({ success: true, message: 'Acesso de administrador autorizado.' });
    } else {
        res.status(403).json({ success: false, message: 'Senha incorreta.' });
    }
});

app.post('/api/auth/viewer', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha obrigatórios.' });
    try {
        const raw = redis ? await redis.get('avaliadores') : null;
        const avaliadores = parseRedisValue(raw) || [];
        const emailNormalizado = String(email).trim().toLowerCase();
        const av = avaliadores.find(a => String(a.email || '').trim().toLowerCase() === emailNormalizado);
        if (!av) return res.status(403).json({ success: false, message: 'E-mail não encontrado na lista de avaliadores.' });
        const senhaCorreta = String(av.senha || '');
        if (!senhaCorreta) return res.status(403).json({ success: false, message: 'Este avaliador ainda não possui senha individual. Solicite ao administrador que remova e cadastre o e-mail novamente.' });
        if (String(password) === senhaCorreta) {
            res.json({ success: true, email: av.email, nome: av.nome || av.email });
        } else {
            res.status(403).json({ success: false, message: 'Senha incorreta.' });
        }
    } catch (e) {
        res.status(500).json({ error: 'Erro interno.' });
    }
});
// ============================================================
// T003 — SISTEMA DE AVALIAÇÃO: AVALIADORES
// ============================================================

app.get('/api/evaluators', async (req, res) => {
    try {
        const raw = redis ? await redis.get('avaliadores') : null;
        const lista = parseRedisValue(raw) || [];
        res.json(lista.map(({ id, email, nome }) => ({ id, email, nome })));
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar avaliadores.' });
    }
});

app.post('/api/evaluators', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const nome = String(req.body?.nome || '').trim();
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
    if (!redis) return res.status(503).json({ error: 'Armazenamento de avaliadores indisponível.' });
    try {
        const raw = await redis.get('avaliadores');
        const lista = parseRedisValue(raw) || [];
        if (lista.some(a => String(a.email || '').trim().toLowerCase() === email)) {
            return res.status(409).json({ error: 'Este e-mail já está cadastrado como avaliador. Remova-o antes de cadastrar novamente.' });
        }
        const senha = gerarSenhaAvaliador();
        const nomeFinal = nome || email;
        const novo = { id: `av_${Date.now()}_${randomInt(100000, 1000000)}`, email, nome: nomeFinal, senha };
        const listaAtualizada = [...lista, novo];
        await redis.set('avaliadores', listaAtualizada);
        const origem = obterOrigemPublicaTermo(req);
        const painelUrl = origem ? `${origem}/avaliador` : '';
        const html = `
        <div style='font-family:Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden;color:#333'>
            <div style='background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 28px'>
                <h2 style='margin:0;color:#fff;font-size:20px'>Acesso ao Painel de Avaliadores</h2>
                <p style='margin:6px 0 0;color:rgba(255,255,255,.86);font-size:13px'>DAC — UFSC</p>
            </div>
            <div style='padding:26px 28px;font-size:14px;line-height:1.6'>
                <p>Olá, <strong>${escapeHtml(nomeFinal)}</strong>.</p>
                <p>Seu acesso individual ao Painel de Avaliadores foi criado.</p>
                <div style='background:#f5f3ff;border:1px solid #ddd6fe;border-radius:9px;padding:16px 18px;margin:20px 0'>
                    <p style='margin:0 0 8px'><strong>E-mail:</strong> ${escapeHtml(email)}</p>
                    <p style='margin:0'><strong>Senha individual:</strong> <span style='font-family:monospace;font-size:20px;letter-spacing:2px;color:#5b347f'>${escapeHtml(senha)}</span></p>
                </div>
                ${painelUrl ? `<p>Acesse o painel pelo link: <a href='${painelUrl}'>${painelUrl}</a></p>` : '<p>Acesse o Painel de Avaliadores do DAC para entrar.</p>'}
                <p>Guarde esta senha com segurança. Ela é exclusiva deste e-mail e não deve ser compartilhada.</p>
                <p style='font-size:12px;color:#777'>Se você perder a senha, solicite ao administrador que remova seu cadastro e faça um novo cadastro para gerar outra.</p>
            </div>
        </div>`;
        const enviado = await sendEmail(email, 'Acesso ao Painel de Avaliadores — DAC/UFSC', html);
        if (!enviado) {
            await redis.set('avaliadores', lista);
            return res.status(502).json({ error: 'Não foi possível enviar o e-mail com a senha. O avaliador não foi cadastrado.' });
        }
        res.json({ success: true, count: listaAtualizada.length, emailSent: true, evaluator: { id: novo.id, email: novo.email, nome: novo.nome } });
    } catch (e) {
        console.error('❌ Erro ao cadastrar avaliador:', e.message);
        res.status(500).json({ error: 'Erro ao cadastrar avaliador.' });
    }
});

const removerAvaliador = async (req, res, idRecebido) => {
    const id = String(idRecebido || '').trim();
    if (!id || id === 'undefined' || id === 'null') {
        return res.status(400).json({ success: false, error: 'Identificador do avaliador é obrigatório.' });
    }
    if (!redis) {
        return res.status(503).json({ success: false, error: 'Armazenamento de avaliadores indisponível.' });
    }
    try {
        const raw = await redis.get('avaliadores');
        const lista = parseRedisValue(raw) || [];
        const filtrada = lista.filter(a => a.id !== id);
        if (filtrada.length === lista.length) {
            return res.status(404).json({ success: false, error: 'Avaliador não encontrado. Atualize a lista e tente novamente.' });
        }
        await redis.set('avaliadores', filtrada);
        res.json({ success: true, deletedId: id, count: filtrada.length });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao remover avaliador.' });
    }
};

// O endpoint sem segmento dinâmico é necessário na Vercel: a configuração
// atual encaminha /api/evaluators, mas devolve NOT_FOUND antes do Express para
// /api/evaluators/:id. O endpoint dinâmico permanece para uso local.
app.delete('/api/evaluators', async (req, res) => {
    await removerAvaliador(req, res, req.query?.id || req.body?.id);
});

app.delete('/api/evaluators/:id', async (req, res) => {
    await removerAvaliador(req, res, req.params.id);
});

// ============================================================
// T003 — SISTEMA DE AVALIAÇÃO: CRITÉRIOS
// ============================================================

const CRITERIOS_DEFAULT = [
    { id: 'A', nome: 'Qualidade Artística', peso: 1 },
    { id: 'B', nome: 'Relevância Cultural', peso: 1 },
    { id: 'C', nome: 'Acessibilidade', peso: 1 },
    { id: 'D', nome: 'Viabilidade Técnica', peso: 1 }
];

app.get('/api/criteria', async (req, res) => {
    try {
        const raw = redis ? await redis.get('criterios') : null;
        res.json(parseRedisValue(raw) || CRITERIOS_DEFAULT);
    } catch (e) {
        res.json(CRITERIOS_DEFAULT);
    }
});

app.post('/api/criteria', async (req, res) => {
    const { criteria } = req.body;
    if (!Array.isArray(criteria)) return res.status(400).json({ error: 'Lista de critérios inválida.' });
    try {
        if (redis) await redis.set('criterios', criteria);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao salvar critérios.' });
    }
});

// ============================================================
// T003 — SISTEMA DE AVALIAÇÃO: AVALIAÇÕES
// ============================================================

app.post('/api/save-assessment', async (req, res) => {
    const { inscriptionId, evaluatorEmail, scoresJson } = req.body;
    if (!inscriptionId || !evaluatorEmail || !scoresJson) {
        return res.status(400).json({ error: 'Dados incompletos.' });
    }
    try {
        const key = `avaliacoes_${inscriptionId}`;
        const raw = redis ? await redis.get(key) : null;
        const avaliacoes = parseRedisValue(raw) || [];
        const idx = avaliacoes.findIndex(a => a.evaluatorEmail === evaluatorEmail);
        const entry = { inscriptionId, evaluatorEmail, scoresJson, updatedAt: new Date().toISOString() };
        if (idx >= 0) avaliacoes[idx] = entry; else avaliacoes.push(entry);
        if (redis) await redis.set(key, avaliacoes);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao salvar avaliação.' });
    }
});

app.get('/api/admin/relatorio-avaliacoes', async (req, res) => {
    try {
        const inscricoes = await getAgendamentos();
        const criteriosRaw = redis ? await redis.get('criterios') : null;
        const criterios = parseRedisValue(criteriosRaw) || [
            { id: 'A', nome: 'Qualidade Artística', peso: 1 },
            { id: 'B', nome: 'Relevância Cultural', peso: 1 },
            { id: 'C', nome: 'Acessibilidade', peso: 1 },
            { id: 'D', nome: 'Viabilidade Técnica', peso: 1 }
        ];
        const cfgRaw = redis ? await redis.get('agendamentos_config') : null;
        const cfg = parseRedisValue(cfgRaw) || {};
        const necessarias = parseInt(cfg.avaliacoesNecessarias || 3);
        const pesoTotal = criterios.reduce((s, c) => s + (parseFloat(c.peso) || 1), 0) || 1;

        const linhas = [];
        for (const p of inscricoes) {
            const id = p.id || p.email;
            if (!id) continue;
            const avRaw = redis ? await redis.get(`avaliacoes_${id}`) : null;
            const avaliacoes = parseRedisValue(avRaw) || [];

            const detalhesPorCriterio = {};
            criterios.forEach(c => { detalhesPorCriterio[c.id] = { nome: c.nome, peso: parseFloat(c.peso) || 1, soma: 0, n: 0 }; });

            let totalPontos = 0;
            avaliacoes.forEach(av => {
                const sc = av.scoresJson || {};
                criterios.forEach(c => {
                    const nota = parseFloat(sc[c.id] || 0);
                    totalPontos += nota * (parseFloat(c.peso) || 1);
                    if (nota > 0) {
                        detalhesPorCriterio[c.id].soma += nota;
                        detalhesPorCriterio[c.id].n += 1;
                    }
                });
            });

            const mediaFinal = avaliacoes.length > 0
                ? +(totalPontos / avaliacoes.length / pesoTotal).toFixed(2)
                : null;

            const mediasPorCriterio = {};
            Object.entries(detalhesPorCriterio).forEach(([cid, d]) => {
                mediasPorCriterio[cid] = {
                    nome: d.nome,
                    peso: d.peso,
                    media: d.n > 0 ? +(d.soma / d.n).toFixed(2) : null
                };
            });

            const avaliadoresList = avaliacoes.map(a => a.evaluatorEmail).filter(Boolean);
            const statusAvaliacao = avaliacoes.length === 0
                ? 'Sem avaliações'
                : (avaliacoes.length >= necessarias ? 'Concluída' : 'Em andamento');

            linhas.push({
                id,
                evento: p.evento || '',
                proponente: p.nome || '',
                email: p.email || '',
                local: p.localNome || p.local || '',
                qtdAvaliacoes: avaliacoes.length,
                necessarias,
                statusAvaliacao,
                mediaFinal,
                mediasPorCriterio,
                avaliadores: avaliadoresList
            });
        }

        linhas.sort((a, b) => {
            if (a.mediaFinal === null && b.mediaFinal === null) return 0;
            if (a.mediaFinal === null) return 1;
            if (b.mediaFinal === null) return -1;
            return b.mediaFinal - a.mediaFinal;
        });

        res.json({
            criterios: criterios.map(c => ({ id: c.id, nome: c.nome, peso: parseFloat(c.peso) || 1 })),
            necessarias,
            total: linhas.length,
            avaliadas: linhas.filter(l => l.qtdAvaliacoes > 0).length,
            ranking: linhas
        });
    } catch (e) {
        console.error('[/api/admin/relatorio-avaliacoes] erro:', e);
        res.status(500).json({ error: 'Erro ao gerar relatório de avaliações.' });
    }
});

app.get('/api/assessments/:inscriptionId', async (req, res) => {
    const { inscriptionId } = req.params;
    try {
        const key = `avaliacoes_${inscriptionId}`;
        const raw = redis ? await redis.get(key) : null;
        res.json(parseRedisValue(raw) || []);
    } catch (e) {
        res.status(500).json({ error: 'Erro ao buscar avaliações.' });
    }
});

// ============================================================
// T004a — EDIÇÃO DE ETAPAS (via painel admin)
// ============================================================

// ---- Helpers para etapas de inscrições legadas (Forms-only) ----
async function getLegadasEtapas() {
    try {
        const raw = await redis.get('agendamentos_legadas_etapas');
        return parseRedisValue(raw) || {};
    } catch { return {}; }
}
async function setLegadaEtapas(id, etapas) {
    const map = await getLegadasEtapas();
    map[id] = etapas;
    await redis.set('agendamentos_legadas_etapas', JSON.stringify(map));
}

const TERMOS_LEGADAS_KEY = 'termos_assinados_legadas';
async function getTermosLegadas() {
    try {
        if (!redis) return {};
        const raw = await redis.get(TERMOS_LEGADAS_KEY);
        return parseRedisValue(raw) || {};
    } catch { return {}; }
}
async function saveTermoLegada(id, dados) {
    try {
        if (!redis) return false;
        const map = await getTermosLegadas();
        map[id] = dados;
        await redis.set(TERMOS_LEGADAS_KEY, JSON.stringify(map));
        return true;
    } catch (e) {
        console.error('❌ [Redis] Erro ao salvar termo legado:', e.message);
        return false;
    }
}

app.post('/api/admin/atualizar-termo', async (req, res) => {
    const { id, termoDados, marcarConcluido = true } = req.body || {};
    if (!id || !termoDados || typeof termoDados !== 'object' || Array.isArray(termoDados)) {
        return res.status(400).json({ error: 'ID e dados do termo são obrigatórios.' });
    }

    const camposPermitidos = [
        'espacoTeatro', 'espacoIgreja', 'nomeEvento', 'dataHorarioEvento',
        'outrasInformacoes', 'nomeCompleto', 'cpfCnpj', 'rg', 'telefone',
        'email', 'endereco', 'numero', 'apartamento', 'bairro', 'cidade'
    ];
    const dadosLimpos = {};
    camposPermitidos.forEach(campo => {
        const valor = termoDados[campo];
        if (typeof valor === 'boolean' || typeof valor === 'string') {
            dadosLimpos[campo] = typeof valor === 'string' ? valor.trim() : valor;
        }
    });

    try {
        if (String(id).startsWith('forms_')) {
            const termos = await getTermosLegadas();
            const anterior = termos[String(id)] || {};
            const success = await saveTermoLegada(String(id), {
                ...anterior,
                termoAssinado: marcarConcluido === true,
                termoDados: dadosLimpos
            });
            if (!success) return res.status(500).json({ error: 'Não foi possível salvar o termo legado.' });
            return res.json({ success: true, termoAssinado: marcarConcluido === true });
        }

        const agendamentos = await getAgendamentos();
        const agendamento = agendamentos.find(item => String(item.id) === String(id));
        if (!agendamento) return res.status(404).json({ error: 'Inscrição não encontrada.' });

        const success = await updateAgendamento(id, {
            termoAssinado: marcarConcluido === true,
            termoDados: dadosLimpos
        });
        if (!success) return res.status(500).json({ error: 'Não foi possível salvar o termo.' });
        return res.json({ success: true, termoAssinado: marcarConcluido === true });
    } catch (e) {
        console.error('❌ [/api/admin/atualizar-termo] erro:', e.message);
        return res.status(500).json({ error: 'Erro interno ao salvar o termo.' });
    }
});

app.post('/api/admin/atualizar-etapas', async (req, res) => {
    const { id, ...campos } = req.body;
    if (!id || Object.keys(campos).length === 0) {
        return res.status(400).json({ error: 'ID e campos para atualizar são obrigatórios.' });
    }

    // Inscrições legadas (Forms-only) têm IDs "forms_..." — salvar em chave separada
    if (String(id).startsWith('forms_')) {
        if (campos.etapas !== undefined) {
            await setLegadaEtapas(id, campos.etapas);
        }
        return res.json({ success: true });
    }

    // Buscar agendamento atual antes de atualizar (para ter email, evento, calendarId)
    const agendamentos = await getAgendamentos();
    const ag = agendamentos.find(a => a.id === id);
    if (!ag) return res.status(404).json({ error: 'Agendamento não encontrado.' });

    // Salvar no Redis e responder imediatamente
    const success = await updateAgendamento(id, campos);
    if (!success) return res.status(500).json({ error: 'Erro ao salvar no banco de dados.' });

    // Responde ao cliente imediatamente — Calendar é atualizado em segundo plano
    res.json({ success: true });

    // Atualizar Google Calendar de forma assíncrona (sem bloquear a resposta)
    if (campos.etapas) {
        (async () => {
            try {
                if (!googleAuthClient) await initGoogleAuth();
                const calId = ag.calendarId || CALENDAR_IDS[(ag.local || 'teatro').toLowerCase()] || CALENDAR_IDS.teatro;
                const nomesEtapas = { ensaio: 'Ensaio', montagem: 'Montagem', evento: 'Evento', desmontagem: 'Desmontagem' };

                const listResp = await calendar.events.list({
                    auth: googleAuthClient,
                    calendarId: calId,
                    maxResults: 2500,
                    singleEvents: true
                });
                const allEvents = listResp.data.items || [];

                // ── Helper: título esperado de um evento ──────────────────────
                const makeTitle = (key, idx, total) => {
                    const label = total > 1 ? `${nomesEtapas[key] || key} ${idx + 1}` : (nomesEtapas[key] || key);
                    return `${label}: ${ag.evento}`;
                };

                // ── Coletar títulos que PERMANECEM (novas etapas) ─────────────
                const titulosRestantes = new Set();
                for (const key in campos.etapas) {
                    const itens = Array.isArray(campos.etapas[key]) ? campos.etapas[key] : [campos.etapas[key]];
                    itens.forEach((it, i) => { if (it && it.data) titulosRestantes.add(makeTitle(key, i, itens.length)); });
                }

                // ── Excluir do Calendar eventos que foram REMOVIDOS ───────────
                const etapasAntigas = ag.etapas || {};
                for (const key in etapasAntigas) {
                    const itens = Array.isArray(etapasAntigas[key]) ? etapasAntigas[key] : [etapasAntigas[key]];
                    for (let i = 0; i < itens.length; i++) {
                        const titulo = makeTitle(key, i, itens.length);
                        if (titulosRestantes.has(titulo)) continue; // ainda existe — não excluir
                        const match = allEvents.find(e =>
                            e.summary === titulo &&
                            e.description && e.description.includes(ag.email)
                        );
                        if (match) {
                            try {
                                await calendar.events.delete({ auth: googleAuthClient, calendarId: calId, eventId: match.id });
                                console.log(`🗑️ [Calendar] Evento excluído: "${titulo}"`);
                            } catch (e) {
                                console.error(`❌ [Calendar] Erro ao excluir "${titulo}":`, e.message);
                            }
                        } else {
                            console.warn(`⚠️ [Calendar] Evento a excluir não encontrado: "${titulo}"`);
                        }
                    }
                }

                // ── Atualizar data/hora dos eventos que PERMANECEM ────────────
                for (const key in campos.etapas) {
                    const itens = Array.isArray(campos.etapas[key]) ? campos.etapas[key] : [campos.etapas[key]];
                    for (let i = 0; i < itens.length; i++) {
                        const it = itens[i];
                        if (!it || !it.data || !it.horario) continue;
                        const titulo = makeTitle(key, i, itens.length);
                        const match = allEvents.find(e =>
                            e.summary === titulo &&
                            e.description && e.description.includes(ag.email)
                        );
                        if (!match) {
                            console.warn(`⚠️ [Calendar] Evento não encontrado para atualizar: "${titulo}"`);
                            continue;
                        }
                        const [startTime, endTime] = it.horario.split(' às ');
                        const startDT = `${it.data}T${startTime}:00-03:00`;
                        const endDT   = `${it.data}T${endTime}:00-03:00`;
                        try {
                            await calendar.events.patch({
                                auth: googleAuthClient,
                                calendarId: calId,
                                eventId: match.id,
                                resource: {
                                    start: { dateTime: startDT, timeZone: 'America/Sao_Paulo' },
                                    end:   { dateTime: endDT,   timeZone: 'America/Sao_Paulo' }
                                }
                            });
                            console.log(`✅ [Calendar] Evento atualizado: "${titulo}" → ${it.data} ${it.horario}`);
                        } catch (e) {
                            console.error(`❌ [Calendar] Erro ao atualizar "${titulo}":`, e.message);
                        }
                    }
                }
            } catch (e) {
                console.error('❌ [Calendar] Erro geral ao atualizar eventos:', e.message);
            }
        })();
    }
});

// Envio manual e registro da mensagem de divulgação institucional.
app.post('/api/admin/enviar-divulgacao', async (req, res) => {
    const { id, mensagem } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID da inscrição não fornecido.' });
    try {
        const agendamento = (await getAgendamentos()).find(item => String(item.id) === String(id));
        if (!agendamento) return res.status(404).json({ error: 'Inscrição não encontrada.' });
        if (!termoAutorizacaoCompleto(agendamento)) {
            return res.status(409).json({
                error: 'A divulgação institucional só pode ser enviada depois que o termo de autorização estiver completo.'
            });
        }
        const email = String(agendamento.email || '').trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'A inscrição não possui um e-mail válido para envio.' });
        }
        const configs = await getConfigs('envio manual divulgação institucional');
        const mensagemFinal = String(mensagem || '').trim() || obterMensagemDivulgacao(configs);
        const primeiroEvento = obterInicioDoPrimeiroEvento(agendamento);
        const resultado = await enviarDivulgacaoInstitucional(agendamento, mensagemFinal, 'manual');
        if (!resultado) return res.status(502).json({ error: 'Não foi possível enviar o e-mail de divulgação.' });
        if (redis && primeiroEvento) {
            await registrarDivulgacaoInstitucionalEnviada(agendamento, primeiroEvento, {
                status: 'sent', origem: 'manual', email,
                enviadoEm: new Date().toISOString(),
                primeiroEvento: primeiroEvento.inicioDate.toISOString(), mensagem: mensagemFinal
            });
        }
        res.json({ success: true, email, messageId: resultado.messageId || null });
    } catch (error) {
        console.error('❌ [Divulgação] Erro no envio manual:', error.message);
        res.status(500).json({ error: 'Erro ao enviar o e-mail de divulgação.' });
    }
});

// ============================================================
// T004b — EMAIL RÁPIDO PARA PROPONENTE (via painel admin)
// ============================================================

app.post('/api/admin/email-rapido', async (req, res) => {
    const { to, nome, assunto, mensagem, linkLabel, linkUrl } = req.body;
    if (!to || !assunto || !mensagem) {
        return res.status(400).json({ error: 'Destinatário, assunto e mensagem são obrigatórios.' });
    }
    const apiKey = limparConfiguracaoBrevo(process.env.BREVO_API_KEY);
    const senderEmail = obterRemetenteBrevo();
    if (!apiKey) return res.status(500).json({ error: 'Serviço de e-mail não configurado.' });

    const mensagemEscapada = escapeHtml(mensagem).replace(/\n/g, '<br>');
    const mensagemHtml = linkLabel && linkUrl
        ? mensagemEscapada.replace(
            escapeHtml(linkLabel),
            `<a href="${escapeHtml(linkUrl)}" style="color:#2563eb;font-weight:600;text-decoration:underline" target="_blank" rel="noopener noreferrer">${escapeHtml(linkLabel)}</a>`
        )
        : mensagemEscapada;

    const htmlContent = `
    <div style="font-family:sans-serif;max-width:620px;margin:auto;border:1px solid #ddd;border-radius:10px;overflow:hidden;color:#333">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:22px 28px">
            <h2 style="margin:0;color:#fff;font-size:18px">DAC — Departamento Artístico Cultural</h2>
            <p style="margin:4px 0 0;color:rgba(255,255,255,.8);font-size:12px">UFSC — Secretaria de Cultura, Arte e Esporte</p>
        </div>
        <div style="padding:28px">
            <p style="font-size:15px">Olá, <strong>${nome || 'Proponente'}</strong>!</p>
            <div style="font-size:14px;color:#444;line-height:1.8;margin:18px 0;white-space:pre-wrap">${mensagemHtml}</div>
            <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
            <p style="font-size:13px;color:#555">Em caso de dúvidas, entre em contato diretamente com a equipe do DAC pelo e-mail <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold;">pautas.dac@contato.ufsc.br</a>.</p>
            <p style="font-size:11px;color:#aaa;margin-top:20px">
                UFSC — Secretaria de Cultura, Arte e Esporte · Departamento Artístico Cultural (DAC)<br>
                Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC
            </p>
        </div>
    </div>`;

    try {
        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: BREVO_SENDER_NAME, email: senderEmail },
            to: [{ email: to, name: nome || to }],
            replyTo: { email: BREVO_REPLY_TO, name: BREVO_SENDER_NAME },
            subject: assunto,
            htmlContent
        }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } });
        console.log(`✅ E-mail rápido enviado para ${to}`);
        res.json({ success: true });
    } catch (e) {
        console.error(`❌ Erro ao enviar e-mail rápido para ${to}:`, e.response?.data || e.message);
        res.status(500).json({ error: e.response?.data?.message || e.message });
    }
});

// ============================================================
// T005 — ENVIO DE TERMOS DIGITAIS POR E-MAIL (BREVO)
// ============================================================

app.post('/api/enviar-termos-digitais', async (req, res) => {
    const { inscricoes } = req.body;
    if (!Array.isArray(inscricoes) || inscricoes.length === 0) {
        return res.status(400).json({ error: 'Nenhuma inscrição selecionada.' });
    }
    const apiKey = limparConfiguracaoBrevo(process.env.BREVO_API_KEY);
    const senderEmail = obterRemetenteBrevo();
    if (!apiKey) return res.status(500).json({ error: 'Serviço de e-mail não configurado.' });

    const locaisNomes = { teatro: 'Teatro Carmen Fossari', igrejinha: 'Igrejinha da UFSC' };
    let enviados = 0, erros = 0;

    for (const insc of inscricoes) {
        const { nome, email, evento, local } = insc;
        if (!email) { erros++; continue; }
        const localNome = locaisNomes[(local || 'teatro').toLowerCase()] || 'Teatro Carmen Fossari';

        const htmlContent = `
        <div style="font-family: sans-serif; max-width: 650px; margin: auto; border: 1px solid #ddd; padding: 30px; border-radius: 10px; color: #333;">
            <div style="text-align: center; margin-bottom: 25px;">
                <h2 style="color: #764ba2;">Termo de Autorização para Ocupação de Espaço</h2>
                <p style="color: #666; font-size: 13px;">UFSC — Departamento Artístico Cultural (DAC)</p>
            </div>
            <p>Olá, <strong>${nome || 'Proponente'}</strong>,</p>
            <p>Sua proposta <strong>"${evento || 'N/A'}"</strong> foi selecionada para o uso do espaço <strong>${localNome}</strong>.</p>
            <p>Para formalizar a ocupação, é necessário que você assine digitalmente o <strong>Termo de Autorização de Ocupação dos Espaços do DAC</strong>.</p>
            <div style="background: #f8f9fa; border: 1px solid #eee; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <h3 style="margin-top: 0; font-size: 15px; color: #333;">Próximos passos:</h3>
                <ol style="font-size: 14px; line-height: 2;">
                    <li>Acesse o link de assinatura que será enviado em seguida pela equipe do DAC.</li>
                    <li>Leia atentamente todas as cláusulas do termo.</li>
                    <li>Assine digitalmente e envie de volta para confirmação.</li>
                </ol>
            </div>
            <p>Em caso de dúvidas, entre em contato diretamente com a equipe do DAC pelo e-mail <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold;">pautas.dac@contato.ufsc.br</a>.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 25px 0;">
            <p style="font-size: 12px; color: #888;">
                UFSC — Secretaria de Cultura, Arte e Esporte<br>
                Departamento Artístico Cultural (DAC)<br>
                Praça Santos Dumont — Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC
            </p>
        </div>`;

        const htmlAdmin = `
        <div style="font-family:sans-serif;max-width:650px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden;color:#333">
            <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 28px;text-align:center">
                <h2 style="margin:0;color:#fff;font-size:19px">Termo de Autorização enviado</h2>
                <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">Notificação administrativa — DAC/UFSC</p>
            </div>
            <div style="padding:28px">
                <p style="font-size:15px;margin-top:0">O Termo de Autorização foi enviado ao proponente para leitura e assinatura digital.</p>
                <div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin:20px 0">
                    <p style="margin:0 0 8px;font-size:13px;color:#555"><strong>Proponente:</strong> ${escapeHtml(nome || 'N/A')}</p>
                    <p style="margin:0 0 8px;font-size:13px;color:#555"><strong>E-mail:</strong> ${escapeHtml(email)}</p>
                    <p style="margin:0 0 8px;font-size:13px;color:#555"><strong>Evento:</strong> ${escapeHtml(evento || 'N/A')}</p>
                    <p style="margin:0;font-size:13px;color:#555"><strong>Local:</strong> ${escapeHtml(localNome)}</p>
                </div>
                <p style="font-size:13px;color:#555;line-height:1.6;margin:0">A mensagem completa, com o link para abrir o termo, foi encaminhada somente ao proponente.</p>
            </div>
        </div>`;

        try {
            await axios.post('https://api.brevo.com/v3/smtp/email', {
                sender: { name: BREVO_SENDER_NAME, email: senderEmail },
                to: [{ email: email, name: nome || email }],
                replyTo: { email: BREVO_REPLY_TO, name: BREVO_SENDER_NAME },
                subject: `Termo de Autorização — ${evento || 'Seu Projeto'} — DAC/UFSC`,
                htmlContent
            }, {
                headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }
            });
            enviados++;
            console.log(`✅ Termo enviado para ${email}`);
            try {
                await axios.post('https://api.brevo.com/v3/smtp/email', {
                    sender: { name: BREVO_SENDER_NAME, email: senderEmail },
                    to: [{ email: 'pautas.dac@contato.ufsc.br', name: 'DAC - UFSC' }],
                    replyTo: { email: BREVO_REPLY_TO, name: BREVO_SENDER_NAME },
                    subject: `📩 Termo enviado: ${evento || 'Seu Projeto'} — ${nome || ''} — DAC/UFSC`,
                    htmlContent: htmlAdmin
                }, {
                    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }
                });
                console.log(`✅ Notificação administrativa do termo enviada para ${email}`);
            } catch (adminError) {
                console.error(`⚠️ Termo enviado para ${email}, mas a notificação ao DAC falhou:`, adminError.response?.data || adminError.message);
            }
        } catch (e) {
            erros++;
            console.error(`❌ Erro ao enviar termo para ${email}:`, e.response?.data || e.message);
        }
    }

    res.json({ success: true, enviados, erros, total: inscricoes.length });
});

// ============================================================
// T005b — ENVIO DO TERMO ASSINADO EM PDF
// ============================================================

app.post('/api/enviar-termo-assinado', async (req, res) => {
    const { id, email, nome, evento, fileName, pdfBase64, termoDados } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const apiKey = limparConfiguracaoBrevo(process.env.BREVO_API_KEY);
    const senderEmail = obterRemetenteBrevo();

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: 'Informe um e-mail válido para o envio.' });
    }
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
        return res.status(400).json({ error: 'O PDF assinado não foi recebido.' });
    }
    if (!apiKey) {
        return res.status(500).json({ error: 'Serviço de e-mail não configurado.' });
    }

    // Quando o termo veio de uma inscrição, o destinatário deve ser o e-mail original.
    if (id) {
        const inscricoes = await getAgendamentos();
        const inscricao = inscricoes.find(item => String(item.id) === String(id))
            || await buscarDadosInscricaoForms(String(id));
        if (!inscricao) {
            return res.status(404).json({ error: 'Inscrição não encontrada.' });
        }
        const emailOriginal = String(inscricao.email || '').trim().toLowerCase();
        if (emailOriginal && emailOriginal !== normalizedEmail) {
            return res.status(400).json({ error: 'O e-mail informado não corresponde ao e-mail da inscrição.' });
        }
    }

    const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, '').replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
        return res.status(400).json({ error: 'Formato do PDF inválido.' });
    }

    const pdfBuffer = Buffer.from(cleanBase64, 'base64');
    if (pdfBuffer.length === 0 || pdfBuffer.length > 8 * 1024 * 1024) {
        return res.status(400).json({ error: 'O PDF precisa ter entre 1 byte e 8 MB.' });
    }

    const safeFileName = String(fileName || 'Termo_DAC_2026.pdf')
        .replace(/[^a-zA-Z0-9_.-]/g, '_')
        .slice(0, 180) || 'Termo_DAC_2026.pdf';
    const nomeSeguro = escapeHtml(nome || 'Proponente');
    const eventoSeguro = escapeHtml(evento || 'Seu projeto');
    const emailSeguro = escapeHtml(normalizedEmail);
    const idSeguro = escapeHtml(id || 'Não informado');
    const dataEventoSeguro = escapeHtml(termoDados?.dataHorarioEvento || 'Não informado');
    const attachment = [{
        content: pdfBuffer.toString('base64'),
        name: safeFileName
    }];

    const htmlContent = `
    <div style="font-family:sans-serif;max-width:650px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden;color:#333">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 28px">
            <h2 style="margin:0;color:#fff;font-size:19px">Termo de Autorização Assinado</h2>
            <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:13px">UFSC — Departamento Artístico Cultural (DAC)</p>
        </div>
        <div style="padding:26px 28px">
            <p style="font-size:15px">Olá, <strong>${nomeSeguro}</strong>!</p>
            <p style="font-size:14px;color:#555;line-height:1.7">
                Conforme sua autorização, segue em anexo o PDF do Termo de Autorização assinado digitalmente
                referente ao evento <strong>${eventoSeguro}</strong>.
            </p>
            <p style="font-size:13px;color:#666">O mesmo documento foi encaminhado ao DAC para registro.</p>
            <p style="font-size:13px;color:#555">Em caso de dúvidas, entre em contato com
                <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold">pautas.dac@contato.ufsc.br</a>.
            </p>
            <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
            <p style="font-size:11px;color:#aaa">
                UFSC — Secretaria de Cultura, Arte e Esporte · Departamento Artístico Cultural (DAC)<br>
                Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC
            </p>
        </div>
    </div>`;

    const textContentProponente = [
        `Olá, ${nome || 'Proponente'}!`,
        '',
        `Conforme sua autorização, segue em anexo o PDF do Termo de Autorização assinado digitalmente referente ao evento ${evento || 'Seu projeto'}.`,
        'O mesmo documento foi encaminhado ao DAC para registro.',
        '',
        'Em caso de dúvidas, entre em contato com pautas.dac@contato.ufsc.br.'
    ].join('\n');

    const htmlContentDac = `
    <div style="font-family:sans-serif;max-width:650px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden;color:#333">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 28px">
            <h2 style="margin:0;color:#fff;font-size:19px">Termo de Autorização Assinado</h2>
            <p style="margin:6px 0 0;color:rgba(255,255,255,.85);font-size:13px">Notificação administrativa — DAC/UFSC</p>
        </div>
        <div style="padding:26px 28px">
            <p style="font-size:15px">O proponente preencheu, confirmou ciência e enviou o Termo de Autorização assinado digitalmente.</p>
            <div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin:20px 0">
                <p style="margin:0 0 8px;font-size:13px"><strong>Proponente:</strong> ${nomeSeguro}</p>
                <p style="margin:0 0 8px;font-size:13px"><strong>E-mail:</strong> ${emailSeguro}</p>
                <p style="margin:0 0 8px;font-size:13px"><strong>Evento:</strong> ${eventoSeguro}</p>
                <p style="margin:0 0 8px;font-size:13px"><strong>Data/horário informado:</strong> ${dataEventoSeguro}</p>
                <p style="margin:0;font-size:13px"><strong>Identificador da inscrição:</strong> ${idSeguro}</p>
            </div>
            <p style="font-size:14px;color:#555;line-height:1.7">O PDF assinado segue anexado para registro e continuidade da análise pela equipe do DAC.</p>
            <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
            <p style="font-size:11px;color:#aaa">
                UFSC — Secretaria de Cultura, Arte e Esporte · Departamento Artístico Cultural (DAC)<br>
                Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC
            </p>
        </div>
    </div>`;

    const textContentDac = [
        'Termo de Autorização Assinado — Notificação administrativa DAC/UFSC',
        '',
        'O proponente preencheu, confirmou ciência e enviou o Termo de Autorização assinado digitalmente.',
        '',
        `Proponente: ${nome || 'Não informado'}`,
        `E-mail: ${normalizedEmail}`,
        `Evento: ${evento || 'Não informado'}`,
        `Data/horário informado: ${termoDados?.dataHorarioEvento || 'Não informado'}`,
        `Identificador da inscrição: ${id || 'Não informado'}`,
        '',
        'O PDF assinado segue anexado para registro e continuidade da análise pela equipe do DAC.'
    ].join('\n');

    try {
        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: BREVO_SENDER_NAME, email: senderEmail },
            to: [{ email: normalizedEmail, name: nome || normalizedEmail }],
            replyTo: { email: BREVO_REPLY_TO, name: BREVO_SENDER_NAME },
            subject: `📄 Termo Assinado — ${evento || 'Projeto DAC'} — DAC/UFSC`,
            htmlContent,
            textContent: textContentProponente,
            attachment
        }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } });

        let dacEmailSent = true;
        try {
            await axios.post('https://api.brevo.com/v3/smtp/email', {
                sender: { name: BREVO_SENDER_NAME, email: senderEmail },
                to: [{ email: BREVO_REPLY_TO, name: 'DAC - UFSC' }],
                replyTo: { email: BREVO_REPLY_TO, name: BREVO_SENDER_NAME },
                subject: `✅ Termo assinado — ${evento || 'Projeto DAC'} — ${nome || 'Proponente'}`,
                htmlContent: htmlContentDac,
                textContent: textContentDac,
                attachment
            }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } });
            console.log(`✅ [Termo] Notificação administrativa enviada para o DAC: ${normalizedEmail}`);
        } catch (e) {
            dacEmailSent = false;
            console.error(`❌ [Termo] PDF enviado ao proponente, mas falha ao notificar o DAC:`, e.response?.data || e.message);
        }

        let statusSaved = true;
        let calendarDescriptionUpdated = null;
        if (id) {
            const camposPermitidos = [
                'espacoTeatro', 'espacoIgreja', 'nomeEvento', 'dataHorarioEvento',
                'outrasInformacoes', 'nomeCompleto', 'cpfCnpj', 'rg', 'telefone',
                'email', 'endereco', 'numero', 'apartamento', 'bairro', 'cidade'
            ];
            const dadosSalvos = {};
            if (termoDados && typeof termoDados === 'object') {
                camposPermitidos.forEach(campo => {
                    if (typeof termoDados[campo] === 'string' || typeof termoDados[campo] === 'boolean') {
                        dadosSalvos[campo] = termoDados[campo];
                    }
                });
            }
            const dadosTermo = {
                termoAssinado: true,
                termoAssinadoEm: new Date().toISOString(),
                termoDados: dadosSalvos
            };
            statusSaved = String(id).startsWith('forms_')
                ? await saveTermoLegada(String(id), dadosTermo)
                : await updateAgendamento(id, dadosTermo);
            if (!statusSaved) {
                console.error(`❌ [Termo] PDF enviado, mas não foi possível salvar termoAssinado para a inscrição ${id}.`);
            }

            if (statusSaved && !String(id).startsWith('forms_')) {
                const agendamento = (await getAgendamentos())
                    .find(item => String(item.id) === String(id));
                if (agendamento?.inscricaoTeste === true) {
                    const sinopse = String(agendamento.segundaEtapaTeste?.sinopse || '').trim();
                    if (sinopse) {
                        const resultado = await atualizarDescricaoEventosInscricao(
                            agendamento,
                            `Sinopse/descrição da proposta:\n${sinopse}`
                        );
                        calendarDescriptionUpdated = resultado.total > 0
                            && resultado.updated === resultado.total;
                    } else {
                        calendarDescriptionUpdated = false;
                        console.warn(`⚠️ [Calendar] Inscrição unificada ${id} sem sinopse salva; descrição não alterada.`);
                    }
                }
            }
        }

        console.log(`✅ Termo assinado enviado para ${normalizedEmail}; notificação administrativa separada: ${dacEmailSent ? 'enviada' : 'falhou'}`);
        res.json({ success: true, statusSaved, dacEmailSent, calendarDescriptionUpdated });
    } catch (e) {
        console.error(`❌ Erro ao enviar termo assinado para ${normalizedEmail}:`, e.response?.data || e.message);
        res.status(500).json({ error: e.response?.data?.message || 'Não foi possível enviar o PDF por e-mail.' });
    }
});

app.post('/api/enviar-links-termo', async (req, res) => {
    const { emails, observacao, baseUrl, id: requestedId } = req.body || {};
    if ((!Array.isArray(emails) || emails.length === 0) && !requestedId) {
        return res.status(400).json({ error: 'Nenhum e-mail ou inscrição informada.' });
    }
    const apiKey = limparConfiguracaoBrevo(process.env.BREVO_API_KEY);
    const senderEmail = obterRemetenteBrevo();
    if (!apiKey) return res.status(500).json({ error: 'Serviço de e-mail não configurado.' });

    const inscricoes = await getAgendamentos();
    const origin = obterOrigemPublicaTermo(req, baseUrl);
    if (!origin) {
        return res.status(400).json({
            error: 'O envio do termo precisa ser feito pela aplicação publicada. O endereço de preview do Replit não pode ser usado no link enviado.'
        });
    }

    let enviados = 0, erros = 0;
    const naoEncontrados = [];
    const detalhes = [];

    const emailSolicitado = Array.isArray(emails) ? String(emails[0] || '').trim().toLowerCase() : '';
    const destinatarios = requestedId
        ? [{ id: String(requestedId), email: emailSolicitado }]
        : emails.map(email => ({ id: '', email }));

    for (const destinatario of destinatarios) {
        const email = String(destinatario.email || '').trim().toLowerCase();
        const idSolicitado = String(destinatario.id || '').trim();
        if (!email && !idSolicitado) continue;
        let insc = idSolicitado
            ? (inscricoes.find(p => String(p.id) === idSolicitado) || await buscarDadosInscricaoForms(idSolicitado))
            : inscricoes.find(p => (p.email || '').trim().toLowerCase() === email)
                || await buscarInscricaoFormsPorEmail(email);
        if (!insc && idSolicitado && email) {
            insc = inscricoes.find(p => (p.email || '').trim().toLowerCase() === email)
                || await buscarInscricaoFormsPorEmail(email);
        }
        if (!insc) {
            naoEncontrados.push(email || idSolicitado);
            detalhes.push({ email: email || null, id: idSolicitado || null, status: 'nao_encontrado' });
            continue;
        }

        const { nome, evento, localNome, local, id } = insc;
        const emailDestino = String(insc.email || email).trim().toLowerCase();
        if (!emailDestino) {
            naoEncontrados.push(id);
            detalhes.push({ email: null, id, status: 'sem_email' });
            continue;
        }
        const localExibir = localNome || (local === 'igrejinha' ? 'Igrejinha da UFSC' : 'Teatro Carmen Fossari');
        const termoUrl = `${origin}/termo?id=${encodeURIComponent(id)}`;

        const observacaoLimpa = escapeHtml(observacao || '').replace(/\n/g, '<br>');
        const obsBlock = observacaoLimpa ? `
            <div style="background:#f8f9fa;border-left:3px solid #764ba2;padding:12px 14px;margin:20px 0">
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#555">Mensagem da equipe do DAC</p>
                <p style="margin:0;font-size:14px;color:#555;line-height:1.6">${observacaoLimpa}</p>
            </div>` : '';

        const htmlContent = `
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;border:1px solid #ddd;border-radius:8px;overflow:hidden;color:#333">
            <div style="background:#f7f7fb;padding:20px 24px;border-bottom:1px solid #e5e7eb">
                <h2 style="margin:0;color:#4b3b80;font-size:19px">DAC — Departamento Artístico Cultural</h2>
                <p style="margin:6px 0 0;color:#666;font-size:12px">UFSC — Secretaria de Cultura, Arte e Esporte</p>
            </div>
            <div style="padding:24px">
                <p style="font-size:15px">Olá, <strong>${escapeHtml(nome || 'Proponente')}</strong>,</p>
                <p style="font-size:14px;color:#555;line-height:1.7">
                    Informamos que sua proposta inscrita no <strong>Edital nº 002/2026/DAC/SeCArtE/UFSC</strong> foi homologada.
                </p>
                <p style="font-size:14px;color:#555;line-height:1.7">
                    Conforme previsto no item <strong>13.1.1 do Edital</strong>, encaminhamos, abaixo, o link para acesso ao <strong>Termo de Autorização para Ocupação dos Espaços do DAC</strong>.
                </p>
                <p style="font-size:14px;color:#555;line-height:1.7">
                    Solicitamos, por gentileza, que os dados referentes à reserva sejam conferidos e, após a leitura dos termos e condições para utilização do espaço, que seja assinalada a opção de ciência do Termo, a fim de que possamos dar continuidade ao processo de reserva.
                </p>
                <p style="font-size:14px;color:#555;line-height:1.7;margin-bottom:20px">
                    Permanecemos à disposição para quaisquer esclarecimentos.<br><br>
                    Atenciosamente,<br>
                    <strong>Equipe DAC</strong>
                </p>
                <div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:6px;padding:14px 16px;margin:18px 0">
                    <p style="margin:0 0 6px;font-size:13px;color:#666"><strong>Evento:</strong> ${escapeHtml(evento || 'N/A')}</p>
                    <p style="margin:0;font-size:13px;color:#666"><strong>Local:</strong> ${escapeHtml(localExibir)}</p>
                </div>
                ${obsBlock}
                <div style="text-align:center;margin:26px 0 22px">
                    <a href="${escapeHtml(termoUrl)}" style="display:inline-block;background-color:#5b3f92;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:1;padding:15px 25px;border-radius:6px;box-shadow:0 2px 5px rgba(91,63,146,.25)">Abrir o Termo Digital</a>
                </div>
                <p style="font-size:13px;color:#555">Em caso de dúvidas, entre em contato diretamente com a equipe do DAC pelo e-mail <a href="mailto:pautas.dac@contato.ufsc.br" style="color:#764ba2;font-weight:bold;">pautas.dac@contato.ufsc.br</a>.</p>
                <hr style="border:0;border-top:1px solid #eee;margin:24px 0">
                <p style="font-size:11px;color:#aaa;text-align:center">
                    UFSC — Secretaria de Cultura, Arte e Esporte · Departamento Artístico Cultural (DAC)<br>
                    Rua Desembargador Vitor Lima, 117 — Trindade — CEP 88040-400 — Florianópolis/SC
                </p>
            </div>
        </div>`;

        const textContent = [
            `Olá, ${nome || 'Proponente'},`,
            '',
            'Informamos que sua proposta inscrita no Edital nº 002/2026/DAC/SeCArtE/UFSC foi homologada.',
            '',
            'Conforme previsto no item 13.1.1 do Edital, encaminhamos, abaixo, o link para acesso ao Termo de Autorização para Ocupação dos Espaços do DAC.',
            '',
            'Solicitamos, por gentileza, que os dados referentes à reserva sejam conferidos e, após a leitura dos termos e condições para utilização do espaço, que seja assinalada a opção de ciência do Termo, a fim de que possamos dar continuidade ao processo de reserva.',
            '',
            'Permanecemos à disposição para quaisquer esclarecimentos.',
            '',
            'Atenciosamente,',
            'Equipe DAC',
            '',
            `Evento: ${evento || 'N/A'}`,
            `Local: ${localExibir}`,
            '',
            'Abrir o Termo Digital:',
            termoUrl,
            observacao ? `\nMensagem da equipe do DAC:\n${observacao}` : '',
            '',
            'Em caso de dúvidas, entre em contato com pautas.dac@contato.ufsc.br.'
        ].join('\n');

        const htmlAdmin = `
        <div style="font-family:sans-serif;max-width:650px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden;color:#333">
            <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:24px 28px;text-align:center">
                <h2 style="margin:0;color:#fff;font-size:19px">Termo Digital enviado</h2>
                <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">Notificação administrativa — DAC/UFSC</p>
            </div>
            <div style="padding:28px">
                <p style="font-size:15px;margin-top:0">O link do Termo Digital foi enviado ao proponente para conferência e assinatura.</p>
                <div style="background:#f8f9fb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 18px;margin:20px 0">
                    <p style="margin:0 0 8px;font-size:13px;color:#555"><strong>Proponente:</strong> ${escapeHtml(nome || 'N/A')}</p>
                    <p style="margin:0 0 8px;font-size:13px;color:#555"><strong>E-mail:</strong> ${escapeHtml(emailDestino)}</p>
                    <p style="margin:0 0 8px;font-size:13px;color:#555"><strong>Evento:</strong> ${escapeHtml(evento || 'N/A')}</p>
                    <p style="margin:0;font-size:13px;color:#555"><strong>Local:</strong> ${escapeHtml(localExibir)}</p>
                </div>
                <p style="font-size:13px;color:#555;line-height:1.6;margin:0">A mensagem completa, com o link para abrir o termo, foi encaminhada somente ao proponente.</p>
            </div>
        </div>`;

        try {
            const respostaBrevo = await axios.post('https://api.brevo.com/v3/smtp/email', {
                sender: { name: BREVO_SENDER_NAME, email: senderEmail },
                to: [{ email: emailDestino, name: nome || emailDestino }],
                replyTo: { email: BREVO_REPLY_TO, name: BREVO_SENDER_NAME },
                subject: `Seu Termo Digital — ${evento || 'Projeto DAC'} — DAC/UFSC`,
                htmlContent,
                textContent
            }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } });
            let dacEmailSent = true;
            try {
                await axios.post('https://api.brevo.com/v3/smtp/email', {
                    sender: { name: BREVO_SENDER_NAME, email: senderEmail },
                    to: [{ email: BREVO_REPLY_TO, name: 'DAC - UFSC' }],
                    replyTo: { email: BREVO_REPLY_TO, name: BREVO_SENDER_NAME },
                    subject: `📩 Termo Digital enviado: ${evento || 'Projeto DAC'} — ${nome || ''} — DAC/UFSC`,
                    htmlContent: htmlAdmin
                }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' } });
            } catch (adminError) {
                dacEmailSent = false;
                console.error(`⚠️ Termo Digital enviado para ${emailDestino}, mas a notificação ao DAC falhou:`, adminError.response?.data || adminError.message);
            }
            enviados++;
            detalhes.push({ email: emailDestino, id, nome, evento, status: 'enviado', dacEmailSent });
            console.log(`✅ Link do termo aceito pelo Brevo para ${emailDestino} (inscrição ${id}) — messageId: ${respostaBrevo.data?.messageId || 'não informado'}; notificação administrativa: ${dacEmailSent ? 'enviada' : 'falhou'}`);
        } catch (e) {
            erros++;
            detalhes.push({ email: emailDestino, id, nome, evento, status: 'erro', msg: e.response?.data?.message || e.message });
            console.error(`❌ Erro ao enviar link para ${emailDestino}:`, e.response?.data || e.message);
        }
    }

    const resultado = { success: true, enviados, erros, naoEncontrados, detalhes, total: destinatarios.length };
    if (requestedId && enviados !== 1) {
        const mensagem = erros > 0
            ? 'O Brevo recusou o envio do link. Consulte os detalhes do erro e tente novamente.'
            : `A inscrição não foi localizada pelo identificador informado${emailSolicitado ? ` nem pelo e-mail ${emailSolicitado}` : ''}. Atualize a lista de inscrições e tente novamente.`;
        return res.status(erros > 0 ? 502 : 404).json({ ...resultado, success: false, error: mensagem });
    }
    res.json(resultado);
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
        verificarEnviosAutomaticosFormulario();
        setInterval(verificarEnviosAutomaticosFormulario, 60 * 1000);
    });
}
