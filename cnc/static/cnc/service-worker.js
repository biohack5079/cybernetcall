// /home/my/d/cybernetcall/cnc/static/cnc/service-worker.js
// Service worker with pre-caching for local assets and external libraries

// Define a unique name for the cache, including a version number
const CACHE_NAME = 'cybernetcall-cache-v5'; // Keep or increment version as needed

// List of URLs to pre-cache when the service worker installs
const urlsToCache = [
  // Core application shell
  '/', // The main HTML page
  '/static/cnc/manifest.json',
  '/static/cnc/app.js',
  '/static/cnc/style.css',
  // Icons used by manifest and potentially HTML
  '/static/cnc/icons/icon-192x192.png',
  '/static/cnc/icons/icon-512x512.png',
  '/static/cnc/icons/icon-maskable-512x512.png', // Also cache maskable icon
  // External libraries loaded from CDNs in index.html
  'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.8/purify.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js',
  'https://unpkg.com/idb@7/build/umd.js',
  'https://unpkg.com/html5-qrcode' // Note:unpkg might redirect, consider specific version URL if issues arise
];

// Event listener for the 'install' event
self.addEventListener('install', event => {
  console.log('[Service Worker] Install event');
  // Force the waiting service worker to become the active service worker.
  self.skipWaiting();
  // Pre-cache the defined URLs
  event.waitUntil(
    caches.open(CACHE_NAME) // Open the specified cache
      .then(cache => {
        console.log('[Service Worker] Opened cache:', CACHE_NAME);
        // Add all URLs from urlsToCache to the cache
        return cache.addAll(urlsToCache)
          .catch(err => {
            // Log errors if any URL fails to cache (e.g., network error)
            console.error('[Service Worker] Failed to cache one or more resources during install:', err);
            // Optional: You might want to throw the error to fail the installation
            // if core assets couldn't be cached.
            // throw err;
          });
      })
  );
});

// Event listener for the 'activate' event
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activate event');
  // Clean up old caches
  event.waitUntil(
    caches.keys().then(keys =>
      // Wait for all promises to resolve (deleting old caches)
      Promise.all(keys.map(key => {
        // If a cache key doesn't match the current CACHE_NAME, delete it
        if (key !== CACHE_NAME) {
          console.log('[Service Worker] Deleting old cache:', key);
          return caches.delete(key);
        }
      }))
    ).then(() => {
      // Take control of uncontrolled clients (pages) immediately
      console.log('[Service Worker] Claiming clients');
      return self.clients.claim().then(() => {
        // After claiming clients, send a message to all controlled clients
        // This can be used by the app to know a new SW is active or app was launched
        self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            console.log('[Service Worker] Sending APP_ACTIVATED message to client:', client.id);
            client.postMessage({ type: 'APP_ACTIVATED', newSW: true });
          });
        });
      });
    })
  );
});

// Listen for messages from the client (app.js) if needed in the future
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'REQUEST_CLIENTS_INFO') {
    console.log('[Service Worker] Received message from client:', event.data);
    // Example: Respond with some info or trigger other SW actions
    // event.source.postMessage({ type: 'CLIENTS_INFO_RESPONSE', data: 'Some info from SW' });
  }
});

// Event listener for the 'fetch' event (intercepting network requests)
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // Apply Stale-While-Revalidate strategy for app.js
  if (requestUrl.pathname === '/static/cnc/app.js') {
    // console.log('[Service Worker] Applying Stale-While-Revalidate for:', event.request.url);
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          const fetchPromise = fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.ok) {
              // console.log('[Service Worker] SWR: Caching new version of', event.request.url);
              cache.put(event.request, networkResponse.clone());
            } else if (networkResponse) {
              // console.warn('[Service Worker] SWR: Network request failed or not ok for', event.request.url, networkResponse.status);
            } else {
              // console.warn('[Service Worker] SWR: Network request completely failed for', event.request.url);
            }
            return networkResponse;
          }).catch(error => {
            // console.error('[Service Worker] SWR: Fetch error for', event.request.url, error);
            // If network fails, and there's a cached response, it will be used.
            // If no cached response, this will lead to an error for the client.
            return undefined; 
          });
          // Return cached response if available, otherwise wait for fetchPromise
          return cachedResponse || fetchPromise;
        });
      })
    );
  } else {
    // For all other resources, use Network falling back to cache strategy
    // console.log('[Service Worker] Applying Network falling back to cache for:', event.request.url);
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          // console.log('[Service Worker] Network failed, trying cache for:', event.request.url);
          return caches.match(event.request).then(cachedResponse => {
            // if (!cachedResponse) {
            //   console.log('[Service Worker] Not found in cache:', event.request.url);
            // }
            return cachedResponse;
          });
        })
    );
  }
});

