/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/sw.ts
 * Module           : web
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-11
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
