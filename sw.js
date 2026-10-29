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

   Regra (desde a v30): UMA VERSÃO INTEIRA OU NENHUMA.

   - Instalar uma versão nova baixa TODOS os arquivos de
     uma vez, direto do servidor. Se qualquer um falhar,
     a instalação inteira falha e o aparelho continua com
     a versão anterior completa; o navegador tenta de novo
     na próxima abertura.
   - As telas são servidas sempre da versão instalada.
     Nunca mais um arquivo novo misturado com um velho.

   Por que mudou: até a v29 cada arquivo ia à rede com
   2,5 s de paciência e, se a rede demorasse, usava o
   guardado. Com sinal lento, um arquivo chegava novo e o
   outro velho. Em 29/10/2026 o lotes.js novo rodou com o
   api.js velho e a lista parou ("API.semRede is not a
   function").

   O que garante que a versão nova entra logo: o pwa.js
   recarrega a tela quando ela é instalada (menos na tela
   de contagem, que pega a versão nova na próxima vez que
   abrir — ali uma recarga no meio do bipe atrapalharia).
   ============================================= */

const VERSAO = "contagens-v32";

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

// Endereço completo de cada arquivo da versão, para reconhecer o pedido.
const DA_VERSAO = new Set(ARQUIVOS.map((a) => new URL(a, self.location).href));

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSAO);
    try {
      // cache: "reload" passa por cima do cache HTTP do navegador: o que
      // entra aqui é o que está publicado agora, não uma cópia de horas atrás.
      await Promise.all(ARQUIVOS.map(async (a) => {
        const r = await fetch(new Request(a, { cache: "reload" }));
        if (!r.ok) throw new Error(`${a}: ${r.status}`);
        await cache.put(a, r);
      }));
    } catch (err) {
      // Versão incompleta não serve: apaga o que entrou e falha a instalação.
      await caches.delete(VERSAO);
      throw err;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // banco não passa por aqui

  // Tira o ?lote=5 etc. para achar a tela guardada.
  const semBusca = url.origin + url.pathname;
  if (!DA_VERSAO.has(semBusca)) return; // arquivo que não é do app: rede normal

  e.respondWith((async () => {
    const cache = await caches.open(VERSAO);
    const guardado = await cache.match(req, { ignoreSearch: true });
    if (guardado) return guardado;
    // Só acontece antes da primeira instalação terminar.
    return fetch(req);
  })());
});
