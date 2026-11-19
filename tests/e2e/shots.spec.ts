// Review screenshots of the 2.0 interface, written to docs/next/shots/web/ (desktop 1440 and phone 390, light and dark).
// Not an assertion suite: run it on purpose — `SPD_SHOTS=1 pnpm e2e shots.spec.ts`.
import { expect, type Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiSignUp } from './helpers.ts';
import { call, indexed, seedDrive } from './next-helpers.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../docs/next/shots/web');
test.skip(!process.env.SPD_SHOTS, 'review screenshots are taken on purpose (SPD_SHOTS=1)');
test.use({ locale: 'fr-CA' });

test('review screenshots', async ({ page, context }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  mkdirSync(OUT, { recursive: true });
  const size = phone ? 'phone' : 'desktop';
  const theme = (t: string) => page.evaluate((x) => { localStorage.setItem('spd.theme', x); document.documentElement.classList.toggle('dark', x === 'dark'); }, t);
  const shot = async (name: string) => { for (const th of ['light', 'dark']) { await theme(th); await page.waitForTimeout(350); await page.screenshot({ path: `${OUT}/${size}-${th}-${name}.png` }); } await theme('light'); };
  const settle = async (p: Page) => { await p.waitForLoadState('networkidle'); await p.waitForTimeout(400); };

  await page.goto('/login'); await settle(page); await shot('01-login');
  await apiSignUp(context, page, { admin: true });
  await page.goto('/'); await settle(page); await shot('02-empty-drive');
  const d = await seedDrive(page);
  await indexed(page, d.contrat.id); await indexed(page, d.rapport.id);
  await page.evaluate(() => localStorage.setItem('spd.explorer.view', 'grid'));
  await page.goto('/'); await settle(page); await page.waitForTimeout(2500); await page.reload(); await settle(page); await shot('03-explorer-grid');
  await page.goto(`/folder/${d.projets}`); await settle(page); await shot('04-folder-grid');
  await page.getByTestId('view-toggle').click(); await settle(page); await shot('05-folder-list');
  // inspector
  await page.locator('[role=row][data-id]:has([data-name]:text-is("Contrat chalet.md")) [data-more]').click();
  await shot('06-context-menu');
  await page.getByRole('menuitem', { name: 'Détails' }).click(); await settle(page); await shot('07-inspector');
  if (!phone) { await page.getByTestId('details').getByRole('tab', { name: 'Activité' }).click(); await settle(page); await shot('08-inspector-activity'); await page.getByTestId('details').getByRole('tab', { name: 'Texte' }).click(); await settle(page); await shot('09-inspector-text'); await page.getByTestId('details').getByRole('tab', { name: 'Détails' }).click(); }
  await page.getByTestId('open-time-machine').click(); await expect(page.getByTestId('tm-diff')).toBeVisible(); await shot('10-time-machine');
  await page.keyboard.press('Escape'); if (phone) await page.keyboard.press('Escape');
  // palette, transfers, search
  await page.keyboard.press('Control+k'); await page.getByRole('combobox').fill('dépôt'); await expect(page.getByTestId('snippet').first()).toBeVisible(); await shot('11-palette');
  await page.keyboard.press('Escape');
  await page.getByTestId('transfer-button').click(); await page.getByRole('tab', { name: 'Historique' }).click(); await expect(page.getByTestId('upload-history')).toBeVisible(); await shot('12-transfer-centre');
  await page.getByTestId('upload-panel').getByRole('button', { name: 'Fermer' }).click();
  await page.goto('/search?q=budget'); await settle(page); await shot('13-search');
  if ((await call(page, 'GET', '/meta')).features.includes('semantic')) { await page.goto('/search?q=location%20de%20chalet&mode=semantic'); await settle(page); await shot('14-search-semantic'); }
  await page.goto('/storage'); await settle(page); await page.waitForTimeout(600); await shot('15-storage');
  await page.goto('/duplicates'); await settle(page); await shot('16-duplicates');
  await page.goto('/activity'); await settle(page); await shot('17-activity');
  const cols = await call<{ id: string }[]>(page, 'GET', '/collections');
  await page.goto(`/collections/${cols[0]!.id}`); await settle(page); await shot('18-collection');
  await page.getByRole('button', { name: 'Modifier la règle' }).click(); await settle(page); await shot('19-collection-builder'); await page.keyboard.press('Escape');
  await page.goto('/shared'); await settle(page); await shot('20-shared');
  await page.goto('/shares'); await settle(page); await shot('21-shares');
  await page.goto('/requests'); await settle(page); await shot('22-portals');
  await page.goto('/settings/profil'); await settle(page); await shot('23-settings');
  await page.goto('/settings/appareils'); await settle(page); await shot('24-devices');
  await page.goto('/admin'); await settle(page); await page.waitForTimeout(500); await shot('25-admin');
  await page.goto('/ask'); await settle(page); await shot('26-ask');
  // viewer with the inspector docked
  await page.goto(`/open/${d.rapport.id}`); await expect(page.getByTestId('viewer')).toBeVisible(); await settle(page); await page.getByTestId('viewer-inspector').click(); await settle(page); await shot('27-viewer');
});
