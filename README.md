# Sistema de Agendamento em Duas Etapas

Um sistema completo de agendamento com integração ao Google Calendar, envio de e-mails automáticos e painel administrativo. Construído com Next.js, tRPC, Postgres e Vercel Serverless.

## 🚀 Funcionalidades (MVP - Etapa 1)

- ✅ Calendário interativo para seleção de data e hora
- ✅ Integração com Google Calendar API (OAuth 2.0)
- ✅ Envio de e-mails de confirmação (cliente e admin) via Resend
- ✅ Armazenamento de dados em Postgres
- ✅ Botão de redirecionamento para Google Forms (Etapa 2)
- ✅ Deploy contínuo via GitHub e Vercel

## 📋 Pré-requisitos

- Node.js 18+ e pnpm
- Conta no GitHub
- Conta na Vercel
- Banco de dados Postgres (Vercel Postgres recomendado)
- Credenciais do Google Cloud Console (Google Calendar API)
- API Key do Resend (serviço de e-mail)

## 🔧 Setup Local

### 1. Clonar o Repositório

```bash
git clone https://github.com/agendac-ufsc/agendamentodac.git
cd agendamentodac
```

### 2. Instalar Dependências

```bash
pnpm install
```

### 3. Configurar Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env.local` e preencha com suas credenciais:

```bash
cp .env.example .env.local
```

**Variáveis obrigatórias:**

- `DATABASE_URL`: String de conexão do Postgres
- `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REFRESH_TOKEN`: Credenciais do Google
- `RESEND_API_KEY`: API Key do Resend
- `ADMIN_EMAIL`: E-mail do administrador
- `VITE_GOOGLE_FORMS_LINK`: Link do Google Forms para Etapa 2

### 4. Configurar Banco de Dados

Gere as migrations do Drizzle:

```bash
pnpm drizzle-kit generate
```

Aplique as migrations no seu banco de dados Postgres (via Vercel ou ferramenta de administração).

### 5. Executar Localmente

```bash
pnpm dev
```

Acesse `http://localhost:3000/agendamento` para testar o sistema.

## 🔐 Configuração do Google Calendar API

1. Acesse [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um novo projeto
3. Ative a **Google Calendar API**
4. Crie credenciais OAuth 2.0 (tipo: Aplicativo da Web)
5. Configure as URIs de redirecionamento autorizadas:
   - Local: `http://localhost:3000/api/oauth/google/callback`
   - Produção: `https://seu-dominio.vercel.app/api/oauth/google/callback`
6. Obtenha o `refresh_token` seguindo o [guia oficial](https://developers.google.com/workspace/calendar/quickstart/nodejs)

## 📧 Configuração do Resend

1. Acesse [Resend Dashboard](https://resend.com)
2. Crie uma conta e obtenha sua API Key
3. Adicione a API Key no arquivo `.env.local`

## 🚀 Deploy na Vercel

### 1. Conectar Repositório à Vercel

```bash
vercel link
```

### 2. Configurar Variáveis de Ambiente na Vercel

No dashboard da Vercel, acesse **Settings > Environment Variables** e adicione:

- `DATABASE_URL`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REFRESH_TOKEN`
- `RESEND_API_KEY`
- `ADMIN_EMAIL`
- `VITE_GOOGLE_FORMS_LINK`

### 3. Deploy

```bash
git push origin main
```

A Vercel fará o deploy automaticamente quando você fizer push para a branch principal.

## 📁 Estrutura do Projeto

```
agendamentodac/
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx           # Página inicial
│   │   │   └── Scheduling.tsx     # Página de agendamento (Etapa 1)
│   │   ├── components/
│   │   ├── lib/
│   │   │   └── trpc.ts           # Cliente tRPC
│   │   └── App.tsx
├── server/
│   ├── services/
│   │   ├── googleCalendar.ts     # Integração com Google Calendar
│   │   └── email.ts              # Integração com Resend
│   ├── db.ts                      # Funções de banco de dados
│   ├── routers.ts                 # Procedures tRPC
│   └── _core/
├── drizzle/
│   └── schema.ts                  # Schema do banco de dados
├── .env.example                   # Exemplo de variáveis de ambiente
└── README.md
```

## 🔄 Fluxo de Dados

1. **Usuário preenche formulário** (nome, email, telefone)
2. **Seleciona data e hora** do calendário
3. **Backend cria agendamento:**
   - Salva no Postgres
   - Cria evento no Google Calendar
   - Envia e-mail de confirmação ao cliente
   - Envia notificação ao admin
4. **Frontend exibe sucesso** com botão para Google Forms (Etapa 2)

## 🧪 Testes

Execute os testes com:

```bash
pnpm test
```

## 📝 Próximas Etapas (Fase 2)

- [ ] Painel administrativo protegido
- [ ] Integração com Google Sheets API
- [ ] Lógica de conciliação de dados (email/telefone)
- [ ] Relatório consolidado das duas etapas
- [ ] Autenticação de admin

## 🤝 Contribuindo

Para continuar desenvolvendo este projeto:

1. Clone o repositório em seu computador
2. Crie uma branch para sua feature: `git checkout -b feature/sua-feature`
3. Faça commit das suas mudanças: `git commit -m 'Adiciona nova feature'`
4. Faça push para a branch: `git push origin feature/sua-feature`
5. Abra um Pull Request

## 📄 Licença

MIT

## 📞 Suporte

Para dúvidas ou problemas, abra uma issue no repositório GitHub.

---

**Desenvolvido com ❤️ usando Next.js, tRPC e Vercel**
