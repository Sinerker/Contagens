/* =============================================
   local.js — o banco do aparelho e a fila de envio
   =============================================
   Contar é a única coisa que não pode depender de
   sinal. Todo lançamento grava aqui primeiro e o envio
   é consequência: com internet sobe na hora, sem
   internet fica na fila até ter.

   O catálogo do lote NÃO é guardado produto por
   produto. Cento e trinta mil gravações separadas
   levam minutos num coletor. Ele é guardado como um
   punhado de blocos de texto — sete, para o catálogo
   inteiro — e os índices de busca são montados na
   memória quando a tela abre. Gravar sete registros é
   instantâneo; montar o índice depois é trabalho de
   memória, que é onde o aparelho é rápido.
   ============================================= */

const LOCAL = (() => {
  const NOME = "ContagensDB";
  const VERSAO = 2;
  let bd = null;

  function abrir() {
    if (bd) return Promise.resolve(bd);
    return new Promise((ok, falha) => {
      const req = indexedDB.open(NOME, VERSAO);

      req.onupgradeneeded = (e) => {
        const d = e.target.result;

        // A versão 1 guardava produto por produto. Sai.
        if (d.objectStoreNames.contains("item")) d.deleteObjectStore("item");

        // Quem vem da versão 1 tem lotes marcados como baixados, mas o
        // que estava baixado morreu junto com a loja "item". Zera a
        // marca para o app baixar de novo em blocos. As contagens ficam:
        // elas moram noutra loja e não são tocadas aqui.
        if (e.oldVersion < 2 && d.objectStoreNames.contains("lote")) {
          e.target.transaction.objectStore("lote").clear();
        }

        if (!d.objectStoreNames.contains("lote")) {
          d.createObjectStore("lote", { keyPath: "id" });
        }

        if (!d.objectStoreNames.contains("pacote")) {
          const s = d.createObjectStore("pacote", { keyPath: ["lote_id", "parte"] });
          s.createIndex("porLote", "lote_id", { unique: false });
        }

        if (!d.objectStoreNames.contains("contagem")) {
          const s = d.createObjectStore("contagem", { keyPath: "id_local" });
          s.createIndex("porLote", "lote_id", { unique: false });
          s.createIndex("porEnvio", "enviado", { unique: false });
          s.createIndex("porProduto", ["lote_id", "seqproduto"], { unique: false });
        }
      };

      req.onsuccess = (e) => { bd = e.target.result; ok(bd); };
      req.onerror = (e) => falha(e.target.error);
    });
  }

  const tx = async (lojas, modo) => (await abrir()).transaction(lojas, modo);

  // Pedido devolve resultado em onsuccess.
  const promessa = (req) =>
    new Promise((ok, falha) => {
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falha(req.error);
    });

  // Transação NÃO tem onsuccess — tem oncomplete. Esperar onsuccess numa
  // transação é esperar para sempre, e foi o que travou a tela de contagem
  // na primeira vez que ela rodou num navegador de verdade.
  const fim = (t) =>
    new Promise((ok, falha) => {
      t.oncomplete = () => ok();
      t.onerror = () => falha(t.error);
      t.onabort = () => falha(t.error || new Error("gravação cancelada"));
    });

  return {
    /* ---------- lote ---------- */
    async guardarLote(lote) {
      const t = await tx(["lote"], "readwrite");
      t.objectStore("lote").put(lote);
      return fim(t);
    },

    async lote(id) {
      const t = await tx(["lote"], "readonly");
      return promessa(t.objectStore("lote").get(Number(id)));
    },

    // Todos os inventários que este aparelho guarda. O de número zero é o
    // cadastro completo, não um inventário — fica de fora.
    async lotes() {
      const t = await tx(["lote"], "readonly");
      const todos = await promessa(t.objectStore("lote").getAll());
      return todos.filter((l) => l && Number(l.id) > 0);
    },

    async estado(loteId) {
      const l = await this.lote(loteId);
      return {
        completo: !!(l && l.completo),
        baixados: (l && l.baixados) || 0,
        esperado: (l && l.itens) || 0,
      };
    },

    /* ---------- pacote do catálogo ---------- */
    async guardarPacote(loteId, parte, texto) {
      const t = await tx(["pacote"], "readwrite");
      t.objectStore("pacote").put({ lote_id: Number(loteId), parte, texto });
      return fim(t);
    },

    async lerPacotes(loteId) {
      const t = await tx(["pacote"], "readonly");
      const partes = await promessa(t.objectStore("pacote").index("porLote").getAll(Number(loteId)));
      return partes.sort((a, b) => a.parte - b.parte).map((p) => p.texto);
    },

    // Terminado o download, os blocos viram um bloco só. O download precisa
    // ser em partes porque o banco devolve vinte mil produtos por vez, mas
    // guardar em partes cobra um preço toda vez que a tela abre: juntar seis
    // megabytes de texto leva perto de trezentos milissegundos num coletor
    // fraco, e ainda dobra a memória no instante em que junta. Juntar uma vez
    // e guardar pronto sai de graça em todas as aberturas seguintes.
    async juntarPacotes(loteId) {
      const partes = await this.lerPacotes(loteId);
      if (partes.length <= 1) return partes[0] || "";
      const inteiro = partes.join("\n");
      await this.limparPacotes(loteId);
      await this.guardarPacote(loteId, 0, inteiro);
      return inteiro;
    },

    async limparPacotes(loteId) {
      const t = await tx(["pacote"], "readwrite");
      const s = t.objectStore("pacote");
      const chaves = await promessa(s.index("porLote").getAllKeys(Number(loteId)));
      chaves.forEach((k) => s.delete(k));
      return fim(t);
    },

    // Pede ao navegador para tratar este banco como protegido. Sem isso,
    // o Android pode descartar os dados do site quando o aparelho fica sem
    // espaço — e levaria junto qualquer contagem que ainda não subiu. É a
    // única perda possível que não depende de alguém errar.
    async protegerArmazenamento() {
      if (!navigator.storage || !navigator.storage.persist) return "sem suporte";
      try {
        if (await navigator.storage.persisted()) return "ja protegido";
        return (await navigator.storage.persist()) ? "protegido" : "negado";
      } catch (_) {
        return "sem suporte";
      }
    },

    async espaco() {
      if (!navigator.storage || !navigator.storage.estimate) return null;
      try {
        const e = await navigator.storage.estimate();
        return { usado: e.usage || 0, disponivel: e.quota || 0 };
      } catch (_) {
        return null;
      }
    },

    /* ---------- o cadastro inteiro ---------- */
    // Guardado como se fosse o lote de número zero: mesmos blocos, mesmas
    // funções. O que muda é a chave, e que ele é compartilhado por todos os
    // lotes do aparelho enquanto a versão do cadastro não mudar.
    CADASTRO_ID: 0,

    async cadastroGuardado() {
      const m = await this.lote(0);
      return m || { id: 0, versao: null, baixados: 0, baixadoAte: 0, parte: 0, completo: false };
    },

    async guardarCadastro(meta) {
      meta.id = 0;
      return this.guardarLote(meta);
    },

    // Cadastro novo joga fora o antigo: conferir contra catálogo velho diria
    // "sem cadastro" para produto que passou a existir.
    async descartarCadastroSeVelho(versaoAtual) {
      const m = await this.cadastroGuardado();
      if (m.versao !== null && m.versao !== versaoAtual) {
        await this.limparPacotes(0);
        await this.guardarCadastro({ versao: versaoAtual, baixados: 0, baixadoAte: 0, parte: 0, completo: false });
        return true;
      }
      return false;
    },

    /* ---------- produtos adicionados fora do lote ---------- */
    // Ficam à parte da lista congelada porque o bloco baixado não os contém.
    // Some quando a lista é baixada de novo, e aí eles já vêm dentro dela.
    async extrasDoLote(loteId) {
      const l = await this.lote(loteId);
      return (l && l.extras) || [];
    },

    async guardarExtra(loteId, linha) {
      const l = await this.lote(loteId);
      if (!l) return;
      l.extras = l.extras || [];
      if (!l.extras.includes(linha)) l.extras.push(linha);
      l.itens = (l.itens || 0) + 1;
      await this.guardarLote(l);
    },

    // Solta a lista de produtos de um lote, mantendo as contagens. É o que
    // libera os sete megabytes quando a pessoa termina a parte dela: a lista
    // sempre pode ser baixada de novo, a contagem não.
    async soltarLista(loteId) {
      await this.limparPacotes(loteId);
      const l = await this.lote(loteId);
      if (l) {
        l.baixadoAte = 0; l.baixados = 0; l.parte = 0; l.completo = false;
        await this.guardarLote(l);
      }
    },

    // Apaga tudo de um lote no aparelho. Só pode ser chamado quando não
    // sobrou nada na fila — senão apaga contagem que nunca chegou ao servidor.
    async esquecerLote(loteId) {
      const pendentes = (await this.doLote(loteId)).filter((c) => !c.enviado);
      if (pendentes.length) {
        throw new Error(`Ainda há ${pendentes.length} contagem(ns) sem subir neste inventário.`);
      }
      await this.limparPacotes(loteId);
      const t = await tx(["contagem", "lote"], "readwrite");
      const s = t.objectStore("contagem");
      const chaves = await promessa(s.index("porLote").getAllKeys(Number(loteId)));
      chaves.forEach((k) => s.delete(k));
      t.objectStore("lote").delete(Number(loteId));
      return fim(t);
    },

    /* ---------- contagens ---------- */
    async lancar(registro) {
      const t = await tx(["contagem"], "readwrite");
      t.objectStore("contagem").put(registro);
      await fim(t);
      return registro;
    },

    async doLote(loteId) {
      const t = await tx(["contagem"], "readonly");
      return promessa(t.objectStore("contagem").index("porLote").getAll(Number(loteId)));
    },

    async doProduto(loteId, seq) {
      const t = await tx(["contagem"], "readonly");
      return promessa(
        t.objectStore("contagem").index("porProduto").getAll([Number(loteId), Number(seq)])
      );
    },

    async somaDoProduto(loteId, seq) {
      const lista = await this.doProduto(loteId, seq);
      return lista.filter((c) => !c.cancelada)
                  .reduce((s, c) => s + Number(c.quantidade || 0), 0);
    },

    async pendentes() {
      const t = await tx(["contagem"], "readonly");
      return promessa(t.objectStore("contagem").index("porEnvio").getAll(0));
    },

    async marcarEnviada(idLocal, idServidor) {
      const t = await tx(["contagem"], "readwrite");
      const s = t.objectStore("contagem");
      const pedido = s.get(idLocal);
      pedido.onsuccess = () => {
        const r = pedido.result;
        if (r) { r.enviado = 1; if (idServidor) r.id_servidor = idServidor; s.put(r); }
      };
      return fim(t);
    },

    async apagarLancamento(idLocal) {
      const t = await tx(["contagem"], "readwrite");
      t.objectStore("contagem").delete(idLocal);
      return fim(t);
    },

    async marcarCancelada(idLocal) {
      const t = await tx(["contagem"], "readwrite");
      const s = t.objectStore("contagem");
      const pedido = s.get(idLocal);
      pedido.onsuccess = () => {
        const r = pedido.result;
        if (r) { r.cancelada = true; s.put(r); }
      };
      return fim(t);
    },
  };
})();

// Tirar acento com normalize("NFD") custa quase um segundo num catálogo de
// seis megabytes e num coletor fraco — e o catálogo do Consinco é quase todo
// ASCII, então quase tudo isso é trabalho jogado fora. Aqui a troca é feita
// só nos caracteres que realmente têm acento.
const ACENTUADOS = "àáâãäåçèéêëìíîïñòóôõöùúûüýÿ";
const SEM_ACENTO = "aaaaaaceeeeiiiinooooouuuuyy";
const TABELA = new Map();
for (let i = 0; i < ACENTUADOS.length; i++) TABELA.set(ACENTUADOS[i], SEM_ACENTO[i]);
const FORA_DO_ASCII = /[^\x00-\x7F]/g;

function semAcento(txt) {
  const baixo = String(txt || "").toLowerCase();
  FORA_DO_ASCII.lastIndex = 0;
  if (!FORA_DO_ASCII.test(baixo)) return baixo;   // caminho comum: nada a trocar
  FORA_DO_ASCII.lastIndex = 0;
  return baixo.replace(FORA_DO_ASCII, (c) => TABELA.get(c) || c);
}

/* =============================================
   CATALOGO — o lote na memória, pronto para buscar
   =============================================
   Um texto só, com uma linha por produto:
     código do sistema <tab> descrição <tab> cod:emb,cod:emb

   Em cima dele, três índices montados de uma vez:
   - onde começa cada linha
   - o código do sistema de cada linha, para busca binária
   - de cada código de barras para a sua linha

   A busca por nome usa uma segunda cópia do texto já
   sem acento e em minúsculas. Parece desperdício, mas
   é UMA normalização de sete megabytes em vez de cento
   e trinta mil normalizações, uma por produto.
   ============================================= */
function criarIndice() {
 return {
  texto: "",
  busca: "",
  inicios: null,   // Int32Array: onde cada linha começa
  seqs: null,      // Int32Array: o código do sistema de cada linha
  porCodigo: null, // Map: código de barras -> número da linha
  linhas: 0,

  montar(textoCompleto, comBusca = true) {
    const t0 = Date.now();
    this.texto = textoCompleto;
    this.busca = comBusca ? semAcento(textoCompleto) : "";

    const inicios = [];
    let p = 0;
    while (p < this.texto.length) {
      inicios.push(p);
      const q = this.texto.indexOf("\n", p);
      if (q === -1) break;
      p = q + 1;
    }
    this.linhas = inicios.length;
    inicios.push(this.texto.length + 1);
    this.inicios = Int32Array.from(inicios);

    this.seqs = new Int32Array(this.linhas);
    this.porCodigo = new Map();

    // Percorre o texto por posição, sem recortar pedaço nenhum. A versão
    // anterior criava quatro strings por produto — mais de meio milhão de
    // recortes no catálogo inteiro, que é o que fazia o coletor travar.
    // A única string criada aqui é o próprio código de barras, que precisa
    // existir para ser a chave do índice.
    const txt = this.texto;
    for (let i = 0; i < this.linhas; i++) {
      const comeco = this.inicios[i];
      const fim = Math.min(this.inicios[i + 1] - 1, txt.length);

      // código do sistema: dígitos até o primeiro TAB, somados na hora
      let p = comeco, n = 0;
      while (p < fim) {
        const c = txt.charCodeAt(p);
        if (c < 48 || c > 57) break;
        n = n * 10 + (c - 48);
        p++;
      }
      this.seqs[i] = n;

      const t1 = txt.indexOf("\t", comeco);
      if (t1 === -1 || t1 >= fim) continue;
      const t2 = txt.indexOf("\t", t1 + 1);
      if (t2 === -1 || t2 >= fim) continue;

      // códigos: "codigo:embalagem,codigo:embalagem"
      let ini = t2 + 1;
      while (ini < fim) {
        let virgula = txt.indexOf(",", ini);
        if (virgula === -1 || virgula > fim) virgula = fim;
        const doisPontos = txt.lastIndexOf(":", virgula);
        if (doisPontos > ini) this.porCodigo.set(txt.slice(ini, doisPontos), i);
        ini = virgula + 1;
      }
    }
    return { linhas: this.linhas, codigos: this.porCodigo.size, ms: Date.now() - t0 };
  },

  linhaCrua(i) {
    const fim = this.inicios[i + 1] - 1;
    return this.texto.slice(this.inicios[i], Math.min(fim, this.texto.length));
  },

  produto(i) {
    const linha = this.linhaCrua(i);
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
      seqproduto: this.seqs[i],
      descricao: t2 === -1 ? linha.slice(t1 + 1) : linha.slice(t1 + 1, t2),
      eans,
    };
  },

  porCodigoDeBarras(codigo) {
    const i = this.porCodigo.get(String(codigo));
    return i === undefined ? null : this.produto(i);
  },

  // As linhas vêm ordenadas por código do sistema, então dá busca binária.
  porSeq(seq) {
    const alvo = Number(seq);
    let a = 0, b = this.linhas - 1;
    while (a <= b) {
      const m = (a + b) >> 1;
      if (this.seqs[m] === alvo) return this.produto(m);
      if (this.seqs[m] < alvo) a = m + 1; else b = m - 1;
    }
    return null;
  },

  // Qual linha contém esta posição do texto
  linhaEm(pos) {
    let a = 0, b = this.linhas - 1;
    while (a <= b) {
      const m = (a + b) >> 1;
      if (this.inicios[m] <= pos && pos < this.inicios[m + 1]) return m;
      if (this.inicios[m] > pos) b = m - 1; else a = m + 1;
    }
    return -1;
  },

  porNome(termo, limite = 40) {
    const palavras = semAcento(termo).split(/\s+/).filter(Boolean);
    if (!palavras.length) return [];

    // Procura a palavra mais longa primeiro: ela aparece menos vezes,
    // então sobra menos linha para conferir.
    const guia = palavras.slice().sort((a, b) => b.length - a.length)[0];
    const vistas = new Set();
    const achados = [];
    // Limite de tempo, não de candidatos: numa palavra comum como
    // "cerv" há milhares de linhas para conferir, e cortar por
    // quantidade deixaria de fora justo o que estava mais adiante.
    const prazo = Date.now() + 250;

    let pos = this.busca.indexOf(guia);
    while (pos !== -1 && achados.length < limite && Date.now() < prazo) {
      const i = this.linhaEm(pos);
      if (i >= 0 && !vistas.has(i)) {
        vistas.add(i);
        // Só a descrição conta. A coluna de códigos tem sequências
        // numéricas que casariam com qualquer pedaço digitado —
        // "275" acha 275ML e acharia também o código 7000000275xxx.
        const linha = this.busca.slice(this.inicios[i], this.inicios[i + 1]);
        const t1 = linha.indexOf("\t");
        const t2 = linha.indexOf("\t", t1 + 1);
        const desc = t2 === -1 ? linha.slice(t1 + 1) : linha.slice(t1 + 1, t2);
        if (palavras.every((p) => desc.includes(p))) achados.push(this.produto(i));
      }
      pos = this.busca.indexOf(guia, pos + 1);
    }
    return achados;
  },
 };
}

// O índice do lote: o que a pessoa está contando.
const CATALOGO = criarIndice();

// O índice do cadastro inteiro: serve só para responder "este produto existe
// no sistema?" quando o código bipado não está no lote. Não precisa de busca
// por nome, então é montado sem a cópia sem acento — sete megabytes de RAM a
// menos. Num inventário de todas as categorias ele nem chega a existir: a
// lista do lote já é o cadastro inteiro.
const CADASTRO = criarIndice();

/* =============================================
   FILA — sobe o que está pendente quando dá
   ============================================= */
const FILA = {
  rodando: false,
  aoMudar: null,

  async avisar() {
    if (this.aoMudar) this.aoMudar((await LOCAL.pendentes()).length);
  },

  async enviar() {
    if (this.rodando || !navigator.onLine) return;
    this.rodando = true;

    try {
      const pendentes = await LOCAL.pendentes();
      for (let i = 0; i < pendentes.length; i += 50) {
        const bloco = pendentes.slice(i, i + 50);
        const corpo = bloco.map((c) => ({
          id_local: c.id_local, lote_id: c.lote_id, perfil_id: c.perfil_id,
          seqproduto: c.seqproduto, codacesso: c.codacesso || null,
          descricao: c.descricao, qtdembalagem: c.qtdembalagem,
          quantidade: c.quantidade, tipo: c.tipo, corredor: c.corredor,
          coluna: c.coluna, andar: c.andar, contado_em: c.contado_em,
          cancela_id: c.cancela_id || null,
        }));

        try {
          const gravadas = await API.inserir("contagem", corpo, true);
          for (const g of gravadas) await LOCAL.marcarEnviada(g.id_local, g.id);
        } catch (e) {
          // Já estava lá: a fila reenviou depois de uma queda de sinal.
          // O identificador do aparelho impediu a duplicata — só marca.
          if (/duplicate key|id_local/i.test(e.message)) {
            for (const c of bloco) await LOCAL.marcarEnviada(c.id_local, null);
          } else {
            throw e;
          }
        }
        await this.avisar();
      }
    } catch (e) {
      console.warn("Fila parada:", e.message);
    } finally {
      this.rodando = false;
      await this.avisar();
    }
  },

  iniciar() {
    this.enviar();
    window.addEventListener("online", () => this.enviar());
    setInterval(() => this.enviar(), 20000);
  },
};
