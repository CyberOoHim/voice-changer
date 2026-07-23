/* VoxClip Studio service worker — GitHub Pages friendly (relative scope) */
const CACHE = 'voxclip-studio-v3-2';
const PRECACHE = [
  './',
  './index.html',
  './fx-presets.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && (url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname.endsWith('.js') || url.pathname.endsWith('.json') || url.pathname.endsWith('.webmanifest') || url.pathname.endsWith('.png'))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);

      // Network-first for HTML (fresh app), cache-first fallback for assets
      if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
        return network.then((r) => r || cached || caches.match('./index.html'));
      }
      return cached || network;
    })
  );
});
