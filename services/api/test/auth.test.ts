import { afterAll, describe, expect, it } from 'vitest';
import { createInvite } from '../src/auth.ts';
import { config } from '../src/config.ts';
import { totpAt } from '../src/crypto.ts';
import { sql } from '../src/db.ts';
import { SoftAuthenticator } from './authenticator.ts';
import { anon, Client, closeAll, server, signup } from './harness.ts';

afterAll(closeAll);
const base32decode = (s: string) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s) bits += A.indexOf(c).toString(2).padStart(5, '0'); return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2))); };

describe('accounts and passkeys', () => {
  it('registers through an invitation, once', async () => {
    await server();
    const inv = await createInvite(sql, { email: 'once@example.test', role: 'user' });
    const a = new Client(new SoftAuthenticator(config.origin, config.rpId));
    const o = await a.post('/api/v1/auth/register/options', { invite: inv.token, displayName: 'Once' });
    const v = await a.post('/api/v1/auth/register/verify', { invite: inv.token, challengeId: o.body.challengeId, response: a.auth!.create(o.body.options) });
    expect(v.status).toBe(200);
    expect(v.body.recoveryCodes).toHaveLength(10);
    expect((await a.get('/api/v1/auth/state')).body).toMatchObject({ authenticated: true, user: { email: 'once@example.test', role: 'user' } });
    // the invitation is spent
    const b = new Client(new SoftAuthenticator(config.origin, config.rpId));
    expect((await b.post('/api/v1/auth/register/options', { invite: inv.token, displayName: 'Twice' })).status).toBe(403);
    expect((await b.post('/api/v1/auth/invite', { invite: 'x'.repeat(43) })).status).toBe(403);
  });
  it('signs in with a passkey and refuses a forged origin, a replayed challenge and an unknown credential', async () => {
    const { client } = await signup();
    const fresh = new Client(client.auth);
    expect((await fresh.get('/api/v1/folders/root')).status).toBe(401);
    expect((await fresh.login()).status).toBe(200);
    expect((await fresh.get('/api/v1/folders/root')).status).toBe(200);
    // phishing origin
    const p = new Client(client.auth);
    const o = await p.post('/api/v1/auth/login/options');
    expect((await p.post('/api/v1/auth/login/verify', { challengeId: o.body.challengeId, response: client.auth!.get(o.body.options, undefined, { origin: 'https://evil.example' }) })).status).toBe(401);
    // a challenge is single-use
    const o2 = await p.post('/api/v1/auth/login/options');
    const assertion = client.auth!.get(o2.body.options);
    expect((await p.post('/api/v1/auth/login/verify', { challengeId: o2.body.challengeId, response: assertion })).status).toBe(200);
    expect((await new Client().post('/api/v1/auth/login/verify', { challengeId: o2.body.challengeId, response: assertion })).status).toBe(401);
    // a credential the server never saw
    const stranger = new SoftAuthenticator(config.origin, config.rpId);
    stranger.create({ challenge: 'x', user: { id: 'x' } });
    const o3 = await p.post('/api/v1/auth/login/options');
    expect((await new Client().post('/api/v1/auth/login/verify', { challengeId: o3.body.challengeId, response: stranger.get(o3.body.options) })).status).toBe(401);
  });
  it('sets hardened session cookies and requires the CSRF header and origin', async () => {
    const { client } = await signup();
    const fresh = new Client(client.auth);
    const o = await fresh.post('/api/v1/auth/login/options');
    const app = await server();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login/verify', headers: { 'x-spd-csrf': '1', 'content-type': 'application/json' }, payload: JSON.stringify({ challengeId: o.body.challengeId, response: client.auth!.get(o.body.options) }) });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/); expect(setCookie).toMatch(/SameSite=Lax/); expect(setCookie).toMatch(/Path=\//);
    const token = /spd=([^;]+)/.exec(setCookie)![1]!;
    const [row] = await sql`select 1 from sessions where token_hash = ${token}`;
    expect(row).toBeUndefined(); // only a hash of the token is stored
    const cookie = `spd=${token}`;
    expect((await app.inject({ method: 'POST', url: '/api/v1/folders', headers: { cookie, 'content-type': 'application/json' }, payload: '{"parentId":"root","name":"x"}' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/folders', headers: { cookie, 'x-spd-csrf': '1', origin: 'https://evil.example', 'content-type': 'application/json' }, payload: '{"parentId":"root","name":"x"}' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/folders', headers: { cookie, 'x-spd-csrf': '1', origin: config.origin, 'content-type': 'application/json' }, payload: '{"parentId":"root","name":"x"}' })).statusCode).toBe(200);
  });
  it('lists and revokes sessions; logout kills the cookie server-side', async () => {
    const { client } = await signup();
    const other = new Client(client.auth);
    await other.login();
    const list = await client.get('/api/v1/account/sessions');
    expect(list.body).toHaveLength(2);
    const victim = list.body.find((s: any) => !s.current);
    expect((await client.del(`/api/v1/account/sessions/${victim.id}`)).status).toBe(200);
    expect((await other.get('/api/v1/folders/root')).status).toBe(401);
    const saved = new Map(client.cookies);
    await client.post('/api/v1/auth/logout');
    const ghost = new Client(); ghost.cookies = saved;
    expect((await ghost.get('/api/v1/folders/root')).status).toBe(401);
  });
  it('rotates the session token daily and keeps the previous one valid only briefly', async () => {
    const { client } = await signup();
    const before = client.cookies.get('spd')!;
    await sql`update sessions set rotated_at = now() - interval '25 hours' where user_id = (select id from users order by created_at desc limit 1)`;
    expect((await client.get('/api/v1/folders/root')).status).toBe(200);
    const after = client.cookies.get('spd')!;
    expect(after).not.toBe(before);
    const old = new Client(); old.cookies.set('spd', before);
    expect((await old.get('/api/v1/folders/root')).status).toBe(200); // grace for requests in flight
    await sql`update sessions set prev_valid_until = now() - interval '1 second' where prev_token_hash is not null`;
    expect((await old.get('/api/v1/folders/root')).status).toBe(401);
    expect((await client.get('/api/v1/folders/root')).status).toBe(200);
  });
  it('requires a fresh passkey assertion for sensitive operations and protects the last passkey', async () => {
    const { client } = await signup();
    await sql`update sessions set reauth_at = now() - interval '10 minutes'`;
    expect((await client.post('/api/v1/account/recovery-codes')).status).toBe(401);
    expect((await client.post('/api/v1/account/passkeys/options')).body.error).toBe('reauth_required');
    await client.reauth();
    const o = await client.post('/api/v1/account/passkeys/options');
    expect(o.status).toBe(200);
    const second = new SoftAuthenticator(config.origin, config.rpId);
    expect((await client.post('/api/v1/account/passkeys/verify', { challengeId: o.body.challengeId, response: second.create(o.body.options), label: 'Clé USB' })).status).toBe(200);
    const keys = (await client.get('/api/v1/account/passkeys')).body;
    expect(keys).toHaveLength(2);
    expect((await new Client(second).login()).status).toBe(200); // the second key signs in
    expect((await client.del(`/api/v1/account/passkeys/${keys[1].id}`)).status).toBe(200);
    expect((await new Client(second).login()).status).toBe(401); // and is dead once revoked
    expect((await client.del(`/api/v1/account/passkeys/${keys[0].id}`)).body.error).toBe('last_passkey');
  });
  it('recovers an account with a one-time code into a session that can only enrol a passkey', async () => {
    const { client, email, recoveryCodes } = await signup();
    const r = anon();
    expect((await r.post('/api/v1/auth/recovery', { email, code: 'AAAA-AAAA-AAAA-AAAA' })).status).toBe(401);
    expect((await r.post('/api/v1/auth/recovery', { email: 'nobody@example.test', code: recoveryCodes[0] })).status).toBe(401);
    expect((await r.post('/api/v1/auth/recovery', { email, code: recoveryCodes[0] })).status).toBe(200);
    expect((await r.get('/api/v1/auth/state')).body.recovery).toBe(true);
    expect((await r.get('/api/v1/folders/root')).body.error).toBe('recovery_session'); // no file access
    expect((await r.get('/api/v1/account/sessions')).status).toBe(403);
    const o = await r.post('/api/v1/account/passkeys/options');
    const key = new SoftAuthenticator(config.origin, config.rpId);
    expect((await r.post('/api/v1/account/passkeys/verify', { challengeId: o.body.challengeId, response: key.create(o.body.options) })).status).toBe(200);
    expect((await r.get('/api/v1/folders/root')).status).toBe(200); // upgraded to a normal session
    expect((await anon().post('/api/v1/auth/recovery', { email, code: recoveryCodes[0] })).status).toBe(401); // a code works once
    const notes = (await client.get('/api/v1/notifications')).body.map((n: any) => n.kind);
    expect(notes).toContain('security.recovery_used'); expect(notes).toContain('security.passkey_added');
  });
  it('locks recovery after repeated failures, whatever address they come from', async () => {
    const { email, recoveryCodes } = await signup();
    for (let i = 0; i < 10; i++) { const c = anon(); c.ip = `10.9.${i}.1`; expect((await c.post('/api/v1/auth/recovery', { email, code: `WRONG-CODE-${i}000` })).status).toBe(401); }
    const c = anon(); c.ip = '10.9.99.1';
    expect((await c.post('/api/v1/auth/recovery', { email, code: recoveryCodes[1] })).status).toBe(429);
  });
  it('demands the TOTP code with the recovery code once TOTP is enabled, and refuses a replayed code', async () => {
    const { client, email, recoveryCodes } = await signup();
    const setup = await client.post('/api/v1/account/totp/setup');
    expect(setup.body.uri).toContain('otpauth://totp/');
    const secret = base32decode(setup.body.secret);
    expect((await client.post('/api/v1/account/totp/enable', { challengeId: setup.body.challengeId, code: '000000' })).status).toBe(400);
    const code = totpAt(secret, Date.now() / 1000);
    expect((await client.post('/api/v1/account/totp/enable', { challengeId: setup.body.challengeId, code })).status).toBe(200);
    const [stored] = await sql<{ totp_secret: Buffer }[]>`select totp_secret from users where email = ${email}`;
    expect(Buffer.from(stored!.totp_secret).includes(secret)).toBe(false); // sealed at rest
    expect((await anon().post('/api/v1/auth/recovery', { email, code: recoveryCodes[0] })).status).toBe(401);
    expect((await anon().post('/api/v1/auth/recovery', { email, code: recoveryCodes[0], totp: code })).status).toBe(401); // step already used at enrolment
    expect((await anon().post('/api/v1/auth/recovery', { email, code: recoveryCodes[0], totp: totpAt(secret, Date.now() / 1000 + 30) })).status).toBe(200);
  });
  it('lets an administrator invite, limit and disable accounts; others cannot see the admin API', async () => {
    const admin = await signup({ role: 'admin' });
    const user = await signup();
    expect((await user.client.get('/api/v1/admin/users')).status).toBe(404);
    const inv = await admin.client.post('/api/v1/admin/invites', { email: 'guest@example.test' });
    expect(inv.body.url).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
    const users = (await admin.client.get('/api/v1/admin/users')).body;
    expect(users.find((u: any) => u.id === user.userId)).toMatchObject({ role: 'user', disabled: false });
    expect((await admin.client.patch(`/api/v1/admin/users/${user.userId}`, { disabled: true })).status).toBe(200);
    expect((await user.client.get('/api/v1/folders/root')).status).toBe(401); // sessions die with the account
    expect((await new Client(user.client.auth).login()).status).toBe(401);
    expect((await admin.client.patch(`/api/v1/admin/users/${admin.userId}`, { disabled: true })).body.error).toBe('self_lockout');
  });
  it('audits sign-ins and failures without storing secrets', async () => {
    const { client } = await signup();
    const act = (await client.get('/api/v1/account/activity')).body.map((e: any) => e.action);
    expect(act).toContain('account.created');
    const rows = await sql<{ meta: unknown }[]>`select meta from audit_events`;
    expect(JSON.stringify(rows)).not.toMatch(/"challenge"|clientDataJSON|authenticatorData|attestationObject/);
  });
});
