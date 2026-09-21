-- =============================================
-- contagens-efetivas.sql
-- APLICADO NO BANCO EM 21/09/2026 (migração "contagens_efetivas").
-- Este arquivo é o registro do que foi feito — não precisa rodar de novo.
-- =============================================
--
-- O problema: o inventário JOAO ficou impossível de apagar.
--
--   · Contaram SKOL 5, corrigiram para 50, cancelaram.
--   · O cancelamento não apaga nada — grava um lançamento novo com
--     quantidade 0 apontando para o cancelado ("nada é sobrescrito").
--   · Ficaram 3 linhas no banco e ZERO contado de verdade.
--
--   · apagar_inventario exigia e-mail porque havia linhas.
--   · o envio recusava porque o TXT saía vazio.
--   · Cada lado usava uma definição diferente de "vazio". Beco sem saída.
--
-- A correção: uma definição só. Conta como contagem que vale o lançamento
-- NÃO cancelado com quantidade diferente de zero. O zero do cancelamento é
-- marca, não contagem — e o app não deixa gravar zero de verdade
-- (salvar() descarta quantidade 0).
--
-- A mesma expressão está em três lugares no banco, mais um no site. Os
-- quatro têm de concordar; se um mudar, mudam todos:
--
--   1. lote_resumo.efetivos         -> a tela decide se o botão de apagar trava
--   2. apagar_inventario            -> o banco decide se aceita apagar
--   3. gerar_arquivos -> 'efetivos' -> o envio decide se há o que mandar
--   4. fechamento.js, efetivos()    -> lê o 1
--
-- A função enviar-arquivos (Edge Function, versão 5) passou a recusar só
-- quando efetivos = 0. Se houver contagem valendo mas o TXT sair vazio (tudo
-- sem código de barras, ou acertos que zeraram a soma), o e-mail vai com o
-- CSV sozinho e explica por quê — antes ele recusava, e o inventário travava
-- do mesmo jeito.
-- =============================================

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
    COALESCE(l.itens, 0)::bigint AS itens,
    COALESCE(l.lancamentos::bigint, ( SELECT count(*) AS count
           FROM contagem c
          WHERE c.lote_id = l.id AND NOT c.cancelada)) AS lancamentos,
    ( SELECT count(*) AS count
           FROM lote_participante p
          WHERE p.lote_id = l.id) AS participantes,
    ( SELECT count(*) AS count
           FROM lote_participante p
          WHERE p.lote_id = l.id AND p.finalizado_em IS NOT NULL) AS finalizados,
    l.enviado_em,
    l.contagens_apagadas_em,
    ( SELECT count(*) AS count
           FROM contagem c
          WHERE c.lote_id = l.id AND NOT c.cancelada AND c.quantidade <> 0) AS efetivos
   FROM lote l
     JOIN loja j ON j.id = l.loja_id
     JOIN perfil pf ON pf.id = l.criado_por;

-- As duas funções foram alteradas no lugar (pg_get_functiondef + replace),
-- para não reescrever o corpo inteiro à mão. As permissões ficaram como
-- estavam: só authenticated e service_role executam.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.apagar_inventario'::regproc);
  d := replace(d,
    'select count(*) into v_contagens from contagem where lote_id = p_lote;',
    'select count(*) into v_contagens from contagem where lote_id = p_lote and not cancelada and quantidade <> 0;');
  if position('and not cancelada and quantidade <> 0' in d) = 0 then
    raise exception 'apagar_inventario: trecho esperado não encontrado — nada alterado';
  end if;
  execute d;

  d := pg_get_functiondef('public.gerar_arquivos'::regproc);
  d := replace(d,
    '''lancamentos'', coalesce(v_linhas, 0),',
    '''lancamentos'', coalesce(v_linhas, 0),
    ''efetivos'', (select count(*) from contagem where lote_id = p_lote and not cancelada and quantidade <> 0),');
  if position('''efetivos''' in d) = 0 then
    raise exception 'gerar_arquivos: trecho esperado não encontrado — nada alterado';
  end if;
  execute d;
end $$;
