/* Registra o service worker. Sem ele o app só abre com internet. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) =>
      console.warn("Service worker não registrou:", e.message)
    );
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
