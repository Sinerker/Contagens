# Contagens

Inventário por categoria: você marca o que contar na árvore do sistema,
o coletor conta offline, e o TXT e o CSV saem prontos e unificados.

Substitui o InventarioPostos, que continua no ar até a migração.

## Como funciona

1. **Administração** — você carrega o cadastro escolhendo os relatórios do
   sistema: um de níveis e os de EANs. O site confere as contagens de linha,
   junta os dois pelo código do produto e monta a árvore de categorias.
   Cadastra também lojas e usuários.
2. **Login** — o contador escolhe o nome numa lista, escolhe a loja e digita
   a senha. Ninguém digita e-mail.
3. **Inventário** — qualquer usuário cria marcando categorias. O inventário
   guarda **as categorias**, não uma cópia do catálogo: criar leva menos de
   meio segundo e o banco não incha a cada inventário.
4. **Contagem** — o coletor baixa a lista uma vez e conta offline. Vários
   contadores no mesmo inventário.
5. **Fechamento** — cada um finaliza sua parte. Quando o último termina,
   saem o TXT unificado e o CSV detalhado, por download e por e-mail.

## Regras que o código não quebra

- **Quantidade crua.** O banco guarda o número exatamente como foi digitado.
- **Nada é sobrescrito.** Correção entra como registro novo apontando para o
  anterior. O cancelado não entra no arquivo, mas fica registrado.
- **Offline é o normal.** Toda contagem grava no aparelho primeiro. O envio é
  consequência; sem sinal, o trabalho continua.
- **Produto sem cadastro nunca entra.** Produto que existe no sistema mas
  ficou fora do inventário pode ser adicionado; produto que o sistema não
  conhece é recusado.
- **Ninguém finaliza com a fila cheia.** Finalizar com contagem parada no
  aparelho faria o arquivo sair sem ela.
- **Carga de cadastro só com tudo fechado.** Inventário aberto trava a carga,
  senão a lista dele mudaria no meio da contagem.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `index.html` / `index.js` | Login: usuário, loja e senha |
| `lotes.html` / `lotes.js` | Os inventários da loja |
| `criar-lote.html` / `criar-lote.js` | Árvore de categorias |
| `contagens.html` / `contagens.js` | A tela do coletor, offline |
| `teclado.js` | O teclado da tela de contagem, no lugar do teclado do Android |
| `fechamento.html` / `fechamento.js` | Finalizar, fechar e entregar |
| `admin.html` / `admin.js` | Cadastro do sistema, lojas e usuários |
| `local.js` | Banco do aparelho, índices de busca e fila de envio |
| `api.js` | Login e chamadas ao banco, sem biblioteca externa |
| `sw.js` / `pwa.js` | Faz o app abrir sem internet |

## No aparelho

O catálogo do inventário é guardado como um bloco de texto no IndexedDB e os
índices de busca são montados na memória quando a tela abre — cerca de um
segundo para 136 mil produtos num coletor fraco. As contagens gravam no
aparelho antes de subir.

**Instale o app na tela inicial.** É isso que faz o navegador proteger os
dados guardados: sem essa proteção, o Android pode descartá-los quando o
aparelho ficar sem espaço.

## Testar aqui

Clique em `TESTAR AQUI.bat`. Abre em `http://localhost:8000`.
Precisa ser localhost ou HTTPS, senão o Service Worker não funciona.

## Publicar

O site sai do próprio repositório: o GitHub Pages já está ligado em
Settings → Pages → Branch `main`, pasta `/ (root)`. Publicar é só mandar os
arquivos para lá — `git push`, ou pelo site do GitHub, em Add file → Upload
files. Cada envio reconstrói a página sozinho.

Ao mexer em qualquer arquivo do site, **mude a versão no topo do `sw.js`**
(`contagens-v14` → `v15`). É ela que faz o coletor largar o que estava
guardado e baixar o novo; sem isso o aparelho continua abrindo a versão
velha, mesmo com o GitHub já atualizado.

O repositório é público, então **nada de dado da empresa entra nele** — o
`.gitignore` já barra planilhas, CSVs e os relatórios do sistema. A chave que
está em `config.js` é pública de propósito: sozinha ela só faz o que as regras
de acesso do banco permitirem.

## Banco

Supabase, projeto `Contagens`. Regras de acesso em todas as tabelas: contagem
só entra em nome próprio, em inventário aberto, de produto que esteja na lista
— e não existe alteração nem exclusão para ninguém.
