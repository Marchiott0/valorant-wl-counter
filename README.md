# Valorant W/L Counter

Um contador local de vitórias e derrotas competitivas do dia, com overlay transparente para OBS Studio. Feito para Windows, sem modificar o jogo ou acessar sua memória.

Exemplo do overlay: **W = 2 / L = 1**.

## Baixar e começar

1. Baixe o arquivo **valorant-wl-counter-windows.zip** na página de [Releases](https://github.com/Marchiott0/valorant-wl-counter/releases/latest).
2. Extraia o ZIP inteiro em uma pasta e abra **Valorant W-L.exe**. A alternativa é executar **iniciar.bat**.
3. O painel será aberto em [http://127.0.0.1:3791](http://127.0.0.1:3791).
4. Informe seu **Riot ID** (`Nome#TAG`), região, plataforma, fuso horário e frequência de atualização.
5. Obtenha sua própria chave no [painel HenrikDev](https://api.henrikdev.xyz/dashboard/): acesse **API Keys → Generate New Key**. Cole a chave no campo do aplicativo.
6. Clique em **Salvar e conectar** e confira o status. A aparência pode ser alterada e salva no painel.

O ZIP pronto inclui o runtime Node.js e sua licença. Mantenha os arquivos e pastas extraídos juntos. Cada pessoa precisa de uma chave própria e executa sua cópia localmente.

## Adicionar ao OBS

1. Selecione uma cena e clique em **Fontes → + → Navegador**.
2. Crie a fonte, deixe **Arquivo local** desmarcado e informe:

   ```text
   http://127.0.0.1:3791/overlay
   ```

3. Use largura **800** e altura **180** como ponto de partida. Confirme e posicione o texto na cena.
4. Se o texto ficar escondido, mova a fonte para cima na lista de fontes.

O fundo é transparente. A fonte, o tamanho, as cores e o intervalo podem ser alterados no painel. Deixe o aplicativo rodando enquanto usa o OBS; fechar a aba não o encerra. Use **parar.bat** para encerrar o servidor.

## Como os resultados são contados

- Somente partidas da fila competitiva concluídas contam. Outros modos, partidas ainda em andamento, empates e remakes identificáveis são ignorados.
- A data é a do **início da partida no fuso escolhido**; a contagem reinicia na meia-noite desse fuso.
- As consultas são automáticas, com opções de intervalo entre **30 e 300 segundos**. A API pode demorar para disponibilizar os resultados e aplicar limites à chave.
- Se ocorrer uma falha ou a cobertura do histórico não puder ser comprovada, o painel avisa e o overlay mantém a última contagem confirmada do mesmo dia. Sem confirmação anterior, mostra `W = — / L = —`.
- A API não informa o total nem uma marca de fim para o histórico v4. Por segurança, páginas curtas, vazias, repetidas ou inconsistentes e históricos que atingem o limite de busca são tratados como incompletos. Contas com poucas partidas podem permanecer com traços mesmo quando parte do histórico existe.
- Reiniciar o programa recupera a última contagem válida do mesmo dia e tenta sincronizar novamente.

Detalhes técnicos e referências oficiais: [docs/API.md](docs/API.md).

## Chave e privacidade

A chave é enviada pelo backend apenas à API HenrikDev, nunca ao overlay. O Windows protege a chave com DPAPI para o usuário atual. Configurações, estado, chave criptografada e logs ficam na pasta `data`, que não é incluída no código ou no ZIP de distribuição. Não compartilhe a pasta `data`; ao trocar de usuário do Windows, configure a chave novamente.

O servidor escuta somente em `127.0.0.1`: o endereço abre no computador onde o programa está rodando. Não é uma hospedagem pública nem funciona diretamente em outro computador da rede.

## Problemas frequentes

| Situação | O que fazer |
| --- | --- |
| Chave recusada ou conta não encontrada | Confira a chave, o Riot ID com tag, a região e a plataforma. |
| Histórico incompleto ou traços | Aguarde e confira o aviso no painel. Uma resposta curta ou inconsistente não é tratada como contagem completa. |
| Limite de requisições | Aguarde; o programa respeita o tempo informado pelo serviço. Se necessário, aumente o intervalo. |
| Porta 3791 ocupada | Encerre outra instância do contador ou o programa que utiliza a porta e tente novamente. |
| OBS não atualiza | Confirme que o aplicativo está aberto, que a URL é exata e que a fonte está visível na cena. |
| Outra conta do Windows não abre a chave | Insira novamente uma chave válida nesse usuário. |

## Executar a partir do código-fonte

O ZIP de código-fonte do GitHub não inclui o executável nem o Node.js. Instale [Node.js para Windows](https://nodejs.org/) versão **22 ou superior**, extraia o código e abra **iniciar.bat**. Nenhum `npm install` é necessário.

Para desenvolvimento, no PowerShell dentro da pasta:

```powershell
node tools/check.mjs
node --test test/*.test.mjs
node src/server.mjs
```

Os testes usam dados sintéticos baseados no formato documentado da API; eles não substituem uma validação com chave e partidas reais nem a conferência visual no OBS.

## Licença

O código do projeto está sob a [licença MIT](LICENSE). O Node.js incluído no pacote pronto possui sua [própria licença](licenses/NODEJS-LICENSE.txt).

Projeto independente, sem afiliação com a Riot Games ou a HenrikDev.
