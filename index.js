/* =============================================
   index.js — a porta de entrada
   =============================================
   Ninguém digita e-mail. Escolhe o nome, escolhe a
   loja, digita a senha. O identificador que o
   Supabase exige é montado por dentro.
   ============================================= */

const ULTIMO = "contagens.ultimo-acesso";

// Sem loja cadastrada, o administrador ainda precisa entrar —
// é ele quem cadastra a primeira. Administrar não depende de loja.
let semLojas = false;

function erro(msg) {
  const el = document.getElementById("erro");
  el.className = "aviso aviso--erro";
  el.textContent = msg;
  el.hidden = !msg;
}

function aviso(msg) {
  const el = document.getElementById("erro");
  el.className = "aviso aviso--neutro";
  el.textContent = msg;
  el.hidden = !msg;
}

async function carregarListas() {
  const usuarioEl = document.getElementById("usuario");
  const lojaEl = document.getElementById("loja");

  try {
    const d = await API.dadosLogin();

    usuarioEl.innerHTML = d.usuarios
      .map((u) => `<option value="${u.slug}">${u.nome}</option>`)
      .join("");

    lojaEl.innerHTML = d.lojas
      .map((l) => `<option value="${l.id}">${l.codigo} · ${l.nome}</option>`)
      .join("");

    semLojas = d.lojas.length === 0;
    if (semLojas) {
      lojaEl.innerHTML = "<option value=''>Nenhuma loja cadastrada ainda</option>";
      lojaEl.required = false;
      aviso(
        "Ainda não há loja cadastrada. Entre como administrador para cadastrar a primeira."
      );
    }

    // Volta com quem entrou por último neste aparelho:
    // o contador costuma ser sempre o mesmo, e a loja também.
    try {
      const ultimo = JSON.parse(localStorage.getItem(ULTIMO) || "null");
      if (ultimo) {
        if ([...usuarioEl.options].some((o) => o.value === ultimo.usuario)) {
          usuarioEl.value = ultimo.usuario;
        }
        if ([...lojaEl.options].some((o) => o.value === String(ultimo.loja))) {
          lojaEl.value = String(ultimo.loja);
        }
      }
    } catch {}

    document.getElementById("senha").focus();
  } catch (e) {
    erro("Sem conexão para buscar usuários e lojas. Confira a internet e recarregue.");
    usuarioEl.innerHTML = "<option value=''>—</option>";
    lojaEl.innerHTML = "<option value=''>—</option>";
  }
}

async function mostrarCadastro() {
  const el = document.getElementById("sub-cadastro");
  try {
    const v = await API.selecionar(
      "cadastro_versao",
      "select=carregado_em,total_produtos&atual=is.true"
    );
    if (!v.length) {
      el.textContent = "Cadastro ainda não carregado";
      return;
    }
    const data = new Date(v[0].carregado_em).toLocaleDateString("pt-BR");
    el.textContent = `Cadastro de ${data} · ${v[0].total_produtos.toLocaleString("pt-BR")} produtos`;
  } catch {
    el.textContent = "";
  }
}

document.getElementById("form-entrar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  erro("");

  const btn = document.getElementById("btn-entrar");
  const apelido = document.getElementById("usuario").value;
  const senha = document.getElementById("senha").value;
  const lojaEl = document.getElementById("loja");
  const lojaId = Number(lojaEl.value);

  if (!apelido) return erro("Escolha o usuário.");
  if (!lojaId && !semLojas) return erro("Escolha a loja.");

  btn.disabled = true;
  btn.textContent = "Entrando…";

  try {
    let loja = null;
    if (lojaId) {
      const texto = lojaEl.selectedOptions[0].textContent;
      loja = {
        id: lojaId,
        codigo: texto.split(" · ")[0],
        nome: texto.split(" · ").slice(1).join(" · "),
      };
    }

    const sessao = await API.entrar(apelido, senha, loja);

    // Contador sem loja não tem o que fazer: quem conta, conta em algum lugar.
    if (!loja && !sessao.usuario.admin) {
      API.sair();
      return erro(
        "Não há loja cadastrada. Peça ao administrador para cadastrar a sua antes de contar."
      );
    }

    localStorage.setItem(ULTIMO, JSON.stringify({ usuario: apelido, loja: lojaId || null }));
    location.href = sessao.usuario.admin ? "admin.html" : "lotes.html";
  } catch (e) {
    erro(e.message);
    btn.disabled = false;
    btn.innerHTML = "Entrar";
    document.getElementById("senha").select();
  }
});

// Já entrou antes neste aparelho? Segue direto.
(function () {
  const s = API.sessao();
  if (s && s.usuario && s.refresh_token) {
    location.href = s.usuario.admin ? "admin.html" : "lotes.html";
    return;
  }
  carregarListas();
  mostrarCadastro();
})();
