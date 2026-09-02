---
name: Entrega de e-mails pelo Brevo
description: Regra para manter remetente consistente e diferenciar aceitação, entrega e filtragem de mensagens.
---

Todos os fluxos de e-mail do aplicativo devem usar o mesmo remetente validado no Brevo. O endereço administrativo é destinatário de notificações e não deve ser usado como fallback de remetente.

**Why:** O servidor receptor pode aceitar confirmações e filtrar termos com conteúdo ou links diferentes. Além disso, o Brevo aceitar uma requisição só confirma o processamento inicial; a entrega precisa ser verificada no log transacional.

**How to apply:** Ao investigar uma falha, comparar o remetente, `messageId` e status transacional entre uma mensagem entregue e uma mensagem ausente. Se estiver `Delivered`, investigar quarentena/filtro do domínio destinatário; se houver bounce, block ou defer, corrigir no Brevo.