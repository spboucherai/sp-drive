/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : tests/e2e/preview.spec.ts
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

// The in-app preview viewer, on real files uploaded through the API and previews produced by the real worker. The
// viewer is mounted by its development harness (apps/web/preview-harness.html), which exists only on the dev server.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, expect, type Page, test, type TestInfo } from '@playwright/test';
import { makePdf } from './fixtures/pdf-gen.mjs';
import { apiSignUp } from './helpers.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SHOTS = '/tmp/spd-shots/preview';
mkdirSync(SHOTS, { recursive: true });

// one account and one copy of each file per worker: tests sign in with the saved cookies and upload what they miss
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | null = null;
const ids = new Map<string, string>();
async function signIn(context: BrowserContext, page: Page): Promise<void> {
  if (cookies) { await context.addCookies(cookies); await page.goto('/pwa/favicon.svg'); return; }
  await apiSignUp(context, page);
  cookies = await context.cookies();
}
async function upload(page: Page, name: string, data: Buffer): Promise<string> {
  const id = await page.evaluate(async ({ name, b64 }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const call = async (method: string, path: string, body?: BodyInit, type = 'application/json') => {
      const r = await fetch(`/api/v1${path}`, { method, headers: { 'X-SPD-CSRF': '1', 'Content-Type': type }, body });
      if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
      return r.json();
    };
    const up = await call('POST', '/uploads', JSON.stringify({ folderId: 'root', name, size: bytes.length }));
    if (bytes.length) await call('PATCH', `/uploads/${up.id}?offset=0`, bytes, 'application/octet-stream');
    const done = await call('POST', `/uploads/${up.id}/complete`, '{}');
    return done.file.id as string;
  }, { name, b64: data.toString('base64') });
  ids.set(name, id);
  return id;
}
/** Ids of the named fixtures (or generated files registered under that name), uploading the missing ones. */
async function need(page: Page, ...names: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const n of names) out.push(ids.get(n) ?? await upload(page, n, readFileSync(join(FIXTURES, n))));
  return out;
}
async function open(page: Page, fileIds: string[], params: Record<string, string> = {}): Promise<void> {
  await page.goto(`/preview-harness.html?${new URLSearchParams({ ids: fileIds.join(','), ...params })}`);
  await expect(page.getByTestId('viewer')).toBeVisible();
}
const shot = async (page: Page, info: TestInfo, name: string) => { await page.waitForTimeout(250); await page.screenshot({ path: join(SHOTS, `${info.project.name}-${name}.png`) }); }; // after the opening fade
/** Records every request a hostile document tries to make, and reads the flag its scripts try to set. */
function watch(page: Page) {
  const calls: string[] = [];
  page.on('request', (r) => { if (r.url().includes('__pwned')) calls.push(r.url()); });
  return async () => {
    await page.waitForTimeout(400);
    expect(calls, 'a document made the browser call out').toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned), 'a script from a document ran').toBeUndefined();
    expect(await page.locator('[data-testid=viewer] :is(iframe, object, embed, script)').count()).toBe(0);
  };
}
const body = (page: Page) => page.getByTestId('viewer-body');

test.beforeEach(async ({ context, page }) => { await signIn(context, page); });

test.describe('pdf', () => {
  test('pages, jump, zoom, text layer and search', async ({ page }, info) => {
    await open(page, await need(page, 'sample.pdf'));
    const scroll = page.getByTestId('pdf-scroll');
    await expect(scroll).toHaveAttribute('data-pages', '3');
    await expect(page.getByTestId('pdf-page-count')).toHaveText('/ 3');
    const first = page.locator('[data-testid=pdf-page][data-page-number="1"]');
    await expect(first).toHaveAttribute('data-rendered', '1');
    // the canvas really holds the page (dark glyph pixels on white), at device resolution
    const ink = await first.locator('canvas').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, Math.floor(c.height / 4)).data; let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 90 && d[i + 3]! > 200) dark++;
      return { dark, ratio: c.width / c.getBoundingClientRect().width };
    });
    expect(ink.dark).toBeGreaterThan(200);
    expect(ink.ratio).toBeGreaterThan((await page.evaluate(() => devicePixelRatio)) * 0.9);
    // selectable text layer
    await expect(first.locator('.textLayer')).toContainText('La marmotte dort sous la neige.');
    await shot(page, info, 'pdf');

    // jump to page 3 with the page field
    const field = page.getByTestId('pdf-page-input');
    await field.fill('3'); await field.press('Enter');
    await expect(scroll).toHaveAttribute('data-page', '3');
    await expect(page.locator('[data-testid=pdf-page][data-page-number="3"]')).toBeInViewport();
    await expect(field).toHaveValue('3');

    // zoom
    const zoom = page.getByTestId('pdf-zoom');
    const before = await zoom.textContent();
    await page.getByTestId('pdf-zoom-in').click();
    await expect(zoom).not.toHaveText(before!);
    await scroll.focus();
    await page.keyboard.press('Control+-');
    await expect(zoom).toHaveText(before!);
    await page.getByTestId('pdf-fit-page').click();
    const fits = await page.locator('[data-testid=pdf-page]').first().evaluate((el) => el.getBoundingClientRect().height <= el.parentElement!.parentElement!.clientHeight);
    expect(fits).toBe(true);
    await page.getByTestId('pdf-fit-width').click();

    // search: Ctrl/⌘+F opens the field; 5 occurrences over the three pages, whatever their case
    await page.keyboard.press('Control+f');
    const input = page.getByTestId('pdf-search-input');
    await expect(input).toBeFocused();
    await input.fill('marmotte');
    const count = page.getByTestId('pdf-search-count');
    await expect(count).toHaveText(/^\d \/ 5$/);
    await expect(page.locator('[data-testid=pdf-hit][data-current="1"]').first()).toBeInViewport();
    const start = Number((await count.textContent())![0]);
    await input.press('Enter');
    await expect(count).toHaveText(`${(start % 5) + 1} / 5`);
    await input.press('Shift+Enter');
    await expect(count).toHaveText(`${start} / 5`);
    for (let i = start; i < 5; i++) await input.press('Enter');
    await expect(count).toHaveText('5 / 5');
    await expect(scroll).toHaveAttribute('data-page', '3');
    await expect(page.locator('[data-testid=pdf-page][data-page-number="3"] [data-testid=pdf-hit][data-current="1"]')).toBeInViewport();
    await shot(page, info, 'pdf-search');
    await input.fill('zzzz-absent');
    await expect(count).toHaveText('Aucun résultat');
    // Escape closes the search first, the viewer second
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(page.getByTestId('viewer')).toBeVisible();
  });

  test('a 400-page file opens by ranges and only renders the pages near the viewport', async ({ page }, info) => {
    test.slow();
    if (!ids.has('big.pdf')) {
      const pages = Array.from({ length: 400 }, (_, i) => [`Page ${i + 1} du grand document`, i === 388 ? 'Ici se cache le mot ornithorynque.' : 'Texte courant.']);
      await upload(page, 'big.pdf', makePdf(pages, { padding: 6000 }));
    }
    const ranges: string[] = [];
    page.on('response', (r) => { if (r.status() === 206 && r.url().includes('/content')) ranges.push(r.headers()['content-range'] ?? ''); });
    await open(page, [ids.get('big.pdf')!]);
    const scroll = page.getByTestId('pdf-scroll');
    await expect(scroll).toHaveAttribute('data-pages', '400');
    await expect(page.locator('[data-testid=pdf-page][data-page-number="1"]')).toHaveAttribute('data-rendered', '1');
    expect(await page.getByTestId('pdf-page').count()).toBeLessThan(12);
    const field = page.getByTestId('pdf-page-input');
    await field.fill('350'); await field.press('Enter');
    await expect(scroll).toHaveAttribute('data-page', '350');
    await expect(page.locator('[data-testid=pdf-page][data-page-number="350"]')).toHaveAttribute('data-rendered', '1');
    await expect(page.locator('[data-testid=pdf-page][data-page-number="350"] .textLayer')).toContainText('Page 350 du grand document');
    expect(await page.getByTestId('pdf-page').count()).toBeLessThan(12);
    expect(await page.locator('[data-testid=pdf-page][data-page-number="1"]').count()).toBe(0);
    expect(await page.locator('[data-testid=viewer] canvas').count()).toBeLessThan(12);
    expect(ranges.length, 'the PDF was fetched by byte ranges').toBeGreaterThan(0);
    await page.getByTestId('pdf-search-toggle').click();
    await page.getByTestId('pdf-search-input').fill('Ornithorynque');
    await expect(page.getByTestId('pdf-search-count')).toHaveText('1 / 1', { timeout: 60_000 });
    await expect(scroll).toHaveAttribute('data-page', '389');
    await expect(page.locator('[data-testid=pdf-hit][data-current="1"]')).toBeInViewport();
    await shot(page, info, 'pdf-400-pages');
  });

  test('damaged and password-protected files say so and offer the download', async ({ page }, info) => {
    if (!ids.has('casse.pdf')) await upload(page, 'casse.pdf', randomBytes(3000));
    await open(page, [ids.get('casse.pdf')!]);
    await expect(page.getByTestId('pdf-damaged')).toContainText('Ce PDF ne peut pas être lu');
    await expect(page.getByTestId('panel-download')).toBeVisible();
    await shot(page, info, 'pdf-damaged');
    await open(page, await need(page, 'locked.pdf'));
    await expect(page.getByTestId('pdf-password')).toContainText('PDF protégé par un mot de passe');
    await expect(page.getByTestId('panel-download')).toBeVisible();
  });
});

test.describe('office documents', () => {
  test('DOCX and PPTX are shown through their PDF conversion', async ({ page }, info) => {
    test.slow();
    const [docx, pptx] = await need(page, 'sample.docx', 'sample.pptx');
    await open(page, [docx!, pptx!]);
    await expect(page.getByTestId('converted-note')).toContainText('Le fichier d’origine n’est pas modifié', { timeout: 90_000 });
    await expect(page.locator('[data-testid=pdf-page][data-page-number="1"] .textLayer')).toContainText('ornithorynque');
    await expect(page.locator('[data-testid=pdf-page][data-page-number="1"]')).toHaveAttribute('data-rendered', '1');
    await shot(page, info, 'docx');
    await page.locator('[data-testid=viewer-next]:visible').click();
    await expect(page.getByTestId('viewer-name')).toHaveText('sample.pptx');
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-pages', '2', { timeout: 90_000 });
    await expect(page.locator('[data-testid=pdf-page][data-page-number="1"] .textLayer')).toContainText('Quokka');
    await expect(page.locator('[data-testid=pdf-page][data-page-number="1"]')).toHaveAttribute('data-rendered', '1');
    await shot(page, info, 'pptx');
  });

  test('a conversion that fails ends in a message, not in a spinner', async ({ page }, info) => {
    test.slow();
    if (!ids.has('faux.docx')) await upload(page, 'faux.docx', randomBytes(4096));
    await open(page, [ids.get('faux.docx')!]);
    const failed = page.getByTestId('preview-failed');
    await expect(failed).toBeVisible({ timeout: 110_000 });
    await expect(failed).toContainText('L’aperçu n’a pas pu être produit');
    expect((await page.getByTestId('panel-detail').textContent())!.length).toBeGreaterThan(5); // the server's reason
    await expect(page.getByTestId('preview-busy')).toHaveCount(0);
    await expect(page.getByTestId('panel-download')).toHaveAttribute('href', /download=1/);
    await shot(page, info, 'conversion-failed');
  });

  test('while the worker has not finished, the viewer waits and polls', async ({ page }, info) => {
    test.slow();
    const [docx] = await need(page, 'sample.docx');
    let held = 0;
    await page.route('**/preview/pdf*', async (route) => { if (held++ < 2) await route.fulfill({ status: 202, contentType: 'application/json', body: '{"status":"pending"}' }); else await route.continue(); });
    await open(page, [docx!]);
    await expect(page.getByTestId('preview-busy')).toContainText('Conversion en cours…');
    await shot(page, info, 'converting');
    await expect(page.locator('[data-testid=pdf-page][data-page-number="1"] .textLayer')).toContainText('ornithorynque', { timeout: 90_000 });
    expect(held).toBeGreaterThan(2);
  });
});

test.describe('images', () => {
  test('PNG and JPEG: fit, zoom, pan, reset', async ({ page }, info) => {
    const [png, jpg] = await need(page, 'sample.png', 'sample.jpg');
    await open(page, [png!, jpg!]);
    const img = page.getByTestId('image');
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(320);
    await expect(img).toHaveCSS('opacity', '1');
    await shot(page, info, 'image-png');
    const scaleOf = () => img.evaluate((i) => new DOMMatrix(getComputedStyle(i).transform).a);
    expect(await scaleOf()).toBe(1);
    await page.getByRole('button', { name: 'Agrandir' }).click();
    await expect.poll(scaleOf).toBeCloseTo(1.4, 1);
    await page.getByTestId('image-stage').dblclick();
    await expect.poll(scaleOf).toBe(1);
    await page.getByTestId('image-stage').dblclick();
    await expect.poll(scaleOf).toBeCloseTo(2.5, 1);
    await page.getByRole('button', { name: 'Ajuster à l’écran' }).click();
    await expect.poll(scaleOf).toBe(1);
    await page.locator('[data-testid=viewer-next]:visible').click();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(640);
    await shot(page, info, 'image-jpg');
  });

  test('HEIC is displayed through the JPEG made by the worker', async ({ page }, info) => {
    const [heic] = await need(page, 'sample.heic');
    await open(page, [heic!]);
    const img = page.getByTestId('image');
    await expect(img).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 60_000 }).toBeGreaterThan(0);
    expect(await img.getAttribute('src')).toContain('/preview/image');
    await shot(page, info, 'heic');
  });

  test('an SVG carrying scripts is only ever an image', async ({ page }, info) => {
    const check = watch(page);
    const [svg] = await need(page, 'hostile.svg');
    await open(page, [svg!]);
    const img = page.getByTestId('image');
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    expect(await img.evaluate((i) => i.tagName)).toBe('IMG');
    expect(await page.locator('[data-testid=viewer] svg script, [data-testid=viewer] foreignObject').count()).toBe(0);
    // served inert: a sandbox policy on the file itself, should it ever be opened directly
    const res = await page.request.get(`/api/v1/files/${svg}/content`);
    expect(res.headers()['content-security-policy']).toContain('sandbox');
    await check();
    await shot(page, info, 'svg');
  });
});

test('video and audio play with the native player', async ({ page }, info) => {
  const [mp4, mp3] = await need(page, 'sample.mp4', 'sample.mp3');
  await open(page, [mp4!, mp3!]);
  const video = page.getByTestId('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((v: HTMLVideoElement) => ({ controls: v.controls, inline: v.playsInline, autoplay: v.autoplay, paused: v.paused, w: v.videoWidth }))).toEqual({ controls: true, inline: true, autoplay: false, paused: true, w: 320 });
  await shot(page, info, 'video');
  await page.locator('[data-testid=viewer-next]:visible').click();
  const audio = page.getByTestId('audio');
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  expect(await audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeGreaterThan(0.5);
  await shot(page, info, 'audio');
});

test.describe('text formats', () => {
  test('plain text and XML: line numbers, wrapping, markup shown as characters', async ({ page }, info) => {
    const check = watch(page);
    const [txt, xml] = await need(page, 'sample.txt', 'sample.xml');
    await open(page, [txt!, xml!]);
    const block = page.getByTestId('text-block');
    await expect(block.locator('.spd-line')).toHaveCount(6);
    await expect(block.locator('.spd-line').nth(3)).toHaveText('<script>window.__pwned = 1</script>');
    await expect(block.locator('.spd-line').nth(5)).toHaveAttribute('data-n', '6');
    const wrap = page.getByTestId('wrap-toggle');
    const initial = await block.getAttribute('data-wrap');
    await wrap.click();
    await expect(block).toHaveAttribute('data-wrap', initial === '1' ? '0' : '1');
    if (initial === '0') await wrap.click(); // leave it unwrapped: the long line then scrolls sideways
    await expect(block).toHaveAttribute('data-wrap', '0');
    expect(await page.getByTestId('text-scroll').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await wrap.click();
    expect(await page.getByTestId('text-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await shot(page, info, 'text');
    await page.locator('[data-testid=viewer-next]:visible').click();
    await expect(page.getByTestId('text-block')).toContainText('<titre>Le castor</titre>');
    await shot(page, info, 'xml');
    await check();
  });

  test('a file over 2 MB is cut and says so', async ({ page }, info) => {
    if (!ids.has('gros.log')) await upload(page, 'gros.log', Buffer.from(Array.from({ length: 60_000 }, (_, i) => `ligne ${i + 1} ${'abcdefghij'.repeat(4)}`).join('\n')));
    await open(page, [ids.get('gros.log')!]);
    await expect(page.getByTestId('truncated-note')).toContainText('seuls les premiers 2 Mo');
    await expect(page.getByTestId('text-block').locator('.spd-line').first()).toHaveText(/^ligne 1 /);
    const lines = await page.getByTestId('text-block').locator('.spd-line').count();
    expect(lines).toBeGreaterThan(30_000); expect(lines).toBeLessThan(60_000);
    await shot(page, info, 'text-truncated');
  });

  test('Markdown is rendered sanitised: no script, no javascript: link, no remote image', async ({ page }, info) => {
    const check = watch(page);
    const [md] = await need(page, 'hostile.md');
    await open(page, [md!]);
    const article = page.getByTestId('markdown');
    await expect(article.locator('h1')).toHaveText('Titre du document');
    await expect(article.locator('strong')).toHaveText('gras');
    await expect(article.locator('table td').first()).toHaveText('1');
    expect(await article.locator('script, iframe, img, style, [onclick], [onerror], [style]').count()).toBe(0);
    expect(await article.locator('a[href^="javascript" i]').count()).toBe(0);
    const safe = article.getByRole('link', { name: 'lien sain' });
    await expect(safe).toHaveAttribute('href', 'https://example.org/page');
    await expect(safe).toHaveAttribute('target', '_blank');
    await expect(safe).toHaveAttribute('rel', /noopener/);
    await expect(safe).toHaveAttribute('rel', /noreferrer/);
    // the trapped links are still there as text, clicking them does nothing
    await article.getByText('lien piege').click();
    await article.getByText('ancre brute').click();
    await expect(article.locator('.spd-md-blocked')).toHaveCount(2);
    await expect(article.locator('.spd-md-blocked').last()).toContainText('image distante');
    await expect(page.getByTestId('md-blocked-note')).toBeVisible();
    await shot(page, info, 'markdown');
    await page.getByTestId('md-source').click();
    await expect(page.getByTestId('text-block')).toContainText('[lien piege](javascript:window.__pwned=1)');
    await check();
  });

  test('CSV: quoted fields, escaped quotes, embedded line breaks, separator detection', async ({ page }, info) => {
    const [csv, semi] = await need(page, 'sample.csv', 'semicolon.csv');
    await open(page, [csv!, semi!]);
    const grid = page.getByTestId('grid');
    await expect(grid.locator('thead th')).toHaveText(['', 'nom', 'ville', 'note']);
    await expect(grid.locator('tbody tr')).toHaveCount(3);
    const firstRow = grid.locator('tbody tr').first().locator('td');
    await expect(firstRow).toHaveCount(3);
    await expect(firstRow.nth(0)).toHaveText('Tremblay, Luc'); // the comma stayed inside its cell
    await expect(firstRow.nth(2)).toHaveText('Il a dit "bonjour"');
    await expect(grid.locator('tbody tr').nth(1).locator('td').nth(0)).toHaveText('Roy; Anne');
    await grid.locator('tbody tr').nth(1).locator('td').nth(2).click();
    expect(await page.getByTestId('grid-cell').innerText()).toContain('ligne 1\nligne 2');
    await expect(page.getByTestId('csv-summary')).toContainText('3 lignes · 3 colonnes · séparateur : virgule');
    // the header stays in place while the body scrolls
    expect(await grid.locator('thead th').nth(1).evaluate((th) => getComputedStyle(th).position)).toBe('sticky');
    await shot(page, info, 'csv');
    await page.getByTestId('csv-raw').click();
    await expect(page.getByTestId('text-block')).toContainText('"Tremblay, Luc",Gatineau');
    await page.locator('[data-testid=viewer-next]:visible').click();
    await expect(page.getByTestId('grid').locator('tbody tr').first().locator('td')).toHaveText(['Gagnon; Paul', '12,50']);
    await expect(page.getByTestId('csv-summary')).toContainText('point-virgule');
  });

  test('CSV beyond 2 000 rows is capped with a notice', async ({ page }) => {
    if (!ids.has('long.csv')) await upload(page, 'long.csv', Buffer.from(`n,v\n${Array.from({ length: 2600 }, (_, i) => `${i + 1},x${i}`).join('\n')}\n`));
    await open(page, [ids.get('long.csv')!]);
    await expect(page.getByTestId('rows-note')).toContainText('2000 premières lignes');
    await expect(page.getByTestId('csv-summary')).toContainText('2000 lignes');
    expect(await page.getByTestId('grid').locator('tbody tr').count()).toBeLessThan(120); // windowed
    await page.getByTestId('grid').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByTestId('grid').locator('tbody th', { hasText: /^2001$/ })).toBeVisible();
  });

  test('JSON: collapsible tree, raw view, and a fallback for invalid files', async ({ page }, info) => {
    const [json, broken] = await need(page, 'sample.json', 'broken.json');
    await open(page, [json!, broken!]);
    const tree = page.getByTestId('json-tree');
    await expect(tree).toContainText('titre: "SP Drive"');
    await expect(tree).toContainText('version: 3');
    await expect(tree).not.toContainText('Gatineau'); // third level starts folded
    await tree.getByRole('button', { name: /contact/ }).click();
    await expect(tree).toContainText('ville: "Gatineau"');
    await tree.getByRole('button', { name: /auteur/ }).click();
    await expect(tree).not.toContainText('Marmotte');
    await shot(page, info, 'json');
    await page.getByTestId('json-raw').click();
    await expect(page.getByTestId('text-block')).toContainText('"auteur": {"nom": "Marmotte"');
    await page.locator('[data-testid=viewer-next]:visible').click();
    await expect(page.getByTestId('json-invalid')).toContainText('n’est pas un JSON valide');
    await expect(page.getByTestId('text-block')).toContainText('{"cassé": [1, 2,');
  });
});

test('XLSX: sheet tabs and cell values read by the worker', async ({ page }, info) => {
  const [xlsx] = await need(page, 'sample.xlsx');
  await open(page, [xlsx!]);
  const tabs = page.getByTestId('sheet-tab');
  await expect(tabs).toHaveText(['Ventes', 'Clients'], { timeout: 60_000 });
  const grid = page.getByTestId('grid');
  await expect(grid.locator('thead th')).toHaveText(['', 'A', 'B', 'C']);
  await expect(grid.locator('tbody tr').nth(1).locator('td')).toHaveText(['Sirop', '12', '8.5']);
  await expect(grid.locator('tbody tr').nth(3).locator('td').nth(1)).toHaveText('15'); // the computed value of the formula
  await expect(grid.locator('tbody tr').nth(1).locator('th')).toHaveText('2');
  await shot(page, info, 'xlsx');
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(grid.locator('tbody tr').nth(1).locator('td')).toHaveText(['Castor Bricoleur', 'Gatineau']);
});

test('archives: an inventory with nested entries, nothing extracted', async ({ page }, info) => {
  const [zip, tgz] = await need(page, 'sample.zip', 'sample.tar.gz');
  await open(page, [zip!, tgz!]);
  for (const format of ['ZIP', 'TAR']) {
    await expect(page.getByTestId('archive-note')).toContainText('rien n’a été extrait', { timeout: 60_000 });
    await expect(page.getByTestId('archive-totals')).toContainText(format);
    const row = (path: string) => page.locator(`[data-testid=archive-row][data-path="${path}"]`);
    await expect(row('docs')).toBeVisible();
    await expect(row('lisezmoi.txt')).toContainText('8 o');
    await expect(row('docs/notes/2026/secret.txt')).toHaveCount(0);
    await row('docs/notes').click();
    await row('docs/notes/2026').click();
    await expect(row('docs/notes/2026/secret.txt')).toContainText('secret.txt');
    await page.getByTestId('archive-expand').click();
    await expect(row('images/photo.png')).toBeVisible();
    await shot(page, info, `archive-${format.toLowerCase()}`);
    if (format === 'ZIP') await page.locator('[data-testid=viewer-next]:visible').click();
  }
});

test('an unsupported format gets a plain message and a working download', async ({ page }, info) => {
  const [bin] = await need(page, 'sample.bin');
  await open(page, [bin!]);
  const none = page.getByTestId('preview-none');
  await expect(none).toContainText('Aucun aperçu pour ce format');
  await expect(none).toContainText('Fichier BIN');
  await expect(none).toContainText('2 Ko');
  await shot(page, info, 'unsupported');
  for (const id of ['panel-download', 'viewer-download']) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(id).click()]);
    expect(download.suggestedFilename()).toBe('sample.bin');
    expect(readFileSync(await download.path()).equals(readFileSync(join(FIXTURES, 'sample.bin')))).toBe(true);
  }
  // when the source does not allow downloads, no download control is offered
  await open(page, [bin!], { nodownload: '1' });
  await expect(page.getByTestId('preview-none')).toContainText('Le téléchargement n’est pas autorisé');
  await expect(page.getByTestId('viewer-download')).toHaveCount(0);
  await expect(page.getByTestId('panel-download')).toHaveCount(0);
  // English is complete
  await open(page, [bin!], { lang: 'en' });
  await expect(page.getByTestId('preview-none')).toContainText('No preview for this format');
  await expect(page.getByTestId('viewer-close')).toHaveAttribute('aria-label', 'Close');
});

test.describe('viewer chrome', () => {
  test('modal dialog: focus trapped and restored, Escape, scroll lock, toolbar actions', async ({ page }) => {
    const [txt, json] = await need(page, 'sample.txt', 'sample.json');
    await open(page, [txt!, json!], { actions: '1' });
    const viewer = page.getByTestId('viewer');
    await expect(viewer).toHaveAttribute('role', 'dialog');
    await expect(viewer).toHaveAttribute('aria-modal', 'true');
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await expect(page.getByTestId('viewer-meta')).toContainText('TXT');
    await page.getByTestId('harness-action').click();
    await expect(page.getByTestId('harness-state')).toContainText('flag=1');
    for (let i = 0; i < 25; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid=viewer]'))).toBe(true); }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid=viewer]'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    // reopened from a button: closing gives the focus back to it
    await page.getByTestId('harness-open').focus();
    await page.keyboard.press('Enter');
    await expect(viewer).toBeVisible();
    await page.getByTestId('viewer-close').click();
    await expect(viewer).toHaveCount(0);
    await expect(page.getByTestId('harness-open')).toBeFocused();
  });

  test('previous and next: buttons, arrow keys, and swipe on touch', async ({ page }, info) => {
    const list = await need(page, 'sample.png', 'sample.json', 'sample.bin');
    await open(page, list);
    const name = page.getByTestId('viewer-name');
    await expect(name).toHaveText('sample.png');
    await expect(page.locator('[data-testid=viewer-prev]:visible')).toHaveCount(0); // nothing before the first file
    await page.locator('[data-testid=viewer-next]:visible').click();
    await expect(name).toHaveText('sample.json');
    await expect(page.getByTestId('json-tree')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(name).toHaveText('sample.bin');
    await expect(page.locator('[data-testid=viewer-next]:visible')).toHaveCount(0);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
    await expect(name).toHaveText('sample.png');
    if (info.project.name !== 'mobile') return;
    const swipe = (fromX: number, toX: number) => page.getByTestId('image-stage').evaluate((el, [a, b]) => {
      const t = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(a!)], changedTouches: [t(a!)] }));
      el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [t((a! + b!) / 2)], changedTouches: [t((a! + b!) / 2)] }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(b!)] }));
    }, [fromX, toX]);
    await swipe(320, 60);
    await expect(name).toHaveText('sample.json');
    await page.locator('[data-testid=viewer-prev]:visible').click();
    await expect(name).toHaveText('sample.png');
    // zoomed in, the same gesture pans the picture instead of changing file
    await page.getByRole('button', { name: 'Agrandir' }).click();
    await swipe(320, 60);
    await page.waitForTimeout(200);
    await expect(name).toHaveText('sample.png');
  });

  test('errors from the API are explicit and translated', async ({ page }, info) => {
    const [txt, png, zip] = await need(page, 'sample.txt', 'sample.png', 'sample.zip');
    const answer = (status: number, error: string, message: string) => async (route: import('@playwright/test').Route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error, message }) });
    await page.route('**/files/*/content*', answer(451, 'infected', 'this file was flagged by the antivirus'));
    await open(page, [txt!, png!]);
    await expect(page.getByTestId('preview-error')).toContainText('Ce fichier a été signalé par l’antivirus.');
    await shot(page, info, 'error-infected');
    await page.locator('[data-testid=viewer-next]:visible').click();
    await expect(page.getByTestId('preview-error')).toContainText('Ce fichier a été signalé par l’antivirus.'); // found out after the <img> failed
    await page.unroute('**/files/*/content*');
    let fail = true;
    await page.route('**/preview/archive*', async (route) => (fail ? answer(404, 'not_found', 'file not found')(route) : route.continue()));
    await open(page, [zip!]);
    await expect(page.getByTestId('preview-error')).toContainText('Élément introuvable.');
    fail = false;
    await page.getByRole('button', { name: 'Réessayer' }).click();
    await expect(page.getByTestId('archive-note')).toBeVisible();
    await page.route('**/preview/archive*', (route) => route.abort());
    await open(page, [zip!]);
    await expect(page.getByTestId('preview-error')).toContainText('Connexion impossible');
  });

  test('dark theme renders documents readably', async ({ page }, info) => {
    const list = await need(page, 'hostile.md', 'sample.csv', 'sample.pdf', 'sample.zip', 'sample.bin');
    await open(page, list, { dark: '1' });
    await expect(page.getByTestId('markdown').locator('h1')).toBeVisible();
    for (const [i, n] of ['markdown', 'csv', 'pdf', 'archive', 'unsupported'].entries()) {
      if (i) await page.locator('[data-testid=viewer-next]:visible').click();
      if (n === 'pdf') await expect(page.locator('[data-testid=pdf-page][data-page-number="1"]')).toHaveAttribute('data-rendered', '1');
      if (n === 'archive') await expect(page.getByTestId('archive-note')).toBeVisible();
      await page.waitForTimeout(250);
      await shot(page, info, `dark-${n}`);
    }
  });
});

test('thumbnails: the picture when it exists, an icon tile otherwise, never a broken image', async ({ page }, info) => {
  const list = await need(page, 'sample.png', 'sample.pdf', 'sample.mp4', 'sample.mp3', 'sample.docx', 'sample.xlsx', 'sample.zip', 'sample.txt', 'sample.bin');
  // wait for the worker: the PNG thumbnail exists
  await expect.poll(async () => (await page.request.get(`/api/v1/files/${list[0]}/preview/thumb`)).status(), { timeout: 60_000 }).toBe(200);
  for (const dark of ['', '1']) {
    // `allthumbs` asks a thumbnail for every file, including those that will never have one (202 or 404 from the API)
    await page.goto(`/preview-harness.html?${new URLSearchParams({ ids: list.join(','), thumbs: '1', allthumbs: '1', dark })}`);
    const wall = page.getByTestId('thumb-wall');
    await expect(wall.locator('[data-testid=thumb][data-family=image][data-state=image]')).toHaveCount(4);
    await expect(wall.locator('[data-testid=thumb][data-family=other]').first()).toHaveAttribute('data-state', 'icon');
    await expect(wall.locator('[data-testid=thumb][data-family=text][data-state=icon]')).toHaveCount(4);
    for (const family of ['folder', 'image', 'video', 'audio', 'pdf', 'document', 'sheet', 'archive', 'text', 'other']) expect(await wall.locator(`[data-testid=thumb][data-family=${family}]`).count(), family).toBeGreaterThan(0);
    // every <img> still in the page is a loaded picture
    await page.waitForTimeout(500);
    const broken = await wall.locator('img').evaluateAll((imgs) => imgs.filter((i) => (i as HTMLImageElement).complete && !(i as HTMLImageElement).naturalWidth && getComputedStyle(i).opacity !== '0').length);
    expect(broken).toBe(0);
    // no layout shift: each tile keeps the size it was given
    const sizes = await wall.locator('[data-testid=thumb][data-family=image]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(sizes).toEqual([32, 48, 96, 200]);
    await page.screenshot({ path: join(SHOTS, `${info.project.name}-thumbs${dark ? '-dark' : ''}.png`), fullPage: true });
  }
});
