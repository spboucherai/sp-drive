// Design review screenshots (not a test suite): one real account per project, real uploads from the e2e fixtures, then
// a picture of every main screen. Run against the development stack:
//   pnpm exec playwright test -c tests/shots/playwright.config.ts --output /tmp/spd-shots-out
// Pictures land in $SPD_SHOTS_DIR (default /tmp/sp-drive-shots)/<project>/NN-name.png.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { apiSignUp } from '../e2e/helpers.ts';

test.use({ locale: 'fr-CA' });
const FIX = join(dirname(fileURLToPath(import.meta.url)), '../e2e/fixtures');
const OUT = process.env.SPD_SHOTS_DIR ?? '/tmp/sp-drive-shots';
const fx = (name: string, as = name) => ({ name: as, mimeType: 'application/octet-stream', buffer: readFileSync(join(FIX, name)) });
const row = (page: Page, name: string) => page.locator(`[role=row][data-id]:has([data-name]:text-is("${name}"))`);
const call = <T = any>(page: Page, method: string, path: string, body?: unknown): Promise<T> =>
  page.evaluate(async ([m, p, b]) => {
    const r = await fetch(`/api/v1${p}`, { method: m as string, headers: { 'Content-Type': 'application/json', 'X-SPD-CSRF': '1' }, body: m === 'GET' ? undefined : JSON.stringify(b ?? {}) });
    if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${await r.text()}`);
    return r.json();
  }, [method, path, body] as const);

test('screens', async ({ page, context }, info) => {
  test.setTimeout(Number(process.env.SPD_SHOTS_TIMEOUT ?? 300_000));
  const dark = info.project.name.includes('dark');
  const phone = info.project.name.includes('phone');
  const dir = join(OUT, info.project.name);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const shot = async (name: string, full = false) => { await page.waitForTimeout(450); await page.screenshot({ path: join(dir, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: full }); };
  await context.addInitScript((d) => { try { localStorage.setItem('spd.theme', d ? 'dark' : 'light'); } catch { /* opaque origin */ } }, dark);

  await page.goto('/login');
  await expect(page.getByRole('button', { name: /passkey/i }).first()).toBeVisible();
  await shot('login');

  await apiSignUp(context, page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ce dossier est vide' })).toBeVisible();
  await shot('empty');

  for (const name of ['Projets', 'Photos de voyage', 'Factures 2026', 'Contrats']) await call(page, 'POST', '/folders', { parentId: 'root', name });
  await page.getByTestId('upload-input').setInputFiles([
    fx('sample.jpg', 'Coucher de soleil.jpg'), fx('sample.png', 'Maquette accueil.png'), fx('sample.pdf', 'Rapport annuel 2026.pdf'), fx('sample.docx', 'Lettre de mission.docx'),
    fx('sample.xlsx', 'Budget prévisionnel.xlsx'), fx('sample.mp4', 'Visite du chantier.mp4'), fx('sample.mp3', 'Mémo vocal.mp3'), fx('sample.zip', 'Archives 2025.zip'),
    fx('sample.txt', 'Notes de réunion.txt'), fx('sample.csv', 'Ventes par région.csv'),
  ]);
  await expect(page.getByTestId('upload-panel')).toBeVisible();
  await expect(page.locator('[data-upload-state=done]')).toHaveCount(10, { timeout: 90_000 });
  await shot('uploads-done');
  await page.getByRole('button', { name: 'Tout effacer' }).first().click().catch(() => {});
  const files = (await call(page, 'GET', '/folders/root')).files as { id: string; name: string }[];
  const byName = (s: string) => files.find((f) => f.name === s)!;
  await call(page, 'PATCH', `/files/${byName('Rapport annuel 2026.pdf').id}`, { starred: true });
  await call(page, 'PATCH', `/files/${byName('Coucher de soleil.jpg').id}`, { starred: true });
  // thumbnails come from the worker a moment later
  await expect.poll(async () => page.locator('[data-testid=thumb][data-state=image]').count(), { timeout: 60_000 }).toBeGreaterThan(1).catch(() => {});
  await page.reload();
  await expect(row(page, 'Projets')).toBeVisible();
  await page.waitForTimeout(1500);

  const toggle = page.getByTestId('view-toggle');
  if ((await toggle.getAttribute('data-mode')) !== 'list') await toggle.click();
  await shot('explorer-list');
  await toggle.click();
  await page.waitForTimeout(1200);
  await shot('explorer-grid');

  // actions menu and details
  await row(page, 'Rapport annuel 2026.pdf').locator('[data-more]').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await shot('menu');
  await page.getByRole('menuitem', { name: 'Détails' }).click();
  await expect(page.getByTestId('details')).toBeVisible();
  await shot('details');
  if (phone) await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click(); else await page.getByRole('complementary', { name: 'Détails' }).getByRole('button', { name: 'Fermer' }).click();
  await page.waitForTimeout(400);

  if (await page.getByTestId('selection-bar').count()) await page.getByTestId('selection-bar').getByRole('button').first().click();
  // "New" menu
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await shot('new-menu');
  await page.keyboard.press('Escape');

  // an upload in progress: hold the blocks of a larger file
  await page.evaluate(() => {
    const orig = window.fetch.bind(window);
    window.fetch = async (u, o) => { if (o?.method === 'PATCH' && String(u).includes('/uploads/')) await new Promise((r) => setTimeout(r, 1400)); return orig(u, o); };
  });
  const big = Buffer.alloc(28 * 1024 * 1024, 7);
  await page.getByTestId('upload-input').setInputFiles([{ name: 'Présentation client.key', mimeType: 'application/octet-stream', buffer: big }, { name: 'Plans architecte.dwg', mimeType: 'application/octet-stream', buffer: big.subarray(0, 15 * 1024 * 1024) }]);
  await expect(page.locator('[data-upload-state=uploading]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3200);
  await shot('upload-progress');
  await expect(page.locator('[data-upload-state=uploading],[data-upload-state=queued],[data-upload-state=finishing]')).toHaveCount(0, { timeout: 120_000 });
  await page.getByRole('button', { name: 'Tout effacer' }).first().click().catch(() => {});

  // selection bar
  if (!phone) { await row(page, 'Coucher de soleil.jpg').click(); await row(page, 'Budget prévisionnel.xlsx').click({ modifiers: ['ControlOrMeta'] }); await shot('selection'); await page.keyboard.press('Escape'); }

  // viewer: image then PDF
  const open = async (name: string) => { if (phone) await row(page, name).locator('[data-name]').tap(); else await row(page, name).dblclick(); };
  await open('Coucher de soleil.jpg');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot('viewer-image');
  await page.keyboard.press('Escape');
  await open('Rapport annuel 2026.pdf');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(3000);
  await shot('viewer-pdf');
  await page.keyboard.press('Escape');

  // share dialog
  await row(page, 'Rapport annuel 2026.pdf').locator('[data-more]').click();
  await page.getByRole('menuitem', { name: 'Partager' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(600);
  await shot('share-dialog');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // public pages need links
  const photos = ((await call(page, 'GET', '/folders/root')).folders as { id: string; name: string }[]).find((f) => f.name === 'Photos de voyage')!;
  for (const f of ['sample.jpg', 'sample.png', 'sample.pdf']) void f;
  const sFile = await call(page, 'POST', '/shares', { fileId: byName('Rapport annuel 2026.pdf').id });
  const projets = ((await call(page, 'GET', '/folders/root')).folders as { id: string; name: string }[]).find((f) => f.name === 'Projets')!;
  await call(page, 'POST', '/move', { fileIds: [byName('Coucher de soleil.jpg').id, byName('Maquette accueil.png').id, byName('Lettre de mission.docx').id, byName('Ventes par région.csv').id], folderIds: [], destinationId: projets.id, onConflict: 'fail' });
  const sFolder = await call(page, 'POST', '/shares', { folderId: projets.id });
  const req = await call(page, 'POST', '/requests', { folderId: photos.id, title: 'Documents pour votre dossier', brandName: 'Cabinet Tremblay', message: 'Merci de déposer vos pièces justificatives : avis de cotisation, relevés et pièce d’identité.' });

  for (const [href, name] of [['/recent', 'recent'], ['/starred', 'starred'], ['/shares', 'shares'], ['/requests', 'requests'], ['/trash', 'trash-empty'], ['/settings', 'settings'], ['/search?q=rapport', 'search']] as const) {
    await page.goto(href);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForTimeout(700);
    await shot(name, name === 'settings');
  }
  if (phone) { await page.goto('/'); await page.getByRole('button', { name: 'Plus', exact: true }).click(); await shot('more-sheet'); await page.keyboard.press('Escape'); }
  else { await page.goto('/'); await page.keyboard.press('ControlOrMeta+k'); await page.waitForTimeout(300); await page.keyboard.type('rap'); await shot('palette'); await page.keyboard.press('Escape'); }

  // anonymous pages, in a context without the session
  const anon = await context.browser()!.newContext({ ...info.project.use, baseURL: info.project.use.baseURL, locale: 'fr-CA', extraHTTPHeaders: { 'X-Forwarded-For': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  const pub = await anon.newPage();
  const pshot = async (name: string) => { await pub.waitForTimeout(900); await pub.screenshot({ path: join(dir, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: true }); };
  await pub.goto(new URL(sFile.url).pathname);
  await expect(pub.getByRole('heading', { level: 1 })).toBeVisible();
  await pub.waitForTimeout(2500);
  await pshot('public-share-file');
  await pub.goto(new URL(sFolder.url).pathname);
  await expect(pub.getByRole('heading', { level: 1 })).toBeVisible();
  await pub.waitForTimeout(1500);
  await pshot('public-share-folder');
  await pub.goto(new URL(req.url).pathname);
  await expect(pub.getByRole('heading', { level: 1 })).toBeVisible();
  await pshot('public-portal');
  await pub.locator('input[type=file]').first().setInputFiles([fx('sample.pdf', 'Avis de cotisation.pdf'), fx('sample.jpg', 'Pièce identité.jpg')]).catch(() => {});
  await pshot('public-portal-files');
  await pub.goto('/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  await pub.waitForTimeout(800);
  await pshot('public-unavailable');
  await pub.goto('/invite/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  await pshot('invite-invalid');
  await anon.close();
});
