# Integração HenrikDev

O backend local consulta a API HenrikDev; o navegador e o overlay não recebem a chave.

## Endpoints

- [`GET /valorant/v1/account/{name}/{tag}`](https://docs.henrikdev.xyz/api-reference/valorant/get-account-v1): resolve o PUUID.
- [`GET /valorant/v4/matches/{affinity}/{platform}/{name}/{tag}`](https://docs.henrikdev.xyz/api-reference/valorant/get-matches-by-name-v4): recebe `mode=competitive`, `size=10` e `start` para paginação.
- A [autenticação oficial](https://docs.henrikdev.xyz/general/auth) exige chave no cabeçalho `Authorization`.
- A [documentação de limites](https://docs.henrikdev.xyz/general/rate-limiting) informa que o custo pode incluir requisições internas à Riot; em `429` o programa respeita `Retry-After` e `X-RateLimit-Reset`.

As plataformas aceitas pelo painel são `pc` e `console`. O fuso escolhido é usado em todas as comparações de data, inclusive quando o overlay está desconectado. A contagem é determinada pelo início da partida, não pela hora da consulta.

## Completude e limitações

O esquema v4 não informa total ou marcador de fim. Para confirmar o dia, o programa exige uma página completa de partidas em ordem que alcance um dia anterior. A busca para após no máximo 100 itens. Uma página curta, vazia, duplicada ou inconsistente não comprova cobertura; o painel sinaliza o resultado incompleto e mantém a última contagem válida. Isso pode manter traços em contas com pouco histórico.

O endpoint de [histórico armazenado](https://docs.henrikdev.xyz/valorant/guides/stored-matches) pode conter lacunas silenciosas e não é utilizado para comprovar a contagem. Para cada partida v4, o programa valida identificador, fila competitiva, horário, conclusão, PUUID, equipes e placar. Não existe campo documentado de remake no esquema utilizado; partidas muito curtas e resultados sem vencedor identificável não incrementam o contador.

O sistema usa timeout, retries com backoff, coalescência de consultas e uma cópia persistida do último estado completo por conta, região, plataforma, fuso e dia. O overlay recebe eventos SSE e consulta o servidor local como fallback, sem chamar a API externa.
