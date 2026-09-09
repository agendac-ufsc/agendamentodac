---
name: Entrega de e-mails pelo Brevo
description: Regra para manter remetente consistente e diferenciar aceitação, entrega e filtragem de mensagens.
---

Todos os fluxos de e-mail do aplicativo devem usar o mesmo remetente validado no Brevo. O endereço administrativo é destinatário de notificações e não deve ser usado como fallback de remetente.

**Why:** O servidor receptor pode aceitar confirmações e filtrar termos com conteúdo ou links diferentes. Além disso, o Brevo aceitar uma requisição só confirma o processamento inicial; a entrega precisa ser verificada no log transacional.

**How to apply:** Links enviados por e-mail devem usar uma URL pública HTTPS estável, nunca o domínio de preview. Ao investigar uma falha, comparar remetente, `messageId` e status transacional entre uma mensagem entregue e uma mensagem ausente. Se estiver `Delivered`, investigar quarentena/filtro do domínio destinatário; se houver bounce, block ou defer, corrigir no Brevo.

Para notificações automáticas de atividades, o DAC só deve receber a confirmação depois que o Brevo registrar `delivered` para o proponente. Envios `deferred` devem permanecer pendentes e usar retentativas espaçadas, sem considerar a aceitação inicial da API como entrega.

**Why:** A API do Brevo pode aceitar a solicitação e depois registrar timeout na entrega; avisar o DAC imediatamente cria uma confirmação falsa e impede uma recuperação confiável.

**How to apply:** Registrar os `messageId`s, aguardar `delivered`, tentar novamente no máximo algumas vezes com intervalo e avisar o DAC apenas após a confirmação técnica de entrega ao servidor do destinatário.