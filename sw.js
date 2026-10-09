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

   Regra: REDE PRIMEIRO, com 2,5 s de paciência. Se a rede
   responder, vale a versão nova — abrir a tela já traz a
   correção publicada, sem recarregar duas vezes. Se a rede
   demorar ou não existir, vale o que está guardado, e a
   tela abre igual dentro da câmara fria.
   ============================================= */

const VERSAO = "contagens-v27";

const ARQUIVOS = [
  "./",
  "index.html", "index.js",
  "lotes.html", "lotes.js",
  "criar-lote.html", "criar-lote.js",
  "contagens.html", "contagens.js",
  "fechamento.html", "fechamento.js",
  "admin.html", "admin.js", "cadastro-worker.js", "rotta400.js",
  "api.js", "config.js", "local.js", "pwa.js", "guarda.js", "planilha.js",
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

const ESPERA_REDE = 2500;   // milissegundos

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return; // banco não passa por aqui

  e.respondWith((async () => {
    const guardado = await caches.match(e.request);

    // Sem internet declarada pelo aparelho: nem tenta, usa o que tem.
    // É o caso da câmara fria e do depósito sem cobertura.
    if (!navigator.onLine && guardado) return guardado;

    const daRede = fetch(e.request).then((r) => {
      if (r && r.ok) {
        const copia = r.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia));
      }
      return r;
    });
    // Deixa o download terminar mesmo se a resposta já tiver saído daqui:
    // é assim que o cache fica em dia para a próxima abertura.
    e.waitUntil(daRede.catch(() => {}));

    // Primeira vez, nada guardado: não há alternativa senão esperar.
    if (!guardado) return daRede;

    // O ponto desta função: a versão nova ganha sempre que a rede
    // responder a tempo. Antes era o contrário — servia o guardado na
    // hora e atualizava por trás, e aí a primeira recarga depois de uma
    // publicação ainda rodava o código velho. Em 07/10/2026 isso fez uma
    // carga de cadastro falhar com o leitor antigo, já corrigido no ar.
    const relogio = new Promise((ok) => setTimeout(() => ok(null), ESPERA_REDE));
    const resposta = await Promise.race([daRede.catch(() => null), relogio]);
    return resposta || guardado;
  })());
});
