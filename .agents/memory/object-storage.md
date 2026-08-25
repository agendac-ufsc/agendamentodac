---
name: Document storage provider
description: A decisão de armazenamento de documentos precisa funcionar tanto no preview quanto na Vercel.
---

Documentos de inscrições devem usar Vercel Blob com acesso `private`. O Redis guarda apenas metadados e a URL do blob; as rotas administrativas fazem a leitura autenticada e a exclusão.

**Why:** O backend de produção roda na Vercel, portanto o App Storage do Replit não estaria disponível automaticamente nesse ambiente.

**How to apply:** Configurar `BLOB_READ_WRITE_TOKEN` como segredo no preview e na Vercel antes de testar uploads. Sem o token, o servidor deve permanecer saudável e retornar indisponibilidade explícita para as rotas de documentos.