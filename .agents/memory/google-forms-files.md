---
name: Google Forms file sync
description: Condições necessárias para copiar uploads do Google Forms para o armazenamento privado do painel.
---

Arquivos enviados pelo Google Forms não ficam automaticamente acessíveis à conta de serviço só porque a planilha de respostas foi compartilhada. A conta precisa ter acesso de leitor à pasta ou aos próprios arquivos. As chamadas da API do Drive para metadados e para o conteúdo precisam receber o cliente autenticado separadamente.

**Why:** A planilha pode ser lida com sucesso enquanto cada arquivo retorna `File not found` ou uma tela de login. Sem acesso ao arquivo, a sincronização não consegue criar o Blob privado.

**How to apply:** Ao ativar a sincronização, compartilhar a pasta de uploads do Forms com a conta de serviço configurada no projeto e recarregar a aba de inscrições. Manter autenticação explícita em toda chamada `drive.files.get`, inclusive quando a chamada usa `alt=media`.