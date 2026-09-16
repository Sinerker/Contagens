-- =============================================
--  Apagar inventario: tudo, e so depois do e-mail
-- =============================================
--  Cole no SQL Editor do Supabase e aperte Run.
--
--  Antes: existiam duas limpezas separadas e uma delas dava para forcar
--  sem ter enviado o e-mail. Agora e uma so, apaga o inventario inteiro
--  do servidor, e nao ha como forcar: sem o carimbo do e-mail a funcao
--  recusa, ponto.
-- =============================================

create or replace function apagar_inventario(p_lote bigint)
returns jsonb
language plpgsql
security definer
set search_path to public
as $fn$
declare v lote%rowtype; v_contagens integer;
begin
  select * into v from lote where id = p_lote;
  if v.id is null then
    raise exception 'Inventário não encontrado.';
  end if;

  if not exists (select 1 from lote_participante where lote_id = p_lote and perfil_id = auth.uid())
     and not private.eh_admin() then
    raise exception 'Só quem participou do inventário pode apagá-lo.';
  end if;

  if v.status <> 'fechado' then
    raise exception 'O inventário precisa estar fechado antes de ser apagado.';
  end if;

  -- A trava. Sem e-mail enviado, nao apaga de jeito nenhum.
  if v.enviado_em is null then
    raise exception 'Este inventário ainda não foi enviado por e-mail. Enquanto o arquivo não sair, ele não pode ser apagado.';
  end if;

  select count(*) into v_contagens from contagem where lote_id = p_lote;

  delete from contagem          where lote_id = p_lote;
  delete from lote_extra        where lote_id = p_lote;
  delete from lote_categoria    where lote_id = p_lote;
  delete from lote_participante where lote_id = p_lote;
  delete from lote              where id      = p_lote;

  return jsonb_build_object('apagado', true, 'nome', v.nome, 'contagens', v_contagens);
end $fn$;

-- A versao que dava para forcar deixa de existir.
drop function if exists apagar_contagens(bigint, boolean);

-- A limpeza automatica passa a apagar o inventario inteiro tambem.
create or replace function limpar_inventarios_antigos(p_dias integer default 7)
returns jsonb
language plpgsql
security definer
set search_path to public
set statement_timeout = '120s'
as $fn$
declare v_lotes integer := 0; r record;
begin
  for r in
    select id from lote
     where status = 'fechado'
       and enviado_em is not null
       and enviado_em < now() - make_interval(days => p_dias)
  loop
    delete from contagem          where lote_id = r.id;
    delete from lote_extra        where lote_id = r.id;
    delete from lote_categoria    where lote_id = r.id;
    delete from lote_participante where lote_id = r.id;
    delete from lote              where id      = r.id;
    v_lotes := v_lotes + 1;
  end loop;
  return jsonb_build_object('inventarios', v_lotes, 'dias', p_dias);
end $fn$;

revoke execute on function apagar_inventario(bigint), limpar_inventarios_antigos(integer) from public, anon;
grant  execute on function apagar_inventario(bigint) to authenticated;
