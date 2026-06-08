# Sistema de Agendamento DAC/UFSC

## 🚀 Setup Rápido (para novo agente / novo ambiente Replit)

Este projeto compartilha o **mesmo backend** que a versão de produção no Vercel (mesmo Redis Upstash, mesmo Google Calendar, mesmo Brevo).

> **⚠️ IMPORTANTE — Política de credenciais:** as 6 chaves de API **NUNCA** devem ser gravadas em arquivos do repositório (`.env`, `.replit`, `attached_assets/`, etc). Elas ficam APENAS em **Replit Secrets** (aba 🔒 Secrets) e nas **Environment Variables do Vercel**. O `.gitignore` já bloqueia `.env`. Qualquer agente ou colaborador que precisar operar neste projeto deve usar o fluxo abaixo — jamais commitar chaves.

### ✅ Abrir o projeto em um novo ambiente Replit: Fork

A forma correta é **fazer Fork do Replit original**, não clonar do GitHub. Ao forkar, os 6 Secrets são copiados automaticamente. Se clonar do GitHub, o agente precisa solicitar os Secrets ao usuário via formulário seguro (`requestSecrets`).

**Instruções para o agente:**
1. Rode `npm install` (se ainda não foi rodado pelo Replit) e garanta que o workflow `Start application` (`npm run dev`, porta 5000) esteja configurado.
2. **SEMPRE, logo após configurar o ambiente (instalar dependências e iniciar o workflow), o agente DEVE enviar o painel/formulário seguro de Secrets para o usuário preencher**, mesmo que o servidor já esteja rodando. Use a função de solicitação de secrets (`requestEnvVar` / `requestSecrets`) listando exatamente estas 6 chaves:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `GOOGLE_SERVICE_ACCOUNT_KEY`
   - `BREVO_API_KEY`
   - `SENDER_EMAIL`
   - `ADMIN_EMAIL`
3. Antes de enviar o painel, verifique quais já existem em Secrets e solicite **apenas as que estão faltando**. Se todas as 6 já existirem, apenas confirme com o usuário e pule esta etapa.
4. **NUNCA** aceite chaves coladas no chat ou em arquivos anexados — exija o preenchimento via painel seguro de Secrets. Isso evita vazamento no histórico da conversa.
5. Após o usuário preencher, reinicie o workflow `Start application` para carregar os Secrets.

⚠️ **Cuidado**: como o Redis é o mesmo da produção, **qualquer inscrição feita aqui aparece no Vercel também**. Use prefixo "TESTE" em nomes de eventos/proponentes durante testes, ou exclua depois pelo painel admin.

### 🔁 Rotação de chaves

Se alguma chave vazar (commit acidental, upload público, etc), rotacione imediatamente:
- Upstash → regerar token REST no painel
- Google → criar nova chave da service account e invalidar a antiga
- Brevo → regerar API key

Após rotacionar, atualize os valores em: Replit Secrets **+** Vercel Environment Variables.

---

### Compartilhar planilhas novas (quando aplicável)
Qualquer planilha nova do Google Sheets configurada no painel admin precisa ser **compartilhada** (acesso de Leitor) com o e-mail da service account:
```
agendamento-dac-service@agendamento-dac.iam.gserviceaccount.com
```

### Deploy no Vercel
O Vercel faz deploy automático a cada `git push` na branch main. Se uma nova feature exigir uma nova variável de ambiente, **adicione no Vercel antes do push** (Settings → Environment Variables).

---

## Visão Geral
Sistema de agendamento de espaços do Departamento Artístico Cultural (DAC) da UFSC. Permite que proponentes inscrevam projetos para uso do Teatro Carmen Fossari ou da Igrejinha da UFSC, e que administradores gerenciem e avaliem as inscrições.

## Arquitetura
- **Backend**: Node.js + Express (`server.js`)
- **Frontend**: HTML/CSS/JS puro (`index.html`, `admin.html`)
- **Banco de Dados**: Upstash Redis (REST API via `@upstash/redis`)
- **Calendário**: Google Calendar API (via Service Account)
- **E-mail**: Brevo (Sendinblue) REST API
- **PDF**: jsPDF (client-side)

## Rotas do Servidor

### Públicas
- `GET /` → Página de inscrição (`index.html`)
- `GET /admin` → Painel administrativo (`admin.html`)
- `GET /api/config` → Configurações públicas (links, horários)
- `GET /api/disponibilidade?local=teatro|igrejinha` → Eventos do Google Calendar
- `POST /api/agendar` → Criar inscrição + eventos no Calendar + enviar e-mails

### Autenticação
- `POST /api/auth/admin` → Login admin (senha via env `ADMIN_PASSWORD`, padrão: `admin.dac.ufsc`)
- `POST /api/auth/viewer` → Login avaliador (senha padrão: `dac.ufsc.2026`, configurável via env `EVALUATOR_PASSWORD`)

### Admin
- `GET /api/admin/dados-unificados` → Lista unificada (Redis + Google Sheets)
- `POST /api/admin/config` → Salvar configurações
- `DELETE /api/admin/excluir/:email` → Remover por e-mail
- `DELETE /api/agendamentos/:id` → Remover por ID
- `DELETE /api/admin/excluir-tudo` → Limpar tudo
- `POST /api/admin/blacklist/:id` → Blacklist visual

### Sistema de Avaliação
- `GET /api/evaluators` → Listar avaliadores
- `POST /api/evaluators` → Salvar lista de avaliadores
- `DELETE /api/evaluators/:id` → Remover avaliador
- `GET /api/criteria` → Listar critérios de avaliação
- `POST /api/criteria` → Salvar critérios
- `POST /api/save-assessment` → Salvar avaliação de uma inscrição
- `GET /api/assessments/:inscriptionId` → Buscar avaliações de uma inscrição
- `GET /api/admin/relatorio-avaliacoes` → Ranking consolidado: média ponderada, médias por critério, status (Sem avaliações / Em andamento / Concluída) e lista de avaliadores por inscrição

### E-mail
- `POST /api/enviar-termos-digitais` → Enviar termos por e-mail em massa via Brevo

## Variáveis de Ambiente (Secrets)
| Variável | Uso |
|---|---|
| `UPSTASH_REDIS_REST_URL` | URL do Redis Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Token do Redis Upstash |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON da conta de serviço do Google |
| `BREVO_API_KEY` | Chave da API Brevo para envio de e-mails |
| `ADMIN_EMAIL` | E-mail do administrador (cópia das notificações) |
| `SENDER_EMAIL` | E-mail remetente dos e-mails |
| `ADMIN_PASSWORD` | Senha admin (padrão: `admin.dac.ufsc`) |

## Locais e Calendários
| Local | Google Calendar ID |
|---|---|
| Teatro Carmen Fossari | `oto.bezerra@ufsc.br` |
| Igrejinha da UFSC | `c_e19d30c40d4de176bc7d4e11ada96bfaffd130b3ed499d9807c88785e2c71c05@group.calendar.google.com` |

## Redis Keys
| Chave | Conteúdo |
|---|---|
| `agendamentos_v1` | Array de inscrições (etapa 1) |
| `agendamentos_config` | Configurações gerais |
| `agendamentos_blacklist` | IDs ocultados visualmente |
| `avaliadores` | Lista de avaliadores |
| `criterios` | Critérios de avaliação com pesos |
| `avaliacoes_{id}` | Avaliações de uma inscrição |

## Funcionalidades
1. **Seleção de Local** — Tela inicial com dois botões (Teatro / Igrejinha)
2. **Autenticação Admin** — Login com senha (sessão salva em localStorage por 8h)
3. **Login de Avaliador** — Acesso exclusivo via `/avaliador.html` (e-mail + senha `dac.ufsc.2026`). A aba "Avaliação" foi removida de `admin.html` — o painel admin agora cobre apenas Inscrições, Avaliadores e Configurações.
4. **Sistema de Avaliação** — Estrelas (1-10) por critério, com pesos configuráveis (em `/avaliador.html`)
5. **Gerenciamento de Avaliadores** — Adicionar/remover via painel admin
5b. **Relatório de Avaliações** — Aba "Relatório" no admin com ranking ordenado por média final, cards de resumo (total, avaliadas, concluídas, sem avaliações, mínimo necessárias), filtros por local/status e exportação em CSV (UTF-8 BOM, separador `;`, decimal `,`)
6. **Envio de Termos** — Seleção múltipla de inscrições + envio em massa via Brevo
7. **PDF da Ficha** — Geração client-side com jsPDF, com cabeçalho colorido
8. **Download em ZIP** — Todos os PDFs em um arquivo .zip
9. **Filtros Avançados** — Por local, status e busca textual
10. **Bloqueio de Datas** — Admin pode bloquear datas específicas
