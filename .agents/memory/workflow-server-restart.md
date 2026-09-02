---
name: Reinício do servidor no preview
description: O workflow Node do preview não recarrega alterações do server.js automaticamente.
---

Depois de alterar o backend, o workflow principal precisa ser reiniciado antes de testar as rotas. Confirme também o horário/PID do novo processo e faça uma chamada simples à API; caso contrário, o preview pode continuar respondendo com uma versão antiga do servidor.

**Why:** O processo Node manteve uma versão anterior do código mesmo após mudanças no arquivo, fazendo uma rota nova parecer inexistente e invalidando testes executados antes do reinício.

**How to apply:** Reinicie `Start application` após alterações em `server.js` e valide a rota afetada antes de concluir a tarefa.