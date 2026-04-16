# Sistema de Agendamento DAC/UFSC

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
