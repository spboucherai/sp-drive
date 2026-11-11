// Share links as an anonymous visitor uses them (Chromium desktop, Chromium phone, WebKit iPhone). The owner is a real
// account driven through the API from a separate Chromium context.
import { type Browser, type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { apiSignUp } from './helpers.ts';

test.use({ locale: 'fr-CA' });
const BASE = process.env.SPD_E2E_BASE ?? 'http://localhost:5183';
const SHOTS = process.env.SPD_SHOTS ? '/tmp/spd-shots/sharing' : '';
// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let ownerBrowser: Browser, ownerCtx: BrowserContext, owner: Page;
async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  return owner.evaluate(async ([m, p, b]) => {
    const r = await fetch(`/api/v1${p}`, { method: m as string, headers: { 'X-SPD-CSRF': '1', ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: b !== undefined ? JSON.stringify(b) : m === 'GET' ? undefined : '{}' });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${JSON.stringify(j)}`);
    return j;
  }, [method, path, body] as const);
}
/** Upload one file into a folder of the owner through the real upload endpoints. */
async function upload(folderId: string, name: string, content: Buffer | string): Promise<{ id: string; name: string }> {
  const bytes = [...(typeof content === 'string' ? Buffer.from(content) : content)];
  const r = await owner.evaluate(async ([folder, n, b]) => {
    const h = { 'X-SPD-CSRF': '1' };
    const u = await (await fetch('/api/v1/uploads', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: folder, name: n, size: (b as number[]).length }) })).json();
    await fetch(`/api/v1/uploads/${u.id}?offset=0`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(b as number[]) });
    const done = await fetch(`/api/v1/uploads/${u.id}/complete`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' });
    if (!done.ok) throw new Error(await done.text());
    return done.json();
  }, [folderId, name, bytes] as const);
  return r.file;
}
let n = 0;
const folder = (name: string, parentId = 'root') => call<{ id: string; name: string }>('POST', '/folders', { parentId, name: parentId === 'root' ? `${name} ${Date.now()}-${++n}` : name });
/** Create a link; returns its id and its public path. */
async function share(target: { fileId?: string; folderId?: string }, settings: Record<string, unknown> = {}): Promise<{ id: string; path: string; token: string }> {
  const r = await call('POST', '/shares', { ...target, ...settings });
  const token = new URL(r.url).pathname.split('/').pop()!;
  return { id: r.share.id, path: `/s/${token}`, token };
}
const shot = async (page: Page, name: string, tag: string) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/share-${name}-${tag}.png`, fullPage: true }); } };
const unavailable = (page: Page) => page.getByRole('heading', { name: 'Ce lien n’est pas disponible' });

test.beforeAll(async () => {
  ownerBrowser = await chromium.launch();
  ownerCtx = await ownerBrowser.newContext({ baseURL: BASE });
  owner = await ownerCtx.newPage();
  await apiSignUp(ownerCtx, owner);
});
test.afterAll(async () => { await ownerBrowser?.close(); });
// The API limits anonymous calls per address and every browser here comes from 127.0.0.1: give each test its own
// client address (the development proxy is a trusted hop, as the production gateway is).
const clientIp = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
test.beforeEach(async ({ context }) => { await context.setExtraHTTPHeaders({ 'X-Forwarded-For': clientIp() }); });

test('a file link with a password: wrong, then right, then download', async ({ page }, info) => {
  const d = await folder('Partage fichier');
  const f = await upload(d.id, 'Rapport annuel.txt', 'Contenu du rapport.\n');
  const s = await share({ fileId: f.id }, { password: 'mésange-7', label: 'Pour la comptable' });
  await page.goto(s.path);
  await expect(page.getByRole('heading', { name: 'Ce contenu est protégé' })).toBeVisible();
  expect(await page.content()).not.toContain(s.token);
  await shot(page, 'password', info.project.name);
  await page.getByLabel('Mot de passe').fill('faux');
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(page.getByText('Mot de passe incorrect.')).toBeVisible();
  await expect(page.getByTestId('file-share')).toHaveCount(0);
  await page.getByLabel('Mot de passe').fill('mésange-7');
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rapport annuel.txt' })).toBeVisible();
  await expect(page.getByText('Pour la comptable')).toBeVisible();
  await expect(page).toHaveTitle('Pour la comptable');
  await shot(page, 'file', info.project.name);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Rapport annuel.txt');
  // one successful view, one refused password, one download in the owner's journal
  const events = await call('GET', `/shares/${s.id}/events`);
  expect(events.map((e: { kind: string; ok: boolean }) => `${e.kind}:${e.ok}`).sort()).toEqual(['download:true', 'open:true', 'password:false']);
  // a reload within the hour does not count a second view
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Rapport annuel.txt' })).toBeVisible();
  expect((await call('GET', `/shares?fileId=${f.id}`))[0].viewCount).toBe(1);
  // the preview opens in the viewer
  await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
  await expect(page.getByText('Contenu du rapport.')).toBeVisible();
});

test('a view-only link offers no download and the server refuses one', async ({ page }) => {
  const d = await folder('Lecture seule');
  const f = await upload(d.id, 'photo.png', PNG);
  const s = await share({ fileId: f.id }, { canDownload: false });
  await page.goto(s.path);
  await expect(page.getByRole('heading', { level: 1, name: 'photo.png' })).toBeVisible();
  await expect(page.getByText('Lecture seule', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Télécharger/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Télécharger/ })).toHaveCount(0);
  const base = `/api/v1/public/shares/${s.token}/files/${f.id}/content`;
  const refused = await page.request.get(`${base}?download=1`);
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error).toBe('download_forbidden');
  expect((await page.request.get(base)).status()).toBe(200); // viewing inline stays possible
});

test('a folder link: navigation stays inside the shared folder', async ({ page }, info) => {
  const parent = await folder('Parent privé');
  await upload(parent.id, 'secret.txt', 'ne pas voir');
  const shared = await folder('Dossier client', parent.id);
  const sub = await folder('Factures', shared.id);
  await upload(shared.id, 'Lisez-moi.txt', 'Bienvenue');
  await upload(shared.id, 'logo.png', PNG);
  await upload(sub.id, 'facture-001.txt', 'Total : 100 $');
  const s = await share({ folderId: shared.id });
  await page.goto(s.path);
  await expect(page.getByRole('heading', { level: 1, name: 'Dossier client' })).toBeVisible();
  const entries = page.getByTestId('entries');
  await expect(entries.locator('[data-entry="file"]')).toHaveCount(2);
  await expect(entries.locator('[data-entry="folder"]')).toHaveCount(1);
  await expect(page.getByTestId('crumbs').getByRole('listitem')).toHaveCount(1); // the path starts at the shared folder
  await expect(page.getByText('Parent privé')).toHaveCount(0);
  await shot(page, 'folder', info.project.name);

  await entries.getByRole('button', { name: 'Factures' }).click();
  await expect(page.getByTestId('crumbs').getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Ouvrir facture-001.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir facture-001.txt' }).click();
  await expect(page.getByText('Total : 100 $')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('crumbs').getByRole('button', { name: 'Dossier client' }).click();
  await expect(entries.locator('[data-entry="file"]')).toHaveCount(2);

  // the server refuses the parent, a sibling of the share and any file outside it
  const api = `/api/v1/public/shares/${s.token}`;
  expect((await page.request.get(`${api}/list?folder=${parent.id}`)).status()).toBe(404);
  expect((await page.request.get(`${api}/list?folder=${sub.id}`)).status()).toBe(200);
  expect((await page.request.get(`${api}/zip?folder=${parent.id}`)).status()).toBe(404);
  const outside = (await call('GET', `/folders/${parent.id}`)).files[0];
  expect((await page.request.get(`${api}/files/${outside.id}/content`)).status()).toBe(404);
  // a hand-made address pointing above the share falls back to the shared folder
  await page.goto(`${s.path}#${parent.id}`);
  await expect(page.getByTestId('share-alert')).toContainText('Ce dossier n’existe plus');
  await expect(page.getByTestId('crumbs').getByRole('listitem')).toHaveCount(1);

  // per-file download and the ZIP of the whole folder
  const one = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger Lisez-moi.txt' }).click();
  expect((await one).suggestedFilename()).toBe('Lisez-moi.txt');
  const zip = page.waitForEvent('download');
  await page.getByTestId('zip').click();
  expect((await zip).suggestedFilename()).toBe('Dossier client.zip');
});

test('a link revoked while the page is open: the next action shows the unavailable state', async ({ page }) => {
  const shared = await folder('À révoquer');
  await folder('Sous-dossier', shared.id);
  await upload(shared.id, 'note.txt', 'note');
  const s = await share({ folderId: shared.id });
  await page.goto(s.path);
  await expect(page.getByRole('heading', { level: 1, name: /À révoquer/ })).toBeVisible();
  await call('DELETE', `/shares/${s.id}`);
  await page.getByTestId('entries').getByRole('button', { name: 'Sous-dossier' }).click();
  await expect(unavailable(page)).toBeVisible();
  await expect(page.getByTestId('entries')).toHaveCount(0);
  await page.reload();
  await expect(unavailable(page)).toBeVisible();

  // same for a file link: opening the preview or downloading after the revocation
  const f = await upload(shared.id, 'autre.txt', 'autre');
  const s2 = await share({ fileId: f.id });
  await page.goto(s2.path);
  await expect(page.getByRole('heading', { level: 1, name: 'autre.txt' })).toBeVisible();
  await call('DELETE', `/shares/${s2.id}`);
  await page.getByRole('button', { name: 'Télécharger', exact: true }).click();
  await expect(unavailable(page)).toBeVisible();
});

test('a single-use link works once: a second browser gets the unavailable state', async ({ page, browser }, info) => {
  const d = await folder('Usage unique');
  const f = await upload(d.id, 'unique.txt', 'une seule fois');
  const s = await share({ fileId: f.id }, { singleUse: true });
  await page.goto(s.path);
  await expect(page.getByRole('heading', { level: 1, name: 'unique.txt' })).toBeVisible();
  const ctx = await browser.newContext({ ...info.project.use, locale: 'fr-CA', baseURL: BASE, extraHTTPHeaders: { 'X-Forwarded-For': clientIp() } });
  const second = await ctx.newPage();
  await second.goto(s.path);
  await expect(unavailable(second)).toBeVisible();
  await expect(second.getByText('unique.txt')).toHaveCount(0);
  await ctx.close();
  const events = await call('GET', `/shares/${s.id}/events`);
  expect(events.filter((e: { kind: string; ok: boolean }) => e.kind === 'open').map((e: { ok: boolean }) => e.ok).sort()).toEqual([false, true]);
});

test('the download limit is explained instead of a raw server answer', async ({ page }) => {
  const d = await folder('Limite');
  const f = await upload(d.id, 'limité.txt', 'deux fois non');
  const s = await share({ fileId: f.id }, { maxDownloads: 1 });
  await page.goto(s.path);
  const first = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger', exact: true }).click();
  await first;
  await page.getByRole('button', { name: 'Télécharger', exact: true }).click();
  await expect(page.getByTestId('share-alert')).toContainText('La limite de téléchargements de ce lien est atteinte');
  await expect(page.getByRole('heading', { level: 1, name: 'limité.txt' })).toBeVisible(); // still on the page, no raw JSON
  expect(page.url()).toContain('/s/');
});

test('an unknown link shows one neutral state, in French or in English', async ({ page }) => {
  await page.goto(`/s/${'B'.repeat(43)}`);
  await expect(unavailable(page)).toBeVisible();
  await expect(page.locator('a[href]')).toHaveCount(0);
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'This link is not available' })).toBeVisible();
  await page.getByRole('button', { name: 'Français' }).click();
});

test('screenshots (SPD_SHOTS=1): light and dark', async ({ browser }, info) => {
  test.skip(!SHOTS, 'set SPD_SHOTS=1');
  const shared = await folder('Dossier client Tremblay');
  await folder('Factures 2026', shared.id); await folder('Contrats', shared.id);
  await upload(shared.id, 'Lisez-moi.txt', 'Bienvenue'); await upload(shared.id, 'logo.png', PNG); await upload(shared.id, 'Budget.csv', 'poste,montant\nloyer,1200\n');
  const f = await upload(shared.id, 'Rapport annuel 2025.txt', 'Rapport');
  const withPw = await share({ fileId: f.id }, { password: 'abcd', label: 'Rapport pour le conseil' });
  const fileLink = await share({ fileId: f.id }, { label: 'Rapport pour le conseil', expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
  const folderLink = await share({ folderId: shared.id });
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ ...info.project.use, colorScheme: scheme, locale: 'fr-CA', baseURL: BASE, extraHTTPHeaders: { 'X-Forwarded-For': clientIp() } });
    const page = await ctx.newPage();
    const tag = `${info.project.name}-${scheme}`;
    await page.goto(withPw.path); await expect(page.getByTestId('gate')).toBeVisible(); await shot(page, 'password', tag);
    await page.goto(fileLink.path); await expect(page.getByTestId('file-share')).toBeVisible(); await page.waitForTimeout(500); await shot(page, 'file', tag);
    await page.goto(folderLink.path); await expect(page.getByTestId('entries')).toBeVisible(); await page.waitForTimeout(800); await shot(page, 'folder', tag);
    await page.goto(`/s/${'C'.repeat(43)}`); await expect(unavailable(page)).toBeVisible(); await shot(page, 'unavailable', tag);
    await ctx.close();
  }
});
