/* =============================================
   sw.js — faz o app abrir sem internet
   =============================================
   Guarda os arquivos do site no aparelho. A partir da
   segunda vez, a tela abre mesmo sem sinal nenhum — e
   é assim que a contagem começa dentro de uma câmara
   fria ou num depósito sem cobertura.

   Só cuida dos arquivos do próprio site. Chamada ao
   banco nunca passa por aqui: dado velho servido como
   novo seria pior que erro de conexão.
   ============================================= */

const VERSAO = "contagens-v15";

const ARQUIVOS = [
  "./",
  "index.html", "index.js",
  "lotes.html", "lotes.js",
  "criar-lote.html", "criar-lote.js",
  "contagens.html", "contagens.js", "teclado.js",
  "fechamento.html", "fechamento.js",
  "admin.html", "admin.js", "cadastro-worker.js",
  "api.js", "config.js", "local.js", "pwa.js",
  "estilo.css", "manifest.json",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSAO)
      .then((c) => Promise.allSettled(ARQUIVOS.map((a) => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return; // banco não passa por aqui

  e.respondWith(
    caches.match(e.request).then((guardado) => {
      const rede = fetch(e.request)
        .then((r) => {
          if (r && r.ok) {
            const copia = r.clone();
            caches.open(VERSAO).then((c) => c.put(e.request, copia));
          }
          return r;
        })
        .catch(() => guardado);

      // Serve o que está guardado na hora e atualiza por trás:
      // no coletor, abrir rápido vale mais que abrir atualizado.
      return guardado || rede;
    })
  );
});
