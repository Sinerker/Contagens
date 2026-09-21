/* =============================================
   guarda.js — ninguém vê página nenhuma sem ter entrado
   =============================================
   Carregado no <head> de toda página que não seja a de entrada,
   ANTES do corpo da página existir. Por isso nada aparece nem por
   um instante: sem sessão, a página é escondida e trocada pela
   entrada antes de desenhar qualquer coisa.

   Antes disto, quem fazia essa checagem era o script do fim de cada
   página — o corpo já tinha aparecido quando ele rodava.

   Três portas que esta guarda fecha:

   1. Abrir a página direto pelo endereço, sem ter entrado.
   2. O botão Voltar depois de sair. O navegador guarda a página
      anterior pronta na memória e a devolve sem rodar script nenhum
      — num coletor dividido, o próximo usuário via a tela do anterior.
      O evento pageshow é o único que roda nesse caso.
   3. Sair em outra aba: as outras abas ficavam abertas, logadas.

   O que esta guarda NÃO faz, e nenhum código no navegador faz: impedir
   que alguém baixe os arquivos do site. Eles são públicos no GitHub.
   O que protege os dados é o banco — sem login ele não entrega nada.

   Funciona sem internet: confere só o que está guardado no aparelho.
   Exigir o servidor aqui trancaria o coletor dentro da câmara fria.
   ============================================= */

(function () {
  "use strict";

  var CHAVE = "contagens.sessao";   // a mesma do api.js
  var eu = document.currentScript;
  var precisaAdmin = !!(eu && eu.hasAttribute("data-admin"));

  // Sessão de verdade tem as duas credenciais e um usuário. Um objeto
  // qualquer gravado à mão no navegador não passa.
  function sessao() {
    try {
      var s = JSON.parse(localStorage.getItem(CHAVE) || "null");
      if (!s || !s.access_token || !s.refresh_token) return null;
      if (!s.usuario || !s.usuario.id) return null;
      return s;
    } catch (_) {
      return null;
    }
  }

  function barrar(destino) {
    // Esconde antes de trocar, e troca SEM deixar esta página no
    // histórico: o Voltar não tem para onde trazer ela de volta.
    document.documentElement.style.visibility = "hidden";
    location.replace(destino);
  }

  function conferir() {
    var s = sessao();
    if (!s) { barrar("index.html"); return; }
    if (precisaAdmin && !s.usuario.admin) { barrar("lotes.html"); return; }
  }

  conferir();

  // Porta 2: página devolvida pelo Voltar, direto da memória.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) conferir();
  });

  // Porta 3: saiu em outra aba.
  window.addEventListener("storage", function (e) {
    if (e.key === CHAVE || e.key === null) conferir();
  });
})();
