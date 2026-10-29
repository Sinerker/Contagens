/* Registra o service worker. Sem ele o app só abre com internet. */
if ("serviceWorker" in navigator) {
  // Já havia uma versão controlando esta tela quando ela abriu? Se não,
  // é a primeira instalação e não há o que recarregar.
  const tinhaVersao = !!navigator.serviceWorker.controller;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")
      .then((reg) => {
        // Procura versão nova ao abrir e sempre que o app volta para a frente.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        });
      })
      .catch((e) => console.warn("Service worker não registrou:", e.message));
  });

  // Versão nova instalada e assumindo: recarrega para a tela inteira passar
  // a ser da versão nova. Na contagem, espera a hora boa: a própria tela diz
  // quando dá (window.podeRecarregar, no contagens.js) — tudo limpo e dois
  // minutos sem ninguém mexer. Até lá fica uma barra com "Atualizar agora".
  let recarregou = false;
  const recarregar = () => {
    if (recarregou) return;
    recarregou = true;
    location.reload();
  };

  function barraNovaVersao() {
    if (document.getElementById("barra-versao")) return;
    const b = document.createElement("div");
    b.id = "barra-versao";
    b.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:9999;display:flex;gap:.6rem;" +
      "align-items:center;justify-content:space-between;padding:.6rem .9rem;" +
      "background:var(--clr-primary,#1a6fd4);color:#fff;font-size:.88rem;" +
      "box-shadow:0 -2px 8px rgba(0,0,0,.25)";
    const t = document.createElement("span");
    t.textContent = "Nova versão disponível — entra sozinha quando você parar.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Atualizar agora";
    btn.style.cssText =
      "flex:none;border:0;border-radius:6px;padding:.45rem .8rem;font-weight:700;" +
      "background:#fff;color:var(--clr-primary,#1a6fd4)";
    btn.addEventListener("click", recarregar);
    b.append(t, btn);
    document.body.appendChild(b);
  }

  function esperarHoraBoa() {
    barraNovaVersao();
    // contagens.js antigo, sem a função: fica só a barra, como antes.
    if (typeof window.podeRecarregar !== "function") return;
    setInterval(() => {
      try { if (window.podeRecarregar()) recarregar(); } catch (_) { /* tenta de novo */ }
    }, 5000);
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!tinhaVersao || recarregou) return;
    if (/contagens\.html$/.test(location.pathname)) return esperarHoraBoa();
    recarregar();
  });
}

/* Pede ao navegador para não descartar o banco do aparelho quando faltar
   espaço. Só tem efeito onde LOCAL existe (as telas que guardam contagem). */
window.addEventListener("load", () => {
  if (typeof LOCAL === "undefined") return;
  LOCAL.protegerArmazenamento()
    .then((r) => { if (r !== "protegido" && r !== "ja protegido") console.warn("Armazenamento não protegido:", r); })
    .catch(() => {});
});
