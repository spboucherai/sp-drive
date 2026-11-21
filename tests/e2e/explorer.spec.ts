/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : tests/e2e/explorer.spec.ts
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

// File explorer, end to end against the development stack: real account, real uploads, real downloads.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { apiSignUp } from './helpers.ts';

test.use({ locale: 'fr-CA' });

const SHOTS = '/tmp/spd-shots/explorer';
mkdirSync(SHOTS, { recursive: true });
const txt = (name: string, body: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(body) });
const row = (page: Page, name: string) => page.locator(`[role=row][data-id]:has([data-name]:text-is("${name}"))`);
const panel = (page: Page) => page.getByTestId('upload-panel');
const uploadFiles = (page: Page, files: Parameters<Page['setInputFiles']>[1]) => page.getByTestId('upload-input').setInputFiles(files);
/** Open the action menu of an item with its "…" button and choose an action. */
async function act(page: Page, name: string, action: string | RegExp): Promise<void> {
  await row(page, name).locator('[data-more]').click();
  await page.getByRole('menuitem', { name: action }).click();
}
/** Open an item the way the device does: double-click with a mouse, tap on a touch screen. */
async function open(page: Page, name: string, mobile: boolean): Promise<void> {
  if (mobile) await row(page, name).locator('[data-name]').tap(); else await row(page, name).dblclick();
}
const call = <T = any>(page: Page, method: string, path: string, body?: unknown): Promise<T> =>
  page.evaluate(async ([m, p, b]) => {
    const r = await fetch(`/api/v1${p}`, { method: m as string, headers: { 'Content-Type': 'application/json', 'X-SPD-CSRF': '1' }, body: m === 'GET' ? undefined : JSON.stringify(b ?? {}) });
    if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${await r.text()}`);
    return r.json();
  }, [method, path, body] as const);
const rootFiles = async (page: Page) => (await call(page, 'GET', '/folders/root')).files as { id: string; name: string; size: number; sha256: string; versions: number; starred: boolean; tagIds: string[] }[];
async function start(page: Page, context: Parameters<typeof apiSignUp>[0], path = '/'): Promise<void> {
  await apiSignUp(context, page);
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('dossiers, envoi multiple, collisions, renommer, déplacer, favoris, étiquettes, recherche, détails', async ({ page, context }, info) => {
  const mobile = info.project.name === 'mobile';
  await start(page, context);
  await expect(page.getByRole('heading', { name: 'Ce dossier est vide' })).toBeVisible();

  // new folder, and the same name again: refused in place
  const newFolder = async (name: string) => {
    await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Nouveau dossier' }).click();
    await page.getByLabel('Nom du dossier').fill(name);
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
  };
  await newFolder('Projets');
  await expect(row(page, 'Projets')).toBeVisible();
  await newFolder('projets');
  await expect(page.getByRole('alert').filter({ hasText: 'Un élément porte déjà ce nom' })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler' }).click();

  // several files at once
  await uploadFiles(page, [txt('note.txt', 'version un'), txt('liste.csv', 'a,b\n1,2\n'), txt('lisez-moi.md', '# Bonjour\n')]);
  for (const n of ['note.txt', 'liste.csv', 'lisez-moi.md']) await expect(row(page, n)).toBeVisible();
  await expect(panel(page)).toContainText('3 fichiers téléversés');
  await panel(page).getByRole('button', { name: 'Tout effacer' }).click();
  await expect(panel(page)).toBeHidden();

  // name collision → new version
  await uploadFiles(page, [txt('note.txt', 'version deux, plus longue')]);
  const ask = page.getByRole('dialog', { name: 'Ce nom existe déjà' });
  await expect(ask).toContainText('note.txt');
  await ask.getByRole('button', { name: 'Remplacer (nouvelle version)' }).click();
  await expect(panel(page)).toContainText('Nouvelle version enregistrée');
  await expect(row(page, 'note.txt').getByTitle('2 versions')).toBeVisible();
  // name collision → keep both
  await uploadFiles(page, [txt('note.txt', 'un autre fichier')]);
  await ask.getByRole('button', { name: 'Garder les deux' }).click();
  await expect(row(page, 'note (2).txt')).toBeVisible();
  await expect(panel(page)).toContainText('Enregistré sous « note (2).txt »');
  let files = await rootFiles(page);
  expect(files.find((f) => f.name === 'note.txt')).toMatchObject({ versions: 2, size: Buffer.byteLength('version deux, plus longue') });
  expect(files.find((f) => f.name === 'note (2).txt')).toMatchObject({ versions: 1, size: 16 });
  await panel(page).getByRole('button', { name: 'Tout effacer' }).click();

  // rename: a taken name is refused in place, then a free one is accepted
  await act(page, 'note (2).txt', 'Renommer');
  await page.getByLabel('Nouveau nom').fill('note.txt');
  await page.getByRole('dialog').getByRole('button', { name: 'Renommer' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Un élément porte déjà ce nom' })).toBeVisible();
  await page.getByLabel('Nouveau nom').fill('brouillon.txt');
  await page.getByLabel('Nouveau nom').press('Enter');
  await expect(row(page, 'brouillon.txt')).toBeVisible();
  await expect(row(page, 'note (2).txt')).toHaveCount(0);

  // move with the picker
  await act(page, 'brouillon.txt', 'Déplacer vers…');
  const picker = page.getByRole('dialog', { name: 'Déplacer 1 élément' });
  await picker.locator('[data-folder-name="Projets"]').click();
  await picker.getByRole('button', { name: 'Déplacer ici' }).click();
  await expect(row(page, 'brouillon.txt')).toHaveCount(0);
  // the same name moved again: 409, then "keep both"
  await uploadFiles(page, [txt('brouillon.txt', 'homonyme')]);
  await expect(row(page, 'brouillon.txt')).toBeVisible();
  await act(page, 'brouillon.txt', 'Déplacer vers…');
  await picker.locator('[data-folder-name="Projets"]').click();
  await picker.getByRole('button', { name: 'Déplacer ici' }).click();
  await expect(picker.getByRole('alert')).toContainText('Un élément nommé « brouillon.txt » existe déjà');
  await picker.getByRole('button', { name: 'Garder les deux' }).click();
  await expect(row(page, 'brouillon.txt')).toHaveCount(0);
  // a new folder made inside the picker, used as the destination of a copy
  await act(page, 'liste.csv', 'Copier vers…');
  const copier = page.getByRole('dialog', { name: 'Copier 1 élément' });
  await copier.locator('[data-folder-name="Projets"]').click();
  await copier.getByRole('button', { name: 'Nouveau dossier' }).click();
  await copier.getByLabel('Nouveau dossier dans « Projets »').fill('Archives');
  await copier.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(copier).toContainText('Destination : Archives');
  await copier.getByRole('button', { name: 'Copier ici' }).click();
  await expect(copier).toBeHidden();

  await open(page, 'Projets', mobile);
  await expect(page).toHaveURL(/\/folder\//);
  for (const n of ['brouillon.txt', 'brouillon (2).txt', 'Archives']) await expect(row(page, n)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Fil d’Ariane' }).getByRole('link', { name: 'Mon Drive' })).toBeVisible();
  await open(page, 'Archives', mobile);
  await expect(row(page, 'liste.csv')).toBeVisible();
  await page.goBack();

  // star, tag
  await act(page, 'brouillon.txt', 'Ajouter aux favoris');
  await expect(row(page, 'brouillon.txt').getByTitle('Favori')).toBeVisible();
  await act(page, 'brouillon.txt', 'Étiquettes…');
  const tagDlg = page.getByRole('dialog', { name: /Étiquettes de/ });
  await tagDlg.getByLabel('Nouvelle étiquette').fill('impôts');
  await tagDlg.getByRole('radio', { name: 'Vert' }).click();
  await tagDlg.getByRole('button', { name: 'Créer et appliquer' }).click();
  await expect(tagDlg.getByRole('checkbox')).toBeChecked();
  await tagDlg.getByLabel('Nouvelle étiquette').fill('Impôts');
  await tagDlg.getByRole('button', { name: 'Créer et appliquer' }).click();
  await expect(tagDlg.getByRole('alert')).toContainText('Une étiquette porte déjà ce nom');
  await tagDlg.getByRole('button', { name: 'Modifier l’étiquette impôts' }).click();
  await tagDlg.getByLabel('Nom de l’étiquette').fill('fiscalité');
  await tagDlg.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(tagDlg.getByText('fiscalité')).toBeVisible();
  await tagDlg.getByRole('button', { name: 'Terminé' }).click();

  // details: checksum, location, tag
  await act(page, 'brouillon.txt', 'Détails');
  const details = page.getByTestId('details');
  await expect(details.getByTestId('sha256')).toHaveText(sha(Buffer.from('un autre fichier')));
  await expect(details).toContainText('Mon Drive / Projets');
  await expect(details).toContainText('fiscalité');
  await expect(details).toContainText('Versions (1)');
  await page.getByRole('button', { name: 'Fermer' }).first().click();

  // starred view, then search by name (accent-insensitive on the server), tag and kind
  await page.goto('/starred');
  await expect(row(page, 'brouillon.txt')).toBeVisible();
  await expect(page.locator('[role=row][data-id]')).toHaveCount(1);
  await page.goto('/search?q=BROUIL');
  await expect(row(page, 'brouillon.txt')).toBeVisible();
  await expect(row(page, 'brouillon (2).txt')).toBeVisible();
  if (mobile) await page.getByRole('button', { name: 'Filtres' }).click(); // folded away on phones
  await page.getByLabel('Étiquette').selectOption({ label: 'fiscalité' });
  await expect(page.locator('[role=row][data-id]')).toHaveCount(1);
  await expect(page).toHaveURL(/tag=/);
  await page.getByLabel('Type').selectOption({ label: 'Images' });
  await expect(page.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
  await page.getByLabel('Type').selectOption({ label: 'Tous' });
  await page.getByLabel('Étiquette').selectOption({ label: 'Toutes' });
  await page.getByLabel('Nom', { exact: true }).fill('lisez');
  await expect(row(page, 'lisez-moi.md')).toBeVisible();
  await expect(page.locator('[role=row][data-id]')).toHaveCount(1);
  await expect(page).toHaveURL(/q=lisez/);

  // versions: the earlier content can be restored, which adds a version
  await page.goto('/');
  await act(page, 'note.txt', 'Détails');
  await expect(details).toContainText('Versions (2)');
  await details.getByRole('button', { name: 'Restaurer la version 1' }).click();
  await expect(details).toContainText('Versions (3)');
  await expect(details.getByTestId('sha256')).toHaveText(sha(Buffer.from('version un')));
  // upload of a new version from the panel
  await details.getByTestId('version-input').setInputFiles(txt('peu-importe.txt', 'version quatre'));
  await expect(details).toContainText('Versions (4)');
  files = await rootFiles(page);
  expect(files.find((f) => f.name === 'note.txt')).toMatchObject({ versions: 4, sha256: sha(Buffer.from('version quatre')) });
  // an old version downloads with its own bytes
  const dl = page.waitForEvent('download');
  await details.getByRole('button', { name: 'Télécharger la version 2' }).click();
  expect(readFileSync(await (await dl).path()).toString()).toBe('version deux, plus longue');

  // deep link to a file opens its preview
  const note = files.find((f) => f.name === 'note.txt')!;
  await page.goto(`/?file=${note.id}`);
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expect(page.getByTestId('viewer-name')).toContainText('note.txt');
  await page.getByTestId('viewer-close').click();
  await expect(page.getByTestId('viewer')).toBeHidden();
  await expect(page).not.toHaveURL(/file=/);
  // an unknown folder says so
  await page.goto('/folder/00000000-0000-4000-8000-000000000000');
  await expect(page.getByRole('heading', { name: 'Dossier introuvable' }).last()).toBeVisible();
  await page.getByRole('link', { name: 'Retour à Mon Drive' }).click();
  await expect(row(page, 'note.txt')).toBeVisible();
});

test('gros fichier : coupure réseau au milieu, puis téléchargement identique octet pour octet', async ({ page, context }) => {
  await start(page, context);
  const big = randomBytes(19 * 1024 * 1024 + 4321); // three chunks
  let cut = 0;
  await page.route('**/api/v1/uploads/*?offset=*', async (route) => {
    if (route.request().method() === 'PATCH' && !route.request().url().endsWith('offset=0') && cut++ === 0) await route.abort('connectionreset'); else await route.continue();
  });
  await uploadFiles(page, [{ name: 'gros.bin', mimeType: 'application/octet-stream', buffer: big }]);
  await expect(panel(page)).toContainText('1 fichier téléversé', { timeout: 60_000 });
  expect(cut).toBeGreaterThan(1); // the chunk was cut once, then sent again
  await page.unroute('**/api/v1/uploads/*?offset=*');
  const f = (await rootFiles(page)).find((x) => x.name === 'gros.bin')!;
  expect(f.size).toBe(big.length);
  expect(f.sha256).toBe(sha(big));

  const dl = page.waitForEvent('download');
  await act(page, 'gros.bin', 'Télécharger');
  const got = await dl;
  expect(got.suggestedFilename()).toBe('gros.bin');
  expect(readFileSync(await got.path()).equals(big)).toBe(true);
});

test('pause et reprise, puis reprise après rechargement de la page en choisissant le même fichier', async ({ page, context }) => {
  await start(page, context);
  const dir = mkdtempSync(join(tmpdir(), 'spd-e2e-'));
  const body = randomBytes(18 * 1024 * 1024);
  const path = join(dir, 'reprise.bin');
  writeFileSync(path, body);
  // the second chunk never gets through until the route is removed
  let hold = true;
  const stalled: (() => void)[] = [];
  await page.route('**/api/v1/uploads/*?offset=*', async (route) => {
    if (hold && route.request().method() === 'PATCH' && !route.request().url().endsWith('offset=0')) await new Promise<void>((r) => stalled.push(r));
    await route.continue().catch(() => {});
  });
  await uploadFiles(page, path);
  await expect(panel(page)).toContainText('8 Mo sur 18 Mo');
  // pause, then resume: still stuck on the second chunk, nothing lost
  await panel(page).getByRole('button', { name: 'Mettre en pause' }).click();
  await expect(panel(page)).toContainText('En pause');
  await panel(page).getByRole('button', { name: 'Reprendre' }).click();
  await expect(panel(page)).toContainText('8 Mo sur 18 Mo');
  await expect(panel(page).getByRole('button', { name: 'Mettre en pause' })).toBeVisible();

  // reload in the middle: the page warns, and afterwards the panel says what can be resumed and how
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  hold = false; stalled.forEach((r) => r());
  await expect(panel(page)).toContainText('1 envoi interrompu');
  await expect(panel(page)).toContainText('Choisissez de nouveau les mêmes fichiers');
  await expect(row(page, 'reprise.bin')).toHaveCount(0);
  await uploadFiles(page, path);
  await expect(panel(page)).toContainText('1 fichier téléversé', { timeout: 60_000 });
  await expect(panel(page)).toContainText('repris à 44 %');
  const f = (await rootFiles(page)).find((x) => x.name === 'reprise.bin')!;
  expect(f).toMatchObject({ size: body.length, sha256: sha(body), versions: 1 });
  expect(await page.evaluate(() => localStorage.getItem('spd.uploads.pending'))).toBe('[]');

  // cancel removes the session on the server
  hold = true;
  await uploadFiles(page, [{ name: 'annule.bin', mimeType: 'application/octet-stream', buffer: randomBytes(9 * 1024 * 1024) }]);
  await expect(panel(page)).toContainText('8 Mo sur 9 Mo');
  await panel(page).getByRole('button', { name: 'Annuler le téléversement' }).click();
  hold = false; stalled.forEach((r) => r());
  await expect(panel(page)).not.toContainText('annule.bin');
  await page.waitForTimeout(500);
  expect((await rootFiles(page)).map((x) => x.name)).toEqual(['reprise.bin']);
});

test('corbeille : annuler, restaurer, supprimer définitivement, vider', async ({ page, context }, info) => {
  await start(page, context);
  await uploadFiles(page, [txt('a.txt', 'a'), txt('b.txt', 'b'), txt('c.txt', 'c')]);
  await expect(row(page, 'c.txt')).toBeVisible();
  // trash + undo from the toast
  await act(page, 'a.txt', 'Mettre à la corbeille');
  await expect(row(page, 'a.txt')).toHaveCount(0);
  const toast = page.getByRole('status').filter({ hasText: '« a.txt » mis à la corbeille' });
  await toast.getByRole('button', { name: 'Annuler' }).click();
  await expect(row(page, 'a.txt')).toBeVisible();
  // trash, then restore from the trash view
  await act(page, 'b.txt', 'Mettre à la corbeille');
  await act(page, 'c.txt', 'Mettre à la corbeille');
  await page.goto('/trash');
  await expect(row(page, 'b.txt')).toBeVisible();
  await expect(row(page, 'c.txt')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-light-trash.png` });
  await act(page, 'b.txt', 'Restaurer');
  await expect(row(page, 'b.txt')).toHaveCount(0);
  // permanent delete, confirmed
  await act(page, 'c.txt', 'Supprimer définitivement');
  const confirm = page.getByRole('dialog', { name: 'Supprimer définitivement ?' });
  await expect(confirm).toContainText('c.txt');
  await confirm.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await expect(page.getByRole('heading', { name: 'La corbeille est vide' })).toBeVisible();
  expect((await rootFiles(page)).map((f) => f.name).sort()).toEqual(['a.txt', 'b.txt']);
  // empty the trash
  await call(page, 'POST', '/trash', { fileIds: (await rootFiles(page)).filter((f) => f.name === 'a.txt').map((f) => f.id), folderIds: [] });
  await page.reload();
  await expect(row(page, 'a.txt')).toBeVisible();
  await page.getByRole('button', { name: 'Vider la corbeille' }).click();
  await page.getByRole('dialog', { name: 'Vider la corbeille' }).getByRole('button', { name: 'Vider la corbeille' }).click();
  await expect(page.getByRole('heading', { name: 'La corbeille est vide' })).toBeVisible();
  expect((await call(page, 'GET', '/trash')).files).toHaveLength(0);
});

test('ZIP d’un dossier, sélection multiple, doublons', async ({ page, context }, info) => {
  const mobile = info.project.name === 'mobile';
  await start(page, context);
  const dossier = await call(page, 'POST', '/folders', { parentId: 'root', name: 'Dossier été' });
  await page.goto(`/folder/${dossier.id}`);
  await uploadFiles(page, [txt('un.txt', 'premier'), txt('deux.txt', 'second')]);
  await expect(row(page, 'deux.txt')).toBeVisible();
  await page.getByRole('navigation', { name: 'Fil d’Ariane' }).getByRole('link', { name: 'Mon Drive' }).click();
  await expect(row(page, 'Dossier été')).toBeVisible();
  await uploadFiles(page, [txt('copie.txt', 'premier')]);
  await expect(row(page, 'copie.txt')).toBeVisible();

  const dl = page.waitForEvent('download');
  await act(page, 'Dossier été', 'Télécharger (ZIP)');
  const zip = await dl;
  expect(zip.suggestedFilename()).toBe('Dossier été.zip');
  const zipPath = await zip.path();
  const names = execFileSync('unzip', ['-Z1', zipPath]).toString().trim().split('\n').sort();
  expect(names).toEqual(['Dossier été/deux.txt', 'Dossier été/un.txt']);
  expect(execFileSync('unzip', ['-p', zipPath, 'Dossier été/un.txt']).toString()).toBe('premier');

  // selection bar: both items, one ZIP
  if (mobile) {
    await row(page, 'copie.txt').locator('[data-more]').click(); // the "…" button selects the item and opens its actions
    await page.keyboard.press('Escape');
    await row(page, 'Dossier été').locator('[data-name]').tap(); // with a selection, a tap adds to it
  } else {
    await row(page, 'copie.txt').click();
    await row(page, 'Dossier été').click({ modifiers: ['ControlOrMeta'] });
  }
  const bar = page.getByTestId('selection-bar');
  await expect(bar).toContainText('2 sélectionnés');
  const dl2 = page.waitForEvent('download');
  await bar.getByRole('button', { name: 'Télécharger (ZIP)' }).click();
  expect(execFileSync('unzip', ['-Z1', await (await dl2).path()]).toString().trim().split('\n').sort()).toEqual(['Dossier été/deux.txt', 'Dossier été/un.txt', 'copie.txt']);
  await bar.getByRole('button', { name: 'Tout désélectionner' }).click();
  await expect(bar).toBeHidden();

  // duplicates: same content in two places
  await page.goto('/duplicates');
  const group = page.getByTestId('dup-group');
  await expect(group).toHaveCount(1);
  await expect(group).toContainText('2 copies');
  await expect(group).toContainText('Mon Drive / Dossier été');
  await group.getByRole('button', { name: 'Mettre la copie en trop à la corbeille' }).click();
  await expect(page.getByRole('heading', { name: 'Aucun doublon' })).toBeVisible();
  expect((await call(page, 'GET', '/trash')).files).toHaveLength(1);
});

test('clavier seul : flèches, espace, F2, suppression ; glisser vers un dossier à la souris', async ({ page, context }, info) => {
  await start(page, context);
  await call(page, 'POST', '/folders', { parentId: 'root', name: 'Cible' });
  await uploadFiles(page, [txt('k1.txt', '1'), txt('k2.txt', '2'), txt('k3.txt', '3')]);
  await expect(row(page, 'k3.txt')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Tout effacer' }).click();
  const listing = page.getByTestId('listing');
  await expect(listing).toHaveAttribute('aria-multiselectable', 'true');
  if ((await listing.getAttribute('data-mode')) !== 'list') await page.getByTestId('view-toggle').click();
  await expect(listing).toHaveAttribute('data-mode', 'list');

  // one tab stop in the listing; arrows move the focus, Space selects
  await expect(page.locator('[role=row][data-id][tabindex="0"]')).toHaveCount(1);
  await row(page, 'Cible').focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'k1.txt')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(row(page, 'k2.txt')).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, 'k1.txt')).toHaveAttribute('aria-selected', 'false');
  // F2 renames; focus comes back to the row
  await page.keyboard.press('F2');
  await expect(page.getByLabel('Nouveau nom')).toBeFocused();
  await page.keyboard.type('renomme-au-clavier');
  await page.keyboard.press('Enter');
  await expect(row(page, 'renomme-au-clavier.txt')).toBeVisible();
  await expect(row(page, 'renomme-au-clavier.txt')).toBeFocused();
  // Shift+arrow extends, Escape clears, select all
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selection-bar')).toBeHidden();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByTestId('selection-bar')).toContainText('4 sélectionnés');
  await page.keyboard.press('Escape');
  // Delete sends the focused item to the trash
  await page.keyboard.press('Delete');
  await expect(row(page, 'renomme-au-clavier.txt')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'mis à la corbeille' })).toBeVisible();
  // Enter opens a folder
  await row(page, 'Cible').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/folder\//);
  await expect(page.getByRole('heading', { name: 'Ce dossier est vide' })).toBeVisible();
  await page.goBack();

  if (info.project.name === 'desktop') {
    // right-click opens the same menu; drag a file onto a folder row moves it
    await row(page, 'k1.txt').click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'Actions pour k1.txt' })).toBeVisible();
    await page.keyboard.press('Escape');
    await row(page, 'k1.txt').dragTo(row(page, 'Cible'));
    await expect(row(page, 'k1.txt')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'déplacé vers « Cible »' })).toBeVisible();
    // files dropped from the desktop are uploaded here
    const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['depuis le bureau'], 'depose.txt', { type: 'text/plain' })); return d; });
    await page.getByTestId('listing').dispatchEvent('dragenter', { dataTransfer: dt });
    await expect(page.getByTestId('drop-overlay')).toBeVisible();
    await page.getByTestId('listing').dispatchEvent('drop', { dataTransfer: dt });
    await expect(row(page, 'depose.txt')).toBeVisible();
  }
});

test('grille / liste : le choix est conservé ; captures dans les deux thèmes', async ({ page, context }, info) => {
  const size = info.project.name;
  if (size === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
  await start(page, context);
  const theme = async (th: string) => page.evaluate((x) => { localStorage.setItem('spd.theme', x); document.documentElement.classList.toggle('dark', x === 'dark'); }, th);
  const both = async (name: string) => { for (const th of ['light', 'dark']) { await theme(th); await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTS}/${size}-${th}-${name}.png` }); } await theme('light'); };
  await both('empty');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAQ0lEQVR4nO3PQQ0AIBDAsAP/nuGNAvZoFSzZOjPzs10HvGpINaQaUg2phlRDqiHVkGpINaQaUg2phlRDqiHVkGrIBfWOAV+3pZzQAAAAAElFTkSuQmCC', 'base64');
  for (const n of ['Contrats', 'Photos de chantier', 'Reçus 2026']) await call(page, 'POST', '/folders', { parentId: 'root', name: n });
  await uploadFiles(page, [
    { name: 'plan.png', mimeType: 'image/png', buffer: png }, txt('Compte rendu de réunion du comité.md', '# CR\n'), txt('budget-2026.csv', 'poste,montant\nloyer,1200\n'),
    { name: 'bail-signé.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') }, { name: 'archive.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18), 'latin1') }, txt('notes.txt', 'à faire'),
  ]);
  await expect(row(page, 'notes.txt')).toBeVisible();
  await expect(panel(page)).toContainText('6 fichiers téléversés');
  await both('upload-panel');
  await panel(page).getByRole('button', { name: 'Tout effacer' }).click();
  const tag = await call(page, 'POST', '/tags', { name: 'À signer', color: 'orange' });
  const files = await rootFiles(page);
  await call(page, 'PATCH', `/files/${files.find((f) => f.name === 'bail-signé.pdf')!.id}`, { starred: true, tagIds: [tag.id] });
  await page.reload();

  const listing = page.getByTestId('listing');
  const first = (await listing.getAttribute('data-mode'))!;
  expect(first).toBe(size === 'mobile' ? 'list' : 'grid'); // default: cards on a large screen, rows on a phone
  await both(first);
  await page.getByTestId('view-toggle').click();
  const second = first === 'grid' ? 'list' : 'grid';
  await expect(listing).toHaveAttribute('data-mode', second);
  await page.reload();
  await expect(listing).toHaveAttribute('data-mode', second); // kept across a reload
  await expect(row(page, 'notes.txt')).toBeVisible();
  await both(second);
  // nothing scrolls sideways
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // sort: by size, descending, done by the server
  await page.getByRole('button', { name: /^Trier/ }).click();
  await page.getByRole('menuitem', { name: 'Taille' }).click();
  await page.getByRole('button', { name: /^Trier/ }).click();
  await page.getByRole('menuitem', { name: 'Ordre décroissant' }).click();
  await expect(page.locator('[role=row][data-type=file] [data-name]').first()).toHaveText('plan.png');
  await page.getByRole('button', { name: /^Trier/ }).click();
  await page.getByRole('menuitem', { name: 'Nom' }).click();
  await page.getByRole('button', { name: /^Trier/ }).click();
  await page.getByRole('menuitem', { name: 'Ordre croissant' }).click();
  await expect(page.locator('[role=row][data-type=file] [data-name]').first()).toHaveText('archive.zip');

  await act(page, 'bail-signé.pdf', 'Détails');
  await expect(page.getByTestId('details')).toContainText('Versions (1)');
  await both('details');
  await page.getByRole('button', { name: 'Fermer' }).first().click();
  await row(page, 'notes.txt').locator('[data-more]').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await both('menu');
  await page.keyboard.press('Escape');
  await page.goto('/search?q=20');
  await expect(row(page, 'budget-2026.csv')).toBeVisible();
  await both('search');
  await call(page, 'POST', '/trash', { fileIds: files.slice(0, 2).map((f) => f.id), folderIds: [] });
  await page.goto('/trash');
  await expect(page.locator('[role=row][data-id]')).toHaveCount(2);
  await both('trash');
});
