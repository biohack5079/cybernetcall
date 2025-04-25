const CACHE_NAME = 'cybernetcall-cache-v1'; // キャッシュ名にバージョンを含める
const URLS_TO_CACHE = [
    '/',
    '/static/app.js',
    '/static/manifest.json',
    '/static/sw.js',
    '/static/css/styles.css',
    'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js',
    'https://unpkg.com/idb@7/build/umd.js',
    'https://unpkg.com/html5-qrcode'
];

// インストールイベント: キャッシュを作成
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('Opened cache');
            return cache.addAll(URLS_TO_CACHE);
        })
    );
});

// アクティベートイベント: 古いキャッシュを削除
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// フェッチイベント: キャッシュからリソースを提供
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});