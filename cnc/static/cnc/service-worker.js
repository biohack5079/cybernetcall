// /home/my/d/cybernetcall/cnc/static/cnc/service-worker.js
// (提供されたコード、キャッシュ対象URLを修正)

const CACHE_NAME = 'cybernetcall-cache-v3'; // 必要に応じてバージョン更新
const urlsToCache = [
  // './', // ルートURL (DjangoのURL設定に依存するため、 '/' の方が確実かも)
  '/', // アプリケーションのルート
  '/static/cnc/manifest.json',
  // アイコンのパスを修正 (manifest.jsonに合わせる)
  '/static/cnc/icons/icon-192x192.png',
  '/static/cnc/icons/icon-512x512.png',
  '/static/cnc/app.js',
  '/static/cnc/style.css',
  // 外部ライブラリもキャッシュする場合 (任意、CDNが落ちた時用)
  // 'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js',
  // 'https://unpkg.com/idb@7/build/umd.js',
  // 'https://unpkg.com/html5-qrcode'
];

// インストール時にキャッシュ
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing new service worker...');
  self.skipWaiting(); // 新しいSWをすぐに有効化
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      // addAllは一つでも失敗すると全体が失敗する
      return cache.addAll(urlsToCache).catch(error => {
          console.error('[Service Worker] Failed to cache urls:', error);
          // キャッシュ失敗時の処理 (部分的にキャッシュするなど)
      });
    })
  );
});

// アクティベート時に古いキャッシュを削除
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
      return self.clients.claim(); // 即座にクライアント制御を開始
    })
  );
});

// リクエスト処理 (ネットワークファースト、失敗時キャッシュ)
self.addEventListener('fetch', (event) => {
  // POSTリクエストなどはキャッシュしない (必要に応じてGETのみ対象にする)
  if (event.request.method !== 'GET') {
      return;
  }

  // HTMLファイルのリクエストは常にネットワークを試みる (最新表示のため)
  if (event.request.mode === 'navigate') {
      event.respondWith(
          fetch(event.request).catch(() => caches.match('/')) // ルートをフォールバック
      );
      return;
  }

  // その他のリソース (CSS, JS, 画像など)
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
          // ネットワークから取得成功
          // レスポンスをクローンしてキャッシュに保存 (レスポンスは一度しか読めないため)
          let responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
          });
          return networkResponse; // オリジナルのレスポンスを返す
      })
      .catch(() => {
          // ネットワーク失敗時、キャッシュから探す
          console.log(`[Service Worker] Network failed for ${event.request.url}, trying cache.`);
          return caches.match(event.request).then(cachedResponse => {
              if (cachedResponse) {
                  console.log(`[Service Worker] Serving ${event.request.url} from cache.`);
                  return cachedResponse;
              }
              // キャッシュにもない場合 (エラー応答を返すことも可能)
              console.warn(`[Service Worker] ${event.request.url} not found in cache.`);
              // return new Response("Network error and not in cache", { status: 404, statusText: "Not Found" });
              return undefined; // ブラウザのデフォルトエラーに任せる
          });
      })
  );
});