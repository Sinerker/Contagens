-- Rodar no Supabase do Contagens: SQL Editor > colar tudo > Run.
-- Não apaga nenhum dado. Pode rodar mais de uma vez sem problema.
-- 2026-10-29 — v31: encerrar a parte de alguém (admin), fechar sem força,
-- e contagens que chegam depois do fechamento (arquivo complementar).

-- 1) Colunas novas
alter table lote_participante
  add column if not exists encerrado_em  timestamptz,
  add column if not exists encerrado_por uuid references perfil(id);
alter table contagem
  add column if not exists atrasada boolean not null default false;
alter table lote
  add column if not exists atrasadas_enviado_em timestamptz;

-- 2) Contagem que entra com o lote já fechado é marcada como atrasada.
create or replace function private.marcar_atrasada()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.atrasada := exists (select 1 from lote where id = new.lote_id and status = 'fechado');
  return new;
end $$;
create or replace trigger contagem_atrasada before insert on contagem
  for each row execute function private.marcar_atrasada();

-- 3) Cancelamento que chega atrasado NÃO mexe no arquivo principal: só
--    cancela se o lançamento cancelado também for atrasado. O zero fica
--    registrado e aparece no complemento como aviso.
create or replace function private.marcar_cancelada()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.cancela_id is not null then
    if new.atrasada and exists (select 1 from contagem
                                 where id = new.cancela_id and lote_id = new.lote_id
                                   and not atrasada) then
      return new;
    end if;
    update contagem
       set cancelada = true
     where id = new.cancela_id
       and lote_id = new.lote_id
       and cancelada = false;
    if not found then
      raise exception 'Lançamento a cancelar não existe, é de outro lote ou já foi cancelado';
    end if;
  end if;
  return new;
end $$;

-- 4) Quem pode mandar contagem com o lote fechado: só quem teve a parte
--    encerrada pelo administrador, só o que foi contado ANTES do encerramento,
--    e só enquanto as contagens do inventário não foram apagadas.
create or replace function private.pode_atrasada(p_lote bigint, p_contado_em timestamptz)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
      from lote l
      join lote_participante p on p.lote_id = l.id and p.perfil_id = auth.uid()
     where l.id = p_lote
       and l.status = 'fechado'
       and l.contagens_apagadas_em is null
       and p.encerrado_em is not null
       and p_contado_em <= p.encerrado_em
  );
$$;
revoke execute on function private.pode_atrasada(bigint, timestamptz) from public, anon;
grant execute on function private.pode_atrasada(bigint, timestamptz) to authenticated;

alter policy contagem_criar on contagem
  with check (
    perfil_id = auth.uid()
    and private.participa_do_lote(lote_id)
    and (
      (exists (select 1 from lote l where l.id = contagem.lote_id and l.status = 'aberto')
       and private.produto_no_lote(lote_id, seqproduto))
      or private.pode_atrasada(lote_id, contado_em)
    )
  );

-- 5) Administrador encerra a parte de uma pessoa
create or replace function public.encerrar_participacao(p_lote bigint, p_perfil uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not private.eh_admin() then
    raise exception 'Só o administrador pode encerrar a parte de outra pessoa.';
  end if;
  if not exists (select 1 from lote where id = p_lote and status = 'aberto') then
    raise exception 'O inventário já está fechado.';
  end if;
  update lote_participante
     set finalizado_em = now(), encerrado_em = now(), encerrado_por = auth.uid()
   where lote_id = p_lote and perfil_id = p_perfil and finalizado_em is null;
  if not found then
    raise exception 'Essa pessoa já finalizou ou não participa deste inventário.';
  end if;
end $$;
revoke execute on function public.encerrar_participacao(bigint, uuid) from public, anon;
grant execute on function public.encerrar_participacao(bigint, uuid) to authenticated;

-- 6) Voltar a contar desfaz também o encerramento pelo administrador
create or replace function public.reabrir_participacao(p_lote bigint)
returns void language plpgsql set search_path to 'public' as $$
begin
  if not exists (select 1 from lote where id = p_lote and status = 'aberto') then
    raise exception 'Este inventário já foi fechado. Não dá mais para voltar a contar.';
  end if;
  update lote_participante
     set finalizado_em = null, encerrado_em = null, encerrado_por = null
   where lote_id = p_lote and perfil_id = auth.uid();
  if not found then
    raise exception 'Você não participa deste inventário.';
  end if;
end $$;

-- 7) Fechar: nunca com alguém sem finalizar (p_forcar fica só por compatibilidade)
create or replace function public.fechar_lote(p_lote bigint, p_forcar boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_total integer; v_prontos integer;
begin
  if not exists (select 1 from lote where id = p_lote and status = 'aberto') then
    raise exception 'Lote já fechado ou inexistente.';
  end if;
  if not exists (select 1 from lote_participante
                  where lote_id = p_lote and perfil_id = auth.uid())
     and not private.eh_admin() then
    raise exception 'Só quem participou do lote pode fechá-lo.';
  end if;
  select count(*), count(finalizado_em) into v_total, v_prontos
    from lote_participante where lote_id = p_lote;
  if v_total = 0 then
    raise exception 'Nenhum participante neste lote.';
  end if;
  if v_prontos < v_total then
    raise exception 'Ainda faltam % de % participantes finalizar. Ninguém fecha o inventário com alguém contando — o administrador pode encerrar a parte de quem não tiver como finalizar.',
      v_total - v_prontos, v_total;
  end if;
  update lote set status = 'fechado', fechado_em = now(), fechado_por = auth.uid() where id = p_lote;
  -- Categorias resolvidas: peso morto depois de fechado (ver versão anterior).
  delete from lote_categoria where lote_id = p_lote;
  return jsonb_build_object('id', p_lote, 'participantes', v_total, 'forcado', false);
end $$;

-- 8) Arquivos: principal (sem atrasadas, igual a antes) ou complemento (só atrasadas)
create or replace function public.gerar_arquivos(p_lote bigint, p_atrasadas boolean)
returns jsonb language plpgsql set search_path to 'public' set statement_timeout to '60s' as $$
declare
  v_txt text; v_csv text; v_dados jsonb;
  v_nome text; v_loja text; v_data text;
  v_linhas integer; v_produtos integer;
  v_sem_codigo_lanc integer; v_sem_codigo_prod integer;
  v_cancel_ignorados integer;
begin
  select l.nome, j.codigo,
         to_char(case when p_atrasadas then now() else coalesce(l.fechado_em, now()) end
                 at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
    into v_nome, v_loja, v_data
    from lote l join loja j on j.id = l.loja_id
   where l.id = p_lote;

  if v_nome is null then
    raise exception 'Lote não encontrado.';
  end if;

  if exists (select 1 from lote where id = p_lote and contagens_apagadas_em is not null) then
    raise exception 'As contagens deste inventário foram apagadas em %. O TXT e o CSV não podem mais ser gerados — eles foram enviados por e-mail antes disso.',
      to_char((select contagens_apagadas_em from lote where id = p_lote) at time zone 'America/Sao_Paulo', 'DD/MM/YYYY');
  end if;

  select string_agg(linha, E'\n' order by codacesso), count(*)
    into v_txt, v_produtos
    from (
      select codacesso,
             '000000' || lpad(codacesso, 14, '0')
                      || lpad(round(sum(quantidade))::text, 7, '0') as linha
        from contagem
       where lote_id = p_lote and not cancelada and atrasada = p_atrasadas
         and codacesso is not null and codacesso <> ''
       group by codacesso
      having round(sum(quantidade)) > 0
    ) t;

  select count(*), count(distinct seqproduto)
    into v_sem_codigo_lanc, v_sem_codigo_prod
    from contagem
   where lote_id = p_lote and not cancelada and atrasada = p_atrasadas
     and (codacesso is null or codacesso = '');

  select 'DATA;HORA;USUARIO;TIPO-CONTAGEM;CORREDOR;COLUNA;ANDAR;SEQPRODUTO;CODACESSO;DESCCOMPLETA;QTDEMBALAGEM;QUANTIDADE;'
         || coalesce(E'\n' || string_agg(linha, E'\n' order by ordem), ''),
         count(*)
    into v_csv, v_linhas
    from (
      select c.contado_em as ordem,
             to_char(c.contado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') || ';' ||
             to_char(c.contado_em at time zone 'America/Sao_Paulo', 'HH24:MI:SS') || ';' ||
             upper(pf.nome)              || ';' ||
             upper(c.tipo)               || ';' ||
             upper(c.corredor)           || ';' ||
             upper(c.coluna)             || ';' ||
             upper(c.andar)              || ';' ||
             c.seqproduto::text          || ';' ||
             coalesce(c.codacesso, '')   || ';' ||
             upper(c.descricao)          || ';' ||
             c.qtdembalagem::text        || ';' ||
             c.quantidade::text          as linha
        from contagem c
        join perfil pf on pf.id = c.perfil_id
       where c.lote_id = p_lote and not c.cancelada and c.atrasada = p_atrasadas
    ) t;

  select jsonb_agg(
           jsonb_build_array(
             to_char(c.contado_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
             to_char(c.contado_em at time zone 'America/Sao_Paulo', 'HH24:MI:SS'),
             upper(pf.nome), upper(c.tipo), upper(c.corredor),
             upper(c.coluna), upper(c.andar),
             c.seqproduto,
             coalesce(c.codacesso, ''),
             upper(c.descricao),
             c.qtdembalagem,
             c.quantidade
           ) order by c.contado_em
         )
    into v_dados
    from contagem c
    join perfil pf on pf.id = c.perfil_id
   where c.lote_id = p_lote and not c.cancelada and c.atrasada = p_atrasadas;

  -- Cancelamentos que chegaram atrasados apontando para lançamento do arquivo
  -- principal: não mexem nele (o principal não muda), mas precisam ser vistos.
  select count(*) into v_cancel_ignorados
    from contagem a join contagem o on o.id = a.cancela_id
   where a.lote_id = p_lote and a.atrasada and not o.atrasada;

  return jsonb_build_object(
    'arquivo',  regexp_replace(upper(v_nome), '[^A-Z0-9]+', '_', 'g') || '_' || upper(v_loja) || '_' || v_data
                || case when p_atrasadas then '_COMPLEMENTO' else '' end,
    'txt',      coalesce(v_txt, ''),
    'csv',      v_csv,
    'dados',    coalesce(v_dados, '[]'::jsonb),
    'produtos', coalesce(v_produtos, 0),
    'lancamentos', coalesce(v_linhas, 0),
    'efetivos', (select count(*) from contagem where lote_id = p_lote and not cancelada
                   and quantidade <> 0 and atrasada = p_atrasadas),
    'sem_codigo_lancamentos', coalesce(v_sem_codigo_lanc, 0),
    'sem_codigo_produtos',    coalesce(v_sem_codigo_prod, 0),
    'cancelamentos_ignorados', case when p_atrasadas then coalesce(v_cancel_ignorados, 0) else 0 end,
    'complemento', p_atrasadas
  );
end $$;
revoke execute on function public.gerar_arquivos(bigint, boolean) from public, anon;
grant execute on function public.gerar_arquivos(bigint, boolean) to authenticated, service_role;

-- A versão de sempre (só o lote) continua existindo e passa a montar o
-- arquivo principal, sem as atrasadas. Quem chama do jeito antigo não muda.
create or replace function public.gerar_arquivos(p_lote bigint)
returns jsonb language sql set search_path to 'public' as $$
  select public.gerar_arquivos(p_lote, false);
$$;

-- 9) Marcar o complemento como enviado por e-mail
create or replace function public.marcar_atrasadas_enviadas(p_lote bigint)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from lote_participante where lote_id = p_lote and perfil_id = auth.uid())
     and not private.eh_admin() then
    raise exception 'Só quem participou do inventário pode marcar o envio.';
  end if;
  update lote set atrasadas_enviado_em = now() where id = p_lote;
end $$;
revoke execute on function public.marcar_atrasadas_enviadas(bigint) from public, anon;
grant execute on function public.marcar_atrasadas_enviadas(bigint) to authenticated;

-- 10) Apagar: também exige o complemento enviado, se chegou atrasada valendo
--     depois do último envio dele.
create or replace function public.apagar_inventario(p_lote bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
  select count(*) into v_contagens from contagem
   where lote_id = p_lote and not cancelada and quantidade <> 0 and not atrasada;
  if v_contagens > 0 and v.enviado_em is null then
    raise exception 'Este inventário ainda não foi enviado por e-mail. Enquanto o arquivo não sair, ele não pode ser apagado.';
  end if;
  if exists (select 1 from contagem
              where lote_id = p_lote and atrasada and not cancelada and quantidade <> 0
                and recebido_em > coalesce(v.atrasadas_enviado_em, '-infinity'::timestamptz)) then
    raise exception 'Chegaram contagens depois do fechamento que ainda não foram enviadas por e-mail (arquivo complementar). Envie antes de apagar.';
  end if;
  delete from contagem          where lote_id = p_lote;
  delete from lote_extra        where lote_id = p_lote;
  delete from lote_categoria    where lote_id = p_lote;
  delete from lote_participante where lote_id = p_lote;
  delete from lote              where id      = p_lote;
  return jsonb_build_object('apagado', true, 'nome', v.nome, 'contagens', v_contagens);
end $$;

-- 11) Limpeza automática: não apaga se houver complemento sem enviar
create or replace function public.limpar_inventarios_antigos(p_dias integer default 7)
returns jsonb language plpgsql security definer set search_path to 'public' set statement_timeout to '120s' as $$
declare v_lotes integer := 0; r record;
begin
  for r in
    select l.id from lote l
     where l.status = 'fechado'
       and l.enviado_em is not null
       and l.enviado_em < now() - make_interval(days => p_dias)
       and not exists (select 1 from contagem c
                        where c.lote_id = l.id and c.atrasada and not c.cancelada and c.quantidade <> 0
                          and c.recebido_em > coalesce(l.atrasadas_enviado_em, '-infinity'::timestamptz))
  loop
    delete from contagem          where lote_id = r.id;
    delete from lote_extra        where lote_id = r.id;
    delete from lote_categoria    where lote_id = r.id;
    delete from lote_participante where lote_id = r.id;
    delete from lote              where id      = r.id;
    v_lotes := v_lotes + 1;
  end loop;
  return jsonb_build_object('inventarios', v_lotes, 'dias', p_dias);
end $$;

-- 12) Resumo: principal sem atrasadas; colunas novas no fim
create or replace view public.lote_resumo as
 SELECT l.id,
    l.nome,
    l.loja_id,
    j.codigo AS loja_codigo,
    j.nome AS loja_nome,
    l.criado_em,
    l.status,
    l.fechado_em,
    pf.nome AS criado_por_nome,
    (COALESCE(l.itens, 0))::bigint AS itens,
    COALESCE((l.lancamentos)::bigint, ( SELECT count(*) AS count
           FROM contagem c
          WHERE ((c.lote_id = l.id) AND (NOT c.cancelada) AND (NOT c.atrasada)))) AS lancamentos,
    ( SELECT count(*) AS count
           FROM lote_participante p
          WHERE (p.lote_id = l.id)) AS participantes,
    ( SELECT count(*) AS count
           FROM lote_participante p
          WHERE ((p.lote_id = l.id) AND (p.finalizado_em IS NOT NULL))) AS finalizados,
    l.enviado_em,
    l.contagens_apagadas_em,
    ( SELECT count(*) AS count
           FROM contagem c
          WHERE ((c.lote_id = l.id) AND (NOT c.cancelada) AND (c.quantidade <> (0)::numeric) AND (NOT c.atrasada))) AS efetivos,
    ( SELECT count(*) AS count
           FROM contagem c
          WHERE ((c.lote_id = l.id) AND (NOT c.cancelada) AND c.atrasada)) AS atrasadas,
    ( SELECT max(c.recebido_em)
           FROM contagem c
          WHERE ((c.lote_id = l.id) AND c.atrasada)) AS atrasadas_ultima,
    l.atrasadas_enviado_em
   FROM ((lote l
     JOIN loja j ON ((j.id = l.loja_id)))
     JOIN perfil pf ON ((pf.id = l.criado_por)));
