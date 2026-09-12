/* =============================================
   criar-lote.js — a árvore de categorias
   =============================================
   O sistema guarda sete níveis, e em boa parte dos
   caminhos os últimos são repetição do anterior
   ("ADITIVO \ ADITIVO \ ADITIVO \ BARDAHL"). Nível
   repetido não vira galho novo: só estende o caminho
   por baixo. Marcar continua selecionando o caminho
   inteiro — muda o que se vê, não o que se conta.
   ============================================= */

const sessao = API.exigirLogin();
const lojaId = Number(new URLSearchParams(location.search).get("loja"));

const SEM_CATEGORIA = "SEM CATEGORIA";
const numero = (n) => Number(n || 0).toLocaleString("pt-BR");

// prefixo null = "tudo": na hora de criar, vira a lista dos galhos de cima
let todas = { nome: "TODAS AS CATEGORIAS", prefixo: null, filhos: new Map(),
              proprios: 0, comCodigoProprios: 0, total: 0, comCodigo: 0, pai: null };

const marcados = new Set();
const abertos = new Set([todas]);

/* ---------- carregar ---------- */
async function carregar() {
  const loja = await API.selecionar("loja", `select=codigo,nome&id=eq.${lojaId}`);
  if (loja.length) {
    document.getElementById("sub-loja").textContent = `${loja[0].codigo} · ${loja[0].nome}`;
    document.getElementById("exemplo-arquivo").textContent =
      `NOME_${loja[0].codigo}_${new Date().toISOString().slice(0, 10)}`;
  }

  const jaAbertos = await API.selecionar(
    "lote_resumo", `select=nome&loja_id=eq.${lojaId}&status=eq.aberto`
  );
  if (jaAbertos.length) {
    const el = document.getElementById("ja-aberto");
    el.textContent =
      `Esta loja já tem ${jaAbertos.length} inventário aberto (${jaAbertos.map(a => a.nome).join(", ")}). ` +
      `Criar outro é permitido e eles não se misturam, mas se os dois tiverem o mesmo produto ` +
      `e você importar os dois arquivos, o sistema soma os dois.`;
    el.hidden = false;
  }

  // Mais de três mil folhas: vem em páginas de mil.
  let linhas = [], pagina = 0;
  while (true) {
    const parte = await API.selecionar(
      "categoria_arvore",
      `select=n1,n2,n3,n4,n5,n6,n7,produtos,com_codigo&limit=1000&offset=${pagina * 1000}`
    );
    linhas = linhas.concat(parte);
    if (parte.length < 1000) break;
    pagina++;
  }

  const semCat = await API.selecionar("sem_categoria_resumo", "select=produtos,com_codigo");
  montarArvore(linhas, semCat[0] || { produtos: 0, com_codigo: 0 });
  desenhar();
}

/* ---------- montar ---------- */
function novoNo(nome, prefixo, pai) {
  return { nome, prefixo, filhos: new Map(), proprios: 0, comCodigoProprios: 0,
           total: 0, comCodigo: 0, pai };
}

function montarArvore(linhas, semCat) {
  for (const l of linhas) {
    const niveis = [l.n1, l.n2, l.n3, l.n4, l.n5, l.n6, l.n7].filter(Boolean);
    let no = todas, partes = [], anterior = null;

    for (const n of niveis) {
      partes.push(n);
      if (n === anterior) continue; // repetição: só estende o caminho

      let filho = no.filhos.get(n);
      if (!filho) {
        filho = novoNo(n, partes.join(" \\ "), no);
        no.filhos.set(n, filho);
      } else if (partes.length < filho.prefixo.split(" \\ ").length) {
        // Caminho mais curto para o mesmo galho: fica o mais curto,
        // porque ele cobre tudo o que o mais longo cobriria.
        filho.prefixo = partes.join(" \\ ");
      }
      no = filho;
      anterior = n;
    }
    no.proprios += l.produtos;
    no.comCodigoProprios += l.com_codigo;
  }

  if (semCat.produtos > 0) {
    const n = novoNo(SEM_CATEGORIA, SEM_CATEGORIA, todas);
    n.proprios = semCat.produtos;
    n.comCodigoProprios = semCat.com_codigo;
    todas.filhos.set(SEM_CATEGORIA, n);
  }

  somar(todas);
}

function somar(no) {
  no.total = no.proprios;
  no.comCodigo = no.comCodigoProprios;
  for (const f of no.filhos.values()) {
    somar(f);
    no.total += f.total;
    no.comCodigo += f.comCodigo;
  }
}

/* ---------- marcar ---------- */
function estaMarcado(no) {
  for (let p = no; p; p = p.pai) if (marcados.has(p)) return true;
  return false;
}

function alternar(no) {
  if (estaMarcado(no)) {
    for (let p = no; p; p = p.pai) {
      if (marcados.has(p)) {
        marcados.delete(p);
        if (p !== no) promoverIrmaos(p, no);
        break;
      }
    }
  } else {
    for (const f of [...marcados]) {
      for (let p = f.pai; p; p = p.pai) if (p === no) marcados.delete(f);
    }
    marcados.add(no);
  }
  desenhar();
}

// Ao tirar um galho de dentro de um pai marcado, os outros galhos
// do caminho continuam marcados — senão o clique apagaria tudo.
function promoverIrmaos(pai, excluido) {
  const caminho = [];
  for (let p = excluido; p && p !== pai; p = p.pai) caminho.push(p);
  let atual = pai;
  for (const passo of caminho.reverse()) {
    for (const f of atual.filhos.values()) if (f !== passo) marcados.add(f);
    atual = passo;
  }
}

function prefixosMarcados() {
  const saida = [];
  for (const n of marcados) {
    if (n.prefixo === null) for (const f of n.filhos.values()) saida.push(f.prefixo);
    else saida.push(n.prefixo);
  }
  return saida;
}

/* ---------- desenhar ---------- */
function desenhar() {
  const alvo = document.getElementById("arvore");
  alvo.innerHTML = "";
  const filtro = document.getElementById("busca").value.trim().toLowerCase();
  alvo.appendChild(desenharNo(todas, filtro));
  atualizarResumo();
}

const ordenar = (mapa) => [...mapa.values()].sort((a, b) => b.total - a.total);

function combina(no, filtro) {
  if (!filtro) return true;
  if (no.nome.toLowerCase().includes(filtro)) return true;
  for (const f of no.filhos.values()) if (combina(f, filtro)) return true;
  return false;
}

function desenharNo(no, filtro) {
  if (!combina(no, filtro)) return document.createComment("");

  const div = document.createElement("div");
  div.className = "no" + (estaMarcado(no) ? " marcado" : "");
  if (no === todas) div.style.borderLeft = "none";

  const temFilhos = no.filhos.size > 0;
  const aberto = abertos.has(no) || (filtro && temFilhos);
  const semCodigo = no.total - no.comCodigo;

  const linha = document.createElement("div");
  linha.className = "no-linha";
  linha.innerHTML = `
    <button class="no-seta" data-vazio="${temFilhos ? 0 : 1}" aria-label="Abrir">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"
           stroke-linecap="round" stroke-linejoin="round"
           style="transform: rotate(${aberto ? 90 : 0}deg); transition: transform .12s">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
    <input type="checkbox" class="no-caixa" ${estaMarcado(no) ? "checked" : ""} />
    <span class="no-nome" style="${no === todas ? "font-weight:700" : ""}">${no.nome}</span>
    <span class="no-conta" title="${numero(semCodigo)} sem código de barras">${numero(no.total)}</span>`;

  linha.querySelector(".no-caixa").addEventListener("change", (e) => {
    e.stopPropagation();
    alternar(no);
  });

  if (temFilhos) {
    const abrir = () => {
      abertos.has(no) ? abertos.delete(no) : abertos.add(no);
      desenhar();
    };
    linha.querySelector(".no-seta").addEventListener("click", abrir);
    linha.querySelector(".no-nome").addEventListener("click", abrir);
  }

  div.appendChild(linha);

  if (temFilhos && aberto) {
    const caixa = document.createElement("div");
    caixa.className = "no-filhos aberto";
    for (const f of ordenar(no.filhos)) caixa.appendChild(desenharNo(f, filtro));
    div.appendChild(caixa);
  }
  return div;
}

function atualizarResumo() {
  const total = [...marcados].reduce((s, n) => s + n.total, 0);
  const comCodigo = [...marcados].reduce((s, n) => s + n.comCodigo, 0);
  const el = document.getElementById("resumo");
  const btn = document.getElementById("btn-criar");

  if (!marcados.size) {
    el.textContent = "Nada marcado ainda.";
    btn.disabled = true;
    return;
  }

  const semCodigo = total - comCodigo;
  el.innerHTML =
    `<b>${numero(total)}</b> produtos em ${marcados.size} ${marcados.size === 1 ? "seleção" : "seleções"}` +
    (semCodigo > 0
      ? ` · <b>${numero(semCodigo)}</b> sem código de barras, só achados por nome ou código do sistema`
      : "");
  btn.disabled = total === 0;
}

document.getElementById("busca").addEventListener("input", desenhar);

/* ---------- criar ---------- */
document.getElementById("btn-criar").addEventListener("click", async () => {
  const btn = document.getElementById("btn-criar");
  const nome = document.getElementById("nome").value.trim().toUpperCase();
  const erro = document.getElementById("erro");
  erro.hidden = true;

  if (!nome) {
    erro.textContent = "Dê um nome ao inventário — ele vai no nome do arquivo.";
    erro.hidden = false;
    document.getElementById("nome").focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = "Congelando a lista de produtos…";

  try {
    const r = await API.rpc("criar_lote", {
      p_nome: nome,
      p_loja_id: lojaId,
      p_caminhos: prefixosMarcados(),
    });

    let recado = `<b>${nome}</b> criado com ${numero(r.itens)} produtos.`;
    if (r.sem_codigo > 0) {
      recado += ` ${numero(r.sem_codigo)} sem código de barras — esses só aparecem buscando por nome ou pelo código do sistema, e não saem no TXT.`;
    }
    sessionStorage.setItem("recado", recado);
    sessionStorage.setItem("loteAtivo", String(r.id));
    location.href = "lotes.html";
  } catch (e) {
    erro.textContent = e.message;
    erro.hidden = false;
    btn.disabled = false;
    btn.textContent = "Criar inventário";
  }
});

if (sessao) carregar().catch((e) => {
  document.getElementById("arvore").textContent = "Não consegui montar a árvore: " + e.message;
});
