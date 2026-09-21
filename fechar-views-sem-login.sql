-- =============================================
-- fechar-views-sem-login.sql
-- APLICADO NO BANCO EM 21/09/2026 (migração "fechar_views_sem_login").
-- Este arquivo é o registro do que foi feito — não precisa rodar de novo.
-- =============================================
--
-- O problema: duas views liam o banco sem login.
--
-- A chave em config.js é pública de propósito — ela só faz o que as regras
-- de acesso permitem. Nas TABELAS essas regras funcionam: todas têm RLS
-- ligado e nenhuma política para quem não está logado, então a resposta
-- sem login é sempre vazia.
--
-- Mas uma VIEW criada do jeito padrão roda com a permissão do DONO do banco,
-- e o dono passa por cima do RLS. Duas estavam assim:
--
--   lote_resumo  -> nome dos inventários, das lojas e de quem criou
--   lote_item    -> a lista de produtos de todos os inventários
--
-- Medido antes de fechar, entrando como "anon" (sem login):
--   lote_resumo  3 linhas        (todos os inventários)
--   lote_item    143.622 linhas
--   lote         0 linhas        (tabela: o RLS segurou)
--   contagem     0 linhas        (tabela: o RLS segurou)
--
-- A correção: tirar das cinco views qualquer permissão para anon. As três
-- que já rodam com a permissão de quem pergunta (security_invoker) não
-- vazavam, mas fechar custa nada e protege se um dia alguém tirar o
-- security_invoker delas.
--
-- Conferido depois de aplicar:
--   anon lendo lote_resumo           -> permission denied
--   logado lendo lote_resumo         -> 3 linhas, como antes
--   logado lendo lote_item           -> 143.622 linhas, como antes
--   anon executando dados_login      -> continua liberado (é o que monta as
--                                       listas de usuário e loja na tela de
--                                       entrada, antes do login)
--
-- REGRA PARA VIEW NOVA: criar com  with (security_invoker = true)  ou
-- rodar o revoke abaixo nela. O Supabase dá permissão a anon por padrão em
-- tudo que é criado no schema public — sem isso, a próxima view vaza igual.
-- =============================================

revoke all on public.lote_resumo          from anon;
revoke all on public.lote_item            from anon;
revoke all on public.categoria_arvore     from anon;
revoke all on public.ean_completo         from anon;
revoke all on public.sem_categoria_resumo from anon;
