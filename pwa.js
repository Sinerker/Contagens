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
  // a ser da versão nova. Na contagem não — ela continua com a versão em que
  // abriu, inteira, e pega a nova na próxima vez que abrir.
  let recarregou = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!tinhaVersao || recarregou) return;
    if (/contagens\.html$/.test(location.pathname)) return;
    recarregou = true;
    location.reload();
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
