/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : tests/e2e/public.portal.spec.ts
 * Module           : tests
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

// The deposit portal as an anonymous depositor uses it (Chromium desktop, Chromium phone, WebKit iPhone). The owner is
// a real account driven through the API from a separate Chromium context (passkeys need Chromium's virtual authenticator).
import { type Browser, type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { apiSignUp } from './helpers.ts';

test.use({ locale: 'fr-CA' });
const BASE = process.env.SPD_E2E_BASE ?? 'http://localhost:5183';
const SHOTS = process.env.SPD_SHOTS ? '/tmp/spd-shots/sharing' : '';

let ownerBrowser: Browser, ownerCtx: BrowserContext, owner: Page;
/** Call the owner API from the signed-in owner page. */
async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  return owner.evaluate(async ([m, p, b]) => {
    const r = await fetch(`/api/v1${p}`, { method: m as string, headers: { 'X-SPD-CSRF': '1', ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: b !== undefined ? JSON.stringify(b) : m === 'GET' ? undefined : '{}' });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${JSON.stringify(j)}`);
    return j;
  }, [method, path, body] as const);
}
let n = 0;
/** A fresh target folder and a portal on it; returns the public path of the portal. */
async function portal(settings: Record<string, unknown> = {}): Promise<{ id: string; folderId: string; path: string; token: string }> {
  const folder = await call('POST', '/folders', { parentId: 'root', name: `Dépôts ${Date.now()}-${++n}` });
  const r = await call('POST', '/requests', { folderId: folder.id, title: 'Documents pour votre dossier', brandName: 'Cabinet Tremblay', ...settings });
  const token = new URL(r.url).pathname.split('/').pop()!;
  return { id: r.request.id, folderId: folder.id, path: `/request/${token}`, token };
}
const file = (name: string, content: string | Buffer, mimeType = 'application/octet-stream') => ({ name, mimeType, buffer: typeof content === 'string' ? Buffer.from(content) : content });
const big = (mb: number) => { const b = Buffer.alloc(mb * 1024 * 1024); for (let i = 0; i < b.length; i += 4096) b.writeUInt32LE((i * 2654435761) >>> 0, i); return b; };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
/** Everything deposited under a folder (recursively), as file names. */
async function deposited(folderId: string): Promise<string[]> {
  const l = await call('GET', `/folders/${folderId}`);
  const below = await Promise.all(l.folders.map((d: { id: string }) => deposited(d.id)));
  return [...l.files.map((f: { name: string }) => f.name), ...below.flat()];
}
const shot = async (page: Page, name: string, project: string) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/portal-${name}-${project}.png`, fullPage: true }); } };

/** Make the page wait before sending the upload blocks selected by `when`, until `window.__release()` is called. */
async function holdChunks(page: Page, when: (offset: number) => boolean): Promise<void> {
  await page.addInitScript(`(() => {
    const when = ${when.toString()}, orig = window.fetch.bind(window);
    window.__gate = new Promise((r) => { window.__release = r; });
    window.fetch = async (u, o) => {
      const m = /\\/public\\/uploads\\/[^?]+\\?offset=(\\d+)/.exec(String(u));
      if (m && o && o.method === 'PATCH' && when(Number(m[1]))) { window.__held = true; await window.__gate; }
      return orig(u, o);
    };
  })()`);
}
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

test('full deposit of two files, one sent in several blocks, ends with a receipt and lands in the owner’s folder', async ({ page }, info) => {
  const p = await portal({ description: 'Transmettez vos pièces justificatives.', instructions: 'Un fichier par document.\nFormats PDF ou image de préférence.', confirmationMessage: 'Merci ! Nous vous écrirons sous 48 h.', fields: { name: 'required', email: 'optional', reference: 'off', custom: [] } });
  const api: string[] = [], patches: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) { api.push(u.pathname); if (r.method() === 'PATCH') patches.push(u.pathname + u.search); } });
  await page.goto(p.path);
  await expect(page.getByRole('heading', { level: 1, name: 'Documents pour votre dossier' })).toBeVisible();
  await expect(page.getByTestId('portal-banner')).toContainText('Cabinet Tremblay');
  await expect(page.getByText('Un fichier par document.')).toBeVisible();
  await expect(page.getByTestId('portal-rules')).toContainText('200 Mo maximum par fichier');
  await expect(page).toHaveTitle(/Documents pour votre dossier/);
  expect(await page.content()).not.toContain(p.token); // the token is never displayed
  await shot(page, 'empty', info.project.name);

  await page.getByLabel('Votre nom').fill('Marie Côté');
  await page.getByTestId('file-input').setInputFiles([file('releve.pdf', PDF, 'application/pdf'), file('numérisation.bin', big(13))]);
  await expect(page.getByTestId('picked').getByRole('listitem')).toHaveCount(2);
  await shot(page, 'selected', info.project.name);
  const admitted = page.waitForResponse((r) => r.url().includes('/submissions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Envoyer 2 fichiers/ }).click();
  expect((await admitted).status()).toBe(200);

  const receipt = page.getByTestId('receipt');
  await expect(receipt).toBeVisible({ timeout: 90_000 });
  await expect(receipt.getByRole('heading', { name: 'Dépôt reçu' })).toBeFocused();
  const ref = (await page.getByTestId('receipt-ref').innerText()).trim();
  expect(ref).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  await expect(receipt.getByTestId('receipt-files').locator('[data-status="accepted"]')).toHaveCount(2);
  await expect(page.getByTestId('confirmation')).toHaveText('Merci ! Nous vous écrirons sous 48 h.');
  await shot(page, 'receipt', info.project.name);

  expect(patches.filter((u) => /offset=[1-9]/.test(u)).length).toBeGreaterThan(0); // the 13 MB file went in several blocks
  expect(api.filter((u) => !u.startsWith('/api/v1/public/'))).toEqual([]); // the page never asked for an owner endpoint
  expect((await deposited(p.folderId)).sort()).toEqual(['numérisation.bin', 'releve.pdf']);
  const subs = await call('GET', `/requests/${p.id}/submissions`);
  expect(subs).toHaveLength(1);
  expect(subs[0]).toMatchObject({ ref, status: 'completed', name: 'Marie Côté', placed: 2, rejected: 0 });

  // a reload of the tab shows the same receipt again; "another deposit" starts from a clean form
  await page.reload();
  await expect(page.getByTestId('receipt-ref')).toHaveText(ref);
  await page.getByRole('button', { name: 'Faire un autre dépôt' }).click();
  await expect(page.getByTestId('dropzone')).toBeVisible();
  // English is complete
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible();
  await expect(page.getByTestId('portal-rules')).toContainText('200 MB maximum per file');
  await page.getByRole('button', { name: 'Français' }).click();
});

test('required fields and consent are enforced before anything is sent', async ({ page }) => {
  const p = await portal({ fields: { name: 'required', email: 'required', reference: 'optional', custom: [{ key: 'no_dossier', label: 'Numéro de dossier', required: true }] }, requireConsent: true, consentText: 'J’autorise le Cabinet Tremblay à conserver ces documents.', retentionNote: 'Conservés 12 mois.' });
  let posts = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && /\/requests\/[^/]+\/submissions/.test(r.url())) posts++; });
  await page.goto(p.path);
  await page.getByTestId('file-input').setInputFiles(file('notes.txt', 'bonjour'));
  await page.getByRole('button', { name: /Envoyer 1 fichier/ }).click();
  await expect(page.getByText('Ce champ est obligatoire.')).toHaveCount(3);
  await expect(page.getByText('Vous devez donner votre consentement pour envoyer.')).toBeVisible();
  await expect(page.getByLabel('Votre nom')).toBeFocused();
  await expect(page.getByLabel('Votre nom')).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toBe(0);

  await page.getByLabel('Votre nom').fill('Luc Roy');
  await page.getByLabel('Votre courriel').fill('pas-un-courriel');
  await page.getByLabel('Numéro de dossier').fill('D-2026-041');
  await page.getByRole('button', { name: /Envoyer 1 fichier/ }).click();
  await expect(page.getByText('Entrez une adresse courriel valide.')).toBeVisible();
  await expect(page.getByText('Vous devez donner votre consentement pour envoyer.')).toBeVisible();
  expect(posts).toBe(0);

  await page.getByLabel('Votre courriel').fill('luc.roy@example.test');
  await page.getByLabel(/J’autorise le Cabinet Tremblay/).check();
  await expect(page.getByText('Conservés 12 mois.')).toBeVisible();
  await page.getByRole('button', { name: /Envoyer 1 fichier/ }).click();
  await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 60_000 });
  const [s] = await call('GET', `/requests/${p.id}/submissions`);
  const d = await call('GET', `/submissions/${s.id}`);
  expect(d).toMatchObject({ name: 'Luc Roy', email: 'luc.roy@example.test', meta: { no_dossier: 'D-2026-041' } });
  expect(d.consentAt).toBeTruthy();
});

test('a disallowed extension and an oversized file are refused on the device', async ({ page }) => {
  const p = await portal({ allowedExtensions: ['pdf', 'jpg'], maxFileBytes: 1024 * 1024, maxFilesPerSubmission: 3 });
  let posts = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && /\/requests\/[^/]+\/submissions/.test(r.url())) posts++; });
  await page.goto(p.path);
  await expect(page.getByTestId('portal-rules')).toContainText('Types acceptés : PDF, JPG');
  await page.getByTestId('file-input').setInputFiles([file('contrat.pdf', PDF), file('notes.txt', 'texte'), file('plan.pdf', big(2)), file('installeur.exe', 'MZ')]);
  const rows = page.getByTestId('picked').getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'notes.txt' })).toContainText('Type de fichier non accepté (.txt)');
  await expect(rows.filter({ hasText: 'plan.pdf' })).toContainText('Trop volumineux : 2 Mo (maximum 1 Mo)');
  await expect(rows.filter({ hasText: 'installeur.exe' })).toContainText('Les programmes et les scripts ne sont jamais acceptés');
  await expect(page.getByText('Ce portail accepte au plus 3 fichiers par dépôt ; vous en avez sélectionné 4.')).toBeVisible();
  await page.getByRole('button', { name: /Envoyer 4 fichiers/ }).click();
  expect(posts).toBe(0);
  await page.getByRole('button', { name: 'Retirer installeur.exe' }).click();
  await expect(page.getByText('Retirez les fichiers refusés pour continuer.')).toBeVisible();
  await page.getByRole('button', { name: 'Retirer les fichiers refusés' }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: /Envoyer 1 fichier/ }).click();
  await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 60_000 });
  expect(posts).toBe(1);
  expect(await deposited(p.folderId)).toEqual(['contrat.pdf']);
});

test('a protected portal refuses a wrong password, then accepts the right one', async ({ page }) => {
  const p = await portal({ password: 'tournesol-42', fields: { name: 'off', email: 'off', reference: 'off', custom: [] } });
  await page.goto(p.path);
  await page.getByTestId('file-input').setInputFiles(file('piece.pdf', PDF));
  await page.getByRole('button', { name: /Envoyer 1 fichier/ }).click();
  await expect(page.getByText('Entrez le mot de passe.', { exact: true })).toBeVisible();
  await page.getByLabel('Mot de passe').fill('mauvais');
  await page.getByRole('button', { name: /Envoyer 1 fichier/ }).click();
  await expect(page.getByText('Mot de passe incorrect.')).toBeVisible();
  await expect(page.getByLabel('Mot de passe')).toBeFocused();
  expect(await deposited(p.folderId)).toEqual([]);
  await page.getByLabel('Mot de passe').fill('tournesol-42');
  await page.getByRole('button', { name: /Envoyer 1 fichier/ }).click();
  await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 60_000 });
  expect(await deposited(p.folderId)).toEqual(['piece.pdf']);
});

test('a portal revoked during a transfer stops it: the depositor is told and nothing lands', async ({ page }, info) => {
  const p = await portal();
  // The first block passes; the next one is held in the page until the owner has revoked the portal. (Held in the page
  // rather than with page.route: WebKit does not replay an intercepted request that carries a multi-megabyte body.)
  await holdChunks(page, (offset) => offset > 0);
  await page.goto(p.path);
  await page.getByTestId('file-input').setInputFiles(file('archive-volumineuse.bin', big(20)));
  await page.getByRole('button', { name: /Envoyer 1 fichier/ }).click();
  await expect(page.getByTestId('keep-open')).toContainText('Ne fermez pas cette page');
  await expect(page.getByRole('progressbar', { name: 'Progression totale' })).toBeVisible();
  await page.waitForFunction(() => (window as any).__held === true);
  await shot(page, 'uploading', info.project.name);
  await call('DELETE', `/requests/${p.id}`);
  await page.evaluate(() => (window as any).__release());
  await expect(page.getByRole('heading', { name: 'Le portail a été fermé pendant l’envoi' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('receipt')).toHaveCount(0);
  await shot(page, 'closed-mid', info.project.name);
  expect(await deposited(p.folderId)).toEqual([]);
  const [s] = await call('GET', `/requests/${p.id}/submissions`);
  expect(s).toMatchObject({ status: 'expired', placed: 0 });
  // the link itself is dead for the next visitor, without saying why
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ce lien de dépôt n’est pas disponible' })).toBeVisible();
});

test('a tab reloaded during a transfer resumes the same deposit from the server’s offset', async ({ page }) => {
  const p = await portal();
  await holdChunks(page, (offset) => offset > 0);
  await page.goto(p.path);
  const data = big(13);
  await page.getByTestId('file-input').setInputFiles([file('plans.bin', data), file('note.txt', 'petit')]);
  await page.getByRole('button', { name: /Envoyer 2 fichiers/ }).click();
  await page.waitForFunction(() => (window as any).__held === true); // first block of the large file is on the server
  await expect(page.getByTestId('sending').getByRole('listitem').filter({ hasText: 'note.txt' })).toContainText('Envoyé');
  page.once('dialog', (d) => void d.accept()); // "leave the page?" warning
  await page.reload();
  const resume = page.getByTestId('resume');
  await expect(resume.getByRole('heading', { name: 'Un dépôt est en cours' })).toBeVisible();
  await expect(page.getByTestId('dropzone')).toHaveCount(0);
  await page.getByTestId('resume-input').setInputFiles(file('autre.bin', 'pas le bon'));
  await expect(resume.getByRole('alert')).toContainText('autre.bin');
  await page.getByTestId('resume-input').setInputFiles([file('plans.bin', data), file('note.txt', 'petit')]);
  const sent: string[] = [];
  page.on('request', (r) => { if (r.method() === 'PATCH') sent.push(new URL(r.url()).search); });
  await resume.getByRole('button', { name: 'Continuer l’envoi' }).click();
  await page.waitForFunction(() => (window as any).__held === true);
  await page.evaluate(() => (window as any).__release());
  await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('receipt-files').locator('[data-status="accepted"]')).toHaveCount(2);
  expect(sent.some((q) => q === '?offset=0')).toBe(false); // nothing already received was sent again
  const subs = await call('GET', `/requests/${p.id}/submissions`);
  expect(subs).toHaveLength(1); // the same deposit, not a second one
  expect(subs[0]).toMatchObject({ status: 'completed', placed: 2, bytes: data.length + 5 });
});

test('a paused portal says it no longer accepts deposits; an unknown link stays neutral', async ({ page }, info) => {
  const p = await portal();
  await call('PATCH', `/requests/${p.id}`, { active: false });
  await page.goto(p.path);
  await expect(page.getByRole('heading', { name: 'Ce portail n’accepte plus de dépôts' })).toBeVisible();
  await expect(page.getByTestId('dropzone')).toHaveCount(0);
  await shot(page, 'closed', info.project.name);
  await page.goto(`/request/${'A'.repeat(43)}`);
  await expect(page.getByRole('heading', { name: 'Ce lien de dépôt n’est pas disponible' })).toBeVisible();
  await expect(page.getByText('SP Drive', { exact: true })).toBeVisible();
  await expect(page.locator('a[href]')).toHaveCount(0); // no way into the application
});

test('an executable disguised as photo.jpg is refused on the receipt while the legitimate file is accepted', async ({ page }) => {
  const p = await portal({ allowedExtensions: ['jpg', 'pdf'] });
  await page.goto(p.path);
  const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff', 'latin1'), Buffer.alloc(2048, 7)]);
  await page.getByTestId('file-input').setInputFiles([file('photo.jpg', exe, 'image/jpeg'), file('facture.pdf', PDF, 'application/pdf')]);
  await page.getByRole('button', { name: /Envoyer 2 fichiers/ }).click();
  const receipt = page.getByTestId('receipt');
  await expect(receipt).toBeVisible({ timeout: 60_000 });
  await expect(receipt.getByRole('heading', { name: 'Dépôt reçu en partie' })).toBeVisible();
  const rows = receipt.getByTestId('receipt-files').getByRole('listitem');
  await expect(rows.filter({ hasText: 'photo.jpg' })).toContainText('Refusé — Le contenu est un programme ou un script, ce qui n’est jamais accepté.');
  await expect(rows.filter({ hasText: 'facture.pdf' })).toContainText('Accepté');
  expect(await deposited(p.folderId)).toEqual(['facture.pdf']);
});

test('the submission token can send its own files and nothing else', async ({ page, request }) => {
  const p = await portal();
  const secret = await owner.evaluate(async (name) => {
    const h = { 'X-SPD-CSRF': '1' };
    const u = await (await fetch('/api/v1/uploads', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: 'root', name, size: 6 }) })).json();
    await fetch(`/api/v1/uploads/${u.id}?offset=0`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: new TextEncoder().encode('secret') });
    return (await fetch(`/api/v1/uploads/${u.id}/complete`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' })).json();
  }, `secret-${Date.now()}.txt`);
  await page.goto(p.path);
  await page.getByTestId('file-input').setInputFiles(file('a.txt', 'aaa'));
  const admitted = page.waitForResponse((r) => r.url().includes('/submissions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /Envoyer 1 fichier/ }).click();
  const mine = await (await admitted).json();
  await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 60_000 });
  const auth = { Authorization: `Bearer ${mine.submissionToken}` };
  // another depositor's submission on the same portal
  const other = await request.post(`/api/v1/public/requests/${p.token}/submissions`, { headers: { 'X-SPD-CSRF': '1', Origin: BASE }, data: { files: [{ name: 'b.txt', size: 3 }] } });
  expect(other.status()).toBe(200);
  const theirs = await other.json();

  expect((await request.get('/api/v1/folders/root', { headers: auth })).status()).toBe(401);
  expect((await request.get(`/api/v1/files/${secret.file.id}/content`, { headers: auth })).status()).toBe(401);
  expect((await request.get(`/api/v1/requests/${p.id}/submissions`, { headers: auth })).status()).toBe(401);
  expect([401, 404, 410]).toContain((await request.get(`/api/v1/public/uploads/${theirs.items[0].uploadId}`, { headers: auth })).status());
  const steal = await request.patch(`/api/v1/public/uploads/${theirs.items[0].uploadId}?offset=0`, { headers: { ...auth, 'X-SPD-CSRF': '1', Origin: BASE, 'Content-Type': 'application/octet-stream' }, data: Buffer.from('xxx') });
  expect([401, 404, 410]).toContain(steal.status());
  // the other depositor is untouched and still at offset 0
  const still = await request.get(`/api/v1/public/uploads/${theirs.items[0].uploadId}`, { headers: { Authorization: `Bearer ${theirs.submissionToken}` } });
  expect(await still.json()).toMatchObject({ received: 0 });
  // and the token only describes its own deposit
  const status = await (await request.get('/api/v1/public/submissions/status', { headers: auth })).json();
  expect(status.items.map((i: { name: string }) => i.name)).toEqual(['a.txt']);
  expect(JSON.stringify(status)).not.toContain(p.folderId);
});

test('screenshots (SPD_SHOTS=1): light and dark', async ({ browser }, info) => {
  test.skip(!SHOTS, 'set SPD_SHOTS=1');
  const p = await portal({ description: 'Transmettez vos pièces justificatives pour l’ouverture de votre dossier.', instructions: 'Un fichier par document.\nNommez vos fichiers clairement (ex. « Avis de cotisation 2025 »).', brandColor: '#0f766e', expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    fields: { name: 'required', email: 'optional', reference: 'optional', custom: [] }, requireConsent: true, retentionNote: 'Les documents sont conservés 12 mois puis détruits.', confirmationMessage: 'Merci ! Nous communiquerons avec vous sous 48 heures.' });
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ ...info.project.use, colorScheme: scheme, locale: 'fr-CA', baseURL: BASE, extraHTTPHeaders: { 'X-Forwarded-For': clientIp() } });
    const page = await ctx.newPage();
    const tag = `${info.project.name}-${scheme}`;
    await holdChunks(page, () => true);
    await page.goto(p.path);
    await expect(page.getByTestId('dropzone')).toBeVisible();
    await shot(page, 'empty', tag);
    await page.getByLabel('Votre nom').fill('Marie Côté');
    await page.getByTestId('file-input').setInputFiles([file('Avis de cotisation 2025.pdf', PDF), file('Relevé bancaire.pdf', big(3)), file('macro.js', 'x')]);
    await shot(page, 'selected', tag);
    await page.getByRole('button', { name: 'Retirer les fichiers refusés' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Envoyer 2 fichiers/ }).click();
    await page.waitForFunction(() => (window as any).__held === true); await page.waitForTimeout(300);
    await shot(page, 'uploading', tag);
    await page.evaluate(() => (window as any).__release());
    await expect(page.getByTestId('receipt')).toBeVisible({ timeout: 60_000 });
    await shot(page, 'receipt', tag);
    await ctx.close();
  }
  await call('PATCH', `/requests/${p.id}`, { active: false });
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ ...info.project.use, colorScheme: scheme, locale: 'fr-CA', baseURL: BASE, extraHTTPHeaders: { 'X-Forwarded-For': clientIp() } });
    const page = await ctx.newPage();
    await page.goto(p.path);
    await expect(page.getByRole('heading', { name: 'Ce portail n’accepte plus de dépôts' })).toBeVisible();
    await shot(page, 'closed', `${info.project.name}-${scheme}`);
    await ctx.close();
  }
});
