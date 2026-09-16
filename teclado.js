/* =============================================
   teclado.js — o teclado é da página, não do Android
   =============================================
   No coletor (AutoID 9 plus, Android 9) o teclado físico
   é só numérico, e o do sistema come metade da tela.

   O que foi testado no aparelho, nesta ordem:

   1. inputmode="none" impede o teclado do Android de subir
      QUANDO O CAMPO RECEBE O FOCO — e só isso. Assim que uma
      tecla FÍSICA é apertada, o Android sobe o teclado do
      mesmo jeito: quem manda ali é o ajuste "mostrar teclado
      virtual com teclado físico", do sistema, e nenhuma
      página tem voz nisso.

   2. readonly resolve, porque um campo travado não é destino
      de escrita: o sistema não tem onde pôr texto, então não
      mostra teclado nenhum. A página passa a escrever o valor
      na mão, a partir das teclas que chegam.

   Depender do ajuste do Android seria pior: ele se perde em
   qualquer reset de aparelho, e são vários coletores.

   O leitor de código de barras continua funcionando porque ele
   "digita" o código (modo wedge) — as teclas chegam como
   qualquer outra e caem no mesmo caminho. Testado.

   O campo do código ganha um teclado de letras desenhado aqui:
   só A–Z e espaço, sem acento, sem sugestão, sem correção. Os
   números saem do teclado físico.
   ============================================= */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var codigo = $("codigo");
  var quantidade = $("quantidade");
  if (!codigo || !quantidade) return;   // outra tela: nada a fazer

  var NOSSOS = [codigo, quantidade];

  /* ---------- 1. tirar os campos do alcance do Android ---------- */
  NOSSOS.forEach(function (c) {
    c.readOnly = true;
    c.setAttribute("inputmode", "none");
    c.setAttribute("autocomplete", "off");
    c.setAttribute("autocorrect", "off");
    c.setAttribute("spellcheck", "false");
  });

  // O atalho QTDE 1 também trava a quantidade. Como agora ela vive
  // readonly, o travamento passou a ser esta marca — quem escreve
  // é esta página, então é aqui que a trava tem de valer.
  function travado(c) {
    return c === quantidade && quantidade.dataset.travado === "1";
  }

  /* ---------- 2. escrever no campo ---------- */
  function inserir(c, txt) {
    if (!txt || travado(c)) return;
    var ini = c.selectionStart, fim = c.selectionEnd;
    if (typeof ini === "number" && typeof fim === "number") {
      c.value = c.value.slice(0, ini) + txt + c.value.slice(fim);
      var p = ini + txt.length;
      try { c.setSelectionRange(p, p); } catch (_) {}
    } else {
      c.value += txt;
    }
  }

  function apagar(c) {
    if (travado(c)) return;
    var ini = c.selectionStart, fim = c.selectionEnd;
    if (typeof ini !== "number") { c.value = c.value.slice(0, -1); return; }
    if (ini !== fim) {
      c.value = c.value.slice(0, ini) + c.value.slice(fim);
      try { c.setSelectionRange(ini, ini); } catch (_) {}
    } else if (ini > 0) {
      c.value = c.value.slice(0, ini - 1) + c.value.slice(ini);
      try { c.setSelectionRange(ini - 1, ini - 1); } catch (_) {}
    }
  }

  /* ---------- 3. teclas físicas e leitor ---------- */

  // O coletor não nomeia as teclas como um teclado de PC: a tecla de
  // apagar dele não chegava como "Backspace", e por isso não apagava
  // nada. Vale o código numérico também, que é o que não muda.
  function ehApagar(e) {
    return e.key === "Backspace" || e.code === "Backspace" || e.keyCode === 8;
  }
  function ehLimparTudo(e) {
    return e.key === "Delete" || e.key === "Clear" ||
           e.code === "Delete" || e.keyCode === 46;
  }

  // Enquanto o IME do Android ainda está grudado no campo — o que acontece
  // na primeira vez que ele recebe o foco — a mesma tecla chega duas vezes,
  // e o número saía dobrado. Dois toques de verdade, ou o leitor mandando
  // "11", nunca dividem o mesmo carimbo de tempo; um eco do IME, sim.
  var ultimoCarimbo = -1, ultimaTecla = null;
  function ehEco(e) {
    if (e.timeStamp === ultimoCarimbo && e.key === ultimaTecla) return true;
    ultimoCarimbo = e.timeStamp;
    ultimaTecla = e.key;
    return false;
  }

  // Captura: precisa chegar antes de qualquer outro. Enter e Tab
  // passam direto — Enter é o que busca o produto e grava a
  // contagem, e isso continua sendo do contagens.js.
  document.addEventListener("keydown", function (e) {
    var c = document.activeElement;
    if (NOSSOS.indexOf(c) === -1) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    // 229 é o aviso "quem manda nesta tecla é o IME". Não é caractere
    // nenhum, e o campo é readonly, então o IME não escreve nada.
    if (e.isComposing || e.keyCode === 229) return;

    if (e.key === "Enter" || e.key === "Tab") return;
    if (ehEco(e)) { e.preventDefault(); return; }

    if (ehApagar(e)) { e.preventDefault(); apagar(c); return; }
    if (ehLimparTudo(e)) { e.preventDefault(); if (!travado(c)) c.value = ""; return; }
    if (!e.key || e.key.length !== 1) return;   // setas, F1, Shift…

    e.preventDefault();
    if (c === quantidade) {
      // Só o que vira número: dígito, vírgula, ponto e o menos
      // do acerto para baixo.
      inserir(c, e.key.replace(/[^0-9.,-]/g, ""));
    } else {
      inserir(c, e.key.toUpperCase());
    }
  }, true);

  /* ---------- 4. o teclado de letras ---------- */
  var FILAS = [
    { teclas: "QWERTYUIOP" },
    { teclas: "ASDFGHJKL" },
    { teclas: "ZXCVBNM", extras: ["apagar"] },
    { extras: ["espaco"] }
  ];

  var estilo = document.createElement("style");
  estilo.textContent = [
    "#teclado-letras{position:fixed;left:0;right:0;bottom:0;z-index:900;display:none;",
      "background:var(--clr-border,#dadce0);border-top:1px solid rgba(0,0,0,.18);",
      "padding:5px 4px calc(5px + env(safe-area-inset-bottom));",
      "user-select:none;-webkit-user-select:none;touch-action:manipulation}",
    "#teclado-letras.aberto{display:block}",
    "#teclado-letras .fila{display:flex;gap:4px;margin-bottom:4px;justify-content:center}",
    ".tecla{flex:1;min-width:0;height:44px;display:flex;align-items:center;justify-content:center;",
      "border-radius:6px;background:var(--clr-surface,#fff);color:var(--clr-text,#202124);",
      "box-shadow:0 1px 0 rgba(0,0,0,.25);font-family:var(--font);font-size:17px;font-weight:600}",
    ".tecla:active{background:rgba(26,111,212,.22)}",
    ".tecla--acao{flex:1.4;background:var(--clr-surface-2,#f8f9fa);font-size:15px}",
    ".tecla--espaco{flex:1;font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--clr-text-secondary,#5f6368)}",
    "body.com-teclado .cnt{padding-bottom:230px}"
  ].join("");
  document.head.appendChild(estilo);

  var caixa = document.createElement("div");
  caixa.id = "teclado-letras";

  // O segredo está no preventDefault do toque: sem ele cada tecla
  // rouba o foco do campo, e o próximo bipe se perde no vazio.
  function prender(el, acao) {
    var quieto = false;
    function agir(e) {
      e.preventDefault();
      if (quieto) return;
      quieto = true;
      setTimeout(function () { quieto = false; }, 40);
      acao();
    }
    if (window.PointerEvent) {
      el.addEventListener("pointerdown", agir);
    } else {
      el.addEventListener("touchstart", agir, { passive: false });
      el.addEventListener("mousedown", agir);
    }
  }

  var EXTRAS = {
    apagar: { texto: "⌫", classe: "tecla tecla--acao", acao: function () { apagar(codigo); } },
    espaco: { texto: "ESPAÇO", classe: "tecla tecla--espaco", acao: function () { inserir(codigo, " "); } }
  };

  FILAS.forEach(function (def) {
    var fila = document.createElement("div");
    fila.className = "fila";

    (def.teclas || "").split("").forEach(function (ch) {
      var t = document.createElement("div");
      t.className = "tecla";
      t.textContent = ch;
      prender(t, function () { inserir(codigo, ch); });
      fila.appendChild(t);
    });

    (def.extras || []).forEach(function (nome) {
      var d = EXTRAS[nome];
      if (!d) return;
      var t = document.createElement("div");
      t.className = d.classe;
      t.textContent = d.texto;
      prender(t, d.acao);
      fila.appendChild(t);
    });

    caixa.appendChild(fila);
  });

  document.body.appendChild(caixa);

  /* ---------- 5. quando aparece ---------- */
  // O botão Voltar do aparelho tem de esconder o teclado antes de sair da
  // tela: sair no meio de uma contagem por causa de um toque é perda de
  // trabalho. O jeito de ouvir esse botão na web é este — enquanto o
  // teclado está aberto, deixamos um passo nosso no histórico; o Voltar
  // gasta esse passo, e só o segundo Voltar sai da página.
  var nossoPasso = false;   // temos um passo no histórico
  var fechandoAqui = false; // fomos nós que desfizemos, não o usuário

  function abrir(sim) {
    caixa.classList.toggle("aberto", sim);
    document.body.classList.toggle("com-teclado", sim);

    if (sim) {
      if (!nossoPasso) {
        try { history.pushState({ teclado: 1 }, ""); nossoPasso = true; } catch (_) {}
      }
    } else if (nossoPasso) {
      nossoPasso = false;
      fechandoAqui = true;
      try { history.back(); } catch (_) { fechandoAqui = false; }
    }
  }

  window.addEventListener("popstate", function () {
    if (fechandoAqui) { fechandoAqui = false; return; }  // desfeito por nós
    if (!nossoPasso) return;                             // não era nosso: deixa voltar
    nossoPasso = false;
    // Esconde o teclado e MANTÉM o foco no campo: assim o leitor continua
    // bipando e o teclado físico continua digitando, só a tela fica livre.
    caixa.classList.remove("aberto");
    document.body.classList.remove("com-teclado");
  });

  codigo.addEventListener("focus", function () { abrir(true); });

  // Depois que o Voltar escondeu o teclado, o campo continua focado — então
  // um toque nele não gera "focus" nenhum. Sem isto, o teclado não voltava.
  codigo.addEventListener("click", function () { abrir(true); });
  codigo.addEventListener("blur", function () {
    // O teclado não tira o foco (preventDefault acima), então um
    // blur de verdade é a pessoa saindo do campo.
    setTimeout(function () {
      if (document.activeElement !== codigo) abrir(false);
    }, 0);
  });

  quantidade.addEventListener("focus", function () { abrir(false); });

  /* ---------- 6. não deixar o foco se perder ---------- */
  // Um toque em área vazia tirava o foco do código, e a partir dali
  // o leitor bipava para lugar nenhum. Toque em vazio volta o foco.
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t !== document.body && !(t.classList && t.classList.contains("cnt"))) return;
    var tampa = $("tampa");
    if (tampa && tampa.classList.contains("aberta")) return;
    if (document.activeElement === quantidade) return;
    codigo.focus();
  });
})();
