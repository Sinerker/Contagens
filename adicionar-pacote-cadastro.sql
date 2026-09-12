-- Cole no SQL Editor do Supabase e aperte Run.
-- Devolve o catálogo inteiro no mesmo formato do pacote do lote. O coletor
-- baixa isso uma vez por versão do cadastro, e só quando o inventário for
-- parcial: em inventário de todas as categorias a lista do lote já é o
-- cadastro inteiro.
create or replace function pacote_cadastro(p_apos integer default 0, p_limite integer default 20000)
returns text
language sql
stable
security invoker
set search_path = public
set statement_timeout = '60s'
as $fn$
  select coalesce(string_agg(linha, E'\n' order by seqproduto), '')
    from (
      select pl.seqproduto, pl.linha
        from produto_linha pl
       where pl.seqproduto > p_apos
       order by pl.seqproduto
       limit p_limite
    ) t;
$fn$;

revoke execute on function pacote_cadastro(integer, integer) from anon;
grant  execute on function pacote_cadastro(integer, integer) to authenticated;
