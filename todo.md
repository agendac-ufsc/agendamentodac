# Sistema de Agendamento - TODO

## Fase 1: MVP Básico (Etapa 1 - Agendamento)

### Banco de Dados
- [x] Criar schema Drizzle com tabela de agendamentos (nome, email, telefone, data, hora)
- [x] Criar tabela de disponibilidades (horarios)
- [ ] Gerar e aplicar migration SQL no Postgres

### Backend (tRPC Procedures)
- [x] Implementar integracao com Google Calendar API (OAuth 2.0)
- [x] Implementar integracao com Resend para envio de e-mails
- [x] Criar procedure para criar agendamento (salvar no DB + Google Calendar + enviar e-mails)
- [x] Criar procedure para listar horarios disponiveis
- [x] Adicionar validacoes e tratamento de erros

### Frontend (Etapa 1)
- [x] Criar pagina de agendamento com calendario interativo
- [x] Implementar selecao de data e hora
- [x] Criar formulario para capturar nome, email e telefone
- [x] Integrar com tRPC para enviar dados ao backend
- [x] Exibir mensagem de sucesso apos agendamento
- [x] Exibir botao para Etapa 2 (Google Forms) apos sucesso

### Configuração e Deploy
- [ ] Configurar variáveis de ambiente (Google Calendar API, Resend, Postgres)
- [ ] Testar localmente
- [ ] Fazer push para GitHub
- [ ] Conectar repositório à Vercel
- [ ] Testar deploy na Vercel

### Documentacao
- [x] Criar README.md com instrucoes de setup
- [x] Documentar variaveis de ambiente necessarias
- [x] Documentar fluxo de integracao com Google Calendar e Resend
- [x] Criar .env.example

---

## Fase 2: Painel Administrativo + Conciliação de Dados (Futuro)

- [ ] Criar tabela de dados conciliados no DB
- [ ] Integrar Google Sheets API para leitura de dados do Forms
- [ ] Implementar lógica de conciliação por email/telefone
- [ ] Criar painel administrativo protegido
- [ ] Exibir relatório consolidado com dados das duas etapas

---

## Notas
- Projeto iniciado em 12/03/2026
- Stack: Next.js + tRPC + Postgres + Vercel Serverless
- Deploy: GitHub + Vercel (CI/CD continuo)
- Proximo passo: Instalar dependencias do Google Calendar e Resend, depois fazer push para GitHub
