---
name: Sincronização de termos
description: Regra de atualização do painel administrativo após o proponente reenviar um termo.
---

O envio do PDF pelo proponente é a fonte final dos dados do termo e deve atualizar o painel administrativo mesmo quando acontece em outro navegador ou sessão.

**Why:** `postMessage` só funciona quando o termo foi aberto pela própria janela administrativa; links reenviados por e-mail normalmente são concluídos em outra sessão.

**How to apply:** mantenha uma busca periódica ou outro mecanismo de atualização vindo do servidor para a listagem administrativa, e não dependa apenas de eventos entre janelas.