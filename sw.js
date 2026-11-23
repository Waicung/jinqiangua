/* ======================================================
   周易起卦 — Service Worker (Cache-First)
   ====================================================== */

const CACHE_NAME = 'jinqiangua-v12';

// Only http(s) requests can be stored in the Cache API.
// Requests injected by browser extensions (chrome-extension://, …)
// or other schemes must be passed straight through to the network.
const isCacheableScheme = (url) =>
  url.protocol === 'http:' || url.protocol === 'https:';

// Fire-and-forget cache write that never produces an unhandled rejection.
const safePut = (request, response) => {
  try {
    if (!isCacheableScheme(new URL(request.url))) return;
  } catch {
    return;
  }
  caches
    .open(CACHE_NAME)
    .then((cache) => cache.put(request, response))
    .catch(() => {
      /* caching is best-effort — ignore QuotaExceeded / unsupported schemes */
    });
};

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/demo',
  '/style.css',
  '/app.js',
  '/landing.js',
  '/version-badge.js',
  '/hexagram.js',
  '/canonical.js',
  '/imagery.js',
  '/service.js',
  '/webmcp.js',
  '/session.js',
  '/ui-kit.js',
  '/gemini.js',
  '/chat-panel.js',
  '/history-panel.js',
  '/manifest.json',
  '/version.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/data/iching.json',
  '/data/canonical.json',
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

  // Ignore anything outside the Cache API's supported schemes
  // (chrome-extension:// etc. injected by extensions, data:, blob:, …)
  if (!isCacheableScheme(url)) return;

  // API 永远走网络：服务端数据比离线缓存新，且 UI 自身可离线计算。
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (url.pathname === '/version.json') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          safePut(event.request, response.clone());
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
        safePut(event.request, response.clone());
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
