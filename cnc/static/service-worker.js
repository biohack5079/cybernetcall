// service-worker.js

const CACHE_NAME = 'cybernetcall-cache-v2'; // ★バージョンを1つ上げた
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon.png'
];

// インストール時に即スキップしてすぐ新しいSW有効化
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing new service worker...');
  self.skipWaiting(); // ★ここが大事
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(urlsToCache);
    })
  );
});

// アクティベート時に古いキャッシュを一掃
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating and cleaning old caches...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] Now ready to handle fetches!');
      return self.clients.claim(); // ★ここも大事
    })
  );
});

// ネット接続優先、なければキャッシュ
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});

