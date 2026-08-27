---
name: Preview routing
description: Replit artifact route declarations can shadow the main app's API routes in the shared preview.
---

The main application must remain the owner of `/api` in the shared Replit preview. A separate API artifact with `paths` or `previewPath` set to `/api` can intercept those requests and return 404 even when the main server is healthy.

**Why:** The preview router dispatches requests by declared artifact paths before they reach the root application's server, so an unrelated generated API artifact can make the admin login and configuration calls fail.

**How to apply:** When debugging preview API 404s, inspect every `.replit-artifact/artifact.toml`; keep auxiliary artifacts from declaring paths used by the root app, and verify the public `/api/config` route returns a successful response.

Quando a página inicial depende de configuração do servidor para escolher qual HTML entregar, a rota `/` da Vercel também deve apontar para o servidor, e não para um arquivo estático fixo. Respostas dessa rota devem evitar cache para refletir mudanças administrativas.

**Why:** Um fallback estático para `index.html` ignora a seleção dinâmica feita pelo Express e faz o modo unificado funcionar no preview, mas não na publicação.

**How to apply:** Em aplicações com seleção dinâmica na raiz, mantenha `/` antes do fallback estático no `vercel.json` e faça a função devolver `index.html` ou `index-teste.html` conforme a configuração persistida.