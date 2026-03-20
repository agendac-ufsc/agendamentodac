# ⚙️ Guia de Configurações: Personalização de Formulários e Planilhas

Este guia explica como utilizar a nova aba de **Configurações** do Painel Administrativo para alterar os links da segunda etapa da inscrição.

---

## 1. O que pode ser alterado?
Através do painel, o administrador pode modificar dois links principais:
1.  **Link do Google Forms**: O formulário que o usuário verá e preencherá após concluir a primeira etapa no site.
2.  **Planilha do Google Sheets**: A planilha onde as respostas desse formulário são salvas, permitindo que o sistema unifique os dados automaticamente.

---

## 2. Passo a Passo para Troca de Formulário

### Passo 1: Preparação do Google Forms e Sheets
1.  Crie seu novo **Google Forms** normalmente.
2.  Nas configurações do formulário, certifique-se de que as perguntas de identificação usem termos padrão:
    *   **E-mail**: Use "E-mail", "Email" ou "Email Address".
    *   **Telefone**: Use "Telefone", "Celular", "Phone" ou "Phone Number".
3.  Vá na aba "Respostas" do Forms e clique em **"Ver no Sheets"** para abrir a planilha vinculada.

### Passo 2: Autorização de Acesso (CRUCIAL)
Para que o sistema consiga ler os dados da sua nova planilha, você **DEVE** compartilhá-la com o e-mail de serviço do sistema:
1.  Na planilha do Google Sheets, clique no botão azul **"Compartilhar"**.
2.  Adicione o seguinte e-mail:  
    `agendamento-dac-service@agendamento-dac.iam.gserviceaccount.com`
3.  Defina a permissão como **"Leitor"** e clique em "Enviar".

### Passo 3: Configuração no Painel Administrativo
1.  Acesse o seu **Painel Administrativo** do Agendamento DAC.
2.  Clique no botão **"Configurações"** (ícone de engrenagem ⚙️) no topo da página.
3.  No campo **"Link do Google Forms"**, cole a URL completa do seu novo formulário.
4.  No campo **"Link da Planilha do Google Sheets"**, cole a URL completa da planilha (o sistema extrairá o ID automaticamente).
5.  Clique em **"Salvar Alterações"**.

---

## 3. Como a "Mágica" da Unificação Funciona?

O sistema agora é inteligente e flexível:
*   **Busca Automática de Abas**: Não importa o nome da aba da planilha (ex: "Respostas ao formulário 1", "Form Responses 1", etc.), o sistema agora busca automaticamente a primeira aba disponível.
*   **Reconhecimento de Colunas**: O sistema "lê" os títulos das colunas e identifica onde estão o e-mail e o telefone, mesmo que estejam em inglês ou em ordens diferentes.
*   **Cruzamento em Tempo Real**: Assim que você salva o novo link, o sistema passa a buscar os dados na nova planilha e cruza com os agendamentos já existentes no banco de dados via e-mail ou telefone.

---

## 4. Solução de Problemas (FAQ)

*   **Erro ao carregar dados unificados?**
    *   Verifique se a planilha foi compartilhada com o e-mail de serviço mencionado no Passo 2.
    *   Verifique se a planilha possui pelo menos uma linha de resposta (além do cabeçalho).
*   **O link do Forms não mudou no site?**
    *   As alterações são aplicadas instantaneamente. Tente atualizar a página de inscrição do site (F5).
*   **Dados não estão cruzando?**
    *   Certifique-se de que o usuário usou o **mesmo e-mail** ou o **mesmo telefone** nas duas etapas.

---
*Desenvolvido para a equipe DAC - UFSC*
