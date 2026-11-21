/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : tests/e2e/next-helpers.ts
 * Module           : tests
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

// Helpers of the 2.0 specs: API calls made from the signed-in page, uploads of text or fixture files, a second account
// in its own browser context, and a rich seeded drive for the visual specs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { apiSignUp } from './helpers.ts';

export const BASE = process.env.SPD_E2E_BASE ?? 'http://localhost:5183';
export const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export async function call<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(async ([m, p, b]) => {
    const r = await fetch(`/api/v1${p}`, { method: m as string, headers: { 'X-SPD-CSRF': '1', ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: b !== undefined ? JSON.stringify(b) : m === 'GET' ? undefined : '{}' });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${JSON.stringify(j)}`);
    return j;
  }, [method, path, body] as const);
}
/** Upload bytes (a string is UTF-8 text) through the real resumable protocol; `fileId` makes it a new version. */
export async function upload(page: Page, folderId: string, name: string, data: string | Buffer, o: { fileId?: string } = {}): Promise<{ id: string; name: string; folderId: string }> {
  const b64 = (typeof data === 'string' ? Buffer.from(data) : data).toString('base64');
  const r = await page.evaluate(async ([folder, n, body, fileId]) => {
    const h = { 'X-SPD-CSRF': '1' }, bytes = Uint8Array.from(atob(body as string), (c) => c.charCodeAt(0));
    const u = await (await fetch('/api/v1/uploads', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: folder, name: n, size: bytes.length, fileId: fileId ?? undefined }) })).json();
    if (!u.id) throw new Error(`upload refused: ${JSON.stringify(u)}`);
    await fetch(`/api/v1/uploads/${u.id}?offset=0`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: bytes });
    return (await fetch(`/api/v1/uploads/${u.id}/complete`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' })).json();
  }, [folderId, name, b64, o.fileId ?? null] as const);
  if (!r.file) throw new Error(`upload failed: ${JSON.stringify(r)}`);
  return r.file;
}
export const fixture = (name: string) => readFileSync(join(FIX, name));
/** A second signed-in account, in its own context (same device profile as the project). */
export async function secondAccount(browser: Browser, info: { project: { use: object } }): Promise<{ context: BrowserContext; page: Page; email: string }> {
  const context = await browser.newContext({ ...info.project.use, locale: 'fr-CA', baseURL: BASE });
  const page = await context.newPage();
  const { email } = await apiSignUp(context, page);
  return { context, page, email };
}
/** Wait until the worker has indexed the text of a file. */
export async function indexed(page: Page, fileId: string, timeout = 60_000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const s = await call<{ status: string }>(page, 'GET', `/files/${fileId}/text`);
    if (s.status === 'ready' || s.status === 'empty') return;
    if (s.status === 'failed' || s.status === 'unsupported' || Date.now() - t0 > timeout) throw new Error(`text of ${fileId}: ${s.status}`);
    await page.waitForTimeout(400);
  }
}
/** A drive with a little of everything, for screenshots: folders, documents, pictures, versions, tags, a collection. */
export async function seedDrive(page: Page): Promise<{ root: string; projets: string; contrat: { id: string }; rapport: { id: string } }> {
  const root = (await call(page, 'GET', '/folders/root')).folder.id as string;
  const mk = async (name: string, parentId = root) => (await call(page, 'POST', '/folders', { parentId, name })).id as string;
  const projets = await mk('Projets'), photos = await mk('Photos'), admin = await mk('Administratif'); await mk('Équipe');
  const contrat = await upload(page, projets, 'Contrat chalet.md', '# Contrat de location\n\nLe locataire verse un dépôt de 500 dollars avant le 1er juin.\n\nLe chalet des Laurentides est loué du 1er au 15 juillet.\n');
  const rapport = await upload(page, projets, 'Rapport trimestriel.pdf', fixture('sample.pdf'));
  await upload(page, projets, 'Budget 2026.csv', 'Poste,Montant\nLoyer,1200\nÉpicerie,640\nTransport,180\n');
  await upload(page, projets, 'Notes de réunion.txt', 'Ordre du jour\nLe budget de la coopérative Hirondelle est adopté.\nProchaine rencontre le 12 décembre.\n');
  await upload(page, photos, 'Lac au matin.jpg', fixture('sample.jpg'));
  await upload(page, photos, 'Sommet.png', fixture('sample.png'));
  await upload(page, admin, 'Assurance habitation.pdf', fixture('sample.pdf'));
  await upload(page, admin, 'Présentation.pptx', fixture('sample.pptx'));
  await upload(page, admin, 'Tableau.xlsx', fixture('sample.xlsx'));
  await upload(page, root, 'Lisez-moi.md', '# Bienvenue\n\nCe Drive est privé.\n');
  await upload(page, root, 'Archive.zip', fixture('sample.zip'));
  await upload(page, root, 'Copie du budget.csv', 'Poste,Montant\nLoyer,1200\nÉpicerie,640\nTransport,180\n');
  await upload(page, root, 'Contrat chalet.md', '# Contrat de location\n\nLe locataire verse un dépôt de 650 dollars avant le 15 mai.\n\nLe chalet des Laurentides est loué du 1er au 15 juillet.\nLe ménage est inclus.\n', { fileId: contrat.id });
  const tag = await call(page, 'POST', '/tags', { name: 'Juridique', color: 'violet' });
  await call(page, 'PATCH', `/files/${contrat.id}`, { tagIds: [tag.id], starred: true });
  await call(page, 'POST', '/collections', { name: 'Documents récents', color: 'blue', rule: { match: 'all', conditions: [{ field: 'modified', op: 'within', value: 30 }, { field: 'kind', op: 'isNot', value: 'image' }], sort: { by: 'updated', dir: 'desc' } } });
  await call(page, 'POST', '/collections', { name: 'PDF', color: 'red', rule: { match: 'all', conditions: [{ field: 'kind', op: 'is', value: 'pdf' }] } });
  return { root, projets, contrat, rapport };
}
