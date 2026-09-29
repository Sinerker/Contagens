/* =============================================
   rotta400.js — manda o cadastro para o app dos postos
   =============================================
   O Rotta400 é outro projeto do Supabase, com outro banco e outros
   usuários. Ele usava um CSV próprio, montado no Excel, e isso acabou:
   o cadastro é carregado aqui, uma vez, e viaja daqui para lá no fim
   da carga.

   Por que a viagem é assim:

   - Vai em blocos, e cada bloco confirma quantas linhas gravou. Bloco
     que não bate para tudo — antes de qualquer troca.
   - O lado de lá guarda os blocos numa tabela de espera. O cadastro dos
     postos só é trocado no último passo, de uma vez. Se a internet cair
     no meio, lá continua com o cadastro inteiro que já tinha, e o
     gerente que estiver contando não vê diferença nenhuma.
   - Produto sem código de barras fica de fora: a tabela de lá exige
     código. São os mesmos que o CSV antigo já descartava.

   O login do Rotta400 é seu, de auditor, e fica guardado neste
   navegador. Ele não tem nada a ver com o login do Contagens: são dois
   bancos, dois cadastros de usuário.
   ============================================= */

const R400 = {
  CHAVE: "contagens.rotta400",
  BLOCO: 5000,       // linhas por viagem; ~30 viagens no cadastro de hoje
  TENTATIVAS: 3,     // internet ruim não pode derrubar uma carga inteira

  ligado() {
    return !!(CONFIG.rotta400 && CONFIG.rotta400.url && CONFIG.rotta400.chave);
  },

  // ---------------------------------------------
  // Sessão (a do Rotta400, separada da do Contagens)
  // ---------------------------------------------
  sessao() {
    try { return JSON.parse(localStorage.getItem(this.CHAVE) || "null"); }
    catch { return null; }
  },

  gravarSessao(s) {
    if (s) localStorage.setItem(this.CHAVE, JSON.stringify(s));
    else localStorage.removeItem(this.CHAVE);
  },

  conectado() {
    const s = this.sessao();
    return !!(s && s.access_token && s.refresh_token);
  },

  async entrar(email, senha) {
    const r = await fetch(`${CONFIG.rotta400.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: CONFIG.rotta400.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(email || "").trim().toLowerCase(), password: senha }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) {
      throw new Error(d.error_description || d.msg || "E-mail ou senha do Rotta400 não conferem.");
    }
    this.gravarSessao({
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expira_em: Date.now() + (d.expires_in || 3600) * 1000,
      email: (d.user && d.user.email) || email,
    });
    return this.sessao();
  },

  sair() { this.gravarSessao(null); },

  async credencial() {
    const s = this.sessao();
    if (!s) throw new Error("Não conectado ao Rotta400.");
    if (Date.now() < (s.expira_em || 0) - 60000) return s.access_token;

    const r = await fetch(`${CONFIG.rotta400.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: CONFIG.rotta400.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) {
      this.gravarSessao(null);
      throw new Error("A conexão com o Rotta400 venceu. Entre de novo.");
    }
    s.access_token = d.access_token;
    s.refresh_token = d.refresh_token || s.refresh_token;
    s.expira_em = Date.now() + (d.expires_in || 3600) * 1000;
    this.gravarSessao(s);
    return s.access_token;
  },

  async rpc(nome, parametros = {}) {
    const token = await this.credencial();
    const r = await fetch(`${CONFIG.rotta400.url}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: {
        apikey: CONFIG.rotta400.chave,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parametros),
    });
    if (!r.ok) {
      let msg = `Rotta400 respondeu ${r.status}`;
      try {
        const d = JSON.parse(await r.text());
        msg = d.message || d.hint || d.details || msg;
      } catch (_) {}
      throw new Error(msg);
    }
    const texto = await r.text();
    return texto ? JSON.parse(texto) : null;
  },

  async situacao() {
    return this.rpc("cadastro_situacao");
  },

  // ---------------------------------------------
  // Leitura daqui (o cadastro já no formato de lá)
  // ---------------------------------------------
  COLUNAS: "seqproduto,ean,descricao,qtd_embalagem,categoria",

  async quantoTem() {
    const r = await fetch(
      `${CONFIG.url}/rest/v1/cadastro_exportacao?select=ean&limit=1`,
      { headers: await API.cabecalhos({ Prefer: "count=exact" }) }
    );
    if (!r.ok) throw new Error(await API.erro(r));
    const faixa = r.headers.get("content-range") || "";
    const total = parseInt(faixa.split("/")[1], 10);
    if (!Number.isFinite(total)) throw new Error("Não consegui contar o cadastro daqui.");
    return total;
  },

  // Página por código, não por posição: assim nenhuma linha escapa nem
  // vem duas vezes, mesmo com o banco ocupado.
  async pagina(depoisDe) {
    const filtro = depoisDe ? `&ean=gt.${encodeURIComponent(depoisDe)}` : "";
    const r = await fetch(
      `${CONFIG.url}/rest/v1/cadastro_exportacao?select=${this.COLUNAS}` +
      `&order=ean.asc&limit=${this.BLOCO}${filtro}`,
      { headers: await API.cabecalhos() }
    );
    if (!r.ok) throw new Error(await API.erro(r));
    return r.json();
  },

  async origem() {
    const v = await API.selecionar("cadastro_versao", "select=carregado_em&atual=is.true");
    return v && v.length ? v[0].carregado_em : null;
  },

  // Internet ruim é o normal aqui. Uma falha isolada não pode derrubar
  // uma transferência de 150 mil linhas.
  async insistindo(oQue) {
    let ultimoErro;
    for (let t = 1; t <= this.TENTATIVAS; t++) {
      try { return await oQue(); }
      catch (e) {
        ultimoErro = e;
        if (t < this.TENTATIVAS) await new Promise((r) => setTimeout(r, 800 * t));
      }
    }
    throw ultimoErro;
  },

  // ---------------------------------------------
  // A transferência
  // ---------------------------------------------
  async enviar(aoAndar = () => {}) {
    if (!this.ligado()) throw new Error("O endereço do Rotta400 não está configurado.");
    if (!this.conectado()) throw new Error("Não conectado ao Rotta400.");

    const t0 = Date.now();
    const total = await this.quantoTem();
    const origem = await this.origem();
    if (!total) throw new Error("O cadastro daqui está vazio. Nada a enviar.");

    await this.insistindo(() => this.rpc("cadastro_sinc_iniciar"));

    let enviadas = 0;
    let ultimo = null;

    while (true) {
      const linhas = await this.insistindo(() => this.pagina(ultimo));
      if (!linhas.length) break;

      const gravadas = await this.insistindo(() => this.rpc("cadastro_sinc_receber", { p_linhas: linhas }));
      if (gravadas !== linhas.length) {
        throw new Error(
          `Um bloco não chegou inteiro: mandei ${linhas.length} linhas, o Rotta400 gravou ${gravadas}. ` +
          `Nada foi trocado lá.`
        );
      }

      enviadas += linhas.length;
      ultimo = linhas[linhas.length - 1].ean;
      aoAndar({ enviadas, total, segundos: (Date.now() - t0) / 1000 });

      if (linhas.length < this.BLOCO) break;
    }

    if (enviadas !== total) {
      throw new Error(
        `Faltou linha no caminho: o cadastro tem ${total} e chegaram ${enviadas}. Nada foi trocado lá.`
      );
    }

    // Só aqui o cadastro dos postos é trocado, de uma vez.
    const r = await this.rpc("cadastro_sinc_aplicar", { p_total: total, p_origem: origem });
    return { ...r, enviadas, segundos: Math.round((Date.now() - t0) / 1000) };
  },
};
