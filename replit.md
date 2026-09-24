# Agendamento DAC

Sistema de agendamento do DAC/UFSC, publicado pela Vercel a partir do repositório GitHub:

- Repositório: `https://github.com/agendac-ufsc/agendamentodac`
- Produção: `https://agendamentodac.vercel.app`

## Regra principal

O GitHub `main` é a fonte de verdade do código. A Vercel é a fonte de verdade do comportamento publicado. Documentos, clones antigos e snapshots podem estar desatualizados.

Antes de alterar qualquer coisa:

1. Confira `git status --short --branch`.
2. Preserve e inspecione alterações locais antes de sincronizar.
3. Atualize a partir de `origin/main`.
4. Consulte a produção somente depois que o check da Vercel do commit atual estiver `success`.

## Configuração para um novo agente

Leia o guia completo [`CONTINUIDADE-AGENDAMENTODAC-CONFIGURACAO.md`](CONTINUIDADE-AGENDAMENTODAC-CONFIGURACAO.md).

Em uma workspace nova, use `pnpm` na versão indicada em `package.json`, instale com `pnpm install --frozen-lockfile` e valide com:

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

## Cuidados obrigatórios

- O modo normal é a inscrição unificada.
- Não reative o fluxo de duas etapas sem a chave de emergência solicitada pelo responsável.
- Não peça ou registre tokens, senhas ou valores de secrets.
- Não envie e-mails, exclua dados ou altere documentos reais durante testes.
- Antes de publicar, leia os SHAs atuais dos arquivos no GitHub e faça escritas sequenciais pela conexão GitHub.
- Depois de publicar, aguarde o check da Vercel ficar `success`.