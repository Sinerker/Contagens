/* =============================================
   api.js — login e conversa com o banco
   =============================================
   Sem biblioteca externa: o app inteiro precisa
   abrir num coletor com internet ruim, e cada
   arquivo a menos é um problema a menos.
   ============================================= */

const CHAVE_SESSAO = "contagens.sessao";

const API = {
  // ---------------------------------------------
  // Sessão
  // ---------------------------------------------
  sessao() {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_SESSAO) || "null");
    } catch {
      return null;
    }
  },

  gravarSessao(s) {
    localStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
  },

  sair() {
    localStorage.removeItem(CHAVE_SESSAO);
    location.href = "index.html";
  },

  // Manda para o login quem não entrou.
  // Devolve a sessão para a página seguir.
  exigirLogin(precisaAdmin = false) {
    const s = this.sessao();
    if (!s || !s.usuario) {
      location.href = "index.html";
      return null;
    }
    if (precisaAdmin && !s.usuario.admin) {
      location.href = "lotes.html";
      return null;
    }
    return s;
  },

  // ---------------------------------------------
  // Credencial: renova sozinha antes de vencer.
  // Um inventário passa de uma hora com facilidade;
  // sem isso o coletor pararia de enviar no meio.
  // ---------------------------------------------
  async credencial() {
    const s = this.sessao();
    if (!s) return null;
    if (Date.now() < (s.expira_em || 0) - 60000) return s.access_token;

    const r = await fetch(`${CONFIG.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: CONFIG.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!r.ok) return s.access_token; // offline: usa o que tem e deixa a fila esperar
    const novo = await r.json();
    if (!novo.access_token) return s.access_token;

    s.access_token = novo.access_token;
    s.refresh_token = novo.refresh_token;
    s.expira_em = Date.now() + novo.expires_in * 1000;
    this.gravarSessao(s);
    return s.access_token;
  },

  async cabecalhos(extra = {}) {
    const token = await this.credencial();
    return {
      apikey: CONFIG.chave,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  },

  // ---------------------------------------------
  // Entrada
  // ---------------------------------------------
  async dadosLogin() {
    const r = await fetch(`${CONFIG.url}/rest/v1/rpc/dados_login`, {
      method: "POST",
      headers: { apikey: CONFIG.chave, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) throw new Error("Não consegui buscar a lista de usuários e lojas.");
    return r.json();
  },

  async entrar(apelido, senha, loja) {
    const r = await fetch(`${CONFIG.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: CONFIG.chave, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `${apelido}@${CONFIG.dominio}`,
        password: senha,
      }),
    });
    const d = await r.json();
    if (!d.access_token) {
      throw new Error(
        d.error_description || d.msg || "Usuário ou senha não conferem."
      );
    }

    const sessao = {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expira_em: Date.now() + d.expires_in * 1000,
      usuario: { id: d.user.id },
      loja,
    };
    this.gravarSessao(sessao);

    // Quem é essa pessoa aqui dentro (nome e se é administrador)
    const perfil = await this.selecionar(
      "perfil",
      `select=nome,slug,admin&id=eq.${d.user.id}`
    );
    sessao.usuario = { id: d.user.id, ...(perfil[0] || {}) };
    this.gravarSessao(sessao);
    return sessao;
  },

  // ---------------------------------------------
  // Banco
  // ---------------------------------------------
  async selecionar(tabela, consulta = "") {
    const r = await fetch(`${CONFIG.url}/rest/v1/${tabela}?${consulta}`, {
      headers: await this.cabecalhos(),
    });
    if (!r.ok) throw new Error(await this.erro(r));
    return r.json();
  },

  async inserir(tabela, linhas, devolver = false) {
    const r = await fetch(`${CONFIG.url}/rest/v1/${tabela}`, {
      method: "POST",
      headers: await this.cabecalhos(
        devolver ? { Prefer: "return=representation" } : {}
      ),
      body: JSON.stringify(linhas),
    });
    if (!r.ok) throw new Error(await this.erro(r));
    return devolver ? r.json() : null;
  },

  async alterar(tabela, consulta, campos) {
    const r = await fetch(`${CONFIG.url}/rest/v1/${tabela}?${consulta}`, {
      method: "PATCH",
      headers: await this.cabecalhos(),
      body: JSON.stringify(campos),
    });
    if (!r.ok) throw new Error(await this.erro(r));
  },

  async apagar(tabela, consulta) {
    const r = await fetch(`${CONFIG.url}/rest/v1/${tabela}?${consulta}`, {
      method: "DELETE",
      headers: await this.cabecalhos(),
    });
    if (!r.ok) throw new Error(await this.erro(r));
  },

  async rpc(nome, parametros = {}) {
    const r = await fetch(`${CONFIG.url}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: await this.cabecalhos(),
      body: JSON.stringify(parametros),
    });
    if (!r.ok) throw new Error(await this.erro(r));
    const texto = await r.text();
    return texto ? JSON.parse(texto) : null;
  },

  async funcao(nome, corpo = {}) {
    const r = await fetch(`${CONFIG.url}/functions/v1/${nome}`, {
      method: "POST",
      headers: await this.cabecalhos(),
      body: JSON.stringify(corpo),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.erro) throw new Error(d.erro || `Falhou (${r.status}).`);
    return d;
  },

  // Mensagem de erro legível em vez de JSON cru na cara do usuário
  async erro(r) {
    try {
      const d = await r.json();
      return d.message || d.hint || d.error_description || `Erro ${r.status}`;
    } catch {
      return `Erro ${r.status}`;
    }
  },
};
