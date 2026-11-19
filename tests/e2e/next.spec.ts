// SP Drive 2.0, end to end against the development stack: live refresh, search in content, command palette,
// collections, activity, versions, storage, private sharing, transfer centre, devices, infrastructure, portal builder,
// and — when the stack was started with SPD_DEV_AI=fake — the AI screens against the fake endpoint (not a real model).
import { expect, type Page, test } from '@playwright/test';
import { apiSignUp } from './helpers.ts';
import { call, fixture, indexed, secondAccount, upload } from './next-helpers.ts';

test.use({ locale: 'fr-CA' });
const row = (page: Page, name: string) => page.locator(`[role=row][data-id]:has([data-name]:text-is("${name}"))`);
const act = async (page: Page, name: string, action: string | RegExp) => { await row(page, name).locator('[data-more]').click(); await page.getByRole('menuitem', { name: action }).click(); };
const rootId = async (page: Page) => (await call(page, 'GET', '/folders/root')).folder.id as string;
const features = async (page: Page) => (await call<{ features: string[] }>(page, 'GET', '/meta')).features;
async function start(page: Page, context: Parameters<typeof apiSignUp>[0], o: { admin?: boolean } = {}) {
  const who = await apiSignUp(context, page, o);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return who;
}

test('live refresh: a change made elsewhere appears without reloading; the stream falls back to polling', async ({ page, context }) => {
  await start(page, context);
  await expect(page.locator('html')).toHaveAttribute('data-live', 'live');
  const other = await context.newPage(); // the same account in another tab
  await other.goto('/pwa/favicon.svg');
  await upload(other, await rootId(other), 'arrive-seul.txt', 'bonjour');
  await expect(row(page, 'arrive-seul.txt')).toBeVisible({ timeout: 8000 });
  await call(other, 'POST', '/folders', { parentId: await rootId(other), name: 'Créé ailleurs' });
  await expect(row(page, 'Créé ailleurs')).toBeVisible({ timeout: 8000 });
  // the stream cannot be opened: the application says so and polls instead
  const cut = await context.newPage();
  await cut.route('**/api/v1/sync/events', (r) => r.abort());
  await cut.goto('/');
  await expect(cut.locator('html')).toHaveAttribute('data-live', 'polling');
});

test('search: content with highlighted snippets, name-only filter, PDF page jump, search by meaning', async ({ page, context }, info) => {
  await start(page, context);
  const root = await rootId(page);
  const note = await upload(page, root, 'Compte rendu.txt', 'Ordre du jour\nLe budget de la coopérative Hirondelle est adopté.\n');
  const pdf = await upload(page, root, 'Faune.pdf', fixture('sample.pdf'));
  await indexed(page, note.id); await indexed(page, pdf.id);
  await page.goto('/search?q=hirondelle');
  const hit = row(page, 'Compte rendu.txt');
  await expect(hit.getByTestId('snippet').locator('mark')).toHaveText(/hirondelle/i);
  // the same word only in names: nothing
  await page.goto('/search?q=hirondelle&in=name');
  await expect(page.getByRole('heading', { name: 'Aucun résultat' })).toBeVisible();
  await page.getByRole('button', { name: 'Retirer les filtres' }).click();
  await expect(hit).toBeVisible();
  // a word of page 2 of the PDF: the result names the page and the viewer opens there
  await page.goto('/search?q=castor');
  if ((await features(page)).includes('semantic')) {
    await page.getByTestId('search-mode').getByRole('button', { name: 'Par le sens' }).click();
    await expect(page.getByTestId('semantic-note')).toContainText('Seul l’ordre compte');
    await expect(page.getByTestId('semantic-hit').first()).toBeVisible();
    await expect(page.getByTestId('semantic-results')).not.toContainText('%'); // the score is never shown
    await expect(page.getByTestId('semantic-results')).not.toContainText(/0[.,]\d{2}/);
    await page.getByTestId('search-mode').getByRole('button', { name: 'Par les mots' }).click();
  }
  const pdfRow = row(page, 'Faune.pdf');
  await expect(pdfRow.getByTestId('match')).toContainText('p. 2');
  if (info.project.name === 'mobile') await pdfRow.locator('[data-name]').tap(); else await pdfRow.dblclick();
  await expect(page.getByTestId('viewer')).toBeVisible();
  await expect(page.getByTestId('pdf-page-input')).toHaveValue('2', { timeout: 20_000 });
  await page.getByTestId('viewer-close').click();
});

test('command palette: real commands on the folder and the selection, files found by their content', async ({ page, context }, info) => {
  await start(page, context);
  const root = await rootId(page);
  const f = await upload(page, root, 'Bail.txt', 'Le dépôt de garantie est de 500 dollars.');
  await indexed(page, f.id);
  await page.reload();
  await expect(row(page, 'Bail.txt')).toBeVisible();
  const palette = page.getByRole('dialog', { name: 'Commandes' });
  const run = async (text: string, option: string | RegExp) => { await page.keyboard.press('Control+k'); await palette.getByRole('combobox').fill(text); await palette.getByRole('option', { name: option }).first().click(); await expect(palette).toHaveCount(0); };
  await run('nouveau dos', 'Nouveau dossier');
  await page.getByLabel('Nom du dossier').fill('Depuis la palette');
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(row(page, 'Depuis la palette')).toBeVisible();
  // content search inside the palette, with the passage
  await page.keyboard.press('Control+k');
  await palette.getByRole('combobox').fill('garantie');
  await expect(palette.getByRole('option', { name: /Bail\.txt/ }).getByTestId('snippet').locator('mark')).toHaveText(/garantie/i);
  await palette.getByRole('option', { name: /Bail\.txt/ }).click();
  await expect(page.getByTestId('viewer-name')).toHaveText('Bail.txt');
  await page.getByTestId('viewer-close').click();
  // selection commands (a mouse selection: desktop)
  if (info.project.name === 'desktop') {
    await row(page, 'Bail.txt').click();
    await run('déplacer', /Déplacer l’élément sélectionné/);
    await expect(page.getByRole('dialog', { name: /Déplacer 1 élément/ })).toBeVisible();
    await page.getByRole('button', { name: 'Annuler' }).click();
    await row(page, 'Bail.txt').click();
    await run('lien', /Créer un lien de partage pour « Bail\.txt »/);
    await expect(page.getByRole('dialog', { name: /Bail\.txt/ })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await run('doublons', 'Trouver les doublons');
  await expect(page).toHaveURL(/\/duplicates$/);
  await run('transferts', 'Ouvrir les transferts');
  await expect(page.getByTestId('upload-panel')).toBeVisible();
});

test('smart collections: build a rule with a live preview, open it from the sidebar, edit, delete', async ({ page, context }, info) => {
  await start(page, context);
  const root = await rootId(page);
  await upload(page, root, 'Facture mars.pdf', fixture('sample.pdf'));
  await upload(page, root, 'Notes.txt', 'rien');
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Commandes' }).getByRole('combobox').fill('nouvelle coll');
  await page.keyboard.press('Enter');
  const dlg = page.getByTestId('collection-dialog');
  await dlg.getByLabel('Nom', { exact: true }).fill('Mes PDF');
  await expect(dlg.getByTestId('preview-total')).toHaveText('1 fichier'); // the default condition: type is PDF
  await expect(dlg.getByTestId('collection-preview')).toContainText('Facture mars.pdf');
  await dlg.getByRole('button', { name: 'Ajouter une condition' }).click();
  await dlg.getByTestId('condition').nth(1).getByLabel('Valeur').fill('zzz');
  await expect(dlg.getByTestId('preview-total')).toHaveText('0 fichier');
  await dlg.getByTestId('condition').nth(1).getByRole('button', { name: 'Retirer cette condition' }).click();
  await expect(dlg.getByTestId('preview-total')).toHaveText('1 fichier');
  await dlg.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(page).toHaveURL(/\/collections\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Mes PDF' })).toBeVisible();
  await expect(page.getByTestId('collection-items')).toContainText('Facture mars.pdf');
  await expect(page.getByTestId('collection-items')).not.toContainText('Notes.txt');
  if (info.project.name === 'desktop') await expect(page.getByTestId('collections-nav').getByRole('link', { name: /Mes PDF/ })).toHaveAttribute('aria-current', 'page');
  // edit: any file whose name contains "notes"
  await page.getByRole('button', { name: 'Modifier la règle' }).click();
  await dlg.getByLabel('Critère').selectOption('name');
  await dlg.getByLabel('Valeur').fill('notes');
  await expect(dlg.getByTestId('collection-preview')).toContainText('Notes.txt');
  await dlg.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByTestId('collection-items')).toContainText('Notes.txt');
  await page.getByRole('button', { name: 'Supprimer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await call(page, 'GET', '/collections')).toHaveLength(0);
  await expect(row(page, 'Notes.txt')).toBeVisible(); // only the rule went away
});

test('activity and extracted text: the inspector tells the story of a file; the account page names what changed', async ({ page, context }) => {
  await start(page, context);
  const root = await rootId(page);
  const f = await upload(page, root, 'journal.txt', 'première ligne');
  await indexed(page, f.id);
  await call(page, 'PATCH', `/files/${f.id}`, { name: 'journal de bord.txt' });
  await page.reload();
  await act(page, 'journal de bord.txt', 'Détails');
  const insp = page.getByTestId('details');
  await insp.getByRole('tab', { name: 'Activité' }).click();
  await expect(insp.getByTestId('timeline').locator('[data-action="file.renamed"]')).toContainText('Renommé (avant : « journal.txt »)');
  await expect(insp.getByTestId('timeline').locator('[data-action="file.uploaded"]')).toContainText('Fichier envoyé');
  await insp.getByRole('tab', { name: 'Texte' }).click();
  await expect(insp.getByTestId('text-status')).toHaveAttribute('data-status', 'ready');
  await expect(insp.getByTestId('text-excerpt')).toHaveText('première ligne');
  await page.goto('/activity');
  await expect(page.getByTestId('timeline').locator('[data-action="file.renamed"]')).toContainText('« journal.txt » renommé en « journal de bord.txt »');
});

test('versions: timeline, real line diff, restore adds a version, binary formats say they cannot be compared', async ({ page, context }) => {
  await start(page, context);
  const root = await rootId(page);
  const f = await upload(page, root, 'contrat.md', '# Contrat\n\nDépôt de 500 dollars.\nFin.\n');
  await upload(page, root, 'contrat.md', '# Contrat\n\nDépôt de 650 dollars.\nMénage inclus.\nFin.\n', { fileId: f.id });
  const b = await upload(page, root, 'donnees.bin', Buffer.from([1, 2, 3, 4]));
  await upload(page, root, 'donnees.bin', Buffer.from([1, 2, 3, 5, 6]), { fileId: b.id });
  await page.reload();
  await act(page, 'contrat.md', 'Historique des versions');
  const tm = page.getByTestId('time-machine');
  await expect(tm.getByTestId('tm-version')).toHaveCount(2);
  await expect(tm.getByTestId('tm-added')).toContainText('+2');
  await expect(tm.getByTestId('tm-removed')).toContainText('−1');
  await expect(tm.locator('[data-op=del]')).toContainText('Dépôt de 500 dollars.');
  await expect(tm.locator('[data-op=add]').first()).toContainText('Dépôt de 650 dollars.');
  await expect(tm.getByTestId('tm-restore-note')).toContainText('devient une nouvelle version 3');
  await tm.getByTestId('tm-restore').click();
  await expect(tm.getByTestId('tm-version')).toHaveCount(3);
  expect((await call(page, 'GET', `/files/${f.id}/versions`)).versions).toHaveLength(3); // nothing was deleted
  await page.keyboard.press('Escape');
  await act(page, 'donnees.bin', 'Historique des versions');
  await expect(tm.getByTestId('tm-binary')).toContainText('ne peut pas être comparé');
  await expect(tm.getByTestId('tm-binary')).toContainText('Empreintes différentes');
});

test('storage: quota, kinds, drill-down by folder, largest files, duplicates with different names', async ({ page, context }) => {
  await start(page, context);
  const root = await rootId(page);
  const photos = (await call(page, 'POST', '/folders', { parentId: root, name: 'Photos' })).id;
  const sub = (await call(page, 'POST', '/folders', { parentId: photos, name: 'Été' })).id;
  await upload(page, sub, 'lac.jpg', fixture('sample.jpg'));
  await upload(page, photos, 'sommet.png', fixture('sample.png'));
  await upload(page, root, 'a.txt', 'même contenu'); await upload(page, root, 'b.txt', 'même contenu');
  await page.goto('/storage');
  await expect(page.getByTestId('fig-files')).toContainText('4');
  await expect(page.getByTestId('storage-kinds').locator('[data-kind=image]')).toContainText('2 fichiers');
  await expect(page.getByTestId('storage-largest').getByRole('link').first()).toBeVisible();
  await page.getByTestId('treemap-cell').filter({ has: page.locator('rect') }).first().click(); // the largest cell: Photos
  await expect(page.getByTestId('storage-crumbs')).toContainText('Photos');
  await page.locator('[data-testid=treemap-cell][role=button]').first().click();
  await expect(page.getByTestId('storage-crumbs')).toContainText('Été');
  await page.getByTestId('storage-crumbs').getByRole('button', { name: 'Mon Drive' }).click();
  await expect(page.getByTestId('storage-crumbs')).not.toContainText('Été');
  await expect(page.getByTestId('storage-dups')).toContainText('1 groupe');
  await page.getByTestId('storage-dups').getByRole('link', { name: 'Examiner les doublons' }).click();
  await expect(page.getByTestId('dup-group')).toHaveCount(1);
  await expect(page.getByTestId('distinct-names')).toHaveText('Même contenu, noms différents');
  expect((await call(page, 'GET', '/trash')).files).toHaveLength(0); // nothing is ever deleted by itself
  if ((await features(page)).includes('similar-images')) { await page.getByTestId('dup-modes').getByRole('tab', { name: 'Images semblables' }).click(); await expect(page.getByText(/Aucune image semblable|groupe d’images semblables/).first()).toBeVisible(); }
});

test('private sharing: invite an account, roles decide what the member can do, revocation is immediate', async ({ page, context, browser }, info) => {
  await start(page, context);
  const root = await rootId(page);
  const folder = (await call(page, 'POST', '/folders', { parentId: root, name: 'Équipe' })).id as string;
  await upload(page, folder, 'Charte.txt', 'La charte de l’équipe.');
  const bob = await secondAccount(browser, info);
  await page.reload();
  await act(page, 'Équipe', 'Membres et accès');
  const dlg = page.getByTestId('members-dialog');
  await dlg.getByLabel('Inviter un compte SP Drive').fill('personne@example.test');
  await dlg.getByRole('button', { name: 'Ajouter' }).click();
  await expect(dlg.getByRole('alert')).toContainText('Aucun compte ne correspond');
  await dlg.getByLabel('Inviter un compte SP Drive').fill(bob.email);
  await dlg.getByRole('button', { name: 'Ajouter' }).click();
  await expect(dlg.getByTestId('member')).toHaveCount(1);
  await dlg.getByLabel('Nom de l’espace de travail').fill('Atelier commun');
  await dlg.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Nom de l’espace de travail enregistré.')).toBeVisible();
  // the member: sees the workspace, reads, cannot write
  await bob.page.goto('/shared');
  await bob.page.getByTestId('grant').filter({ hasText: 'Atelier commun' }).click();
  const browser2 = bob.page.getByTestId('shared-browser');
  await expect(browser2).toHaveAttribute('data-role', 'viewer');
  await expect(bob.page.getByTestId('shared-row')).toContainText('Charte.txt');
  await expect(bob.page.getByRole('button', { name: 'Envoyer des fichiers' })).toHaveCount(0);
  await bob.page.getByTestId('shared-row').getByRole('button', { name: /Charte\.txt/ }).first().click();
  await expect(bob.page.getByTestId('text-block').first()).toContainText('La charte de l’équipe.');
  await bob.page.getByTestId('viewer-close').click();
  // editor: creates a folder and sends a file; the owner sees both, with who did it
  await dlg.getByLabel('Rôle de E2E').selectOption('editor');
  await expect(dlg.getByTestId('member')).toHaveAttribute('data-role', 'editor');
  await bob.page.reload();
  await expect(browser2).toHaveAttribute('data-role', 'editor');
  await bob.page.getByRole('button', { name: 'Nouveau dossier' }).click();
  await bob.page.getByLabel('Nom du dossier').fill('De Bob');
  await bob.page.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(bob.page.getByTestId('shared-row').filter({ hasText: 'De Bob' })).toBeVisible();
  await bob.page.getByTestId('shared-upload-input').setInputFiles({ name: 'apport.txt', mimeType: 'text/plain', buffer: Buffer.from('envoyé par le membre') });
  await expect(bob.page.getByTestId('upload-panel')).toContainText('1 fichier téléversé');
  await expect(bob.page.getByTestId('shared-row').filter({ hasText: 'apport.txt' })).toBeVisible();
  // uploader: only a surface to send files in
  await dlg.getByLabel('Rôle de E2E').selectOption('uploader');
  await expect(dlg.getByTestId('member')).toHaveAttribute('data-role', 'uploader');
  await bob.page.goto('/shared');
  await bob.page.getByTestId('grant').click();
  await expect(bob.page.getByTestId('upload-surface')).toBeVisible();
  await expect(bob.page.getByTestId('shared-row')).toHaveCount(0);
  await bob.page.getByTestId('shared-upload-input').setInputFiles({ name: 'depot.txt', mimeType: 'text/plain', buffer: Buffer.from('déposé') });
  await expect(bob.page.getByTestId('uploader-status')).toContainText('1 envoyé sur 1');
  const inFolder = (await call(page, 'GET', `/folders/${folder}`)) as { files: { name: string }[]; folders: { name: string }[] };
  expect(inFolder.files.map((f) => f.name).sort()).toEqual(['Charte.txt', 'apport.txt', 'depot.txt']);
  expect(inFolder.folders.map((f) => f.name)).toEqual(['De Bob']);
  await dlg.getByRole('tab', { name: 'Activité du dossier' }).click();
  await expect(dlg.getByTestId('timeline')).toContainText('via un dossier partagé');
  await dlg.getByRole('tab', { name: 'Membres' }).click();
  // revoke
  await dlg.getByRole('button', { name: 'Retirer E2E' }).click();
  await page.getByRole('dialog', { name: 'Retirer E2E ?' }).getByRole('button', { name: 'Retirer' }).click();
  await expect(dlg.getByTestId('member')).toHaveCount(0);
  await bob.page.reload();
  await expect(bob.page.getByTestId('shared-gone')).toBeVisible();
  await bob.context.close();
});

test('transfer centre from any screen, upload history, devices dashboard, administrator infrastructure', async ({ page, context }) => {
  await start(page, context, { admin: true });
  await upload(page, await rootId(page), 'hier.txt', 'déjà envoyé');
  await page.goto('/storage');
  await page.getByTestId('transfer-button').click();
  const centre = page.getByTestId('upload-panel');
  await expect(centre).toContainText('Rien ne voyage');
  await centre.getByTestId('transfer-input').setInputFiles({ name: 'depuis-le-centre.txt', mimeType: 'text/plain', buffer: Buffer.from('envoyé hors de l’explorateur') });
  await expect(centre).toContainText('1 fichier téléversé');
  if ((await features(page)).includes('upload-history')) {
    await centre.getByRole('tab', { name: 'Historique' }).click();
    await expect(centre.getByTestId('upload-history')).toContainText('hier.txt');
    await expect(centre.getByTestId('upload-history')).toContainText('depuis-le-centre.txt');
  }
  expect(((await call(page, 'GET', '/folders/root')) as { files: { name: string }[] }).files.map((f) => f.name)).toContain('depuis-le-centre.txt');
  await page.goto('/settings/appareils');
  await expect(page.getByTestId('devices-summary')).toContainText('Sessions');
  await expect(page.locator('[data-testid=session][data-current]')).toHaveCount(1);
  await page.goto('/admin');
  const infra = page.getByTestId('infrastructure');
  await expect(infra.getByTestId('infra-worker')).toContainText(/Actif|Silencieux/);
  await expect(infra.getByTestId('infra-index')).toBeVisible();
  await expect(infra.getByTestId('infra-backup')).toContainText('Dernière sauvegarde');
});

test('portal builder: the live preview follows the form', async ({ page, context }, info) => {
  test.skip(info.project.name === 'mobile', 'the side-by-side preview is the desktop layout; the phone shows it folded');
  await start(page, context);
  await call(page, 'POST', '/folders', { parentId: await rootId(page), name: 'Dépôts' });
  await page.reload();
  await act(page, 'Dépôts', 'Créer un portail de dépôt');
  const pv = page.getByTestId('portal-preview');
  await page.getByTestId('portal-form').getByLabel('Titre', { exact: false }).first().fill('Pièces du dossier 4471');
  await expect(pv.getByTestId('pp-title')).toHaveText('Pièces du dossier 4471');
  await expect(pv.getByTestId('pp-rules')).toContainText('Tous les types de fichiers');
  await page.getByTestId('portal-form').getByRole('switch', { name: 'Exiger un consentement' }).click();
  await expect(pv.getByTestId('pp-consent')).toBeVisible();
  await pv.getByRole('tab', { name: 'Après l’envoi' }).click();
  await expect(pv.getByTestId('pp-done')).toContainText('Dépôt reçu');
});

test('AI is explicit when it is not configured (answers of /ai/providers replaced for this test)', async ({ page, context }) => {
  await start(page, context);
  const off = { enabled: false, externalAllowed: false, external: { server: false, account: false }, default: null, providers: [{ id: 'maclustr', label: 'MacLustr (local)', local: true, configured: false, usable: false, models: [] }] };
  await page.route('**/api/v1/ai/providers', (r) => r.fulfill({ json: off }));
  await page.goto('/ask');
  await expect(page.getByTestId('ai-unavailable')).toContainText('L’IA n’est pas configurée');
  await expect(page.getByRole('textbox', { name: 'Votre question' })).toHaveCount(0);
  await page.unroute('**/api/v1/ai/providers');
  await page.route('**/api/v1/ai/providers', (r) => r.fulfill({ json: { ...off, external: { server: true, account: false }, providers: [{ id: 'anthropic', label: 'Anthropic', local: false, configured: true, usable: false, models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5', creator: 'Anthropic' }] }] } }));
  await page.reload();
  await expect(page.getByTestId('ai-unavailable')).toContainText('Fournisseurs externes non autorisés');
  await page.getByRole('link', { name: 'Ouvrir les réglages' }).click();
  await page.unroute('**/api/v1/ai/providers');
  // the real switch of the account, with its privacy explanation
  const ai = page.getByTestId('ai-settings');
  await expect(ai).toContainText('les passages retrouvés dans vos documents sont envoyés à ce fournisseur');
  await ai.getByRole('switch', { name: 'Autoriser les fournisseurs d’IA externes' }).click();
  await expect(ai.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  expect((await call(page, 'GET', '/ai/providers')).external.account).toBe(true);
});

test('AI against the fake endpoint: streamed answer with citations that open the file, ask this document, suggestions applied one by one', async ({ page, context }, info) => {
  await start(page, context);
  test.skip(!(await features(page)).includes('ai'), 'the stack was not started with SPD_DEV_AI=fake');
  const root = await rootId(page);
  const f = await upload(page, root, 'Contrat chalet.md', '# Contrat de location\n\nLe locataire verse un dépôt de 500 dollars avant le 1er juin.\n');
  const g = await upload(page, root, 'photo.bin', Buffer.from([0, 1, 2]));
  await indexed(page, f.id);
  await page.goto('/ask');
  await expect(page.getByTestId('ai-route')).toContainText('Modèle conçu par Alibaba');
  await expect(page.getByTestId('ai-route')).toContainText('servi sur le cluster MacLustr');
  await page.getByRole('textbox', { name: 'Votre question' }).fill('Quel est le montant du dépôt ?');
  await page.getByRole('button', { name: 'Demander' }).click();
  const turn = page.getByTestId('ai-turn').first();
  await expect(turn).toHaveAttribute('data-state', 'done');
  await expect(turn.getByTestId('ai-answer')).toContainText('serveur factice');
  await expect(turn.getByTestId('ai-sources')).toContainText('Contrat chalet.md');
  await turn.getByTestId('ai-answer').getByRole('button', { name: 'Source 1' }).click();
  await turn.getByTestId('ai-sources').getByRole('link').first().click();
  await expect(page.getByTestId('viewer-name')).toHaveText('Contrat chalet.md'); // the citation opens the cited file
  await page.getByTestId('viewer-close').click();
  // nothing retrieved: said plainly, no model called
  await page.goto('/ask');
  await page.getByRole('textbox', { name: 'Votre question' }).fill('xylophone zeppelin');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ai-empty')).toContainText('aucun modèle n’a été interrogé');
  // ask this document, from the viewer
  await page.goto(`/open/${f.id}`);
  await page.getByTestId('viewer-ask').click();
  const side = page.getByTestId('viewer-side');
  await side.getByRole('textbox', { name: 'Votre question' }).fill('Résume ce document');
  await side.getByRole('button', { name: 'Demander' }).click();
  await expect(side.getByTestId('ai-turn')).toHaveAttribute('data-state', 'done');
  await expect(side.getByTestId('ai-sources')).toContainText('Contrat chalet.md');
  await page.getByTestId('viewer-close').click();
  // suggestions: a review list, applied item by item
  void g;
  await page.goto('/');
  await act(page, 'Contrat chalet.md', 'Suggestions de rangement (IA)');
  const sug = page.getByTestId('suggest-dialog');
  const name = sug.locator('[data-testid=suggestion][data-part=name]');
  await expect(name).toContainText('Classé – Contrat chalet.md');
  expect(((await call(page, 'GET', '/folders/root')) as { files: { name: string }[] }).files.map((x) => x.name)).toContain('Contrat chalet.md'); // nothing applied yet
  await sug.locator('[data-testid=suggestion][data-part=tags]').getByRole('button', { name: 'Ignorer' }).click();
  await name.getByRole('button', { name: 'Appliquer' }).click();
  await expect(name).toHaveAttribute('data-state', 'applied');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Classé – Contrat chalet.md')).toBeVisible();
  expect(await call(page, 'GET', '/tags')).toHaveLength(0); // the ignored proposal changed nothing
  void info;
});
