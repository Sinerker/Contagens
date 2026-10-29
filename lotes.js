/* =============================================
   lotes.js — os inventários da loja
   ============================================= */

const sessao = API.exigirLogin();
let lojaAtual = sessao?.loja || null;

if (sessao) {
  document.getElementById("quem").textContent = sessao.usuario.nome;
  document.getElementById("btn-sair").addEventListener("click", () => API.sair());
  if (sessao.usuario.admin) document.getElementById("link-admin").hidden = false;
}

const numero = (n) => Number(n || 0).toLocaleString("pt-BR");

function quando(iso) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/* ---------- sem internet ---------- */
// Sem rede, a tela usa a última cópia que veio do servidor (API.copia) e
// avisa de quando ela é. Tudo o que precisa do banco para acontecer —
// entrar, continuar, criar — fica travado com um aviso, em vez de pendurar.
let semInternet = false;

function horaCopia(em) {
  const d = new Date(em);
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje
    ? `às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : `em ${quando(d.toISOString())}`;
}

function avisoRede(msg) {
  const el = document.getElementById("aviso-rede");
  el.innerHTML = msg || "";
  el.hidden = !msg;
}

function precisaInternet(oque) {
  avisoRede(`<b>Sem internet:</b> ${oque}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- loja ---------- */
async function montarLojas() {
  const sel = document.getElementById("troca-loja");
  let lojas;
  try {
    lojas = await API.selecionar("loja", "select=id,codigo,nome&ativo=is.true&order=codigo");
    API.guardarCopia("lojas", lojas);
  } catch (e) {
    if (!API.semRede(e)) throw e;
    const c = API.copia("lojas");
    if (!c) throw new Error("Sem internet e nenhuma lista salva neste aparelho. Conecte uma vez para abrir.");
    lojas = c.dado;
  }

  if (!lojas.length) {
    sel.innerHTML = "<option value=''>Nenhuma loja cadastrada</option>";
    return;
  }

  sel.innerHTML = lojas
    .map((l) => `<option value="${l.id}">${l.codigo} · ${l.nome}</option>`)
    .join("");

  // Sem loja na sessão (entrou antes de existir loja), assume a primeira
  if (!lojaAtual) lojaAtual = { id: lojas[0].id, codigo: lojas[0].codigo, nome: lojas[0].nome };
  sel.value = String(lojaAtual.id);
  aplicarLoja(lojas.find((l) => l.id === Number(sel.value)));

  sel.addEventListener("change", () => {
    aplicarLoja(lojas.find((l) => l.id === Number(sel.value)));
    listar();
  });
}

function aplicarLoja(l) {
  if (!l) return;
  lojaAtual = { id: l.id, codigo: l.codigo, nome: l.nome };
  const s = API.sessao();
  s.loja = lojaAtual;
  API.gravarSessao(s);
  document.getElementById("titulo-loja").textContent = `${l.codigo} · ${l.nome}`;
}

/* ---------- lista ---------- */
function cartaoLote(l, souParticipante) {
  const faltam = l.participantes - l.finalizados;
  const aberto = l.status === "aberto";

  const situacao = aberto
    ? l.participantes === 0
      ? "ninguém entrou ainda"
      : faltam === 0
        ? `${l.participantes} contando · todos finalizaram`
        : `${l.participantes} contando · ${faltam} ainda não finalizou`
    : `fechado em ${quando(l.fechado_em)}`;

  return `
    <div class="linha">
      <div class="linha-info">
        <div class="linha-titulo">${l.nome} ${souParticipante ? '<span class="etiqueta">você está nele</span>' : ""}</div>
        <div class="linha-sub">${numero(l.itens)} produtos · criado por ${l.criado_por_nome} em ${quando(l.criado_em)}</div>
        <div class="linha-sub">${situacao}</div>
        <div class="linha-sub"><span class="etiqueta etiqueta--apagada" id="baixa-${l.id}">verificando o aparelho…</span></div>
      </div>
      <div style="display:flex; flex-direction:column; gap:.35rem">
        <button class="botao botao--pequeno ${aberto ? "" : "botao--fantasma"}" data-abrir="${l.id}">
          ${aberto ? (souParticipante ? "Continuar" : "Entrar") : "Ver"}
        </button>
        ${aberto && souParticipante
          ? `<button class="botao botao--pequeno botao--fantasma" data-fechamento="${l.id}">Finalizar</button>`
          : ""}
      </div>
    </div>`;
}

async function listar() {
  const elA = document.getElementById("abertos");
  const elF = document.getElementById("fechados");
  if (!lojaAtual) { elA.innerHTML = "<p class='cartao-ajuda'>Escolha uma loja.</p>"; return; }

  elA.innerHTML = "<p class='cartao-ajuda'>Carregando…</p>";
  elF.innerHTML = "";

  try {
    let lotes, minhas;
    try {
      [lotes, minhas] = await Promise.all([
        API.selecionar("lote_resumo", `select=*&loja_id=eq.${lojaAtual.id}&order=criado_em.desc&limit=40`),
        API.selecionar("lote_participante", `select=lote_id,finalizado_em&perfil_id=eq.${sessao.usuario.id}`),
      ]);
      semInternet = false;
      avisoRede("");
      API.guardarCopia(`lotes.${lojaAtual.id}`, { lotes, minhas });
      // Semente do fechamento: se a pessoa abrir o Finalizar sem internet,
      // a tela tem de onde desenhar. Só a parte dela — a lista completa de
      // quem está contando só vem quando o fechamento abre com sinal.
      for (const l of lotes) {
        const eu = minhas.find((m) => m.lote_id === l.id);
        if (!eu) continue;
        const atual = API.copia(`fechamento.${l.id}`);
        if (atual && !atual.dado.parcial) {
          atual.dado.resumo = l;
          const p = atual.dado.pessoas.find((x) => x.perfil_id === sessao.usuario.id);
          if (p) p.finalizado_em = eu.finalizado_em;
          API.guardarCopia(`fechamento.${l.id}`, atual.dado);
        } else {
          API.guardarCopia(`fechamento.${l.id}`, {
            parcial: true, resumo: l,
            pessoas: [{ perfil_id: sessao.usuario.id, finalizado_em: eu.finalizado_em, perfil: { nome: sessao.usuario.nome } }],
          });
        }
      }
    } catch (e) {
      if (!API.semRede(e)) throw e;
      const c = API.copia(`lotes.${lojaAtual.id}`);
      if (!c) {
        semInternet = true;
        avisoRede("<b>Sem internet</b> e nenhuma lista desta loja salva neste aparelho. Conecte para ver os inventários.");
        elA.innerHTML = "<p class='cartao-ajuda'>Sem lista salva.</p>";
        return;
      }
      semInternet = true;
      ({ lotes, minhas } = c.dado);
      avisoRede(`<b>Sem internet</b> — lista salva ${horaCopia(c.em)}. Pode estar desatualizada. Dá para abrir o <b>Finalizar</b>; entrar e continuar contando precisam de sinal.`);
    }
    const meus = new Set(minhas.map((m) => m.lote_id));

    const abertos = lotes.filter((l) => l.status === "aberto");
    const fechados = lotes.filter((l) => l.status === "fechado").slice(0, 5);

    elA.innerHTML = abertos.length
      ? abertos.map((l) => cartaoLote(l, meus.has(l.id))).join("")
      : "<p class='cartao-ajuda'>Nenhum inventário aberto nesta loja.</p>";

    elF.innerHTML = fechados.length
      ? fechados.map((l) => cartaoLote(l, meus.has(l.id))).join("")
      : "<p class='cartao-ajuda'>Nenhum ainda.</p>";

    document.querySelectorAll("[data-abrir]").forEach((b) =>
      b.addEventListener("click", () => abrir(Number(b.dataset.abrir)))
    );
    document.querySelectorAll("[data-fechamento]").forEach((b) =>
      b.addEventListener("click", () => { location.href = `fechamento.html?lote=${b.dataset.fechamento}`; })
    );

    marcarBaixados([...abertos, ...fechados]);
    limparOrfaos();
  } catch (e) {
    elA.innerHTML = `<p class="cartao-ajuda">Não consegui listar: ${e.message}</p>`;
  }
}

// Inventário apagado no servidor por outra pessoa deixa lixo neste aparelho:
// a lista de produtos, que são megabytes, e contagens que já subiram. Aqui o
// aparelho se limpa sozinho — é o que faz "apagar o inventário" valer para
// todos os coletores, não só para quem clicou no botão.
async function limparOrfaos() {
  if (typeof LOCAL === "undefined") return;
  try {
    const locais = await LOCAL.lotes();
    const ids = locais.map((l) => l.id).filter((id) => id > 0);
    if (!ids.length) return;

    const vivos = await API.selecionar("lote_resumo", `select=id&id=in.(${ids.join(",")})`);
    const conjunto = new Set(vivos.map((v) => v.id));
    const sumiram = ids.filter((id) => !conjunto.has(id));
    if (!sumiram.length) return;

    let limpos = 0, comPendentes = 0;
    for (const id of sumiram) {
      try {
        await LOCAL.esquecerLote(id);
        limpos++;
      } catch (_) {
        // Tem contagem que nunca subiu. O inventário não existe mais, então
        // ela não tem para onde ir — mas apagar sem avisar seria pior.
        // Solta só a lista de produtos, que é o que pesa.
        await LOCAL.limparPacotes(id);
        comPendentes++;
      }
    }

    if (comPendentes > 0) {
      const el = document.getElementById("aviso-armazenamento");
      if (el) {
        el.textContent =
          `${comPendentes} inventário(s) guardados neste aparelho foram apagados no servidor, mas ainda têm contagens que nunca subiram. ` +
          `Liberei a lista de produtos deles; as contagens continuam aqui.`;
        el.hidden = false;
      }
    } else if (limpos > 0) {
      console.info(`${limpos} inventário(s) apagados no servidor foram limpos deste aparelho.`);
    }
  } catch (_) {
    // Sem internet não dá para saber o que ainda existe. Tenta na próxima.
  }
}

// Diz, antes de entrar, se a lista daquele inventário já está inteira
// neste aparelho. Assim ninguém sai para o corredor com meia lista.
async function marcarBaixados(lotes) {
  for (const l of lotes) {
    const el = document.getElementById(`baixa-${l.id}`);
    if (!el) continue;
    try {
      const e = await LOCAL.estado(l.id);
      if (e.completo) {
        el.className = "etiqueta etiqueta--ok";
        el.textContent = "lista baixada neste aparelho";
      } else if (e.baixados > 0) {
        const pct = l.itens ? Math.floor((e.baixados / l.itens) * 100) : 0;
        el.className = "etiqueta etiqueta--falta";
        el.textContent = `lista ${pct}% neste aparelho`;
      } else {
        el.className = "etiqueta etiqueta--apagada";
        el.textContent = "lista ainda não baixada";
      }
    } catch (_) {
      el.hidden = true;
    }
  }
}

async function abrir(id) {
  if (semInternet || !navigator.onLine) {
    precisaInternet("a contagem precisa de sinal para abrir. Conecte e tente de novo.");
    return;
  }
  let lote;
  try {
    lote = await API.selecionar("lote_resumo", `select=*&id=eq.${id}`);
  } catch (e) {
    if (API.semRede(e)) { precisaInternet("a contagem precisa de sinal para abrir. Conecte e tente de novo."); return; }
    throw e;
  }
  if (!lote.length) return;

  if (lote[0].status === "fechado") {
    location.href = `fechamento.html?lote=${id}`;
    return;
  }

  // Entrar no lote é o que dá direito de lançar contagem nele.
  try {
    await API.rpc("entrar_lote", { p_lote: id });
  } catch (e) {
    if (API.semRede(e)) { precisaInternet("precisa de internet para entrar no inventário."); return; }
    throw e;
  }
  sessionStorage.setItem("loteAtivo", String(id));
  location.href = `contagens.html?lote=${id}`;
}

document.getElementById("btn-criar").addEventListener("click", () => {
  if (semInternet || !navigator.onLine) return precisaInternet("criar inventário precisa de internet.");
  if (!lojaAtual) return alert("Cadastre uma loja antes.");
  location.href = `criar-lote.html?loja=${lojaAtual.id}`;
});

/* ---------- recado vindo da criação ---------- */
(function recado() {
  const m = sessionStorage.getItem("recado");
  if (!m) return;
  sessionStorage.removeItem("recado");
  const el = document.getElementById("recado");
  el.innerHTML = m;
  el.hidden = false;
})();

// Se o navegador não aceitar proteger os dados, a contagem que ainda não
// subiu pode ser descartada quando o aparelho ficar sem espaço. O navegador
// costuma aceitar quando o app está instalado na tela inicial — então é isso
// que o aviso pede, em vez de só informar que deu errado.
(async function conferirArmazenamento() {
  if (typeof LOCAL === "undefined") return;
  const estado = await LOCAL.protegerArmazenamento();
  if (estado === "protegido" || estado === "ja protegido") return;
  const el = document.getElementById("aviso-armazenamento");
  if (!el) return;
  el.textContent = estado === "sem suporte"
    ? "Este navegador não protege os dados guardados no aparelho. Use o Chrome e instale o app na tela inicial antes de contar."
    : "Este aparelho ainda não está protegendo as contagens guardadas nele. Abra o menu do navegador e escolha \u201cInstalar aplicativo\u201d ou \u201cAdicionar à tela inicial\u201d — sem isso, o Android pode descartar contagens que ainda não subiram quando faltar espaço.";
  el.hidden = false;
})();

if (sessao) montarLojas().then(listar).catch((e) => {
  document.getElementById("abertos").innerHTML = `<p class="cartao-ajuda">${e.message}</p>`;
});

// Voltou o sinal com a lista salva na tela: troca pela de agora.
window.addEventListener("online", () => { if (semInternet && sessao) listar(); });
