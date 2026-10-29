-- 2026-10-29 — voltar a contar reabre a parte no banco; conferência de envio antes de finalizar.
-- (já aplicado no Supabase do Contagens como migração reabrir_participacao_e_ids_ausentes)

create or replace function public.reabrir_participacao(p_lote bigint)
returns void
language plpgsql
set search_path to 'public'
as $$
begin
  if not exists (select 1 from lote where id = p_lote and status = 'aberto') then
    raise exception 'Este inventário já foi fechado. Não dá mais para voltar a contar.';
  end if;
  update lote_participante
     set finalizado_em = null
   where lote_id = p_lote and perfil_id = auth.uid();
  if not found then
    raise exception 'Você não participa deste inventário.';
  end if;
end;
$$;

-- Devolve, dos ids_local informados, os que o servidor NÃO tem neste lote.
create or replace function public.ids_ausentes(p_lote bigint, p_ids uuid[])
returns setof uuid
language sql
stable
set search_path to 'public'
as $$
  select u.id
    from unnest(p_ids) as u(id)
   where not exists (select 1 from contagem c
                      where c.lote_id = p_lote and c.id_local = u.id);
$$;

revoke execute on function public.reabrir_participacao(bigint) from public, anon;
revoke execute on function public.ids_ausentes(bigint, uuid[]) from public, anon;
grant execute on function public.reabrir_participacao(bigint) to authenticated;
grant execute on function public.ids_ausentes(bigint, uuid[]) to authenticated;
