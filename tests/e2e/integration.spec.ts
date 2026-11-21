/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : tests/e2e/integration.spec.ts
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

// The lots meeting each other: explorer → share dialog → public page → viewer, and explorer → portal dialog.
import { expect, test, type Page } from '@playwright/test';
import { apiSignUp } from './helpers.ts';

test.use({ locale: 'fr-CA' });
const row = (page: Page, name: string) => page.locator(`[role=row][data-id]:has([data-name]:text-is("${name}"))`);
const menu = async (page: Page, name: string, action: string) => { await row(page, name).locator('[data-more]').click(); await page.getByRole('menuitem', { name: action, exact: true }).click(); };
const api = (page: Page, method: string, path: string, body?: unknown) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch(`/api/v1${p}`, { method: m as string, headers: { 'X-SPD-CSRF': '1', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : m === 'GET' ? undefined : '{}' });
  return r.json();
}, [method, path, body] as const);

test('share a file from the explorer, open the link anonymously, preview it; create a portal on a folder', async ({ context, page, browser }) => {
  await apiSignUp(context, page);
  const folder = await api(page, 'POST', '/folders', { parentId: 'root', name: 'Clients' });
  const text = 'Bonjour depuis SP Drive';
  await page.evaluate(async ([folderId, content]) => {
    const h = { 'X-SPD-CSRF': '1' };
    const data = new TextEncoder().encode(content);
    const u = await (await fetch('/api/v1/uploads', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId, name: 'note.txt', size: data.length }) })).json();
    await fetch(`/api/v1/uploads/${u.id}?offset=0`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: data });
    await fetch(`/api/v1/uploads/${u.id}/complete`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' });
  }, [folder.id, text] as const);
  await page.goto(`/folder/${folder.id}`);
  await expect(row(page, 'note.txt')).toBeVisible();

  // explorer → share dialog
  await menu(page, 'note.txt', 'Partager');
  const dialog = page.getByRole('dialog').filter({ hasText: 'note.txt' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Libellé').fill('Intégration'); // a file with no link yet opens straight on the form
  await dialog.getByRole('button', { name: 'Créer un lien' }).click();
  const url = await dialog.getByTestId('link-once').getByRole('textbox', { name: 'Lien' }).inputValue();
  expect(url).toContain('/s/');

  // anonymous visitor
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(new URL(url).pathname);
  await expect(v.getByText('note.txt').first()).toBeVisible();
  await v.getByRole('button', { name: 'Aperçu' }).first().click();
  await expect(v.getByRole('dialog').getByText(text)).toBeVisible();
  await visitor.close();

  // explorer → portal dialog on a folder
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.goto('/');
  await menu(page, 'Clients', 'Créer un portail de dépôt');
  await expect(page.getByRole('dialog', { name: 'Nouveau portail de dépôt' })).toBeVisible();
});
