---
name: App Storage provisioning
description: O SDK do App Storage precisa de um bucket provisionado no ambiente antes de aceitar uploads.
---

O pacote `@replit/object-storage` pode ser instalado sem que exista um bucket disponível. Nesse estado, a inicialização do cliente falha com a mensagem de bucket ausente; isso é uma configuração do ambiente, não uma falha do fluxo de documentos.

**Why:** O cliente inicializa o bucket de forma assíncrona e uma instância sem bucket pode produzir rejeição não tratada se o erro não for capturado.

**How to apply:** Antes de testar uploads, provisionar o App Storage no ambiente. O servidor deve capturar a falha e retornar indisponibilidade explícita, sem derrubar o workflow.