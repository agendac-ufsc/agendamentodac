---
name: Vercel pnpm lockfile
description: Regra para manter instalações congeladas da Vercel reproduzíveis em monorepos pnpm.
---

Quando a Vercel instala com `--frozen-lockfile`, o lockfile precisa refletir tanto os especificadores atuais dos manifests quanto a configuração de resolução do workspace, e deve ser gerado com a mesma linha de pnpm usada no build. Fixar a versão do pnpm no manifesto evita que a Vercel e o ambiente local produzam lockfiles incompatíveis.

**Why:** Uma instalação local com outra versão de pnpm pode parecer válida, mas a Vercel falha antes de iniciar a aplicação com erro de configuração de `overrides` ou de lockfile desatualizado.

**How to apply:** Ao corrigir esse tipo de falha, compare a versão indicada nos logs da Vercel, regenere o lockfile com essa linha de pnpm, valide com `install --frozen-lockfile` e não misture alterações automáticas de módulos do ambiente no commit.