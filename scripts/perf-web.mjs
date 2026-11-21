/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : scripts/perf-web.mjs
 * Module           : scripts
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
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

// Measures the web application as served by an API instance (built bundle, not the Vite dev server):
//   time to an interactive explorer, and a folder of 2,000 files in list and in grid mode.
// Usage: node scripts/perf-web.mjs <base url> <invite url>      — prints one JSON object. See docs/next/PERF-web.md.
import { chromium } from '@playwright/test';

const [base, invite] = process.argv.slice(2);
const token = invite.split('/').pop();
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 }, locale: 'fr-CA' });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
await page.goto('/pwa/favicon.svg');
await page.evaluate(async (inviteToken) => {
  const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const un = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const call = async (path, body) => { const r = await fetch(`/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SPD-CSRF': '1' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${path}: ${await r.text()}`); return r.json(); };
  const o = await call('/auth/register/options', { invite: inviteToken, displayName: 'Perf' });
  const pk = o.options;
  const cred = await navigator.credentials.create({ publicKey: { ...pk, challenge: un(pk.challenge), user: { ...pk.user, id: un(pk.user.id) }, excludeCredentials: [] } });
  await call('/auth/register/verify', { invite: inviteToken, challengeId: o.challengeId, label: 'Perf', response: { id: cred.id, rawId: b64(cred.rawId), type: cred.type, clientExtensionResults: {}, response: { clientDataJSON: b64(cred.response.clientDataJSON), attestationObject: b64(cred.response.attestationObject), transports: ['internal'] } } });
}, token);
// seed: 12 files and 3 folders at the root; a folder "Deux mille" with 2,000 files (100 uploaded, then copied in place)
const big = await page.evaluate(async () => {
  const h = { 'X-SPD-CSRF': '1', 'Content-Type': 'application/json' };
  const j = async (m, p, b) => { const r = await fetch(`/api/v1${p}`, { method: m, headers: h, body: b ? JSON.stringify(b) : m === 'GET' ? undefined : '{}' }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json(); };
  const up = async (folderId, name, text) => { const bytes = new TextEncoder().encode(text); const u = await j('POST', '/uploads', { folderId, name, size: bytes.length }); await fetch(`/api/v1/uploads/${u.id}?offset=0`, { method: 'PATCH', headers: { 'X-SPD-CSRF': '1', 'Content-Type': 'application/octet-stream' }, body: bytes }); return (await j('POST', `/uploads/${u.id}/complete`)).file; };
  const root = (await j('GET', '/folders/root')).folder.id;
  for (const n of ['Projets', 'Photos', 'Administratif']) await j('POST', '/folders', { parentId: root, name: n });
  for (let i = 0; i < 12; i++) await up(root, `document ${String(i).padStart(2, '0')}.txt`, `contenu ${i}`);
  const folder = (await j('POST', '/folders', { parentId: root, name: 'Deux mille' })).id;
  const first = [];
  for (let i = 0; i < 100; i++) first.push((await up(folder, `fichier ${String(i).padStart(4, '0')}.txt`, `ligne ${i}`)).id);
  for (let k = 1; k < 20; k++) await j('POST', '/copy', { fileIds: first, folderIds: [], destinationId: folder });
  return folder;
});
await page.waitForTimeout(61_000); // the seeding spent most of the per-address request budget of this minute
const count = await page.evaluate(async (id) => (await (await fetch(`/api/v1/folders/${id}`)).json()).files.length, big);

async function load(path, mode, runs) {
  const t = { firstRow: [], settled: [], nodes: [], rows: [], longTaskMs: [], select: [] };
  for (let i = 0; i < runs; i++) {
    await page.goto('/pwa/favicon.svg');
    await page.evaluate((m) => localStorage.setItem('spd.explorer.view', m), mode);
    await page.addInitScript(() => { window.__first = 0; const look = () => { if (!window.__first && document.querySelector('[data-testid=listing] [role=row][data-id]')) { window.__first = performance.now(); mo.disconnect(); } }; const mo = new MutationObserver(look); mo.observe(document, { childList: true, subtree: true }); window.__lt = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += e.duration; }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ } });
    await page.goto(path, { waitUntil: 'commit' });
    await page.waitForSelector('[data-testid=listing] [role=row][data-id]');
    t.firstRow.push(await page.evaluate(() => window.__first));
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    t.settled.push(await page.evaluate(() => performance.now()));
    t.nodes.push(await page.evaluate(() => document.querySelectorAll('*').length));
    t.rows.push(await page.evaluate(() => document.querySelectorAll('[data-testid=listing] [role=row][data-id]').length));
    t.longTaskMs.push(await page.evaluate(() => Math.round(window.__lt)));
    // interaction: select the first row, until the frame that shows it selected
    t.select.push(await page.evaluate(() => new Promise((resolve) => {
      const row = document.querySelector('[data-testid=listing] [role=row][data-id]'); const t0 = performance.now();
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const tick = () => (row.getAttribute('aria-selected') === 'true' ? requestAnimationFrame(() => resolve(performance.now() - t0)) : requestAnimationFrame(tick));
      tick();
    })));
  }
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(median(v))]));
}
const out = { base, files: count, explorerRoot: await load('/', 'grid', 9), big: { list: await load(`/folder/${big}`, 'list', 5), grid: await load(`/folder/${big}`, 'grid', 5) } };
// bytes of script and style the explorer route downloads on a cold cache
const cold = await browser.newContext({ baseURL: base, storageState: await context.storageState() });
const p2 = await cold.newPage();
await p2.goto('/', { waitUntil: 'networkidle' });
out.transfer = await p2.evaluate(() => { const r = performance.getEntriesByType('resource').filter((e) => /\.(js|css)(\?|$)/.test(e.name)); return { requests: r.length, encodedKb: Math.round(r.reduce((n, e) => n + e.encodedBodySize, 0) / 1024), decodedKb: Math.round(r.reduce((n, e) => n + e.decodedBodySize, 0) / 1024) }; });
console.log(JSON.stringify(out, null, 1));
await browser.close();
