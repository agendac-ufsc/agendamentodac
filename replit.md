# Sistema de Agendamento DAC/UFSC

## 🚀 Setup Rápido (para novo agente / novo ambiente Replit)

Este projeto compartilha o **mesmo backend** que a versão de produção no Vercel (mesmo Redis Upstash, mesmo Google Calendar, mesmo Brevo).

> **⚠️ IMPORTANTE — Política de credenciais:** as 6 chaves de API **NUNCA** devem ser gravadas em arquivos do repositório (`.env`, `.replit`, `attached_assets/`, etc). Elas ficam APENAS em **Replit Secrets** (aba 🔒 Secrets) e nas **Environment Variables do Vercel**. O `.gitignore` já bloqueia `.env`. Qualquer agente ou colaborador que precisar operar neste projeto deve usar o fluxo abaixo — jamais commitar chaves.

### ✅ Abrir o projeto em um novo ambiente Replit: Fork

A forma correta é **fazer Fork do Replit original**, não clonar do GitHub. Ao forkar, os 6 Secrets são copiados automaticamente. Se clonar do GitHub, o agente precisa solicitar os Secrets ao usuário via formulário seguro (`requestSecrets`).

**Instruções para o agente:**
1. Se o usuário forkou: confirme na aba **🔒 Secrets** que estes 6 estão presentes:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `GOOGLE_SERVICE_ACCOUNT_KEY`
   - `BREVO_API_KEY`
   - `SENDER_EMAIL`
   - `ADMIN_EMAIL`
2. Se o usuário clonou do GitHub: use `requestSecrets` para pedir as 6 chaves pelo formulário seguro. **Não aceite** chaves coladas no chat ou em arquivos anexados — isso cria risco de vazamento no histórico.
3. Rode `npm install` (se ainda não foi rodado pelo Replit).
4. Clique em **Run** — o workflow `Start application` (`npm run dev`) já está configurado e roda na porta 5000.

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
- `POST /api/auth/viewer` → Login avaliador (senha fixa: `avalia.dac.2026`)

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
3. **Login de Avaliador** — E-mail + senha `avalia.dac.2026`
4. **Sistema de Avaliação** — Estrelas (1-10) por critério, com pesos configuráveis
5. **Gerenciamento de Avaliadores** — Adicionar/remover via painel admin
6. **Envio de Termos** — Seleção múltipla de inscrições + envio em massa via Brevo
7. **PDF da Ficha** — Geração client-side com jsPDF, com cabeçalho colorido
8. **Download em ZIP** — Todos os PDFs em um arquivo .zip
9. **Filtros Avançados** — Por local, status e busca textual
10. **Bloqueio de Datas** — Admin pode bloquear datas específicas
