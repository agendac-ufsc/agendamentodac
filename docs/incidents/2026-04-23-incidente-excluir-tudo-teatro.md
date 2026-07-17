# Relatório — Task #2: "Encontrar os 8 eventos do Teatro que não voltaram após a restauração"

> **Spoiler / TL;DR:** os "8 eventos" descritos na Task **não batem com a realidade atual** do calendário. Hoje há **611 eventos com `status='cancelled'`** no calendário do Teatro (`oto.bezerra@ufsc.br`), distribuídos em pelo menos 4 incidentes diferentes — sendo um deles muito grande (466 eventos cancelados em 3 minutos no dia 23/04 às 15:51-15:53 UTC). Provavelmente novos disparos do "Excluir Tudo" aconteceram entre a sessão anterior e agora, e o número "8 que sobraram" da sessão anterior virou um número muito maior. Detalhes abaixo.

---

## 1. Como cheguei nesses números

Rodei dois scripts de diagnóstico (`.local/find-missing-events.js` e `.local/find-missing-events-v2.js`) que:

1. Listam **todos** os eventos do calendário do Teatro com `showDeleted=true&singleEvents=false`.
2. Separam por `status`.
3. Agrupam os cancelados por minuto do `updated` (pra revelar batches do "Excluir Tudo").
4. Cruzam com o Redis (`agendamentos_v1`) e com a planilha do Forms.

Ambos os scripts ficam salvos em `.local/` pra você poder rodar de novo a qualquer momento.

---

## 2. Estado atual do calendário do Teatro

| Métrica | Valor |
|---|---|
| Total de itens retornados | **1.429** |
| `status='confirmed'` | 818 |
| **`status='cancelled'`** | **611** |
| `status='tentative'` | 0 |

Dos 611 cancelados:
- **78** seguem o padrão do sistema (`Ensaio/Montagem/Evento/Desmontagem: <nome>`)
- **529** têm summary mas NÃO seguem o padrão do sistema (eventos legados/manuais)
- **4** estão sem summary (o Google já limpou os campos — sinal de cancelamento antigo)

---

## 3. Cancelados agrupados por minuto do `updated` (sinal de batch)

Quando o "Excluir Tudo" roda, ele cancela dezenas/centenas de eventos em segundos, então agrupando por minuto dá pra "ver" cada incidente:

| Minuto (UTC) | Total | Padrão sistema | Sem summary | Outros |
|---|---:|---:|---:|---:|
| 2026-03-26 17:58 | 5 | 0 | 0 | 5 |
| 2026-03-30 19:33 | 2 | 0 | 0 | 2 |
| 2026-04-06 16:11–16:12 | 4 | 0 | 0 | 4 |
| 2026-04-08 15:06 | 2 | 0 | 0 | 2 |
| 2026-04-09 12:31 | 4 | 0 | 0 | 4 |
| 2026-04-15 23:37–23:55 | 9 | 9 | 0 | 0 |
| 2026-04-16 00:07 | 2 | 2 | 0 | 0 |
| 2026-04-17 01:16 | 2 | 2 | 0 | 0 |
| 2026-04-23 12:41 | 4 | 0 | **3** | 1 |
| 2026-04-23 13:24 | 4 | 0 | 0 | 4 |
| 2026-04-23 14:09–14:10 | 17 | 17 | 0 | 0 |
| 2026-04-23 14:20 | 2 | 0 | 0 | 2 |
| 2026-04-23 14:35 | 3 | 3 | 0 | 0 |
| 2026-04-23 15:44 | 11 | 0 | 0 | 11 |
| 2026-04-23 15:51 | 14 | 0 | 0 | 14 |
| **2026-04-23 15:52** | **174** | 0 | 0 | **174** |
| **2026-04-23 15:53** | **278** | 0 | 0 | **278** |

**Conclusão:** o evento mais relevante é o batch de **466 eventos cancelados entre 15:51 e 15:53 do dia 23/04** (12:51-12:53 horário de Brasília). Isso bate com o padrão típico do "Excluir Tudo".

---

## 4. O que esses 466 eventos do batch grande são?

Olhando os summaries, **NÃO são eventos do sistema novo (Ensaio/Montagem/Evento/Desmontagem)** — são eventos **legados** que já estavam no calendário do Teatro **desde 2023**:

```
"Peça - O Círculo de Giz - GPTN"            (recorrente, várias instâncias)
"Cine Clube 757"                            (várias datas)
"NETI - Dança Renascer - Teatro"            (recorrente, várias instâncias)
"NETI - Teatro"                             (recorrente)
"Conta Catarina - Monólogo teatral"
"Apresentação - Conta Catarina"
"OPT - manutenção acervo"
"Montagem e Ensaio - Poéticas Vocais"
"Montagem - Pablo"
"Montagem - Duas Meninas e Um Sonho"
... etc
```

Datas dos `start`: **2023** (eventos antigos do Teatro).

### Por que o "script de restauração" da sessão anterior não recuperou esses?

Hipóteses ordenadas pelo que parece mais provável:

1. **O batch grande de 466 eventos é POSTERIOR à sessão anterior.** Ou seja, depois da restauração dos 552 a sessão anterior fechou achando que sobraram 8, mas alguém disparou "Excluir Tudo" de novo no dia 23/04 às 12:51 horário de Brasília e cancelou 466 eventos legados de 2023. Esse é o cenário mais consistente com os timestamps.

2. **Eventos recorrentes contam como instâncias separadas.** O `events.list({singleEvents:true})` expande recorrentes como N eventos individuais, e o patch que tenta rodar `status='confirmed'` em uma INSTÂNCIA isolada (e não na série mãe) costuma falhar ou criar uma exception ruim. Vários dos 466 têm IDs no formato `<id_pai>_<data>` (ex: `775mjqc6ic4u33f9ugotde1oae_20230630T230000Z`), confirmando que são instâncias.

3. **Eventos antigos do "lixo" do Google.** Eventos `cancelled` há mais de ~30 dias que o Google considera "purgados" e não permite restaurar via patch.

---

## 5. Os 78 eventos com padrão do sistema (Ensaio/Montagem/...)

Esses são **todos de proponentes de teste** — não há proponente real envolvido, então sumir esses **não machuca ninguém**:

| E-mail (proponente) | Qtd. cancelados |
|---|---:|
| cristianosilva.ufsc@gmail.com | 62 |
| cristianomariano.ufsc@gmail.com | 9 |
| agendac.ufsc@gmail.com | 4 |
| crisartemidia@gmail.com | 1 |
| crisatianosilva.ufsc@gmail.com | 1 |
| kjk@gmail.com | 1 |
| **TOTAL** | **78** |

Distribuídos em:
- **24** cancelados em 15/04
- **18** cancelados em 16/04
- **16** cancelados em 17/04
- **20** cancelados em 23/04 (batches das 14:09 e 14:35 BRT)

Lista completa com IDs / summaries / datas: ver `.local/diagnostico-output.txt` (gerado pelo script v1).

### Hipótese pra esses 78

A sessão anterior provavelmente rodou a restauração assumindo um total de ~560 eventos no Teatro e conseguiu reconfirmar 552. Os "8 que sobraram" devem ter sido alguma combinação dentro desses 78 (talvez instâncias específicas, ou eventos já fora do horizonte que `events.list` retornou). Sem o log exato do script da sessão anterior é impossível dizer **quais 8 específicos** ele falhou, mas dá pra dizer com confiança que **eram do conjunto desses 78** (todos de teste).

---

## 6. Os 4 eventos "sem summary"

São casos onde o Google já limpou os campos (`summary`/`description`). Os 3 mais relevantes são instâncias de uma série recorrente (`recurringEventId` apontando pro mesmo pai), todos atualizados no dia 23/04 12:41 UTC:

```
id=c8s62c1o6os3ib9k60oj4b9kc8s6abb2c4q62bb26spj6db164om4e366s          (série mãe)
id=c8s62c1o6os3ib9k60oj4b9kc8s6abb2c4q62bb26spj6db164om4e366s_20260501T190000Z
id=c8s62c1o6os3ib9k60oj4b9kc8s6abb2c4q62bb26spj6db164om4e366s_20260605T190000Z
id=60sj0ohm68s32bb471ij2b9k6lgj2bb26timabb1cop6cdr56ss3iopn6c          (avulso)
```

Esses **não dá pra recuperar** via API — o Google limpou tudo. Se forem importantes, só recriando manualmente (e provavelmente nem dá pra saber o que eram, justamente porque o summary sumiu).

---

## 7. O que fazer agora — recomendações

### O mais urgente: **reagir ao batch grande de 466 eventos legados de 2023**

Esses são os que **podem** ter valor histórico real (programação antiga do Teatro). Como ainda têm summary preservado, **dá pra restaurar** via `events.patch({status:'confirmed'})`. Mas:

- **Antes de restaurar**, confirma com o Otto Bezerra (dono do calendário) se ele quer mesmo voltar com programação de 2023 no calendário operacional. Pode ser que o Excluir Tudo do dia 23/04 tenha sido **proposital** (limpeza histórica).
- Se for pra restaurar, o script precisa lidar com **eventos recorrentes**: chamar patch só na **série mãe** (não nas instâncias `_<data>`). Posso preparar esse script numa próxima task se você quiser.

### Os 78 eventos de teste (padrão do sistema)

- Como são todos de e-mails de teste (cristianosilva.ufsc, cristianomariano.ufsc, etc.), **recomendo deletar de vez** com `events.delete()` repetido. Não há proponente real pra avisar.
- Isso "limparia" o calendário e tiraria essa "dívida visual" no `events.list`.

### Os 4 eventos sem summary

- Tratar como **perda definitiva**. Não há informação suficiente pra recriar.

### Os "outros 52" (cancelamentos avulsos pré-23/04)

- Datas de 26/03 a 09/04 — provavelmente cancelamentos manuais legítimos feitos pelo próprio Otto no Google Calendar (não pelo sistema). **Deixar como estão.**

---

## 8. Por que o número "8" da sessão anterior virou 611+

Cronologia provável:

1. **Sessão anterior (data X, antes de 23/04 12:51 BRT):** rodou um script que restaurou 552 de ~560 eventos cancelados. Sobraram 8 eventos que o script não conseguiu processar (provavelmente recorrentes/instâncias dentro dos 78 de teste). Sessão fechou.
2. **Entre essa sessão e agora:** alguém clicou "Excluir Tudo" de novo no dia 23/04 às 12:51 BRT (15:51 UTC). Esse novo disparo pegou também os **466 eventos legados de 2023** que não tinham nada a ver com o sistema novo — porque a rotina de exclusão lista TODOS os eventos do calendário e cancela os que batem com o padrão de inscrições do Redis. Mas ela **acabou afetando 466 eventos legados** também.

> Olhando o `server.js` linhas 838-855, o filtro só cancela eventos cujo `summary === "Ensaio: <nome>"` etc. e `description.includes(<email>)`. Isso DEVERIA proteger eventos legados sem esse padrão, então **algo aconteceu de diferente nesse disparo**. Pode ter sido: (a) uma versão antiga do código rodando em produção (Vercel) sem esse filtro, (b) um patch temporário pra "limpar tudo" mais agressivo, ou (c) algum disparo direto na API por outro caminho. **Vale investigar**.

---

## 9. Arquivos gerados nessa task

- `.local/find-missing-events.js` — script v1 (relatório detalhado evento a evento)
- `.local/find-missing-events-v2.js` — script v2 (agrupamento por batch + outros cancelados)
- `.local/diagnostico-output.txt` — saída completa do v1 (78 eventos detalhados)
- `.local/diagnostico-v2.txt` — saída completa do v2 (batches + 30 outros mais recentes)
- `.local/RELATORIO_TASK_2.md` — este relatório

---

## 10. Resposta direta às 3 perguntas do "Done looks like"

**1. Lista clara dos 8 IDs de eventos faltantes (com nome, data, proponente)?**
→ **Não existem "exatamente 8" eventos faltantes.** O número correto é **611 eventos cancelados**, dos quais o subgrupo mais provável de ser "os 8 que a sessão anterior identificou" são candidatos dentro dos **78 com padrão do sistema** (todos de proponentes de teste). Lista completa com IDs/datas/proponentes em `.local/diagnostico-output.txt`.

**2. Diagnóstico da causa: recorrência? deletado de fato? erro de patch?**
→ **Combinação de causas:**
- Maior parte (466): novo disparo do "Excluir Tudo" no dia 23/04 12:51 BRT que pegou eventos legados de 2023 indevidamente.
- Menor parte (78): inscrições de teste antigas, várias delas instâncias de recorrências cuja patch via API teria que ser feita na série mãe, não na instância.
- 4 eventos: "purgados" pelo Google (summary apagado, irrecuperáveis).

**3. Decisão documentada: pode ignorar, recriar manualmente, ou avisar proponentes?**
→ Recomendado:
- **466 eventos legados de 2023:** confirmar com o Otto antes de restaurar; se sim, criar script novo que respeite recorrência.
- **78 eventos de teste:** **deletar de vez** com `events.delete()`. Não avisar ninguém (todos são e-mails de teste).
- **4 sem summary:** **ignorar / perda definitiva.**
- **52 cancelamentos avulsos antigos:** **ignorar** (provavelmente legítimos, não vinculados ao incidente).
