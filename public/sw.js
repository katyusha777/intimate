// App-shell service worker: cache-first for hashed/static assets only.
// SSR pages stay network-served (edge cache does the heavy lifting).
// OneSignal push rides THIS worker (one worker, one scope) — the import wires
// its push/notificationclick handlers; PushManager.astro points the SDK here.
// Wrapped: the OneSignal CDN is a known-blocked tracker (Brave Shields, ad
// blockers) and can also just fail — an uncaught throw here aborts evaluation
// and the WHOLE app-shell worker fails to register. Push degrades; PWA lives.
try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
} catch (e) {
  // Push unavailable (CDN blocked/unreachable) — app-shell caching still works.
}

const STATIC_CACHE = 'static-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // /_astro/* filenames are content-hashed — safe to cache forever.
  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      }),
    );
  }
});
