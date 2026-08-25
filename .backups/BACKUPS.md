# Registro de Backups / Pontos de Restauração

Este arquivo fica versionado no Git, então é acessível de qualquer ambiente Replit
(qualquer conta/agente) que tenha acesso a este repositório — basta puxar o repo
e conferir o histórico do Git ou este arquivo.

Para restaurar, diga ao agente:
- "Volte para o backup **[nome]**", ou
- "Volte para o commit **[hash]**"

## Backups disponíveis

| Nome (use para pedir a restauração) | Commit (hash) | Data | Descrição |
|---|---|---|---|
| `etapas-lineares-2026-07-02` | `44abd08` | 02/07/2026 | Estado do `index.html` com o fluxo linear original de etapas (Ensaio → Montagem → Evento → Desmontagem), salvo antes de testes de alteração nessa tela. Cópia integral também em `.backups/index_backup_2026-07-02.html`. |

## Como o agente deve restaurar

1. Localizar o commit pelo hash na tabela acima (ou pelo arquivo de cópia integral em `.backups/`).
2. Restaurar os arquivos afetados para o estado daquele commit (via `git show <hash>:<arquivo>` ou copiando o arquivo de backup salvo em `.backups/`).
3. Confirmar com o usuário o que foi restaurado antes de reiniciar o workflow.

> Observação: commits e checkpoints anteriores a este registro também existem no histórico do Git e podem ser referenciados diretamente pelo hash, mesmo sem um nome cadastrado aqui.
