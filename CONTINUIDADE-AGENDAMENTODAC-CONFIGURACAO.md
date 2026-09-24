# Configuração de continuidade — Agendamento DAC

Este documento é um manual de preparação para outro agente continuar o trabalho. Ele não é um histórico do projeto nem uma lista de tarefas concluídas. O agente deve descobrir o estado atual consultando o GitHub e a Vercel no momento da configuração.

## Instrução para o agente que receber este arquivo

Se este arquivo foi anexado pelo usuário, leia-o antes de fazer perguntas e trate-o como instrução operacional para preparar a workspace. Execute a configuração descrita aqui e comece pelo estado atual do repositório; não peça ao usuário para colar o código, repetir o histórico ou confirmar etapas que o próprio documento já define.

Se uma capacidade necessária não estiver conectada — especialmente o GitHub — solicite a integração pela conexão segura da interface do Replit. Nunca peça token, senha, chave SSH ou secret no chat. Depois que o usuário autorizar a conexão, continue a configuração automaticamente usando o repositório e o `main` atual.

O anexo não concede acesso por si só: a autorização da conta do usuário continua sendo necessária quando a workspace ainda não tiver a integração. Essa autorização deve ser solicitada por um cartão de conexão do Replit, não por credenciais copiadas na conversa.

## 1. Fontes de verdade

Use sempre estas fontes, nesta ordem:

1. Código: branch `main` do repositório `agendac-ufsc/agendamentodac`.
2. Publicação: projeto Vercel ligado a esse repositório.
3. Dados e secrets: ambientes configurados na Vercel, acessados somente pelo código por meio de variáveis de ambiente.

Referências:

- GitHub: `https://github.com/agendac-ufsc/agendamentodac`
- Produção: `https://agendamentodac.vercel.app`

Não considere como fonte de verdade:

- este documento;
- arquivos colados em `attached_assets`;
- um clone local antigo;
- um commit, deployment ou SHA mencionado em uma conversa anterior;
- o projeto Replit antigo de referência.

O objetivo da configuração é que o agente comece sempre do `origin/main` atual. Não fixe um SHA neste manual.

## 2. Preparar uma workspace Replit nova

### 2.1 Localizar ou criar a cópia de trabalho

Use uma única cópia local do repositório:

```bash
cd /home/runner/workspace
```

Se `agendamentodac` ainda não existir:

```bash
git clone https://github.com/agendac-ufsc/agendamentodac.git agendamentodac
cd agendamentodac
```

Se já existir, não apague nem faça `reset` imediatamente. Primeiro inspecione:

```bash
cd /home/runner/workspace/agendamentodac
git status --short --branch
git diff --stat
git remote -v
```

Se houver alterações locais, preserve-as e revise o diff antes de atualizar. Se a cópia estiver limpa:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
```

Confirme o ponto de partida:

```bash
git status --short --branch
git log -1 --format='%H%n%ad%n%s' --date=iso-strict
git rev-parse HEAD
git rev-parse origin/main
```

O `HEAD` e `origin/main` devem coincidir antes de começar uma nova alteração.

### 2.2 Conectar o GitHub pela workspace

Para ler e publicar no repositório, use a integração GitHub da workspace. Se ela ainda não estiver conectada, solicite a conexão GitHub pela interface do Replit.

Não:

- peça token, senha ou chave SSH ao usuário;
- cole credenciais no terminal;
- configure tokens em arquivos do projeto;
- use `git push` com URL contendo credenciais.

Depois que a conexão estiver disponível, as operações autenticadas devem usar `connectorFetch` com o `connection:<id>` fornecido pela workspace.

Antes da primeira chamada, leia as notas da conexão com `viewIntegration`. Para o repositório, as rotas principais são:

```text
GET /repos/agendac-ufsc/agendamentodac
GET /repos/agendac-ufsc/agendamentodac/commits?sha=main&per_page=...
GET /repos/agendac-ufsc/agendamentodac/contents/{arquivo}?ref=main
GET /repos/agendac-ufsc/agendamentodac/commits/{sha}/status
```

## 3. Instalação e validação inicial

O projeto usa `pnpm` e informa a versão pelo campo `packageManager` do `package.json`. Use essa versão com Corepack quando necessário.

```bash
cd /home/runner/workspace/agendamentodac
corepack enable
pnpm install --frozen-lockfile
```

Validação mínima antes de editar:

```bash
pnpm --filter @workspace/agendamento-dac run build
node --check api/home.js
node --check api/documentos-teste/upload.js
node --check api/admin-documents.js
node --check api/registro-atividades.js
node --check artifacts/agendamento-dac/server.js
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('vercel.json válido')"
git diff --check
```

O build do artefato é o definido em `artifacts/agendamento-dac/package.json`. Não crie builds paralelos, mockups ou servidores substitutos para este sistema sem uma decisão explícita.

## 4. Mapa rápido do sistema

Arquivos centrais:

- `artifacts/agendamento-dac/server.js`: servidor Express e regras de negócio.
- `artifacts/agendamento-dac/admin.html`: painel administrativo e painel de gerenciamento dos avaliadores.
- `artifacts/agendamento-dac/avaliador.html`: painel usado pelos avaliadores.
- `artifacts/agendamento-dac/index-teste.html`: inscrição unificada.
- `artifacts/agendamento-dac/index.html`: fluxo legado, reservado para emergência.
- `api/home.js`: seleção da home publicada.
- `api/[...path].js`: entrada geral das rotas da API na Vercel.
- `api/admin/[...path].js`: entrada das rotas administrativas.
- `api/documentos-teste/upload.js`: função Vercel do upload unificado.
- `api/admin-documents.js`: documentos administrativos.
- `api/registro-atividades.js`: registro de atividades.
- `api/cron/verificar-atividades.js`: função do cron.
- `vercel.json`: roteamento, funções e rewrites da Vercel.

O servidor principal é exportado para as funções da Vercel. Não suponha que iniciar `server.js` localmente reproduza todos os secrets e serviços de produção.

## 5. Conferir produção sem alterar dados

Primeiro consulte o status do commit atual no GitHub. Só valide o site quando o contexto `Vercel` estiver `success`.

Configuração pública:

```bash
curl -fsSL https://agendamentodac.vercel.app/api/config
```

O comportamento normal deve informar:

```json
{
  "modoInscricao": "unificado"
}
```

Sinais esperados na home:

```bash
curl -fsSL https://agendamentodac.vercel.app/ \
  | grep -oE 'Finalizar[^<]{0,80}|Próxima etapa|formsLinkProximaEtapaTeste|window\.open\([^)]*forms|docs\.google\.com/forms'
```

No modo unificado, deve aparecer `Próxima etapa`. Não deve aparecer:

- `Finalizar 1ª Etapa`;
- `formsLinkProximaEtapaTeste`;
- abertura automática do Google Forms;
- `docs.google.com/forms` dentro do fluxo unificado.

Probe seguro de roteamento:

```bash
curl -i -X POST \
  https://agendamentodac.vercel.app/api/documentos-teste/upload \
  -F 'id=probe-upload-route'
```

Para um ID inexistente, a rota deve alcançar o Express e devolver JSON informando que a inscrição não foi encontrada. `404 NOT_FOUND` com a página padrão da Vercel indica falha de roteamento.

Não teste rotas que enviem e-mail com uma inscrição real. Não teste exclusão com dados reais.

## 6. Variáveis de ambiente

Nunca registre valores, apenas confira os nomes nos ambientes Production e Preview da Vercel quando isso for necessário:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
REDIS_URL
BLOB_READ_WRITE_TOKEN
GOOGLE_SERVICE_ACCOUNT_KEY
IGREJINHA_CALENDAR_ID
BREVO_API_KEY
SENDER_EMAIL
ADMIN_EMAIL
ADMIN_PASSWORD
EVALUATOR_PASSWORD
PUBLIC_APP_URL
REPLIT_APP_URL
VERCEL_PROJECT_PRODUCTION_URL
CRON_SECRET
```

Para a cadeia automática, os grupos críticos são:

- Redis: `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`, ou `REDIS_URL`;
- e-mail: `BREVO_API_KEY`;
- origem pública: `PUBLIC_APP_URL`, `REPLIT_APP_URL` ou `VERCEL_PROJECT_PRODUCTION_URL`;
- cron: `CRON_SECRET`.

Não peça secrets ao usuário no chat. Se for necessário configurar uma variável, use o fluxo de secrets da workspace ou a configuração existente da Vercel.

## 7. Como fazer uma alteração

1. Atualize o clone e confirme que `HEAD` coincide com `origin/main`.
2. Leia o arquivo e as rotas relacionadas antes de editar.
3. Inspecione qualquer diff local; não apague trabalho de outro agente.
4. Faça a menor alteração que resolva o comportamento solicitado.
5. Execute o build, as verificações de sintaxe e `git diff --check`.
6. Revise o diff para confirmar que não há secrets, dados reais ou arquivos gerados indevidos.
7. Antes de publicar, leia novamente no GitHub cada arquivo que será alterado e obtenha o SHA atual do blob.
8. Publique com `PUT /repos/agendac-ufsc/agendamentodac/contents/{arquivo}` usando Base64, `branch: "main"` e o SHA lido.
9. Faça escritas no mesmo repositório sequencialmente, nunca em paralelo.
10. Consulte o status do commit criado e aguarde a Vercel ficar `success`.
11. Faça somente probes seguros em produção.

Em uma escrita de arquivo existente, o corpo deve conter:

```json
{
  "message": "mensagem curta da alteração",
  "content": "CONTEUDO_BASE64",
  "branch": "main",
  "sha": "SHA_ATUAL_DO_BLOB"
}
```

Não republique um arquivo se a leitura do SHA indicar que outra alteração chegou ao GitHub. Nesse caso, atualize o clone, revise o novo diff e reaplique a alteração sobre a versão atual.

## 8. Regras de segurança e não regressão

- O modo unificado é o padrão.
- O modo de duas etapas só pode ser ativado deliberadamente pela chave de emergência `DAC-EMERGENCIA-MODO-2-ETAPAS`.
- Não reintroduza o Google Forms no fluxo unificado.
- Não remova `api/home.js` nem as funções Vercel explícitas do `vercel.json`.
- Não permita divulgação institucional sem termo completo.
- Não permita registro de atividades sem divulgação enviada e evento terminado.
- Não altere documentos reais para testar rotas.
- Não envie e-mails reais durante testes.
- Não exponha senhas individuais dos avaliadores no endpoint de listagem.
- Não confunda o projeto Replit antigo com o repositório que publica a Vercel.
- Não transforme a publicação em produção em substituto de validação local.

## 9. Checklist de encerramento

Antes de dizer que uma alteração está pronta, confirme:

```text
[ ] clone atualizado a partir de origin/main
[ ] alterações locais preservadas e revisadas
[ ] build concluído
[ ] sintaxe das funções alteradas verificada
[ ] vercel.json válido
[ ] git diff --check sem problemas
[ ] nenhum secret ou dado real exposto
[ ] SHA remoto conferido antes da publicação
[ ] arquivos publicados sequencialmente
[ ] check Vercel success
[ ] produção validada somente com probes seguros
```