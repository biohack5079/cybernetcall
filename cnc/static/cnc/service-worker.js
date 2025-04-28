// /home/my/d/cybernetcall/cnc/static/cnc/service-worker.js
// Updated Service Worker with refined caching and logging.

const CACHE_NAME = 'cybernetcall-cache-v4'; // Increment version on changes
const urlsToCache = [
  // Core application shell
  '/', // Root URL (ensure Django serves this correctly)
  '/static/cnc/manifest.json',
  '/static/cnc/style.css',
  '/static/cnc/app.js',
  // Icons (ensure paths match manifest.json and actual files)
  '/static/cnc/icons/favicon.ico',
  '/static/cnc/icons/icon-192x192.png',
  '/static/cnc/icons/icon-512x512.png',
  '/static/cnc/icons/icon-maskable-512x512.png',
  '/static/cnc/icons/apple-touch-icon.png', // Cache if added
  // External libraries (cache for offline resilience)
  'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js',
  'https://unpkg.com/idb@7/build/umd.js',
  'https://unpkg.com/html5-qrcode'
];

// Install: Cache the application shell
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Install event fired. Caching app shell.');
  // Ensure the new service worker activates immediately
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching:', urlsToCache);
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.error('[Service Worker] Failed to cache app shell:', error);
        // Optional: Throw error to indicate install failure
        // throw error;
      })
  );
});

// Activate: Clean up old caches and take control
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activate event fired. Cleaning old caches.');
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
      console.log('[Service Worker] Claiming clients.');
      // Take control of all open clients immediately
      return self.clients.claim();
    })
  );
});

// Fetch: Serve from network first, then cache (Network falling back to cache)
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests and Chrome extension requests
  if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
    // Let the browser handle it directly
    return;
  }

  // Strategy: Network falling back to cache
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Check if we received a valid response
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            // If response is not valid, don't cache it, return it directly
            // This handles opaque responses from CDNs correctly if not caching them
            // console.log(`[Service Worker] Valid network response for ${event.request.url}. Caching.`);
             return networkResponse;
        }

        // Clone the response stream because it can only be consumed once
        let responseToCache = networkResponse.clone();

        // Cache the valid network response
        caches.open(CACHE_NAME)
          .then(cache => {
            // console.log(`[Service Worker] Caching network response for: ${event.request.url}`);
            cache.put(event.request, responseToCache);
          });

        // Return the original network response to the browser
        return networkResponse;
      })
      .catch(() => {
        // Network request failed, try to serve from cache
        console.log(`[Service Worker] Network failed for ${event.request.url}. Trying cache.`);
        return caches.match(event.request)
          .then(cachedResponse => {
            if (cachedResponse) {
              console.log(`[Service Worker] Serving ${event.request.url} from cache.`);
              return cachedResponse;
            }
            // Critical failure: Not in cache either
            console.warn(`[Service Worker] ${event.request.url} not found in cache. Cannot serve.`);
            // Return a generic fallback or error response if appropriate
            // For HTML pages, maybe return an offline page: return caches.match('/offline.html');
            // For other assets, return undefined to let the browser handle the error
            return new Response(`Network error and resource not found in cache: ${event.request.url}`, {
                 status: 404,
                 statusText: "Not Found",
                 headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
  );
});
