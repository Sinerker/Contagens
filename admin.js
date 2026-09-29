/* =============================================
   admin.js — cadastro, lojas e usuários
   ============================================= */

const sessao = API.exigirLogin(true);

if (sessao) {
  document.getElementById("quem").textContent = sessao.usuario.nome;
  document.getElementById("btn-sair").addEventListener("click", () => API.sair());
}

/* ---------------- abas ---------------- */
document.querySelectorAll(".aba").forEach((aba) => {
  aba.addEventListener("click", () => {
    document.querySelectorAll(".aba").forEach((a) => a.classList.remove("ativa"));
    document.querySelectorAll(".painel").forEach((p) => p.classList.remove("ativo"));
    aba.classList.add("ativa");
    document.getElementById(`painel-${aba.dataset.painel}`).classList.add("ativo");
  });
});

function mostrar(id, texto, classe) {
  const el = document.getElementById(id);
  el.className = `aviso aviso--${classe}`;
  el.innerHTML = texto;
  el.hidden = !texto;
}

const numero = (n) => Number(n || 0).toLocaleString("pt-BR");

/* =============================================
   CADASTRO
   ============================================= */
let arqNiveis = null;
let arqEans = [];

async function cadastroAtual() {
  const el = document.getElementById("cadastro-atual");
  try {
    const v = await API.selecionar(
      "cadastro_versao",
      "select=carregado_em,total_produtos,total_eans,total_categorias&atual=is.true"
    );
    if (!v.length) {
      el.textContent = "Nenhum cadastro carregado ainda. Sem cadastro não dá para criar lote.";
      return;
    }
    const c = v[0];
    el.innerHTML = `
      <div class="numeros">
        <div class="numero"><div class="numero-valor">${numero(c.total_produtos)}</div><div class="numero-rotulo">produtos</div></div>
        <div class="numero"><div class="numero-valor">${numero(c.total_eans)}</div><div class="numero-rotulo">códigos</div></div>
        <div class="numero"><div class="numero-valor">${numero(c.total_categorias)}</div><div class="numero-rotulo">categorias</div></div>
      </div>
      <div style="margin-top:.6rem">Carregado em ${new Date(c.carregado_em).toLocaleString("pt-BR")}</div>`;
  } catch (e) {
    el.textContent = "Não consegui ler o cadastro atual: " + e.message;
  }
}

function conferirBotao() {
  document.getElementById("btn-carregar").disabled = !(arqNiveis || arqEans.length);
}

document.getElementById("arq-niveis").addEventListener("change", (e) => {
  arqNiveis = e.target.files[0] || null;
  document.getElementById("rotulo-niveis").textContent = arqNiveis
    ? `${arqNiveis.name} · ${(arqNiveis.size / 1048576).toFixed(1)} MB`
    : "Escolher o arquivo de níveis";
  conferirBotao();
});

document.getElementById("arq-eans").addEventListener("change", (e) => {
  arqEans = [...e.target.files];
  document.getElementById("rotulo-eans").textContent = arqEans.length
    ? arqEans.map((a) => a.name).join(", ")
    : "Escolher os arquivos de EANs";
  conferirBotao();
});

document.getElementById("btn-carregar").addEventListener("click", carregarCadastro);

async function carregarCadastro() {
  const btn = document.getElementById("btn-carregar");
  const barra = document.getElementById("barra");
  const cheia = document.getElementById("barra-cheia");

  if (!arqNiveis) {
    if (!confirm("Sem o relatório de níveis, todos os produtos ficam em SEM CATEGORIA e a árvore fica inútil. Continuar assim mesmo?")) return;
  }
  if (!arqEans.length) {
    mostrar("resultado", "Sem os relatórios de EANs não há o que contar.", "erro");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Lendo…";
  barra.hidden = false;
  cheia.style.width = "0%";
  mostrar("resultado", "", "neutro");

  // Tamanho total só para a barra andar de forma honesta
  const bytesTotais = (arqNiveis ? arqNiveis.size : 0) + arqEans.reduce((s, a) => s + a.size, 0);

  const trabalhador = new Worker("cadastro-worker.js");

  try {
    await API.rpc("cadastro_iniciar");

    const resumo = await new Promise((resolve, reject) => {
      trabalhador.onmessage = async (ev) => {
        const m = ev.data;

        if (m.tipo === "bloco") {
          try {
            const fn = m.destino === "niveis" ? "cadastro_enviar_niveis" : "cadastro_enviar_eans";
            const gravadas = await API.rpc(fn, { p_linhas: m.linhas });
            if (gravadas !== m.linhas.length) {
              throw new Error(
                `Um bloco não entrou inteiro: mandei ${m.linhas.length} linhas, o banco gravou ${gravadas}.`
              );
            }
            trabalhador.postMessage({ tipo: "continuar" });
          } catch (e) {
            reject(e);
          }
          return;
        }

        if (m.tipo === "andamento") {
          document.getElementById("andamento").hidden = false;
          document.getElementById("andamento").textContent =
            `Lidas ${numero(m.niveis)} linhas de níveis e ${numero(m.eans)} de EANs…`;
          if (bytesTotais) {
            cheia.style.width = Math.min(96, (m.bytes / bytesTotais) * 100) + "%";
          }
          return;
        }

        if (m.tipo === "erro") return reject(new Error(m.mensagem));
        if (m.tipo === "fim") return resolve(m.resumo);
      };

      trabalhador.onerror = (e) => reject(new Error("Falha ao ler os arquivos: " + e.message));
      trabalhador.postMessage({ tipo: "processar", niveis: arqNiveis, eans: arqEans });
    });

    // A única conferência que barra: relatório cortado no meio.
    if (resumo.niveisDeclarado !== null && resumo.niveisDeclarado !== resumo.niveis) {
      throw new Error(
        `O relatório de níveis diz ter ${numero(resumo.niveisDeclarado)} linhas, mas eu li ${numero(resumo.niveis)}. ` +
        `O arquivo veio cortado — exporte de novo.`
      );
    }

    btn.textContent = "Aplicando…";
    const r = await API.rpc("cadastro_aplicar", {
      p_total_niveis: resumo.niveis,
      p_total_eans: resumo.eans + resumo.codigosDoNivel,
    });

    cheia.style.width = "100%";
    document.getElementById("andamento").hidden = true;
    let texto =
      `<b>Cadastro trocado.</b><br>` +
      `${numero(r.produtos)} produtos, ${numero(r.eans)} códigos e ${numero(r.categorias)} categorias.<br>` +
      `${numero(r.sem_categoria)} sem categoria — aparecem no galho SEM CATEGORIA da árvore.<br>` +
      `${numero(r.sem_codigo)} sem código nenhum — entram no lote, mas só são achados por nome ou pelo ` +
      `código do sistema, e não saem no TXT.`;

    if (r.conflitos > 0) {
      texto += `<br><br><b>Atenção:</b> ${numero(r.conflitos)} código(s) apontam para produtos diferentes ` +
               `nos dois relatórios (${r.conflitos_exemplos}). Valeu o do relatório de EANs — vale corrigir no sistema.`;
    }
    mostrar("resultado", texto, "ok");
    await cadastroAtual();

    // O app dos postos usa este mesmo cadastro: vai agora, sozinho.
    await enviarAoRotta400({ automatico: true });
  } catch (e) {
    document.getElementById("andamento").hidden = true;
    barra.hidden = true;
    mostrar("resultado", `<b>Nada foi trocado.</b><br>${e.message}`, "erro");
  } finally {
    trabalhador.terminate();
    btn.disabled = false;
    btn.textContent = "Ler e carregar";
  }
}

/* =============================================
   POSTOS (Rotta400)
   =============================================
   O envio acontece sozinho no fim de cada carga. O botão existe para
   quando a carga terminou e a viagem não deu certo — internet caiu,
   sessão vencida — ou para conferir a situação de lá.
   ============================================= */
async function situacaoRotta400() {
  const el = document.getElementById("r400-situacao");
  const entrar = document.getElementById("r400-entrar");
  const btn = document.getElementById("btn-r400");
  const btnSair = document.getElementById("btn-r400-sair");

  if (!R400.ligado()) {
    el.textContent = "O endereço do Rotta400 não está configurado neste site.";
    entrar.hidden = true; btn.hidden = true; btnSair.hidden = true;
    return;
  }

  if (!R400.conectado()) {
    el.innerHTML = "Não conectado. Entre com o seu login do Rotta400 — ele fica guardado " +
                   "neste navegador e o envio passa a acontecer sozinho.";
    entrar.hidden = false;
    btn.hidden = false;
    btn.textContent = "Conectar";
    btnSair.hidden = true;
    return;
  }

  entrar.hidden = true;
  btn.hidden = false;
  btn.textContent = "Enviar cadastro agora";
  btnSair.hidden = false;

  try {
    const s = await R400.situacao();
    const quando = s.atualizado
      ? new Date(s.atualizado).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
      : "nunca";
    el.innerHTML =
      `Conectado como <b>${R400.sessao().email}</b>.<br>` +
      `Lá hoje: <b>${numero(s.linhas)} códigos</b> e ${numero(s.produtos)} produtos · atualizado em ${quando}.`;
  } catch (e) {
    el.innerHTML = `Conectado, mas não consegui ler a situação de lá: ${API.texto(e)}`;
  }
}

async function enviarAoRotta400({ automatico = false } = {}) {
  const btn = document.getElementById("btn-r400");
  const andamento = document.getElementById("r400-andamento");
  const barra = document.getElementById("r400-barra");
  const cheia = document.getElementById("r400-barra-cheia");

  if (!R400.ligado()) return;

  if (!R400.conectado()) {
    if (automatico) {
      mostrar("r400-resultado",
        "<b>O cadastro dos postos não foi atualizado.</b><br>" +
        "Conecte o Rotta400 aqui embaixo e clique em Enviar cadastro agora. " +
        "O cadastro do Contagens já está trocado — não precisa carregar de novo.",
        "erro");
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = "Enviando…";
  barra.hidden = false;
  cheia.style.width = "0%";
  andamento.hidden = false;
  andamento.textContent = "Conferindo o cadastro…";
  mostrar("r400-resultado", "", "neutro");

  try {
    const r = await R400.enviar(({ enviadas, total, segundos }) => {
      const pct = (enviadas / total) * 100;
      cheia.style.width = Math.min(99, pct).toFixed(1) + "%";
      const falta = Math.round((segundos / enviadas) * (total - enviadas));
      andamento.textContent =
        `${numero(enviadas)} de ${numero(total)} · ${pct.toFixed(0)}%` +
        (falta > 5 ? ` · falta cerca de ${falta > 60 ? Math.ceil(falta / 60) + " min" : falta + " s"}` : "");
    });

    cheia.style.width = "100%";
    andamento.hidden = true;
    mostrar("r400-resultado",
      `<b>Cadastro dos postos atualizado.</b><br>` +
      `${numero(r.linhas)} códigos e ${numero(r.produtos)} produtos, em ${r.segundos} segundos.` +
      (r.antes ? `<br>Antes tinha ${numero(r.antes)} códigos.` : ""),
      "ok");
    await situacaoRotta400();
  } catch (e) {
    andamento.hidden = true;
    barra.hidden = true;
    mostrar("r400-resultado",
      `<b>Não foi para os postos. Lá continua com o cadastro anterior, inteiro.</b><br>` +
      `${API.texto(e)}<br>Pode tentar de novo no botão — o cadastro daqui já está pronto.`,
      "erro");
  } finally {
    btn.disabled = false;
    btn.textContent = R400.conectado() ? "Enviar cadastro agora" : "Conectar";
  }
}

document.getElementById("btn-r400").addEventListener("click", async () => {
  const btn = document.getElementById("btn-r400");

  if (!R400.conectado()) {
    const email = document.getElementById("r400-email").value;
    const senha = document.getElementById("r400-senha").value;
    if (!email || !senha) {
      return mostrar("r400-resultado", "Informe o e-mail e a senha do Rotta400.", "erro");
    }
    btn.disabled = true;
    try {
      await R400.entrar(email, senha);
      document.getElementById("r400-senha").value = "";
      mostrar("r400-resultado", "", "neutro");
      await situacaoRotta400();
    } catch (e) {
      mostrar("r400-resultado", API.texto(e), "erro");
    } finally {
      btn.disabled = false;
    }
    return;
  }

  await enviarAoRotta400();
});

document.getElementById("btn-r400-sair").addEventListener("click", async () => {
  R400.sair();
  mostrar("r400-resultado", "", "neutro");
  await situacaoRotta400();
});

/* =============================================
   LOJAS
   ============================================= */
async function listarLojas() {
  const el = document.getElementById("lista-lojas");
  try {
    const lojas = await API.selecionar("loja", "select=id,codigo,nome,ativo&order=codigo");
    if (!lojas.length) {
      el.innerHTML = `<p class="cartao-ajuda">Nenhuma loja cadastrada.</p>`;
      return;
    }
    el.innerHTML = lojas
      .map(
        (l) => `
      <div class="linha">
        <div class="linha-info">
          <div class="linha-titulo">${l.codigo} · ${l.nome}</div>
          <div class="linha-sub">${l.ativo ? "Ativa" : "Desativada"}</div>
        </div>
        ${l.ativo
          ? `<button class="botao botao--pequeno botao--perigo" data-loja="${l.id}" data-nome="${l.codigo}">Remover</button>`
          : `<button class="botao botao--pequeno botao--fantasma" data-reativar="${l.id}">Reativar</button>`}
      </div>`
      )
      .join("");

    el.querySelectorAll("[data-loja]").forEach((b) =>
      b.addEventListener("click", () => removerLoja(b.dataset.loja, b.dataset.nome))
    );
    el.querySelectorAll("[data-reativar]").forEach((b) =>
      b.addEventListener("click", async () => {
        await API.alterar("loja", `id=eq.${b.dataset.reativar}`, { ativo: true });
        listarLojas();
      })
    );
  } catch (e) {
    el.innerHTML = `<p class="cartao-ajuda">Não consegui listar: ${e.message}</p>`;
  }
}

async function removerLoja(id, codigo) {
  // Loja com lote no histórico não é apagada: some o rastro do inventário.
  const lotes = await API.selecionar("lote", `select=id&loja_id=eq.${id}&limit=1`);
  if (lotes.length) {
    if (!confirm(`A loja ${codigo} já tem inventário no histórico, então ela será desativada em vez de apagada. Continuar?`)) return;
    await API.alterar("loja", `id=eq.${id}`, { ativo: false });
  } else {
    if (!confirm(`Apagar a loja ${codigo}?`)) return;
    await API.apagar("loja", `id=eq.${id}`);
  }
  listarLojas();
}

document.getElementById("btn-nova-loja").addEventListener("click", async () => {
  const codigo = document.getElementById("loja-codigo").value.trim();
  const nome = document.getElementById("loja-nome").value.trim().toUpperCase();
  if (!codigo || !nome) return mostrar("loja-erro", "Preencha código e nome.", "erro");

  try {
    await API.inserir("loja", { codigo, nome });
    document.getElementById("loja-codigo").value = "";
    document.getElementById("loja-nome").value = "";
    mostrar("loja-erro", "", "erro");
    listarLojas();
  } catch (e) {
    mostrar("loja-erro", e.message.includes("duplicate") ? `Já existe loja com o código ${codigo}.` : e.message, "erro");
  }
});

/* =============================================
   USUÁRIOS
   ============================================= */
async function listarUsuarios() {
  const el = document.getElementById("lista-usuarios");
  try {
    const us = await API.selecionar("perfil", "select=id,nome,admin,ativo&order=nome");
    el.innerHTML = us
      .map(
        (u) => `
      <div class="linha">
        <div class="linha-info">
          <div class="linha-titulo">${u.nome} ${u.admin ? '<span class="etiqueta">admin</span>' : ""}</div>
          <div class="linha-sub">${u.ativo ? "Ativo" : "Desativado"}</div>
        </div>
        <button class="botao botao--pequeno botao--fantasma" data-senha="${u.id}" data-nome="${u.nome}">Senha</button>
        ${u.ativo
          ? `<button class="botao botao--pequeno botao--perigo" data-excluir="${u.id}" data-nome="${u.nome}">Remover</button>`
          : `<button class="botao botao--pequeno botao--fantasma" data-reativar="${u.id}">Reativar</button>`}
      </div>`
      )
      .join("");

    el.querySelectorAll("[data-senha]").forEach((b) =>
      b.addEventListener("click", () => trocarSenha(b.dataset.senha, b.dataset.nome))
    );
    el.querySelectorAll("[data-excluir]").forEach((b) =>
      b.addEventListener("click", () => removerUsuario(b.dataset.excluir, b.dataset.nome))
    );
    el.querySelectorAll("[data-reativar]").forEach((b) =>
      b.addEventListener("click", async () => {
        await API.funcao("admin-usuarios", { acao: "reativar", id: b.dataset.reativar });
        listarUsuarios();
      })
    );
  } catch (e) {
    el.innerHTML = `<p class="cartao-ajuda">Não consegui listar: ${e.message}</p>`;
  }
}

async function trocarSenha(id, nome) {
  const senha = prompt(`Senha nova para ${nome} (mínimo 6 caracteres):`);
  if (senha === null) return;
  try {
    await API.funcao("admin-usuarios", { acao: "senha", id, senha });
    alert(`Senha de ${nome} trocada.`);
  } catch (e) {
    alert(e.message);
  }
}

async function removerUsuario(id, nome) {
  if (!confirm(`Remover ${nome}? Se essa pessoa já contou alguma coisa, o acesso é desativado em vez de apagado, para não perder o registro de quem contou o quê.`)) return;
  try {
    const r = await API.funcao("admin-usuarios", { acao: "excluir", id });
    if (r.acao === "desativado") alert(`${nome} foi desativado porque já tem contagens ou lotes no histórico.`);
    listarUsuarios();
  } catch (e) {
    alert(e.message);
  }
}

document.getElementById("btn-novo-usuario").addEventListener("click", async () => {
  const btn = document.getElementById("btn-novo-usuario");
  const nome = document.getElementById("usr-nome").value.trim().toUpperCase();
  const senha = document.getElementById("usr-senha").value;
  const admin = document.getElementById("usr-admin").checked;

  if (!nome) return mostrar("usr-erro", "Informe o nome.", "erro");
  if (senha.length < 6) return mostrar("usr-erro", "A senha precisa ter pelo menos 6 caracteres.", "erro");

  btn.disabled = true;
  try {
    await API.funcao("admin-usuarios", { acao: "criar", nome, senha, admin });
    document.getElementById("usr-nome").value = "";
    document.getElementById("usr-senha").value = "";
    document.getElementById("usr-admin").checked = false;
    mostrar("usr-erro", "", "erro");
    listarUsuarios();
  } catch (e) {
    mostrar("usr-erro", e.message, "erro");
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- início ---------------- */
if (sessao) {
  cadastroAtual();
  situacaoRotta400();
  listarLojas();
  listarUsuarios();
}
