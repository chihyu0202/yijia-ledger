/*
 * 一家帳 — Service Worker
 * 只快取介面檔，不快取 API（API 在 script.google.com，不經過這裡）。
 * - 頁面（index.html）：先上網抓最新版，離線時才用快取。
 * - 其他介面檔：網址帶 ?v= 版本號，版本不變就直接用快取；換版本時抓新檔並刪掉舊版。
 */

const CACHE = 'yijia-ui';
const VERSION = '5'; // 與 index.html 的 ?v= 相同
const ASSETS = [
  './',
  'style.css?v=' + VERSION,
  'config.js?v=' + VERSION,
  'app.js?v=' + VERSION,
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // 清掉不在目前清單內的舊版檔案
  const keep = new Set(ASSETS.map((a) => new URL(a, self.registration.scope).href));
  event.waitUntil(caches.open(CACHE)
    .then((c) => c.keys().then((reqs) => Promise.all(reqs.filter((r) => !keep.has(r.url)).map((r) => c.delete(r)))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    const pageKey = new URL('./', self.registration.scope).href;
    event.respondWith(fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(pageKey, copy));
        }
        return res;
      })
      .catch(() => caches.match(pageKey)));
    return;
  }

  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && url.searchParams.has('v')) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  })));
});
