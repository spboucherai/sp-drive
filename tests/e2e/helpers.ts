/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : tests/e2e/helpers.ts
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

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
/** A one-time invitation link from the development stack's CLI. */
export function inviteUrl(email = `e2e-${randomBytes(4).toString('hex')}@example.test`, admin = false): { email: string; url: string; token: string } {
  const url = execFileSync(join(ROOT, 'scripts/dev-invite.sh'), admin ? [email, '--admin'] : [email], { cwd: ROOT }).toString().trim().split('\n').pop()!;
  return { email, url, token: url.split('/').pop()! };
}
/** Attach a virtual platform authenticator (user verifying, resident keys) to the page: passkey prompts are answered automatically. Chromium only. */
export async function virtualAuthenticator(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
}
/**
 * Create an account and a session without going through the screens (for specs that are not about sign-up): the
 * registration ceremony runs in the page with the raw WebAuthn API against the real endpoints.
 */
export async function apiSignUp(context: BrowserContext, page: Page, o: { admin?: boolean } = {}): Promise<{ email: string; recoveryCodes: string[] }> {
  const { email, token } = inviteUrl(undefined, o.admin);
  await virtualAuthenticator(context, page);
  await page.goto('/pwa/favicon.svg'); // any same-origin document
  const recoveryCodes = await page.evaluate(async (invite) => {
    const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const un = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const call = async (path: string, body: unknown) => { const r = await fetch(`/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SPD-CSRF': '1' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${path}: ${await r.text()}`); return r.json(); };
    const o = await call('/auth/register/options', { invite, displayName: 'E2E' });
    const pk = o.options;
    const cred = (await navigator.credentials.create({ publicKey: { ...pk, challenge: un(pk.challenge), user: { ...pk.user, id: un(pk.user.id) }, excludeCredentials: [] } })) as PublicKeyCredential;
    const r = cred.response as AuthenticatorAttestationResponse;
    const v = await call('/auth/register/verify', { invite, challengeId: o.challengeId, label: 'E2E', response: { id: cred.id, rawId: b64(cred.rawId), type: cred.type, clientExtensionResults: {}, response: { clientDataJSON: b64(r.clientDataJSON), attestationObject: b64(r.attestationObject), transports: ['internal'] } } });
    return v.recoveryCodes as string[];
  }, token);
  return { email, recoveryCodes };
}
