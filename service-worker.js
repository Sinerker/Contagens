// service-worker.js
// Cache estático dos arquivos essenciais do app
const CACHE_NAME = 'inventario-app-v1';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/contagens.html',
  '/limpar-banco.html',
  '/style.css',
  '/script.js',
  '/FORAMATAÇÃO EANS.csv'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
