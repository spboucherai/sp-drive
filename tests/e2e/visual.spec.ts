// Visual regression of the main screens: desktop 1440 × 900 and phone 390 × 844, light and dark. The drive is seeded
// with content that needs no worker-made thumbnail; what changes with the clock (relative times, dates, the growth
// chart) is masked, and a small pixel ratio absorbs sub-pixel text differences.
//   update the references on purpose: pnpm e2e visual.spec.ts --update-snapshots
import { expect, type Locator, type Page, test } from '@playwright/test';
import { apiSignUp } from './helpers.ts';
import { call, indexed, upload } from './next-helpers.ts';

test.use({ locale: 'fr-CA', timezoneId: 'America/Toronto' });

test('main screens, light and dark', async ({ page, context }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  const theme = (t: string) => page.evaluate((x) => { localStorage.setItem('spd.theme', x); document.documentElement.classList.toggle('dark', x === 'dark'); }, t);
  const volatile = (): Locator[] => [page.locator('time'), page.locator('[data-testid=timeline] .spd-eyebrow'), page.getByTestId('storage-growth'), page.getByTestId('live-state'),
    page.locator('[data-testid=listing] [role=gridcell]:nth-child(2)'), page.locator('[data-testid=listing] [data-name] ~ *, [data-testid=listing] .text-ink-3'), page.locator('[data-testid=details] dd'), page.locator('[data-testid=details] li p + p'),
    page.locator('[data-testid=collection-file] .text-ink-3'), page.locator('[data-testid=outgoing] .text-ink-3'), page.locator('[data-testid=session] p + p'), page.locator('[data-testid=snippet]').locator('xpath=../../span[last()]')];
  const settle = async (p: Page) => { await p.waitForLoadState('networkidle'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300); };
  const shot = async (name: string) => {
    for (const th of ['light', 'dark']) { await theme(th); await settle(page); await expect(page).toHaveScreenshot(`${name}-${th}.png`, { mask: volatile(), maxDiffPixelRatio: 0.02, animations: 'disabled' }); }
    await theme('light');
  };

  await page.goto('/login'); await settle(page); await shot('login');
  await apiSignUp(context, page);
  const root = (await call(page, 'GET', '/folders/root')).folder.id as string;
  await page.goto('/'); await settle(page); await shot('empty-drive');
  const projets = (await call(page, 'POST', '/folders', { parentId: root, name: 'Projets' })).id as string;
  await call(page, 'POST', '/folders', { parentId: root, name: 'Administratif' });
  const contrat = await upload(page, projets, 'Contrat chalet.md', '# Contrat de location\n\nLe locataire verse un dépôt de 500 dollars avant le 1er juin.\n');
  await upload(page, projets, 'Contrat chalet.md', '# Contrat de location\n\nLe locataire verse un dépôt de 650 dollars avant le 15 mai.\n', { fileId: contrat.id });
  await upload(page, projets, 'Budget 2026.csv', 'Poste,Montant\nLoyer,1200\nÉpicerie,640\n');
  const notes = await upload(page, projets, 'Notes de réunion.txt', 'Ordre du jour\nLe budget de la coopérative Hirondelle est adopté.\n');
  await upload(page, root, 'Lisez-moi.md', '# Bienvenue\n');
  await upload(page, root, 'Données.bin', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  await upload(page, root, 'Copie des données.bin', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  await indexed(page, notes.id); await indexed(page, contrat.id);
  const col = await call(page, 'POST', '/collections', { name: 'Textes', color: 'blue', rule: { match: 'all', conditions: [{ field: 'kind', op: 'is', value: 'text' }], sort: { by: 'name', dir: 'asc' } } });

  await page.evaluate(() => localStorage.setItem('spd.explorer.view', 'grid'));
  await page.goto('/'); await settle(page); await shot('explorer-grid');
  await page.evaluate(() => localStorage.setItem('spd.explorer.view', 'list'));
  await page.goto(`/folder/${projets}`); await settle(page); await shot('folder-list');
  await page.locator('[role=row][data-id]:has([data-name]:text-is("Contrat chalet.md")) [data-more]').click();
  await page.getByRole('menuitem', { name: 'Détails' }).click(); await settle(page); await shot('inspector');
  await page.getByTestId('open-time-machine').click(); await expect(page.getByTestId('tm-diff')).toBeVisible();
  await expect(page).toHaveScreenshot('time-machine-light.png', { mask: [page.locator('[data-testid=tm-timeline] button span span'), page.locator('figcaption'), page.locator('[data-testid=details] dd'), page.locator('[data-testid=listing] [role=gridcell]:nth-child(2)')], maxDiffPixelRatio: 0.02 });
  await page.keyboard.press('Escape'); if (phone) await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k'); await page.getByRole('combobox').fill('hirondelle'); await expect(page.getByTestId('snippet').first()).toBeVisible(); await shot('palette'); await page.keyboard.press('Escape');
  await page.goto('/search?q=budget'); await settle(page); await shot('search');
  await page.goto('/storage'); await settle(page); await page.waitForTimeout(700); await shot('storage');
  await page.goto('/duplicates'); await settle(page); await shot('duplicates');
  await page.goto(`/collections/${col.id}`); await settle(page); await shot('collection');
  await page.goto('/activity'); await settle(page); await shot('activity');
  await page.goto('/shared'); await settle(page); await shot('shared');
  await page.goto('/settings/profil'); await settle(page); await shot('settings');
});
