// 随手记账 —— Service Worker（离线缓存）
const CACHE = 'ledger-v5';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.png',
  './assets/styles.css',
  './assets/config.js',
  './assets/sync.js',
  './assets/store.js',
  './assets/charts.js',
  './assets/quick.js',
  './assets/app.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // 仅缓存同源静态资源；云端 API（跨域）直连网络，不进缓存（避免缓存含令牌的响应）
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => hit);
    })
  );
});
