// App-shell service worker: makes the app installable and lets it open instantly. It never caches API answers or
// document content — files stay on the server and are fetched under the user's session every time.
const sw = self as unknown as ServiceWorkerGlobalScope; // typed by tsconfig.sw.json (WebWorker lib)
declare const __SW_VERSION__: string;
const CACHE = `spd-shell-${__SW_VERSION__}`;

sw.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest'])).then(() => sw.skipWaiting())); });
sw.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => sw.clients.claim())); });
sw.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== sw.location.origin || url.pathname.startsWith('/api/')) return; // network only
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/pwa/')) { // hashed, immutable
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) ?? fetch(req).then((res) => { if (res.ok) void c.put(req, res.clone()); return res; })));
    return;
  }
  if (req.mode === 'navigate') { // the shell: fresh when online, cached copy when offline
    e.respondWith(fetch(req).then((res) => { if (res.ok) void caches.open(CACHE).then((c) => c.put('/', res.clone())); return res; }).catch(async () => (await caches.match('/')) ?? Response.error()));
  }
});
