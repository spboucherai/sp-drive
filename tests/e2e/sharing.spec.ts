/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : tests/e2e/sharing.spec.ts
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

// Owner side of sharing: the share dialog and the Shares screen, the portal dialog, the Requests screen and the detail
// of a portal with its deposits. Visitors and depositors are separate anonymous contexts or plain HTTP clients.
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { apiSignUp } from './helpers.ts';

test.use({ locale: 'fr-CA' });
const BASE = process.env.SPD_E2E_BASE ?? 'http://localhost:5183';
const SHOTS = process.env.SPD_SHOTS ? '/tmp/spd-shots/sharing' : '';
const shot = async (page: Page, name: string, info: { project: { name: string } }) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/owner-${name}-${info.project.name}.png` }); } };
const clientIp = () => `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

async function call<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(async ([m, p, b]) => {
    const r = await fetch(`/api/v1${p}`, { method: m as string, headers: { 'X-SPD-CSRF': '1', ...(b !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: b !== undefined ? JSON.stringify(b) : m === 'GET' ? undefined : '{}' });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${m} ${p}: ${r.status} ${JSON.stringify(j)}`);
    return j;
  }, [method, path, body] as const);
}
async function upload(page: Page, folderId: string, name: string, text: string): Promise<{ id: string }> {
  const r = await page.evaluate(async ([folder, n, body]) => {
    const h = { 'X-SPD-CSRF': '1' }, bytes = new TextEncoder().encode(body);
    const u = await (await fetch('/api/v1/uploads', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId: folder, name: n, size: bytes.length }) })).json();
    await fetch(`/api/v1/uploads/${u.id}?offset=0`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: bytes });
    return (await fetch(`/api/v1/uploads/${u.id}/complete`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' })).json();
  }, [folderId, name, text] as const);
  return r.file;
}
/** An anonymous visitor in its own browser context. */
async function visitor(browser: Browser, info: { project: { use: object } }): Promise<Page> {
  const ctx = await browser.newContext({ ...info.project.use, locale: 'fr-CA', baseURL: BASE, extraHTTPHeaders: { 'X-Forwarded-For': clientIp() } });
  return ctx.newPage();
}
const pathOf = (url: string) => new URL(url).pathname;
const menu = async (scope: ReturnType<Page['locator']>, page: Page, item: string) => { await scope.getByRole('button', { name: /^Actions pour/ }).click(); await page.getByRole('menuitem', { name: item }).click(); };

test('share links: create, visit, journal, edit, rotate, revoke and delete', async ({ context, page, browser }, info) => {
  await apiSignUp(context, page);
  const folder = await call(page, 'POST', '/folders', { parentId: 'root', name: 'Comptabilité' });
  const file = await upload(page, folder.id, 'Bilan 2025.txt', 'Actif = Passif');
  await call(page, 'POST', '/shares', { fileId: file.id, label: 'Premier lien' });
  await call(page, 'POST', '/shares', { folderId: folder.id, label: 'Dossier pour le conseil' });

  await page.goto('/shares');
  const screen = page.getByTestId('shares-screen');
  await expect(screen.getByRole('heading', { level: 1, name: 'Liens de partage' })).toBeVisible();
  await expect(screen.getByTestId('share-item')).toHaveCount(2);
  // a folder link leads to the folder; a file link opens the share dialog of the file
  await expect(screen.getByRole('link', { name: 'Comptabilité' })).toHaveAttribute('href', `/folder/${folder.id}`);
  await screen.getByRole('button', { name: 'Bilan 2025.txt' }).click();
  const dialog = page.getByRole('dialog', { name: 'Partager « Bilan 2025.txt »' });
  await expect(dialog.getByTestId('share-item')).toHaveCount(1);

  // --- create ---
  await dialog.getByRole('button', { name: 'Créer un lien' }).click();
  await dialog.getByLabel('Libellé').fill('Pour Julie');
  await dialog.getByRole('switch', { name: 'Autoriser le téléchargement' }).click();
  await expect(dialog.getByText(/Cela n’empêche pas une capture d’écran/)).toBeVisible();
  await dialog.getByLabel('Mot de passe (facultatif)').fill('abc');
  await dialog.getByRole('radio', { name: '7 jours' }).click();
  await dialog.getByLabel('Consultations max.').fill('5');
  await dialog.getByRole('button', { name: 'Créer un lien' }).click();
  await expect(dialog.getByText('Le mot de passe doit compter au moins 4 caractères.')).toBeVisible();
  await dialog.getByLabel('Mot de passe (facultatif)').fill('hibou-12');
  await dialog.getByRole('button', { name: 'Créer un lien' }).click();
  const once = dialog.getByTestId('link-once');
  await expect(once.getByText(/il ne sera plus jamais affiché/)).toBeVisible();
  await shot(page, 'share-created', info);
  const url = await once.getByRole('textbox', { name: 'Lien' }).inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole('button', { name: 'Terminé' }).click();
  await expect(dialog.getByTestId('share-item')).toHaveCount(2);
  await expect(dialog.getByTestId('link-once')).toHaveCount(0); // the link is not shown a second time
  expect(await dialog.innerHTML()).not.toContain(pathOf(url));

  // --- a visitor uses it: one wrong password, then in ---
  const guest = await visitor(browser, info);
  await guest.goto(pathOf(url));
  await guest.getByLabel('Mot de passe').fill('raté');
  await guest.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(guest.getByText('Mot de passe incorrect.')).toBeVisible();
  await guest.getByLabel('Mot de passe').fill('hibou-12');
  await guest.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(guest.getByRole('heading', { level: 1, name: 'Bilan 2025.txt' })).toBeVisible();
  await expect(guest.getByRole('button', { name: /Télécharger/ })).toHaveCount(0); // view-only

  // --- the owner sees the visit ---
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await page.reload();
  const item = screen.getByTestId('share-item').filter({ hasText: 'Pour Julie' });
  await expect(item.getByTestId('share-counters')).toContainText('1 consultation / 5');
  await shot(page, 'shares', info);
  await expect(item).toContainText('Lecture seule');
  await expect(item).toContainText('Mot de passe');
  await menu(item, page, 'Journal d’accès');
  const journal = page.getByRole('dialog', { name: /Journal d’accès — Pour Julie/ });
  await expect(journal.getByTestId('share-events').getByRole('listitem')).toHaveCount(2);
  await shot(page, 'share-journal', info);
  await expect(journal.locator('[data-kind="open"][data-ok="true"]')).toContainText('Ouverture');
  await expect(journal.locator('[data-kind="password"][data-ok="false"]')).toContainText('Refusé');
  await expect(journal.locator('[data-kind="open"]')).toContainText(/10\.\d+\.\d+\.\d+/);
  await journal.getByRole('button', { name: 'Fermer' }).last().click();

  // --- edit ---
  await menu(item, page, 'Modifier les réglages');
  const edit = page.getByRole('dialog', { name: 'Réglages du lien' });
  await expect(edit.getByLabel('Libellé')).toHaveValue('Pour Julie');
  await shot(page, 'share-edit', info);
  await edit.getByLabel('Libellé').fill('Pour Julie B.');
  await edit.getByRole('switch', { name: 'Autoriser le téléchargement' }).click();
  await edit.getByLabel('Téléchargements max.').fill('3');
  await edit.getByRole('button', { name: 'Enregistrer' }).click();
  const edited = screen.getByTestId('share-item').filter({ hasText: 'Pour Julie B.' });
  await expect(edited).toContainText('Téléchargement autorisé');
  await expect(edited.getByTestId('share-counters')).toContainText('0 téléchargement / 3');

  // --- rotate: a new link once, the old one dead ---
  await menu(edited, page, 'Nouveau lien');
  await page.getByRole('dialog', { name: 'Nouveau lien' }).getByRole('button', { name: 'Générer un nouveau lien' }).click();
  const fresh = await page.getByTestId('link-once').getByRole('textbox', { name: 'Lien' }).inputValue();
  expect(fresh).not.toBe(url);
  await page.getByRole('button', { name: 'Terminé' }).click();
  await guest.goto(pathOf(url));
  await expect(guest.getByRole('heading', { name: 'Ce lien n’est pas disponible' })).toBeVisible();
  await guest.goto(pathOf(fresh));
  await expect(guest.getByRole('heading', { name: 'Ce contenu est protégé' })).toBeVisible();

  // --- revoke: immediate ---
  await menu(edited, page, 'Révoquer');
  await page.getByRole('dialog', { name: 'Révoquer' }).getByRole('button', { name: 'Révoquer' }).click();
  await expect(edited).toHaveAttribute('data-status', 'revoked');
  await guest.reload();
  await expect(guest.getByRole('heading', { name: 'Ce lien n’est pas disponible' })).toBeVisible();
  await guest.context().close();

  // --- filter by state, then delete ---
  await screen.getByRole('button', { name: /^Révoqué/ }).click();
  await expect(screen.getByTestId('share-item')).toHaveCount(1);
  await menu(edited, page, 'Supprimer');
  await page.getByRole('dialog', { name: 'Supprimer' }).getByRole('button', { name: 'Supprimer' }).click();
  await expect(screen.getByText('Pour Julie B.')).toHaveCount(0);
  expect((await call(page, 'GET', '/shares')).map((s: { label: string }) => s.label).sort()).toEqual(['Dossier pour le conseil', 'Premier lien']);
});

/** A depositor without a browser: the public endpoints, as the deposit page calls them. */
async function deposit(request: APIRequestContext, token: string, form: Record<string, unknown>, files: { name: string; body: Buffer }[]): Promise<{ ref: string; status: string }> {
  const headers = { 'X-SPD-CSRF': '1', Origin: BASE, 'X-Forwarded-For': clientIp() };
  const res = await request.post(`/api/v1/public/requests/${token}/submissions`, { headers, data: { ...form, files: files.map((f) => ({ name: f.name, size: f.body.length })) } });
  expect(res.status(), await res.text()).toBe(200);
  const sub = await res.json();
  const auth = { ...headers, Authorization: `Bearer ${sub.submissionToken}` };
  for (const [i, it] of sub.items.entries()) expect((await request.patch(`/api/v1/public/uploads/${it.uploadId}?offset=0`, { headers: { ...auth, 'Content-Type': 'application/octet-stream' }, data: files[i]!.body })).status()).toBe(200);
  expect((await request.post('/api/v1/public/submissions/finalize', { headers: auth, data: {} })).status()).toBe(200);
  for (let i = 0; i < 60; i++) {
    const s = await (await request.get('/api/v1/public/submissions/status', { headers: auth })).json();
    if (s.status === 'completed' || s.status === 'rejected') return { ref: sub.ref, status: s.status };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the deposit was not processed in time');
}

test('deposit portals: create with every section, pause, deposits and their journal, rotate, edit, revoke, delete', async ({ context, page, browser, request }, info) => {
  await apiSignUp(context, page);
  const clients = await call(page, 'POST', '/folders', { parentId: 'root', name: 'Clients' });
  const target = await call(page, 'POST', '/folders', { parentId: clients.id, name: 'Dossier Roy' });

  await page.goto('/requests');
  const screen = page.getByTestId('requests-screen');
  await expect(screen.getByRole('heading', { name: 'Aucun portail de dépôt' })).toBeVisible();
  await expect(screen.getByText(/Un portail est une page publique/)).toBeVisible();
  await screen.getByRole('button', { name: 'Nouveau portail' }).click();

  // --- folder picker: lazy tree, root included ---
  const picker = page.getByRole('dialog', { name: 'Dossier de destination' });
  await expect(picker.getByRole('button', { name: 'Mon Drive', exact: true })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Choisir ce dossier' })).toBeDisabled();
  await picker.getByRole('button', { name: 'Développer Clients' }).click();
  await picker.getByRole('button', { name: 'Dossier Roy', exact: true }).click();
  await picker.getByRole('button', { name: 'Choisir ce dossier' }).click();

  // --- every section of the form ---
  const form = page.getByRole('dialog', { name: 'Nouveau portail de dépôt' });
  await expect(form.getByText('Les fichiers déposés arrivent dans « Dossier Roy »')).toBeVisible();
  await expect(form.getByLabel('Taille max. par fichier')).toHaveValue('200'); // defaults are visible
  await expect(form.getByLabel('Volume total du portail')).toHaveValue('5');
  await form.getByRole('button', { name: 'Créer le portail' }).click();
  await expect(form.getByText('Donnez un titre au portail.')).toBeVisible();
  await form.getByLabel('Titre').fill('Pièces pour votre déclaration');
  await form.getByLabel('Description').fill('Déposez ici vos relevés et reçus.');
  await form.getByLabel('Consignes').fill('Un fichier par document.\nPDF de préférence.');
  await form.getByLabel('Nom affiché').fill('Cabinet Roy & associés');
  await form.getByRole('button', { name: '#0f766e' }).click();
  await expect(form.getByTestId('brand-preview')).toContainText('Pièces pour votre déclaration');
  await expect(form.getByTestId('brand-preview')).toContainText('Cabinet Roy & associés');
  await shot(page, 'portal-form-top', info);
  await form.getByLabel('Mot de passe (facultatif)').fill('depot-2026');
  const inTenDays = new Date(Date.now() + 10 * 86_400_000);
  await form.getByLabel('Date d’expiration').fill(`${inTenDays.getFullYear()}-${String(inTenDays.getMonth() + 1).padStart(2, '0')}-${String(inTenDays.getDate()).padStart(2, '0')}T17:00`);
  await form.getByLabel('Taille max. par fichier').fill('50');
  await form.getByLabel('Fichiers par dépôt').fill('5');
  await form.getByLabel('Volume total du portail').fill('1');
  await form.getByLabel('Nombre max. de dépôts').fill('10');
  await form.getByLabel('Dépôts par heure et par adresse').fill('6');
  await form.getByRole('button', { name: 'Documents', exact: true }).click();
  await form.getByLabel('Ajouter une extension').fill('exe');
  await form.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(form.getByText('.exe est un type exécutable : il est toujours refusé.')).toBeVisible();
  await form.getByLabel('Ajouter une extension').fill('.JPG, png');
  await form.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(form.getByTestId('ext-chips')).toContainText('.jpg');
  await expect(form.getByTestId('ext-chips')).toContainText('.pdf');
  await form.getByLabel('Nom', { exact: true }).selectOption('required');
  await form.getByLabel('Courriel', { exact: true }).selectOption('optional');
  await form.getByLabel('Référence', { exact: true }).selectOption('required');
  await form.getByRole('button', { name: 'Ajouter un champ personnalisé' }).click();
  await form.getByRole('textbox', { name: 'Champ personnalisé 1' }).fill('Numéro de client');
  await form.getByTestId('custom-field').getByRole('checkbox').check();
  await form.getByRole('switch', { name: 'Exiger un consentement' }).click();
  await form.getByLabel('Texte du consentement').fill('J’autorise le cabinet à traiter ces documents.');
  await form.getByLabel('Note de conservation').fill('Conservés 7 ans.');
  await expect(form.getByRole('switch', { name: 'Un sous-dossier par dépôt' })).toHaveAttribute('aria-checked', 'true');
  await expect(form.getByRole('switch', { name: 'Me notifier à chaque dépôt' })).toHaveAttribute('aria-checked', 'true');
  await form.getByLabel('Message de confirmation').fill('Merci, nous avons bien reçu vos pièces.');
  await shot(page, 'portal-form-bottom', info);
  await form.getByRole('button', { name: 'Créer le portail' }).click();

  // --- the link, once, with its QR code ---
  const created = page.getByRole('dialog', { name: 'Portail créé' });
  await expect(created.getByText(/il ne sera plus jamais affiché/)).toBeVisible();
  await expect(created.getByTestId('qr')).toBeVisible();
  await shot(page, 'portal-created', info);
  const url = await created.getByRole('textbox', { name: 'Lien' }).inputValue();
  expect(url).toMatch(/\/request\/[A-Za-z0-9_-]{43}$/);
  await created.getByRole('button', { name: 'Terminé' }).click();

  const [saved] = await call(page, 'GET', '/requests');
  expect(saved).toMatchObject({
    folderId: target.id, title: 'Pièces pour votre déclaration', description: 'Déposez ici vos relevés et reçus.', instructions: 'Un fichier par document.\nPDF de préférence.', brandName: 'Cabinet Roy & associés', brandColor: '#0f766e',
    hasPassword: true, active: true, maxFileBytes: 50 * 1024 ** 2, maxFilesPerSubmission: 5, maxTotalBytes: 1024 ** 3, maxSubmissions: 10, submissionsPerHour: 6, requireConsent: true,
    consentText: 'J’autorise le cabinet à traiter ces documents.', retentionNote: 'Conservés 7 ans.', subfolderPerSubmission: true, notifyOwner: true, confirmationMessage: 'Merci, nous avons bien reçu vos pièces.', state: 'open',
    fields: { name: 'required', email: 'optional', reference: 'required', custom: [{ key: 'numero_de_client', label: 'Numéro de client', required: true }] },
  });
  expect(saved.allowedExtensions).toEqual(expect.arrayContaining(['pdf', 'docx', 'jpg', 'png']));
  expect(new Date(saved.expiresAt).getTime()).toBeGreaterThan(Date.now() + 8 * 86_400_000);

  // --- the card, pause and reactivate ---
  const card = screen.getByTestId('portal-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('portal-state')).toHaveText('Ouvert');
  await expect(card.getByRole('link', { name: 'Dossier Roy' })).toHaveAttribute('href', `/folder/${target.id}`);
  await card.getByRole('button', { name: 'Mettre en pause' }).click();
  await expect(card.getByTestId('portal-state')).toHaveText('En pause');
  const guest = await visitor(browser, info);
  await guest.goto(pathOf(url));
  await expect(guest.getByRole('heading', { name: 'Ce portail n’accepte plus de dépôts' })).toBeVisible();
  await card.getByRole('button', { name: 'Réactiver' }).click();
  await expect(card.getByTestId('portal-state')).toHaveText('Ouvert');
  await guest.reload();
  await expect(guest.getByRole('heading', { level: 1, name: 'Pièces pour votre déclaration' })).toBeVisible();
  await expect(guest.getByTestId('portal-banner')).toContainText('Cabinet Roy & associés');
  await expect(guest.getByTestId('portal-banner')).toHaveCSS('background-color', 'rgb(15, 118, 110)'); // the portal's accent colour
  await expect(guest.getByTestId('portal-banner')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(guest.getByLabel('Numéro de client')).toBeVisible();

  // --- a deposit: one good file, one program disguised as an image ---
  const token = pathOf(url).split('/').pop()!;
  const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'), Buffer.alloc(1024, 1)]);
  const done = await deposit(request, token, { password: 'depot-2026', name: 'Hélène Roy', email: 'helene@example.test', reference: 'T1-2025', custom: { numero_de_client: 'C-0077' }, consent: true },
    [{ name: 'T4.pdf', body: Buffer.from('%PDF-1.4\n%%EOF\n') }, { name: 'photo.jpg', body: exe }]);
  expect(done.status).toBe('completed');

  // --- the deposits of the portal ---
  await card.getByRole('button', { name: 'Voir les dépôts' }).click();
  const detail = page.getByTestId('request-detail');
  await expect(detail.getByRole('heading', { level: 1, name: 'Pièces pour votre déclaration' })).toBeVisible();
  await expect(detail.getByTestId('portal-facts')).toContainText('50 Mo par fichier');
  await expect(detail.getByTestId('portal-facts')).toContainText('Numéro de client (obligatoire)');
  const row = detail.getByTestId('submissions').locator('tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(done.ref);
  await expect(row).toContainText('Hélène Roy');
  await expect(row).toContainText('Terminé');
  await expect(row).toContainText('1 accepté');
  await expect(row).toContainText('1 refusé');
  await shot(page, 'portal-detail', info);
  await expect(row.getByRole('link', { name: 'Ouvrir le dossier' })).toHaveAttribute('href', /\/folder\/[0-9a-f-]{36}$/);
  await row.getByRole('button', { name: `Détail du dépôt ${done.ref}` }).click();
  const sub = page.getByRole('dialog', { name: `Dépôt ${done.ref}` });
  await expect(sub.getByTestId('answers')).toContainText('Hélène Roy');
  await expect(sub.getByTestId('answers')).toContainText('T1-2025');
  await expect(sub.getByTestId('answers')).toContainText('Numéro de client');
  await expect(sub.getByTestId('answers')).toContainText('C-0077');
  await expect(sub.getByTestId('answers')).toContainText(/10\.\d+\.\d+\.\d+/);
  await expect(sub.getByTestId('sub-items').locator('[data-status="placed"]')).toContainText('T4.pdf');
  await expect(sub.getByTestId('sub-items').locator('[data-status="rejected"]')).toContainText('Refusé — le contenu est un programme ou un script.');
  const events = sub.getByTestId('sub-events').getByRole('listitem');
  await expect(events).toHaveCount(4);
  await expect(events.nth(0)).toContainText('Dépôt commencé : 2 fichier(s)');
  await expect(events.nth(1)).toContainText('Envoi terminé : 2 fichier(s)');
  await expect(events.nth(2)).toContainText('« photo.jpg » refusé');
  await expect(events.nth(3)).toContainText('Dépôt terminé : 1 fichier(s) rangé(s), 1 refusé(s).');
  await shot(page, 'submission', info);
  await sub.getByRole('button', { name: 'Fermer' }).last().click();

  // --- rotate from the list: new link once, old link dead ---
  await detail.getByRole('link', { name: 'Portails de dépôt' }).click();
  await expect(card.getByTestId('portal-deposits')).toHaveText('1 / 10');
  await shot(page, 'requests', info);
  await menu(card, page, 'Nouveau lien');
  await page.getByRole('dialog', { name: 'Générer un nouveau lien' }).getByRole('button', { name: 'Générer un nouveau lien' }).click();
  const fresh = await page.getByTestId('link-once').getByRole('textbox', { name: 'Lien' }).inputValue();
  expect(fresh).not.toBe(url);
  await expect(page.getByTestId('qr')).toBeVisible();
  await page.getByRole('button', { name: 'Terminé' }).click();
  await guest.goto(pathOf(url));
  await expect(guest.getByRole('heading', { name: 'Ce lien de dépôt n’est pas disponible' })).toBeVisible();
  await guest.goto(pathOf(fresh));
  await expect(guest.getByRole('heading', { level: 1, name: 'Pièces pour votre déclaration' })).toBeVisible();

  // --- edit: values are back, the link is not ---
  await menu(card, page, 'Modifier');
  const edit = page.getByRole('dialog', { name: 'Modifier le portail' });
  await expect(edit.getByLabel('Titre')).toHaveValue('Pièces pour votre déclaration');
  await expect(edit.getByRole('textbox', { name: 'Champ personnalisé 1' })).toHaveValue('Numéro de client');
  await expect(edit.getByTestId('link-once')).toHaveCount(0);
  await expect(edit.getByText(/Le lien public ne peut pas être réaffiché/)).toBeVisible();
  await expect(edit.getByRole('button', { name: 'Générer un nouveau lien' })).toBeVisible();
  await edit.getByLabel('Titre').fill('Pièces — déclaration 2025');
  await edit.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(card.getByRole('link', { name: 'Pièces — déclaration 2025' })).toBeVisible();
  const [after] = await call(page, 'GET', '/requests');
  expect(after).toMatchObject({ title: 'Pièces — déclaration 2025', hasPassword: true, maxSubmissions: 10, fields: { custom: [{ key: 'numero_de_client' }] } });
  expect(after.expiresAt).toBe(saved.expiresAt);

  // --- revoke, then delete ---
  await menu(card, page, 'Révoquer');
  const revoke = page.getByRole('dialog', { name: 'Révoquer le portail' });
  await expect(revoke.getByText(/refusés à leur prochain bloc/)).toBeVisible();
  await revoke.getByRole('button', { name: 'Révoquer' }).click();
  await expect(card.getByTestId('portal-state')).toHaveText('Révoqué');
  await expect(card.getByRole('button', { name: 'Mettre en pause' })).toHaveCount(0);
  await guest.reload();
  await expect(guest.getByRole('heading', { name: 'Ce lien de dépôt n’est pas disponible' })).toBeVisible();
  await guest.context().close();
  await menu(card, page, 'Supprimer');
  const purge = page.getByRole('dialog', { name: 'Supprimer le portail' });
  await expect(purge.getByText(/Les fichiers déjà déposés restent dans votre dossier/)).toBeVisible();
  await purge.getByRole('button', { name: 'Supprimer' }).click();
  await expect(screen.getByRole('heading', { name: 'Aucun portail de dépôt' })).toBeVisible();
  // the deposited file is still in the owner's folder
  const inTarget = await call(page, 'GET', `/folders/${target.id}`);
  expect(inTarget.folders).toHaveLength(1);
  expect((await call(page, 'GET', `/folders/${inTarget.folders[0].id}`)).files.map((f: { name: string }) => f.name)).toEqual(['T4.pdf']);
});
