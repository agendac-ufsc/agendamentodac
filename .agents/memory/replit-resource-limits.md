---
name: Recursos do ambiente
description: Falhas temporárias de processos durante instalações de dependências e reinícios de workflows.
---

Instalações de pacotes e reinícios de workflows podem falhar com `EAGAIN` quando workflows de artefatos estão consumindo os recursos de processo do ambiente.

**Why:** Esse erro pode aparecer antes de qualquer comando do projeto iniciar e não indica, por si só, uma falha no código ou nas dependências.

**How to apply:** Diferencie esse erro de uma falha de build; confirme os logs do workflow principal e tente novamente quando houver recursos disponíveis antes de alterar o projeto.