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

  // O coletor tem DOIS caminhos de entrada ligados ao mesmo tempo, e cada
  // tecla física chega duas vezes. Medido no aparelho, um toque na tecla 4:
  //
  //   13:03:50.698  keydown  key "4"  code ""        keyCode 52   <- IME
  //   13:03:50.719  keydown  key "4"  code "Digit4"  keyCode 52   <- teclado
  //
  // Os carimbos de tempo são DIFERENTES (22 ms), então não dá para separar
  // por tempo — foi assim que a primeira tentativa falhou. O que separa é o
  // "code": o IME manda vazio, o teclado físico manda o código da tecla.
  //
  // A regra abaixo só descarta quando a assinatura é exatamente essa: mesma
  // tecla, menos de 80 ms, a anterior SEM code e esta COM code. Assim o leitor
  // mandando "11" de verdade (as duas com code) continua escrevendo os dois —
  // descartar um dígito de contagem seria pior que a duplicação.
  var ult = { tecla: null, carimbo: -1, comCode: false };
  function ehCopia(e) {
    var comCode = !!e.code;
    var copia =
      e.key === ult.tecla &&
      (e.timeStamp === ult.carimbo ||
       (e.timeStamp - ult.carimbo < 80 && comCode && !ult.comCode));
    ult.tecla = e.key;
    ult.carimbo = e.timeStamp;
    ult.comCode = comCode;
    return copia;
  }

  // Tem teclado físico? O navegador não responde isso: coletor e celular se
  // apresentam iguais (tela de toque, Android). Mas o coletor se entrega pelo
  // comportamento — medido no aparelho, a tecla física chega com o "code" da
  // tecla ("Digit4"), e nada num celular sem teclado manda isso.
  //
  // Só vale tecla apertada com o foco na QUANTIDADE. No campo do código chega
  // também o leitor de código de barras, que manda "code" como um teclado —
  // e um celular com leitor Bluetooth seria marcado como "tem teclado" e
  // ficaria sem como digitar a quantidade. Na quantidade ninguém bipa.
  //
  // O Enter que o teclado da tela dispara é sintético (isTrusted = false) e
  // não conta — senão o próprio teclado da tela marcaria o celular.
  //
  // A marca fica guardada no aparelho: no coletor isso acontece uma vez só.
  var CHAVE_FISICO = "contagens.tecladoFisico";
  function temTecladoFisico() {
    try { return localStorage.getItem(CHAVE_FISICO) === "1"; } catch (_) { return false; }
  }
  function ehTeclaFisica(e) {
    return e.isTrusted && !!e.code &&
      (/^(Digit|Numpad)/.test(e.code) || e.code === "Backspace" ||
       e.code === "Enter" || e.code === "Comma" || e.code === "Period");
  }

  // Captura: precisa chegar antes de qualquer outro. Enter e Tab
  // passam direto — Enter é o que busca o produto e grava a
  // contagem, e isso continua sendo do contagens.js.
  document.addEventListener("keydown", function (e) {
    var c = document.activeElement;
    if (NOSSOS.indexOf(c) === -1) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (c === quantidade && !temTecladoFisico() && ehTeclaFisica(e)) {
      try { localStorage.setItem(CHAVE_FISICO, "1"); } catch (_) {}
      if (!qtdForcado) setTimeout(atualizarTeclado, 0);
    }

    // 229 é o aviso "quem manda nesta tecla é o IME". Não é caractere
    // nenhum, e o campo é readonly, então o IME não escreve nada.
    if (e.isComposing || e.keyCode === 229) return;

    if (e.key === "Enter" || e.key === "Tab") return;
    if (ehCopia(e)) { e.preventDefault(); return; }

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

  /* ---------- 4. os teclados da tela ---------- */
  // Dois teclados no mesmo campo: letras e números. O físico do coletor só
  // tem números, então as letras precisam estar na tela; e o numérico da tela
  // existe para quem prefere não tirar a mão do vidro. A tecla de alternância
  // troca um pelo outro sem sair do campo.
  //
  // Os dois têm as MESMAS quatro linhas de altura, de propósito: alternar não
  // pode fazer a tela pular, senão o dedo erra o alvo que estava mirando.
  var TECLADOS = {
    letras: [
      { teclas: "QWERTYUIOP" },
      { teclas: "ASDFGHJKL" },
      { teclas: "ZXCVBNM", extras: ["apagar"] },
      { extras: ["paraNumeros", "espaco", "enter"] }
    ],
    numeros: [
      { teclas: "123", extras: ["apagar"] },
      { teclas: "456", extras: ["paraLetras"] },
      { teclas: "789", extras: ["enter"] },
      { teclas: "0", extras: ["vazio"] }
    ],
    // A da quantidade: mesma grade do numérico, para a mão não reaprender
    // nada. No lugar do ABC, a vírgula — quantidade não tem letra, e tem
    // produto que se conta em quilo.
    quantidade: [
      { teclas: "123", extras: ["apagarQtd"] },
      { teclas: "456", extras: ["virgula"] },
      { teclas: "789", extras: ["enter"] },
      { teclas: "0", extras: ["vazio"] }
    ]
  };

  // Em qual campo cada placa escreve.
  var ALVO = { letras: codigo, numeros: codigo, quantidade: quantidade };

  var estilo = document.createElement("style");
  estilo.textContent = [
    "#teclado-letras{position:fixed;left:0;right:0;bottom:0;z-index:900;display:none;",
      "background:var(--clr-border,#dadce0);border-top:1px solid rgba(0,0,0,.18);",
      "padding:5px 4px calc(5px + env(safe-area-inset-bottom));",
      "user-select:none;-webkit-user-select:none;touch-action:manipulation}",
    "#teclado-letras.aberto{display:block}",
    "#teclado-letras .placa{display:none}",
    "#teclado-letras .placa.ativa{display:block}",
    "#teclado-letras .fila{display:flex;gap:4px;margin-bottom:4px;justify-content:center}",
    ".tecla{flex:1;min-width:0;height:44px;display:flex;align-items:center;justify-content:center;",
      "border-radius:6px;background:var(--clr-surface,#fff);color:var(--clr-text,#202124);",
      "box-shadow:0 1px 0 rgba(0,0,0,.25);font-family:var(--font);font-size:17px;font-weight:600}",
    ".tecla:active{background:rgba(26,111,212,.22)}",
    // O numérico tem 4 teclas por linha em vez de 10: cada uma fica larga,
    // que é o alvo que se acerta em pé, no corredor, sem olhar.
    // Só os dígitos crescem. Sem o :not(), esta regra vencia por especificidade
    // a fonte do ENTER e o texto transbordava a tecla.
    ".placa--numeros .tecla:not(.tecla--acao):not(.tecla--enter):not(.tecla--vazio),",
    ".placa--quantidade .tecla:not(.tecla--acao):not(.tecla--enter):not(.tecla--vazio)",
      "{font-size:21px;font-weight:700}",
    ".placa--quantidade .tecla--acao{font-size:21px;font-weight:700}",
    ".tecla--acao{background:var(--clr-surface-2,#f8f9fa);font-size:15px}",
    ".tecla--rotulo{font-size:12px;font-weight:700;letter-spacing:.06em;",
      "color:var(--clr-text-secondary,#5f6368)}",
    ".tecla--enter{background:var(--clr-primary,#1a6fd4);color:#fff;font-size:13px;",
      "font-weight:800;letter-spacing:.06em}",
    ".tecla--enter:active{filter:brightness(.9);background:var(--clr-primary,#1a6fd4)}",
    ".tecla--vazio{background:transparent;box-shadow:none}",
    // Última linha do numérico: o 0 ocupa as três colunas dos dígitos,
    // como no teclado do telefone, e a quarta coluna fica vazia.
    ".placa--numeros .fila:last-child .tecla:not(.tecla--vazio),",
    ".placa--quantidade .fila:last-child .tecla:not(.tecla--vazio){flex:3}",
    "body.com-teclado .cnt{padding-bottom:230px}"
  ].join("");
  document.head.appendChild(estilo);

  var caixa = document.createElement("div");
  caixa.id = "teclado-letras";

  // O segredo está no preventDefault do toque: sem ele cada tecla
  // rouba o foco do campo, e o próximo bipe se perde no vazio.
  //
  // Antes havia aqui uma trava de 40 ms contra toque duplo na MESMA tecla — e
  // ela engolia dígito: "0000000" tocado rápido virava "0000". Com
  // PointerEvent (o Chrome do coletor e de qualquer celular) um toque gera um
  // evento só, e não há o que travar.
  function prender(el, acao) {
    if (window.PointerEvent) {
      el.addEventListener("pointerdown", function (e) { e.preventDefault(); acao(); });
      return;
    }
    // Navegador antigo, sem PointerEvent: o toque dispara touchstart e, logo
    // depois, um mousedown "fantasma" do mesmo toque. Só o fantasma é ignorado
    // — um segundo toque de verdade é outro touchstart e passa.
    var ultimoToque = 0;
    el.addEventListener("touchstart", function (e) {
      e.preventDefault(); ultimoToque = Date.now(); acao();
    }, { passive: false });
    el.addEventListener("mousedown", function (e) {
      e.preventDefault();
      if (Date.now() - ultimoToque < 600) return;
      acao();
    });
  }

  var placas = {};
  var placaCodigo = "letras";   // a última escolhida no campo do código
  var qtdForcado = false;       // tocou na quantidade pedindo o teclado

  function mostrarPlaca(nome) {
    if (nome !== "quantidade") placaCodigo = nome;
    for (var k in placas) placas[k].classList.toggle("ativa", k === nome);
  }

  // O Enter da tela não reimplementa nada: dispara o mesmo evento que a tecla
  // física dispararia, e quem decide o que fazer continua sendo o contagens.js
  // — buscar o produto no campo do código, gravar na quantidade. Uma regra só,
  // num lugar só.
  function enterNoCampo() {
    var alvo = document.activeElement;
    if (NOSSOS.indexOf(alvo) === -1) { codigo.focus(); alvo = codigo; }
    alvo.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));
  }

  var EXTRAS = {
    apagar:       { texto: "⌫",      classe: "tecla tecla--acao",   acao: function () { apagar(codigo); } },
    espaco:       { texto: "ESPAÇO", classe: "tecla tecla--rotulo", acao: function () { inserir(codigo, " "); } },
    enter:        { texto: "ENTER",  classe: "tecla tecla--enter",  acao: enterNoCampo },
    paraNumeros:  { texto: "123",    classe: "tecla tecla--acao",   acao: function () { mostrarPlaca("numeros"); } },
    paraLetras:   { texto: "ABC",    classe: "tecla tecla--acao",   acao: function () { mostrarPlaca("letras"); } },
    apagarQtd:    { texto: "⌫",      classe: "tecla tecla--acao",   acao: function () { apagar(quantidade); } },
    virgula:      { texto: ",",      classe: "tecla tecla--acao",   acao: function () { inserir(quantidade, ","); } },
    vazio:        { texto: "",       classe: "tecla tecla--vazio",  acao: function () {} }
  };

  Object.keys(TECLADOS).forEach(function (nome) {
    var placa = document.createElement("div");
    placa.className = "placa placa--" + nome;

    TECLADOS[nome].forEach(function (def) {
      var fila = document.createElement("div");
      fila.className = "fila";

      (def.teclas || "").split("").forEach(function (ch) {
        var t = document.createElement("div");
        t.className = "tecla";
        t.textContent = ch;
        prender(t, function () { inserir(ALVO[nome], ch); });
        fila.appendChild(t);
      });

      (def.extras || []).forEach(function (chave) {
        var d = EXTRAS[chave];
        if (!d) return;
        var t = document.createElement("div");
        t.className = d.classe;
        t.textContent = d.texto;
        if (chave !== "vazio") prender(t, d.acao);
        fila.appendChild(t);
      });

      placa.appendChild(fila);
    });

    placas[nome] = placa;
    caixa.appendChild(placa);
  });

  mostrarPlaca("letras");
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
    if (sim) setTimeout(mostrarCampo, 30);

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

  // Um lugar só decide o que aparece, olhando onde está o foco:
  //   código      -> letras ou números (o último escolhido)
  //   quantidade  -> o numérico da quantidade, se o aparelho NÃO tem teclado
  //                  físico — ou se a pessoa tocou no campo pedindo
  //   outro lugar -> nada
  function atualizarTeclado() {
    var a = document.activeElement;
    if (a === codigo) {
      mostrarPlaca(placaCodigo);
      abrir(true);
    } else if (a === quantidade && (!temTecladoFisico() || qtdForcado)) {
      mostrarPlaca("quantidade");
      abrir(true);
    } else {
      abrir(false);
    }
  }

  // Se o campo ficou atrás do teclado, sobe a tela o bastante para ele
  // aparecer. No coletor o código fica acima; no celular a quantidade não.
  function mostrarCampo() {
    var c = document.activeElement;
    if (NOSSOS.indexOf(c) === -1 || !caixa.classList.contains("aberto")) return;
    var r = c.getBoundingClientRect();
    var topo = caixa.getBoundingClientRect().top;
    if (r.bottom > topo - 8) window.scrollBy(0, r.bottom - topo + 16);
  }

  codigo.addEventListener("focus", atualizarTeclado);
  quantidade.addEventListener("focus", function () { qtdForcado = false; atualizarTeclado(); });

  // Depois que o Voltar escondeu o teclado, o campo continua focado — então
  // um toque nele não gera "focus" nenhum. Sem isto, o teclado não voltava.
  // Na quantidade, o toque também é o jeito de pedir o teclado num aparelho
  // que tem teclado físico (ou que foi marcado assim por engano).
  codigo.addEventListener("click", atualizarTeclado);
  quantidade.addEventListener("click", function () { qtdForcado = true; atualizarTeclado(); });

  // O teclado não tira o foco (preventDefault acima), então um blur de
  // verdade é a pessoa saindo do campo.
  codigo.addEventListener("blur", function () { setTimeout(atualizarTeclado, 0); });
  quantidade.addEventListener("blur", function () { setTimeout(atualizarTeclado, 0); });

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
