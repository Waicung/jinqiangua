/* ======================================================
   周易起卦 — Service Worker (Cache-First)
   ====================================================== */

const CACHE_NAME = 'jinqiangua-v5';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/version.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/data/iching.json',
];

// ── Install: pre-cache all static assets ──────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Activate immediately — don't wait for old SW to close
  self.skipWaiting();
});

// ── Listen for skip-waiting message from refresh button ─
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Activate: clean up old caches ────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  // Take control of all clients immediately
  return self.clients.claim();
});

// ── Fetch: cache-first, fallback to network ──────────
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // version.json: network-first, so the badge always
  // reflects the live deployment (cache as offline fallback)
  const url = new URL(event.request.url);
  if (url.pathname === '/version.json') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() =>
          caches.match(event.request).then((cached) =>
            cached || new Response('{}', {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Return cached response immediately, or fetch from network
      return cached || fetch(event.request).then((response) => {
        // Optionally cache new requests for future offline use
        // Skip non-successful responses and non-GET
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        // Clone the response since it can only be consumed once
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      }).catch(() => {
        // Network failed and not in cache — return offline fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
