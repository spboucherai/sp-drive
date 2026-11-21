/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : tests/e2e/account.spec.ts
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

// Account life cycle through the real screens: invitation, registration, recovery codes, sign-out, sign-in, a second
// passkey, session revocation, recovery into the enrolment step; and the administrator's invitation and quota flows.
import { createHmac } from 'node:crypto';
import { type BrowserContext, type CDPSession, expect, type Page, test } from '@playwright/test';
import { apiSignUp, inviteUrl } from './helpers.ts';

test.use({ locale: 'fr-CA' });

interface Credential { credentialId: string; isResidentCredential: boolean; rpId?: string; privateKey: string; userHandle?: string; signCount: number }
/** A virtual platform authenticator whose credentials can be read, copied and cleared (helpers.ts keeps no handle on its own). */
async function authenticator(context: BrowserContext, page: Page): Promise<{ cdp: CDPSession; id: string; credentials(): Promise<Credential[]>; add(c: Credential): Promise<void>; clear(): Promise<void> }> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId: id } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return {
    cdp, id,
    credentials: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId: id })).credentials as Credential[],
    add: async (credential) => { await cdp.send('WebAuthn.addCredential', { authenticatorId: id, credential }); },
    clear: async () => { await cdp.send('WebAuthn.clearCredentials', { authenticatorId: id }); },
  };
}
/** RFC 6238 code (SHA-1, 6 digits, 30 s) for a base32 secret, as an authenticator app computes it. */
function totp(secret: string, at = Date.now()): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const signOut = async (page: Page) => {
  await page.getByRole('button', { name: /^Compte de / }).click();
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/login$/);
};
const signIn = async (page: Page) => {
  await page.getByRole('button', { name: 'Se connecter avec une passkey' }).click();
  await expect(page.getByRole('button', { name: /^Compte de / })).toBeVisible();
};

test('invitation, passkeys, sessions and recovery', async ({ page, context, browser }) => {
  const { email, token } = inviteUrl();
  const auth = await authenticator(context, page);

  // --- invitation → registration → recovery codes shown once ---
  await page.goto(`/invite/${token}`);
  await expect(page.getByText(email)).toBeVisible();
  await page.getByLabel('Votre nom').fill('Camille Tremblay');
  await expect(page.getByLabel('Nom de la passkey')).not.toHaveValue('');
  await page.getByLabel('Nom de la passkey').fill('Premier appareil');
  await page.getByRole('button', { name: 'Créer mon compte avec une passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Vos codes de récupération' })).toBeVisible();
  const codes = await page.getByTestId('recovery-codes').locator('li span.select-all').allTextContents();
  expect(codes).toHaveLength(10);
  for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Télécharger (.txt)' }).click()]);
  expect(download.suggestedFilename()).toBe('sp-drive-codes-recuperation.txt');
  const finish = page.getByRole('button', { name: 'Continuer vers mes fichiers' });
  await expect(finish).toBeDisabled();
  await page.getByLabel('J’ai conservé ces codes').check();
  await finish.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Compte de Camille Tremblay' })).toBeVisible();
  // a used invitation says so
  const other = await context.newPage();
  await other.goto(`/invite/${token}`);
  await expect(other.getByRole('heading', { name: 'Invitation invalide ou expirée' })).toBeVisible();
  await other.close();

  // --- sign out, then sign in with the passkey; a deep link survives the sign-in ---
  await signOut(page);
  await page.goto('/settings/securite');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fsecurite$/);
  await signIn(page);
  await expect(page).toHaveURL(/\/settings\/securite$/);
  await expect(page.getByTestId('passkey')).toHaveCount(1);
  await expect(page.getByTestId('codes-left')).toContainText('10 / 10');
  await expect(page.getByRole('button', { name: 'La dernière passkey ne peut pas être retirée' })).toBeDisabled();

  // --- a second passkey, on another authenticator (the first one would refuse a duplicate) ---
  const first = await auth.credentials();
  expect(first).toHaveLength(1);
  await auth.clear();
  await page.getByRole('button', { name: 'Ajouter' }).click();
  await page.getByLabel('Nom de la passkey').fill('Clé de secours');
  await page.getByRole('button', { name: 'Créer la passkey' }).click();
  await expect(page.getByTestId('passkey')).toHaveCount(2);
  await expect(page.getByTestId('passkey').filter({ hasText: 'Clé de secours' })).toBeVisible();
  // rename the first one
  await page.getByRole('button', { name: 'Renommer Premier appareil' }).click();
  await page.getByLabel('Nom de la passkey').fill('MacBook');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByTestId('passkey').filter({ hasText: 'MacBook' })).toBeVisible();

  // --- another device signs in with the first passkey; this one revokes it ---
  const ctx2 = await browser.newContext({ locale: 'fr-CA', viewport: page.viewportSize(), baseURL: new URL(page.url()).origin });
  const page2 = await ctx2.newPage();
  const auth2 = await authenticator(ctx2, page2);
  await auth2.add(first[0]!);
  await page2.goto('/login');
  await signIn(page2);
  await page.goto('/settings/appareils');
  await expect(page.getByTestId('session')).toHaveCount(2);
  await expect(page.locator('[data-testid=session][data-current]')).toContainText('Cet appareil');
  await page.locator('[data-testid=session]:not([data-current])').getByRole('button', { name: /^Révoquer/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Révoquer' }).click();
  await expect(page.getByTestId('session')).toHaveCount(1);
  await page2.goto('/recent');
  await expect(page2).toHaveURL(/\/login\?next=%2Frecent$/);

  // --- activity shows what happened, with human labels ---
  await page.goto('/settings/activite');
  await expect(page.locator('[data-action="account.passkey_added"]')).toContainText('Passkey ajoutée');
  await expect(page.locator('[data-action="account.session_revoked"]')).toContainText('Session révoquée');
  await expect(page.locator('[data-action="auth.login"]').first()).toContainText('Connexion par passkey');

  // --- recovery on the second device (no passkey left there): a code opens the enrolment step only ---
  await auth2.clear();
  await page2.goto('/recovery');
  await page2.getByLabel('Courriel').fill(email);
  // one attempt only: the recovery route allows 8 calls per 15 minutes and per address, shared by every run
  await page2.getByLabel('Code de récupération').fill(codes[3]!.toLowerCase());
  await page2.getByRole('button', { name: 'Continuer' }).click();
  await expect(page2.getByRole('heading', { name: 'Enregistrer une nouvelle passkey' })).toBeVisible();
  await page2.goto('/'); // a recovery session reaches nothing else
  await expect(page2).toHaveURL(/\/recovery$/);
  await page2.getByLabel('Nom de la passkey').fill('Nouveau téléphone');
  await page2.getByRole('button', { name: 'Enregistrer une passkey' }).click();
  await expect(page2).toHaveURL(/\/$/);
  await expect(page2.getByRole('button', { name: 'Compte de Camille Tremblay' })).toBeVisible();

  // --- the bell tells the story; codes left went down ---
  await expect(page2.getByTestId('unread-count')).toBeVisible();
  await page2.getByRole('button', { name: /^Notifications, \d+ non lues?$/ }).click();
  const panel = page2.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('Un code de récupération a servi à ouvrir votre compte.')).toBeVisible();
  await expect(panel.getByText('Une passkey a été ajoutée à votre compte.').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Tout marquer comme lu' }).click();
  await expect(page2.getByTestId('unread-count')).toHaveCount(0);
  await page2.keyboard.press('Escape');
  await page2.goto('/settings/securite');
  await expect(page2.getByTestId('passkey')).toHaveCount(3);
  await expect(page2.getByTestId('codes-left')).toContainText('9 / 10');
  await ctx2.close();
});

test('administrator: invitation created, quota edited, system state', async ({ page, context }) => {
  const { email } = await apiSignUp(context, page, { admin: true });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Administration', level: 1 })).toBeVisible();
  await expect(page.getByTestId('system')).toContainText('Base de données');
  await expect(page.getByTestId('system')).toContainText('Antivirus');

  // invitation: the link is shown once
  const guest = `guest-${Date.now()}@example.test`;
  await page.getByRole('button', { name: 'Inviter' }).click();
  await page.getByLabel('Courriel de la personne invitée').fill(guest);
  await page.getByLabel('Quota (Go)').fill('3');
  await page.getByRole('button', { name: 'Créer l’invitation' }).click();
  const link = await page.getByLabel('Lien d’invitation').inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);
  await expect(page.getByRole('dialog', { name: 'Invitation créée' }).locator(':focus')).toHaveCount(1); // focus moved into the new dialog
  await page.getByRole('button', { name: 'J’ai copié le lien' }).click();
  const invite = page.locator(`[data-testid=admin-invite][data-email="${guest}"]`);
  await expect(invite).toContainText('En attente');
  // the link really opens the registration screen for that address
  const fresh = await context.newPage();
  await fresh.goto(new URL(link).pathname);
  await expect(fresh.getByText(guest)).toBeVisible();
  await fresh.close();
  await invite.getByRole('button', { name: /^Supprimer l’invitation/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(invite).toHaveCount(0);

  // quota of an account
  const row = page.locator(`[data-testid=admin-user][data-email="${email}"]`).locator('visible=true');
  await row.getByRole('button', { name: /^Modifier / }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Rôle')).toBeDisabled(); // no self-demotion
  await dialog.getByLabel('Quota (Go)').fill('7,5');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText('7,5 Go');
  await page.goto('/settings/profil');
  await expect(page.getByText('utilisés sur 7,5 Go', { exact: true })).toBeVisible();
});

test('shell: navigation, search, command palette, theme and language', async ({ page, context }, info) => {
  await apiSignUp(context, page);
  await page.goto('/');
  const desktop = info.project.name === 'desktop';
  const nav = page.getByRole('navigation', { name: 'Navigation principale' }).locator('visible=true');
  await expect(nav.getByRole('link', { name: desktop ? 'Mes fichiers' : 'Fichiers' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Récents' }).click();
  await expect(page).toHaveURL(/\/recent$/);
  await expect(nav.getByRole('link', { name: 'Récents' })).toHaveAttribute('aria-current', 'page');
  if (!desktop) {
    await nav.getByRole('button', { name: 'Plus' }).click();
    await page.getByRole('dialog', { name: 'Plus' }).getByRole('link', { name: 'Corbeille' }).click();
    await expect(page).toHaveURL(/\/trash$/);
  }
  // search field: "/" focuses it, Enter goes to the results
  await page.locator('#main').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Rechercher dans mes fichiers' })).toBeFocused();
  await page.keyboard.type('facture été');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=facture%20%C3%A9t%C3%A9$/);
  // palette: filter, arrows, Enter
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Commandes' });
  const input = palette.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill('regl');
  await expect(palette.getByRole('option')).toHaveCount(1);
  await expect(palette.getByRole('option', { name: /Réglages/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(palette).toHaveCount(0);
  // palette commands: theme and language
  await page.keyboard.press('Control+k');
  await input.fill('sombre');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.keyboard.press('Control+k');
  await input.fill('english');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload(); // the language is stored on the account and on the device
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // authenticator app: QR code and key, a wrong code is refused, the right one enables it; then disable
  await page.goto('/settings/securite');
  await page.getByRole('button', { name: 'Set up' }).click();
  const setup = page.getByRole('dialog', { name: 'Set up the authenticator app' });
  await expect(setup.getByRole('img', { name: 'Setup QR code' })).toBeVisible();
  const secret = await setup.getByLabel('Key to type by hand').inputValue();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  const good = totp(secret);
  await setup.getByLabel('6-digit code').fill(good === '000000' ? '000001' : '000000');
  await setup.getByRole('button', { name: 'Enable' }).click();
  await expect(setup.getByRole('alert')).toContainText('Code not accepted');
  await setup.getByLabel('6-digit code').fill(totp(secret));
  await setup.getByRole('button', { name: 'Enable' }).click();
  await expect(page.getByTestId('totp-state')).toContainText('Enabled');
  await page.getByRole('button', { name: 'Disable' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByTestId('totp-state')).toContainText('Disabled');
  // no horizontal overflow
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
