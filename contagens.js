/* =============================================
   contagens.js — a tela do coletor
   =============================================
   Tudo aqui parte do princípio de que não há sinal.
   O lote inteiro é baixado uma vez, fica no aparelho,
   e cada lançamento grava no aparelho antes de tentar
   subir. Sem internet o trabalho continua igual; o
   único sinal disso é o contador de pendentes no topo.
   ============================================= */

const sessao = API.exigirLogin();
const loteId = Number(
  new URLSearchParams(location.search).get("lote") || sessionStorage.getItem("loteAtivo")
);

let lote = null;
let produto = null;      // o que está na tela agora
let cadastroInfo = null; // versão e tamanho do cadastro no ar
let loteEhTudo = false;  // a lista do lote já é o cadastro inteiro
let EXTRAS = [];         // produtos adicionados a este lote depois de criado
let tipo = "loja";
let ultimoLancamento = null;

const $ = (id) => document.getElementById(id);
const numero = (n) => Number(n || 0).toLocaleString("pt-BR");

/* ---------- som ---------- */
const audio = (() => {
  try { return new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
})();

function bipe(certo) {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.connect(g); g.connect(audio.destination);
  if (certo) {
    o.frequency.setValueAtTime(880, audio.currentTime);
    o.frequency.setValueAtTime(1180, audio.currentTime + 0.07);
    g.gain.setValueAtTime(0.35, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.22);
    o.start(); o.stop(audio.currentTime + 0.22);
  } else {
    o.type = "sawtooth";
    o.frequency.setValueAtTime(200, audio.currentTime);
    o.frequency.setValueAtTime(150, audio.currentTime + 0.1);
    g.gain.setValueAtTime(0.35, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
    o.start(); o.stop(audio.currentTime + 0.3);
  }
}

function recado(texto, erro = true) {
  document.querySelector(".aviso-flutuante")?.remove();
  const d = document.createElement("div");
  d.className = "aviso-flutuante";
  d.style.background = erro ? "#d93025" : "#1e8c45";
  d.textContent = texto;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2200);
}

/* ---------- baixar e montar o catálogo ---------- */
// O pacote chega como texto e é guardado como texto, em blocos de
// vinte mil produtos. Nada é destrinchado durante o download: gravar
// sete blocos é instantâneo, e o índice de busca é montado na memória
// quando a tela abre — cerca de dois décimos de segundo para o
// catálogo inteiro.

function contarLinhas(texto) {
  let n = 1, p = texto.indexOf("\n");
  while (p !== -1) { n++; p = texto.indexOf("\n", p + 1); }
  return n;
}

function ultimoSeq(texto) {
  const corte = texto.lastIndexOf("\n");
  const linha = corte === -1 ? texto : texto.slice(corte + 1);
  return parseInt(linha, 10) || 0;
}

// O selo fica sempre à vista: buscar um produto numa lista pela metade
// e não achar é pior que esperar, porque parece que o produto não existe.
function mostrarSelo(baixados, total, completo) {
  const el = $("selo-lista");
  el.hidden = false;
  el.onclick = rebaixar;
  el.style.cursor = "pointer";
  if (completo) {
    el.textContent = `lista completa · ${numero(total)}`;
    el.style.background = "rgba(30,140,69,.9)";
    el.title = "Toque para baixar a lista de novo";
  } else {
    const pct = total ? Math.floor((baixados / total) * 100) : 0;
    el.textContent = `lista ${pct}% · faltam ${numero(Math.max(0, total - baixados))}`;
    el.style.background = "rgba(217,48,37,.9)";
    el.title = "A lista ainda não está completa neste aparelho";
  }
}

async function rebaixar() {
  if (!confirm("Baixar a lista deste inventário de novo neste aparelho? As contagens já feitas não são afetadas.")) return;
  await LOCAL.limparPacotes(loteId);
  const l = await LOCAL.lote(loteId);
  if (l) { l.baixadoAte = 0; l.baixados = 0; l.parte = 0; l.completo = false; await LOCAL.guardarLote(l); }
  location.reload();
}

function travarBusca(motivo) {
  $("codigo").disabled = true;
  $("codigo").placeholder = motivo;
  $("quantidade").disabled = true;
}

function liberarBusca() {
  $("codigo").disabled = false;
  $("codigo").placeholder = "";
  $("quantidade").disabled = false;
}

async function prepararLote() {
  const resumo = await API.selecionar("lote_resumo", `select=*&id=eq.${loteId}`);
  if (!resumo.length) { alert("Inventário não encontrado."); location.href = "lotes.html"; return false; }
  lote = resumo[0];
  $("lote-nome").textContent = lote.nome;

  // Quantos produtos o sistema tem hoje. Serve para duas coisas: saber se a
  // lista deste lote já é o cadastro inteiro (aí não há segundo índice a
  // baixar) e descartar um cadastro guardado de versão antiga.
  try {
    const v = await API.selecionar("cadastro_versao", "select=id,total_produtos&atual=is.true");
    cadastroInfo = v[0] || null;
  } catch (_) {
    cadastroInfo = null;   // sem sinal: decide depois, quando precisar
  }
  loteEhTudo = !!(cadastroInfo && lote.itens >= cadastroInfo.total_produtos);
  if (cadastroInfo) await LOCAL.descartarCadastroSeVelho(cadastroInfo.id);

  EXTRAS = await LOCAL.extrasDoLote(loteId);

  const guardado = await LOCAL.lote(loteId);
  const base = {
    id: lote.id, nome: lote.nome, loja_codigo: lote.loja_codigo,
    loja_nome: lote.loja_nome, status: lote.status, itens: lote.itens,
    baixadoAte: (guardado && guardado.baixadoAte) || 0,
    baixados: (guardado && guardado.baixados) || 0,
    completo: !!(guardado && guardado.completo),
    parte: (guardado && guardado.parte) || 0,
  };

  if (!base.completo) {
    if (!navigator.onLine) {
      travarBusca("aguardando internet");
      $("baixando").className = "aviso aviso--atencao";
      $("baixando").textContent = base.baixados
        ? `A lista deste inventário está pela metade neste aparelho (${numero(base.baixados)} de ${numero(lote.itens)}) e não há internet agora. Conecte uma vez para terminar.`
        : "Este inventário ainda não foi baixado neste aparelho e não há internet agora. Conecte uma vez para baixar a lista.";
      $("baixando").hidden = false;
      mostrarSelo(base.baixados, lote.itens, false);
      return false;
    }

    travarBusca("baixando a lista…");
    $("baixando").className = "aviso aviso--neutro";
    $("baixando").hidden = false;
    $("barra").hidden = false;

    const PAGINA = 20000;
    const pedir = (de) => API.rpc("pacote_lote", { p_lote: loteId, p_apos: de, p_limite: PAGINA });
    const inicio = Date.now();

    // A próxima página é pedida ANTES de gravar a atual: rede e disco
    // trabalham juntos em vez de um esperar o outro.
    let proxima = pedir(base.baixadoAte);

    while (true) {
      const texto = await proxima;
      if (!texto) break;

      const linhas = contarLinhas(texto);
      const ultimo = ultimoSeq(texto);
      const temMais = linhas >= PAGINA;
      proxima = temMais ? pedir(ultimo) : Promise.resolve("");

      await LOCAL.guardarPacote(loteId, base.parte, texto);

      base.parte += 1;
      base.baixados += linhas;
      base.baixadoAte = ultimo;
      await LOCAL.guardarLote(base);

      const passou = (Date.now() - inicio) / 1000;
      $("baixando").textContent =
        `Baixando a lista do inventário… ${numero(base.baixados)} de ${numero(lote.itens)} (${passou.toFixed(0)}s)`;
      $("barra-cheia").style.width = Math.min(100, (base.baixados / lote.itens) * 100) + "%";
      mostrarSelo(base.baixados, lote.itens, false);

      if (!temMais) break;
    }

    // Junta os blocos num só antes de marcar como completo: a partir daqui
    // toda abertura da tela lê um bloco pronto em vez de remontar sete.
    await LOCAL.juntarPacotes(loteId);
    base.parte = 0;
    base.completo = true;
    await LOCAL.guardarLote(base);
  }

  // Monta o índice de busca a partir dos blocos guardados
  travarBusca("preparando a busca…");
  $("baixando").className = "aviso aviso--neutro";
  $("baixando").textContent = "Preparando a busca…";
  $("baixando").hidden = false;

  const partes = await LOCAL.lerPacotes(loteId);
  const r = CATALOGO.montar(partes.length === 1 ? partes[0] : partes.join("\n"));

  if (r.linhas < lote.itens) {
    // Guardou menos do que o inventário tem: melhor dizer isso do que
    // deixar a pessoa buscar num catálogo furado.
    base.completo = false;
    base.baixados = r.linhas;
    await LOCAL.guardarLote(base);
    mostrarSelo(r.linhas, lote.itens, false);
    $("baixando").className = "aviso aviso--erro";
    $("baixando").textContent =
      `A lista está incompleta neste aparelho: ${numero(r.linhas)} de ${numero(lote.itens)} produtos. Toque no selo vermelho para baixar de novo.`;
    return false;
  }

  mostrarSelo(r.linhas, lote.itens, true);
  $("baixando").hidden = true;
  $("barra").hidden = true;
  liberarBusca();
  return true;
}

/* ---------- montar a tela ---------- */
function montarSelects() {
  const col = $("coluna");
  col.innerHTML = "<option value=''>—</option>" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `<option>${l}</option>`).join("");
  const and = $("andar");
  and.innerHTML = "<option value=''>—</option>" +
    Array.from({ length: 12 }, (_, i) => `<option>${i + 1}</option>`).join("");

  // O lugar quase nunca muda entre um produto e o próximo:
  // guardar poupa três toques por item.
  const guardado = JSON.parse(localStorage.getItem("contagens.local") || "{}");
  if (guardado.corredor) $("corredor").value = guardado.corredor;
  if (guardado.coluna) col.value = guardado.coluna;
  if (guardado.andar) and.value = guardado.andar;
  if (guardado.tipo) escolherTipo(guardado.tipo);

  ["corredor", "coluna", "andar"].forEach((id) =>
    $(id).addEventListener("change", guardarLocal)
  );
}

function guardarLocal() {
  localStorage.setItem("contagens.local", JSON.stringify({
    corredor: $("corredor").value, coluna: $("coluna").value,
    andar: $("andar").value, tipo,
  }));
}

function escolherTipo(t) {
  tipo = t;
  document.querySelectorAll(".pilha").forEach((p) =>
    p.classList.toggle("ativa", p.dataset.tipo === t)
  );
  guardarLocal();
}

document.querySelectorAll(".pilha").forEach((p) =>
  p.addEventListener("click", () => escolherTipo(p.dataset.tipo))
);

/* ---------- busca ---------- */
const soDigitos = (t) => /^\d+$/.test(t.trim());

async function procurar(texto) {
  const t = texto.trim();
  if (!t) return;

  if (soDigitos(t)) {
    // Código de barras primeiro: é o que o leitor manda.
    const porCod = CATALOGO.porCodigoDeBarras(t);
    // Depois o código do sistema, para quem digita à mão.
    const porSeq = CATALOGO.porSeq(t);

    const achados = [];
    if (porCod) achados.push(porCod);
    if (porSeq && (!porCod || porSeq.seqproduto !== porCod.seqproduto)) achados.push(porSeq);

    for (const e of acharNosExtras(t, true)) {
      if (!achados.some((a) => a.seqproduto === e.seqproduto)) achados.push(e);
    }

    if (achados.length === 1) return mostrarProduto(achados[0], t);
    if (achados.length > 1) return mostrarLista(achados, t);
    return foraDoLote(t);
  }

  const achados = CATALOGO.porNome(t).concat(acharNosExtras(t, false));
  if (achados.length === 1) return mostrarProduto(achados[0]);
  if (achados.length > 1) return mostrarLista(achados);
  return naoEncontrado(t);
}

/* ---------- produtos adicionados depois que o lote nasceu ---------- */
// A lista baixada não os contém, então eles vivem numa lista curta à parte.
function produtoDaLinha(linha) {
  const t1 = linha.indexOf("\t");
  const t2 = linha.indexOf("\t", t1 + 1);
  const cods = t2 === -1 ? "" : linha.slice(t2 + 1);
  const eans = cods
    ? cods.split(",").filter(Boolean).map((par) => {
        const dp = par.lastIndexOf(":");
        return { c: par.slice(0, dp), e: Number(par.slice(dp + 1)) || 1 };
      })
    : [];
  return {
    seqproduto: parseInt(linha, 10) || 0,
    descricao: t2 === -1 ? linha.slice(t1 + 1) : linha.slice(t1 + 1, t2),
    eans,
  };
}

function acharNosExtras(termo, porNumero) {
  if (!EXTRAS.length) return [];
  const achados = [];
  for (const linha of EXTRAS) {
    const p = produtoDaLinha(linha);
    const bate = porNumero
      ? String(p.seqproduto) === termo || p.eans.some((e) => String(e.c) === termo)
      : semAcento(p.descricao).includes(semAcento(termo));
    if (bate) achados.push(p);
  }
  return achados;
}

function linhaDoProduto(p) {
  const cods = p.eans.map((e) => `${e.c}:${e.e}`).join(",");
  return `${p.seqproduto}\t${p.descricao}\t${cods}`;
}

function naoEncontrado(t) {
  produto = null;
  $("resultado").innerHTML =
    `<div class="aviso aviso--erro">Não achei <b>${t}</b> neste inventário.` +
    (loteEhTudo ? "" : `<br><br>Se o produto existe no sistema mas ficou fora deste inventário, bipe o código de barras dele — aí dá para adicionar.`) +
    `</div>`;
  $("ja-contado").hidden = true;
  bipe(false);
  focarCodigo();
}

function semCadastro(termo) {
  produto = null;
  $("resultado").innerHTML =
    `<div class="aviso aviso--erro"><b>${termo}</b> não tem cadastro no sistema.` +
    `<br><br>Produto sem cadastro não entra em inventário nenhum. Confira se o código foi lido certo; se estiver certo, o produto precisa ser cadastrado no sistema antes de ser contado.</div>`;
  $("ja-contado").hidden = true;
  bipe(false);
  focarCodigo();
}

/* ---------- o cadastro inteiro, para conferir ---------- */
// Só é baixado em inventário parcial, e uma vez só por versão do cadastro:
// os outros lotes do aparelho reaproveitam. Montado sem a cópia sem acento,
// porque aqui não se busca por nome, só se confere existência.
async function garantirCadastro() {
  if (CADASTRO.linhas > 0) return true;

  const meta = await LOCAL.cadastroGuardado();

  if (!meta.completo) {
    if (!navigator.onLine) {
      $("resultado").innerHTML =
        `<div class="aviso aviso--atencao">Este produto não está neste inventário, e sem internet não dá para conferir se ele existe no sistema.` +
        `<br><br>Conecte uma vez: o cadastro fica guardado no aparelho e a partir daí a conferência funciona offline.</div>`;
      bipe(false);
      return false;
    }
    if (!(await baixarCadastro(meta))) return false;
  }

  $("resultado").innerHTML = `<div class="aviso aviso--neutro">Conferindo o cadastro…</div>`;
  const partes = await LOCAL.lerPacotes(LOCAL.CADASTRO_ID);
  const r = CADASTRO.montar(partes.length === 1 ? partes[0] : partes.join("\n"), false);

  if (cadastroInfo && r.linhas < cadastroInfo.total_produtos) {
    // Guardou menos do que existe. Responder "sem cadastro" com catálogo pela
    // metade seria pior que admitir que não dá para conferir agora.
    await LOCAL.guardarCadastro({ versao: cadastroInfo.id, baixados: r.linhas, baixadoAte: 0, parte: 0, completo: false });
    $("resultado").innerHTML =
      `<div class="aviso aviso--erro">O cadastro guardado neste aparelho está incompleto (${numero(r.linhas)} de ${numero(cadastroInfo.total_produtos)}). Bipe de novo com internet para eu terminar de baixar.</div>`;
    bipe(false);
    return false;
  }
  return true;
}

async function baixarCadastro(meta) {
  const total = (cadastroInfo && cadastroInfo.total_produtos) || 0;
  $("resultado").innerHTML =
    `<div class="aviso aviso--neutro" id="baixa-cad">Baixando o cadastro do sistema para conferir aqui mesmo…</div>`;

  const PAGINA = 20000;
  const pedir = (de) => API.rpc("pacote_cadastro", { p_apos: de, p_limite: PAGINA });

  try {
    let proxima = pedir(meta.baixadoAte || 0);
    while (true) {
      const texto = await proxima;
      if (!texto) break;

      const linhas = contarLinhas(texto);
      const ultimo = ultimoSeq(texto);
      const temMais = linhas >= PAGINA;
      proxima = temMais ? pedir(ultimo) : Promise.resolve("");

      await LOCAL.guardarPacote(LOCAL.CADASTRO_ID, meta.parte, texto);
      meta.parte += 1;
      meta.baixados += linhas;
      meta.baixadoAte = ultimo;
      if (cadastroInfo) meta.versao = cadastroInfo.id;
      await LOCAL.guardarCadastro(meta);

      const el = $("baixa-cad");
      if (el) el.textContent =
        `Baixando o cadastro do sistema… ${numero(meta.baixados)}${total ? " de " + numero(total) : ""}`;

      if (!temMais) break;
    }

    await LOCAL.juntarPacotes(LOCAL.CADASTRO_ID);
    meta.parte = 0;
    meta.completo = true;
    await LOCAL.guardarCadastro(meta);
    return true;
  } catch (e) {
    $("resultado").innerHTML =
      `<div class="aviso aviso--erro">Não consegui baixar o cadastro para conferir: ${API.erro(e)}</div>`;
    bipe(false);
    return false;
  }
}

/* ---------- fora do lote ---------- */
// Três respostas possíveis, e a diferença entre elas é o que o contador
// precisa saber: está no sistema mas fora deste inventário (dá para
// adicionar), não está no sistema (não conta, ponto), ou não deu para
// conferir agora (sem sinal e sem o cadastro guardado).
async function foraDoLote(termo) {
  produto = null;
  $("ja-contado").hidden = true;

  // Inventário de todas as categorias: a lista dele já é o cadastro inteiro,
  // então não achar aqui é não existir no sistema.
  if (loteEhTudo) return semCadastro(termo);

  if (!(await garantirCadastro())) return;   // a mensagem já foi escrita

  const achado = CADASTRO.porCodigoDeBarras(termo) || CADASTRO.porSeq(termo);
  if (!achado) return semCadastro(termo);

  bipe(false);
  $("resultado").innerHTML = `
    <div class="aviso aviso--atencao">
      <b>Está no sistema, mas fora deste inventário.</b>
      Adicionar coloca ele na lista do inventário para todo mundo, e aí você conta normalmente.
    </div>
    <div class="produto">
      <div class="produto-seq">Código do sistema ${achado.seqproduto}</div>
      <div class="produto-desc">${achado.descricao}</div>
      <div class="produto-info">${achado.eans.length ? "Cód.: " + achado.eans.map((e) => e.c).join(", ") : "Sem código de barras"}</div>
    </div>
    <button class="botao" id="btn-adicionar" style="margin-top:.6rem">Adicionar a este inventário</button>`;

  $("btn-adicionar").addEventListener("click", () => adicionarAoLote(achado, termo));
}

async function adicionarAoLote(item, codigoBipado) {
  const btn = $("btn-adicionar");
  if (!navigator.onLine) {
    recado("Adicionar produto precisa de internet: a lista é a mesma para todo mundo.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Adicionando…";
  try {
    await API.rpc("adicionar_produto_ao_lote", { p_lote: loteId, p_seqproduto: item.seqproduto });
    const linha = linhaDoProduto(item);
    EXTRAS.push(linha);
    await LOCAL.guardarExtra(loteId, linha);
    lote.itens = (lote.itens || 0) + 1;
    mostrarSelo(lote.itens, lote.itens, true);
    recado(`${item.descricao} entrou no inventário.`, false);
    await mostrarProduto(item, codigoBipado);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Adicionar a este inventário";
    recado(API.erro(e));
  }
}

function mostrarLista(itens, codigoBipado) {
  produto = null;
  $("ja-contado").hidden = true;
  const el = $("resultado");
  el.innerHTML = `<div class="achados">` + itens.map((i, n) => `
    <div class="achado" data-n="${n}">
      <div class="achado-desc">${i.descricao}</div>
      <div class="achado-info">Código do sistema ${i.seqproduto}${i.eans.length ? " · " + i.eans.map(e => e.c).join(", ") : " · sem código de barras"}</div>
    </div>`).join("") + `</div>`;

  el.querySelectorAll(".achado").forEach((d) =>
    d.addEventListener("click", () => mostrarProduto(itens[Number(d.dataset.n)], codigoBipado))
  );
}

async function mostrarProduto(item, codigoBipado) {
  produto = item;
  // Qual código usar: o que foi bipado, senão o primeiro do cadastro.
  const ean = codigoBipado && item.eans.find((e) => String(e.c) === String(codigoBipado));
  produto.codigoEscolhido = ean ? String(ean.c) : (item.eans[0] ? String(item.eans[0].c) : null);
  produto.embalagem = ean ? ean.e : (item.eans[0] ? item.eans[0].e : 1);

  $("resultado").innerHTML = `
    <div class="produto">
      <div class="produto-seq">Código do sistema ${item.seqproduto}</div>
      <div class="produto-desc">${item.descricao}</div>
      <div class="produto-info">${produto.codigoEscolhido ? "Cód.: " + produto.codigoEscolhido : "Sem código de barras"} · Emb.: ${produto.embalagem}</div>
    </div>`;

  const soma = await LOCAL.somaDoProduto(loteId, item.seqproduto);
  if (soma > 0) {
    // Avisa, mas não preenche: preencher faz somar duas vezes
    // quando a pessoa aperta Enter sem olhar.
    $("ja-contado").textContent = `Já contado neste inventário: ${numero(soma)}. O que você digitar soma a isso.`;
    $("ja-contado").hidden = false;
  } else {
    $("ja-contado").hidden = true;
  }

  bipe(true);

  if ($("qtde1").checked) {
    $("quantidade").value = "1";
    await salvar();
  } else {
    $("quantidade").value = "";
    focarQuantidade();
  }
}

/* ---------- salvar ---------- */
async function salvar() {
  const corredor = $("corredor").value.trim();
  const coluna = $("coluna").value.trim();
  const andar = $("andar").value.trim();

  if (!corredor || !coluna || !andar) {
    recado("Preencha corredor, coluna e andar.");
    bipe(false);
    return;
  }
  if (!produto) { recado("Nenhum produto na tela."); bipe(false); return focarCodigo(); }

  const bruto = $("quantidade").value.trim().replace(",", ".");
  const qtd = bruto === "" ? NaN : Number(bruto);
  if (!Number.isFinite(qtd) || Math.abs(qtd) > 999999) {
    recado("Quantidade inválida.");
    bipe(false);
    return $("quantidade").select();
  }
  if (qtd === 0) return limpar();

  const agora = new Date();
  const registro = {
    id_local: crypto.randomUUID(),
    lote_id: loteId,
    perfil_id: sessao.usuario.id,
    usuario: sessao.usuario.nome,
    seqproduto: produto.seqproduto,
    codacesso: produto.codigoEscolhido,
    descricao: produto.descricao,
    qtdembalagem: produto.embalagem || 1,
    quantidade: qtd,
    tipo, corredor, coluna, andar,
    contado_em: agora.toISOString(),
    enviado: 0,
    cancelada: false,
  };

  await LOCAL.lancar(registro);
  ultimoLancamento = registro;
  bipe(true);
  mostrarUltimo(registro);
  await atualizarContador();
  FILA.enviar();
  limpar();
}

function limpar() {
  produto = null;
  $("codigo").value = "";
  $("resultado").innerHTML = "";
  $("ja-contado").hidden = true;
  $("quantidade").value = $("qtde1").checked ? "1" : "";
  focarCodigo();
}

function mostrarUltimo(r) {
  $("ultimo").innerHTML = `
    <div class="ultimo">
      <div class="ultimo-rot">Último contado</div>
      <div class="ultimo-desc">${r.descricao}</div>
      <div class="ultimo-info">${r.codacesso || "sem código"} · ${r.corredor}-${r.coluna}-${r.andar} · ${numero(r.quantidade)}</div>
    </div>`;
}

async function atualizarContador() {
  const todas = await LOCAL.doLote(loteId);
  const validas = todas.filter((c) => !c.cancelada).length;
  $("lote-conta").textContent = `${numero(validas)} ${validas === 1 ? "contagem" : "contagens"}`;
}

/* ---------- fila ---------- */
FILA.aoMudar = (n) => {
  const selo = $("selo-fila");
  selo.hidden = n === 0;
  selo.textContent = n === 1 ? "1 a enviar" : `${numero(n)} a enviar`;
};

/* ---------- lista do que foi contado ---------- */
async function abrirLista() {
  $("tampa").classList.add("aberta");
  $("busca-lanc").value = "";
  await desenharLista();
}

async function desenharLista() {
  const filtro = $("busca-lanc").value.trim().toLowerCase();
  const todas = (await LOCAL.doLote(loteId)).sort(
    (a, b) => new Date(b.contado_em) - new Date(a.contado_em)
  );
  const lista = filtro
    ? todas.filter((c) =>
        (c.descricao || "").toLowerCase().includes(filtro) ||
        String(c.codacesso || "").includes(filtro) ||
        String(c.seqproduto).includes(filtro))
    : todas;

  const el = $("lista-lanc");
  if (!lista.length) {
    el.innerHTML = `<p class="cartao-ajuda">Nada contado ainda neste aparelho.</p>`;
    return;
  }

  el.innerHTML = lista.map((c) => {
    const hora = new Date(c.contado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="lanc ${c.cancelada ? "cancelada" : ""}">
        <div class="lanc-topo">
          <div class="lanc-desc">${c.descricao}</div>
          <div class="lanc-qtd">${numero(c.quantidade)}</div>
        </div>
        <div class="lanc-info">
          ${c.codacesso || "sem código"} · ${c.corredor}-${c.coluna}-${c.andar} · ${hora}
          ${c.enviado ? "" : " · <b>na fila</b>"}
        </div>
        ${c.cancelada ? "" : `
        <div class="lanc-acoes">
          <button class="botao botao--pequeno botao--fantasma" data-corrigir="${c.id_local}">Corrigir</button>
          <button class="botao botao--pequeno botao--perigo" data-cancelar="${c.id_local}">Cancelar</button>
        </div>`}
      </div>`;
  }).join("");

  el.querySelectorAll("[data-corrigir]").forEach((b) =>
    b.addEventListener("click", () => corrigir(b.dataset.corrigir))
  );
  el.querySelectorAll("[data-cancelar]").forEach((b) =>
    b.addEventListener("click", () => cancelar(b.dataset.cancelar))
  );
}

// Corrigir e cancelar têm dois caminhos por baixo:
// se o lançamento ainda está na fila, ele nunca chegou ao banco e
// some daqui mesmo. Se já subiu, entra um registro novo que cancela
// o anterior — o banco não apaga nada.
async function corrigir(idLocal) {
  const todas = await LOCAL.doLote(loteId);
  const r = todas.find((c) => c.id_local === idLocal);
  if (!r) return;

  const nova = prompt(`Quantidade certa para ${r.descricao}:`, r.quantidade);
  if (nova === null) return;
  const qtd = Number(String(nova).replace(",", "."));
  if (!Number.isFinite(qtd)) return recado("Quantidade inválida.");

  if (!r.enviado) {
    r.quantidade = qtd;
    await LOCAL.lancar(r);
  } else {
    await LOCAL.marcarCancelada(idLocal);
    await LOCAL.lancar({
      ...r,
      id_local: crypto.randomUUID(),
      quantidade: qtd,
      contado_em: new Date().toISOString(),
      enviado: 0,
      cancelada: false,
      cancela_id: r.id_servidor || null,
    });
  }
  await desenharLista();
  await atualizarContador();
  FILA.enviar();
}

async function cancelar(idLocal) {
  const todas = await LOCAL.doLote(loteId);
  const r = todas.find((c) => c.id_local === idLocal);
  if (!r) return;
  if (!confirm(`Cancelar o lançamento de ${numero(r.quantidade)} em ${r.descricao}?`)) return;

  if (!r.enviado) {
    await LOCAL.apagarLancamento(idLocal);
  } else {
    await LOCAL.marcarCancelada(idLocal);
    await LOCAL.lancar({
      ...r,
      id_local: crypto.randomUUID(),
      quantidade: 0,
      contado_em: new Date().toISOString(),
      enviado: 0,
      cancelada: false,
      cancela_id: r.id_servidor || null,
    });
  }
  await desenharLista();
  await atualizarContador();
  FILA.enviar();
}

/* ---------- foco ---------- */
function focarCodigo() { const c = $("codigo"); c.focus(); c.select(); }
function focarQuantidade() { const q = $("quantidade"); q.focus(); q.select(); }

/* ---------- ligações ---------- */
$("codigo").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  await procurar(e.target.value);
});

$("quantidade").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  salvar();
});

$("qtde1").addEventListener("change", (e) => {
  $("atalho-um").classList.toggle("ativo", e.target.checked);
  // A quantidade vive readonly — o teclado.js é quem escreve nela, para
  // o Android não subir o teclado dele. Então a trava do QTDE 1 não pode
  // mais ser o readOnly: é esta marca que o teclado.js respeita.
  $("quantidade").dataset.travado = e.target.checked ? "1" : "";
  $("quantidade").value = e.target.checked ? "1" : "";
  focarCodigo();
});

$("btn-lista").addEventListener("click", abrirLista);
$("btn-fechar").addEventListener("click", () => $("tampa").classList.remove("aberta"));
$("busca-lanc").addEventListener("input", desenharLista);
$("tampa").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) $("tampa").classList.remove("aberta");
});

$("btn-tela").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});

document.addEventListener("touchstart", () => {
  if (audio && audio.state === "suspended") audio.resume();
}, { once: true });

/* ---------- início ---------- */
(async function iniciar() {
  if (!sessao) return;
  if (!loteId) { location.href = "lotes.html"; return; }

  travarBusca("carregando…");
  montarSelects();
  const pronto = await prepararLote();
  await atualizarContador();
  await FILA.avisar();
  FILA.iniciar();
  if (pronto) focarCodigo();
})();
