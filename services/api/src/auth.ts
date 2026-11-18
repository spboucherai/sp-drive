import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { masterKey, usedBytes } from './blob.ts';
import { config, notFound, secureCookies, UserError } from './config.ts';
import { base32, newToken, seal, sha256hex, tokenHash, totpVerify, unseal } from './crypto.ts';
import { type Actor, audit, type Db, notify, sql, tx } from './db.ts';

export const COOKIE = secureCookies ? '__Host-spd' : 'spd';
const ABSOLUTE_DAYS = 30, IDLE_DAYS = 14, ROTATE_HOURS = 24, REAUTH_MIN = 5, RECOVERY_SESSION_MIN = 20;
// device sessions (native clients): no absolute end while the device keeps syncing, closed after a long silence
const DEVICE_DAYS = 400, DEVICE_IDLE_DAYS = 90, DEVICE_LINK_MIN = 10;

export interface User { id: string; email: string; display_name: string; role: 'admin' | 'user'; locale: string }
export interface Session { id: string; method: 'passkey' | 'recovery'; kind: 'web' | 'device'; reauth_at: Date | null; user: User }
declare module 'fastify' { interface FastifyRequest { session?: Session } interface FastifyContextConfig { allowRecovery?: boolean } }

export const actorOf = (req: FastifyRequest): Actor => ({
  kind: req.session ? 'user' : 'anonymous', userId: req.session?.user.id ?? null, ip: req.ip, userAgent: String(req.headers['user-agent'] ?? ''),
});

// --- sessions ----------------------------------------------------------------------------------------------
function setCookie(reply: FastifyReply, token: string, maxAgeS: number) {
  reply.setCookie(COOKIE, token, { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/', maxAge: maxAgeS });
}
async function startSession(t: Db, req: FastifyRequest, reply: FastifyReply, userId: string, method: 'passkey' | 'recovery'): Promise<void> {
  const token = newToken();
  const life = method === 'recovery' ? `${RECOVERY_SESSION_MIN} minutes` : `${ABSOLUTE_DAYS} days`;
  await t`insert into sessions (user_id, token_hash, method, expires_at, reauth_at, ip, user_agent)
    values (${userId}, ${tokenHash(token)}, ${method}, now() + ${life}::interval, ${method === 'passkey' ? new Date() : null}, ${req.ip},
      ${String(req.headers['user-agent'] ?? '').slice(0, 300)})`;
  setCookie(reply, token, method === 'recovery' ? RECOVERY_SESSION_MIN * 60 : ABSOLUTE_DAYS * 86400);
}
/** Printable device name: what the owner will read in the list of sessions. */
const cleanDeviceName = (raw: string) => raw.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
/** Open a device session and return its bearer token (the only time it exists in clear). `fresh`: a passkey was just used. */
async function startDeviceSession(t: Db, req: FastifyRequest, userId: string, deviceName: string, fresh: boolean): Promise<string> {
  const token = newToken();
  await t`insert into sessions (user_id, token_hash, method, kind, device_name, expires_at, reauth_at, ip, user_agent)
    values (${userId}, ${tokenHash(token)}, 'passkey', 'device', ${cleanDeviceName(deviceName)}, now() + ${`${DEVICE_DAYS} days`}::interval, ${fresh ? new Date() : null}, ${req.ip},
      ${String(req.headers['user-agent'] ?? '').slice(0, 300)})`;
  return token;
}

interface SessionRow { id: string; method: 'passkey' | 'recovery'; kind: 'web' | 'device'; reauth_at: Date | null; rotated_at: Date; expires_at: Date; user_id: string; email: string; display_name: string; role: 'admin' | 'user'; locale: string; via_prev: boolean }
/** A device session, designated by its bearer token. Never rotated; its end slides while it is used. */
async function loadDeviceSession(token: string): Promise<Session | undefined> {
  const [s] = await sql<SessionRow[]>`
    update sessions s set last_seen_at = now(), expires_at = greatest(s.expires_at, now() + ${`${DEVICE_DAYS - 30} days`}::interval) from users u
    where u.id = s.user_id and u.disabled_at is null and s.revoked_at is null and s.expires_at > now() and s.kind = 'device'
      and s.last_seen_at > now() - ${`${DEVICE_IDLE_DAYS} days`}::interval and s.token_hash = ${tokenHash(token)}
    returning s.id, s.method, s.kind, s.reauth_at, s.rotated_at, s.expires_at, u.id as user_id, u.email, u.display_name, u.role, u.locale, false as via_prev`;
  return s ? { id: s.id, method: s.method, kind: 'device', reauth_at: s.reauth_at, user: { id: s.user_id, email: s.email, display_name: s.display_name, role: s.role, locale: s.locale } } : undefined;
}
/** True when the request carries a bearer token: such a request cannot be forged by another site (no ambient credential). */
export const hasBearer = (req: FastifyRequest): boolean => /^Bearer [A-Za-z0-9_-]{20,64}$/.test(String(req.headers.authorization ?? ''));
/** Resolve the session cookie. Rotates the token once a day; the previous token stays valid one minute for requests in flight. */
export async function loadSession(req: FastifyRequest, reply: FastifyReply): Promise<Session | undefined> {
  if (hasBearer(req)) return loadDeviceSession(String(req.headers.authorization).slice(7)); // a bearer never falls back to the cookie
  const token = req.cookies[COOKIE];
  if (!token || token.length > 100) return undefined;
  const h = tokenHash(token);
  const [s] = await sql<SessionRow[]>`
    update sessions s set last_seen_at = now() from users u
    where u.id = s.user_id and u.disabled_at is null and s.revoked_at is null and s.expires_at > now() and s.kind = 'web'
      and s.last_seen_at > now() - ${`${IDLE_DAYS} days`}::interval
      and (s.token_hash = ${h} or (s.prev_token_hash = ${h} and s.prev_valid_until > now()))
    returning s.id, s.method, s.kind, s.reauth_at, s.rotated_at, s.expires_at, u.id as user_id, u.email, u.display_name, u.role, u.locale, (s.token_hash <> ${h}) as via_prev`;
  if (!s) return undefined;
  if (!s.via_prev && s.method === 'passkey' && Date.now() - s.rotated_at.getTime() > ROTATE_HOURS * 3600_000) {
    const next = newToken();
    const [r] = await sql`update sessions set prev_token_hash = token_hash, prev_valid_until = now() + interval '60 seconds', token_hash = ${tokenHash(next)}, rotated_at = now()
      where id = ${s.id} and token_hash = ${h} returning id`;
    if (r) setCookie(reply, next, Math.max(60, Math.floor((s.expires_at.getTime() - Date.now()) / 1000)));
  }
  return { id: s.id, method: s.method, kind: 'web', reauth_at: s.reauth_at, user: { id: s.user_id, email: s.email, display_name: s.display_name, role: s.role, locale: s.locale } };
}

/** preHandler: a signed-in account. A recovery session may only reach routes that opt in. */
export async function requireUser(req: FastifyRequest): Promise<void> {
  if (!req.session) throw new UserError('unauthenticated', 'sign in required', 401);
  if (req.session.method === 'recovery' && !(req.routeOptions.config as { allowRecovery?: boolean }).allowRecovery)
    throw new UserError('recovery_session', 'this recovery session can only enrol a new passkey', 403);
}
export const userOf = (req: FastifyRequest): User => { if (!req.session) throw new UserError('unauthenticated', 'sign in required', 401); return req.session.user; };
/** Sensitive operations need a passkey assertion made in the last few minutes. */
export function requireFreshAuth(req: FastifyRequest): void {
  const at = req.session?.reauth_at;
  if (!at || Date.now() - at.getTime() > REAUTH_MIN * 60_000) throw new UserError('reauth_required', 'confirm with your passkey', 401);
}
export function requireAdmin(req: FastifyRequest): void {
  if (userOf(req).role !== 'admin') throw notFound();
}

// --- challenges --------------------------------------------------------------------------------------------
async function putChallenge(kind: string, challenge: string, userId: string | null = null, data: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await sql`delete from auth_challenges where expires_at < now()`;
  await sql`insert into auth_challenges (id, kind, challenge, user_id, data, expires_at) values (${id}, ${kind}, ${challenge}, ${userId}, ${sql.json(data as never)}, now() + interval '5 minutes')`;
  return id;
}
async function takeChallenge(id: string, kind: string, userId: string | null = null): Promise<{ challenge: string; data: Record<string, any> }> {
  const [r] = await sql<{ challenge: string; data: Record<string, any> }[]>`delete from auth_challenges
    where id = ${id} and kind = ${kind} and expires_at > now() and user_id is not distinct from ${userId} returning challenge, data`;
  if (!r) throw new UserError('challenge_expired', 'challenge expired, try again', 401);
  return r;
}

// --- WebAuthn helpers --------------------------------------------------------------------------------------
interface Passkey { id: string; user_id: string; credential_id: string; public_key: string; counter: string; transports: string[]; label: string; device_type: string; backed_up: boolean; created_at: Date; last_used_at: Date | null }
const passkeysOf = (userId: string) => sql<Passkey[]>`select * from passkeys where user_id = ${userId} order by created_at`;

const regOptions = (u: { handle: Buffer; email: string; displayName: string }, exclude: Passkey[]) => generateRegistrationOptions({
  rpName: 'SP Drive', rpID: config.rpId, userName: u.email, userDisplayName: u.displayName, userID: new Uint8Array(u.handle),
  attestationType: 'none', excludeCredentials: exclude.map((c) => ({ id: c.credential_id, transports: c.transports as never })),
  authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
});
async function verifyReg(response: unknown, expectedChallenge: string) {
  const v = await verifyRegistrationResponse({ response: response as RegistrationResponseJSON, expectedChallenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true })
    .catch((e: Error) => { throw new UserError('registration_failed', e.message, 401); });
  if (!v.verified || !v.registrationInfo) throw new UserError('registration_failed', 'passkey registration not verified', 401);
  const c = v.registrationInfo.credential;
  return { credentialId: c.id, publicKey: Buffer.from(c.publicKey).toString('base64url'), counter: c.counter, transports: (c.transports ?? []) as string[],
    deviceType: v.registrationInfo.credentialDeviceType, backedUp: v.registrationInfo.credentialBackedUp };
}
type NewCred = Awaited<ReturnType<typeof verifyReg>>;
const insertPasskey = (t: Db, userId: string, c: NewCred, label: string) => t`insert into passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, label)
  values (${userId}, ${c.credentialId}, ${c.publicKey}, ${c.counter}, ${t.json(c.transports)}, ${c.deviceType}, ${c.backedUp}, ${label})`;

/** Verify an assertion against the stored credential; returns the passkey. `userId` restricts to one account (re-authentication). */
async function verifyAssertion(response: unknown, expectedChallenge: string, userId?: string): Promise<Passkey> {
  const r = response as AuthenticationResponseJSON;
  const fail = () => new UserError('authentication_failed', 'passkey not accepted', 401);
  if (!r || typeof r.id !== 'string' || r.id.length > 1024) throw fail();
  const [pk] = await sql<Passkey[]>`select p.* from passkeys p join users u on u.id = p.user_id where p.credential_id = ${r.id} and u.disabled_at is null`;
  if (!pk || (userId && pk.user_id !== userId)) throw fail();
  const v = await verifyAuthenticationResponse({
    response: r, expectedChallenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true,
    credential: { id: pk.credential_id, publicKey: new Uint8Array(Buffer.from(pk.public_key, 'base64url')), counter: Number(pk.counter), transports: pk.transports as never },
  }).catch(() => { throw fail(); });
  if (!v.verified) throw fail();
  await sql`update passkeys set counter = ${v.authenticationInfo.newCounter}, last_used_at = now() where id = ${pk.id}`;
  return pk;
}

// --- recovery codes ----------------------------------------------------------------------------------------
const codeHash = (code: string) => sha256hex(`spd-recovery-v1:${code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`);
async function issueRecoveryCodes(t: Db, userId: string): Promise<string[]> {
  await t`delete from recovery_codes where user_id = ${userId}`;
  const codes = Array.from({ length: 10 }, () => { const s = base32(randomBytes(10)); return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`; });
  for (const c of codes) await t`insert into recovery_codes (user_id, code_hash) values (${userId}, ${codeHash(c)})`;
  return codes;
}

// --- accounts ----------------------------------------------------------------------------------------------
export async function createInvite(t: Db, o: { email: string; role: 'admin' | 'user'; quotaBytes?: number; createdBy?: string | null; hours?: number }): Promise<{ id: string; token: string }> {
  const token = newToken();
  const [r] = await t<{ id: string }[]>`insert into invites (token_hash, email, role, quota_bytes, created_by, expires_at)
    values (${tokenHash(token)}, ${o.email}, ${o.role}, ${o.quotaBytes ?? config.defaultQuotaBytes}, ${o.createdBy ?? null}, now() + ${`${o.hours ?? 72} hours`}::interval) returning id`;
  return { id: r!.id, token };
}
interface Invite { id: string; email: string; role: 'admin' | 'user'; quota_bytes: string }
const liveInvite = async (t: Db, token: string, lock = false): Promise<Invite> => {
  const [i] = await t<Invite[]>`select id, email, role, quota_bytes::text from invites where token_hash = ${tokenHash(token)} and used_at is null and expires_at > now() ${lock ? t`for update` : t``}`;
  if (!i) throw new UserError('invite_invalid', 'this invitation is invalid or expired', 403);
  return i;
};

const Token = z.string().min(20).max(100);
const Label = z.string().trim().max(60).optional();
const NativeClient = z.object({ kind: z.literal('native'), name: z.string().trim().min(1).max(120) });
/** Code a device shows for linking: no ambiguous characters; it grants nothing by itself. */
const userCode = () => { const s = Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''); return `${s.slice(0, 4)}-${s.slice(4)}`; };
const normCode = (raw: string) => { const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, ''); return `${s.slice(0, 4)}-${s.slice(4, 8)}`; };
const strict = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
const veryStrict = { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } };

export function authRoutes(app: FastifyInstance): void {
  const authed = { preHandler: requireUser };
  const authedOrRecovery = { preHandler: requireUser, config: { allowRecovery: true } };
  const recoveryStrict = { preHandler: requireUser, config: { allowRecovery: true, ...strict.config } };

  app.get('/api/v1/auth/state', { config: { allowRecovery: true } }, async (req) => {
    const s = req.session;
    if (!s) return { authenticated: false };
    const [q] = await sql<{ limit_bytes: string }[]>`select limit_bytes::text from quotas where user_id = ${s.user.id}`;
    return { authenticated: true, recovery: s.method === 'recovery', kind: s.kind, user: s.user, quota: { limit: Number(q?.limit_bytes ?? 0), used: await usedBytes(sql, s.user.id) },
      freshAuth: !!s.reauth_at && Date.now() - s.reauth_at.getTime() < REAUTH_MIN * 60_000 };
  });

  // --- registration by one-time invitation ---
  app.post('/api/v1/auth/invite', strict, async (req) => {
    const { invite } = z.object({ invite: Token }).parse(req.body);
    const i = await liveInvite(sql, invite);
    return { email: i.email };
  });
  app.post('/api/v1/auth/register/options', strict, async (req) => {
    const b = z.object({ invite: Token, displayName: z.string().trim().min(1).max(80) }).parse(req.body);
    const i = await liveInvite(sql, b.invite);
    const handle = randomBytes(32);
    const options = await regOptions({ handle, email: i.email, displayName: b.displayName }, []);
    return { challengeId: await putChallenge('register', options.challenge, null, { invite: i.id, handle: handle.toString('base64url'), displayName: b.displayName }), options };
  });
  app.post('/api/v1/auth/register/verify', strict, async (req, reply) => {
    const b = z.object({ invite: Token, challengeId: z.uuid(), response: z.any(), label: Label }).parse(req.body);
    const ch = await takeChallenge(b.challengeId, 'register');
    const cred = await verifyReg(b.response, ch.challenge);
    const recoveryCodes = await tx(async (t) => {
      const i = await liveInvite(t, b.invite, true);
      if (i.id !== ch.data.invite) throw new UserError('invite_invalid', 'invitation mismatch', 403);
      const [taken] = await t`select 1 from users where email = ${i.email}`;
      if (taken) throw new UserError('invite_invalid', 'this invitation is invalid or expired', 403);
      const [u] = await t<{ id: string }[]>`insert into users (email, display_name, role, webauthn_handle)
        values (${i.email}, ${String(ch.data.displayName)}, ${i.role}, ${Buffer.from(String(ch.data.handle), 'base64url')}) returning id`;
      const userId = u!.id;
      await t`insert into quotas (user_id, limit_bytes) values (${userId}, ${i.quota_bytes})`;
      await t`insert into folders (owner_id, parent_id, name, name_key) values (${userId}, null, '', '')`;
      await insertPasskey(t, userId, cred, b.label || 'Passkey');
      await t`update invites set used_at = now() where id = ${i.id}`;
      const codes = await issueRecoveryCodes(t, userId);
      await startSession(t, req, reply, userId, 'passkey');
      await audit(t, { ...actorOf(req), kind: 'user', userId }, 'account.created', { targetType: 'user', targetId: userId, meta: { role: i.role } });
      return codes;
    });
    return { ok: true, recoveryCodes };
  });

  // --- sign-in ---
  app.post('/api/v1/auth/login/options', strict, async () => {
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'required' });
    return { challengeId: await putChallenge('login', options.challenge), options };
  });
  app.post('/api/v1/auth/login/verify', strict, async (req, reply) => {
    const b = z.object({ challengeId: z.uuid(), response: z.any(), client: NativeClient.optional() }).parse(req.body);
    const ch = await takeChallenge(b.challengeId, 'login');
    let pk: Passkey;
    try { pk = await verifyAssertion(b.response, ch.challenge); } catch (e) {
      await audit(sql, actorOf(req), 'auth.login_failed', { meta: { method: 'passkey' } });
      throw e;
    }
    // a native client gets a device session: its token comes back in the answer and no cookie is set
    const token = await tx(async (t) => {
      const tok = b.client ? await startDeviceSession(t, req, pk.user_id, b.client.name, true) : (await startSession(t, req, reply, pk.user_id, 'passkey'), undefined);
      await audit(t, { ...actorOf(req), kind: 'user', userId: pk.user_id }, 'auth.login', { meta: { method: 'passkey', passkey: pk.id, ...(b.client ? { device: cleanDeviceName(b.client.name) } : {}) } });
      return tok;
    });
    return token ? { ok: true, token } : { ok: true };
  });
  app.post('/api/v1/auth/logout', { config: { allowRecovery: true } }, async (req, reply) => {
    if (req.session) { await sql`update sessions set revoked_at = now() where id = ${req.session.id}`; await audit(sql, actorOf(req), 'auth.logout'); }
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  // --- device linking: a native client without a passkey on the device shows a code; a signed-in browser approves it ---
  app.post('/api/v1/auth/device/start', veryStrict, async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
    await sql`delete from device_links where expires_at < now() - interval '1 day'`;
    const deviceCode = newToken();
    let code = userCode();
    for (let i = 0; i < 5; i++) {
      const [r] = await sql`insert into device_links (device_hash, user_code, device_name, ip, user_agent, expires_at)
        values (${tokenHash(deviceCode)}, ${code}, ${cleanDeviceName(b.name)}, ${req.ip}, ${String(req.headers['user-agent'] ?? '').slice(0, 300)}, now() + ${`${DEVICE_LINK_MIN} minutes`}::interval)
        on conflict (user_code) do nothing returning id`;
      if (r) break;
      code = userCode();
      if (i === 4) throw new UserError('busy', 'try again', 503);
    }
    return { deviceCode, userCode: code, verifyUrl: `${config.origin}/appareil?code=${code}`, expiresInS: DEVICE_LINK_MIN * 60, intervalS: 2 };
  });
  /** The device asks whether its code was approved. The token is handed over exactly once. */
  app.post('/api/v1/auth/device/poll', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ deviceCode: Token }).parse(req.body);
    return tx(async (t) => {
      const [l] = await t<{ id: string; status: string; user_id: string | null; device_name: string; expired: boolean }[]>`
        select id, status, user_id, device_name, expires_at < now() as expired from device_links where device_hash = ${tokenHash(b.deviceCode)} for update`;
      if (!l || l.status === 'consumed') return { status: 'expired' as const };
      if (l.status === 'denied') return { status: 'denied' as const };
      if (l.expired) return { status: 'expired' as const };
      if (l.status !== 'approved' || !l.user_id) return { status: 'pending' as const };
      const [u] = await t`select 1 from users where id = ${l.user_id} and disabled_at is null`;
      if (!u) return { status: 'denied' as const };
      const token = await startDeviceSession(t, req, l.user_id, l.device_name, false);
      await t`update device_links set status = 'consumed' where id = ${l.id}`;
      await audit(t, { ...actorOf(req), kind: 'user', userId: l.user_id }, 'auth.login', { meta: { method: 'device_link', device: l.device_name } });
      return { status: 'approved' as const, token };
    });
  });
  const pendingLink = async (t: Db, raw: string) => {
    const [l] = await t<{ id: string; device_name: string; ip: string; created_at: Date }[]>`select id, device_name, ip, created_at from device_links
      where user_code = ${normCode(raw)} and status = 'pending' and expires_at > now()`;
    if (!l) throw new UserError('device_code_invalid', 'this code is unknown or expired', 404);
    return l;
  };
  app.get('/api/v1/auth/device/info', { ...authed, ...strict }, async (req) => {
    const q = z.object({ code: z.string().min(8).max(20) }).parse(req.query);
    const l = await pendingLink(sql, q.code);
    return { name: l.device_name, ip: l.ip, createdAt: l.created_at };
  });
  /** Approving a device is as sensitive as adding a passkey: it needs a passkey assertion made in the last minutes, from a browser session. */
  app.post('/api/v1/auth/device/decide', { ...authed, ...strict }, async (req) => {
    const b = z.object({ code: z.string().min(8).max(20), approve: z.boolean() }).parse(req.body);
    const u = userOf(req);
    if (req.session!.kind !== 'web') throw new UserError('forbidden', 'a device cannot approve another device', 403);
    if (b.approve) requireFreshAuth(req);
    await tx(async (t) => {
      const l = await pendingLink(t, b.code);
      await t`update device_links set status = ${b.approve ? 'approved' : 'denied'}, user_id = ${u.id}, expires_at = least(expires_at, now() + interval '2 minutes') where id = ${l.id} and status = 'pending'`;
      await audit(t, actorOf(req), b.approve ? 'account.device_approved' : 'account.device_denied', { meta: { device: l.device_name } });
      if (b.approve) await notify(t, u.id, 'security.device_linked', { name: l.device_name, ip: l.ip });
    });
    return { ok: true };
  });

  // --- recovery: a code (plus TOTP when enabled) opens a short session that can only enrol a new passkey ---
  app.post('/api/v1/auth/recovery', veryStrict, async (req, reply) => {
    const b = z.object({ email: z.string().trim().max(200), code: z.string().trim().min(8).max(40), totp: z.string().trim().max(10).optional() }).parse(req.body);
    const fail = new UserError('recovery_failed', 'email, code or verification code not accepted', 401);
    const [u] = await sql<{ id: string; totp_secret: Buffer | null; totp_enabled_at: Date | null; totp_last_step: string | null }[]>`
      select id, totp_secret, totp_enabled_at, totp_last_step::text from users where email = ${b.email} and disabled_at is null`;
    const actor = actorOf(req);
    if (!u) { await audit(sql, actor, 'auth.recovery_failed', { meta: { reason: 'unknown' } }); throw fail; }
    // account-level brake, independent of the caller's address
    const [f] = await sql<{ n: number }[]>`select count(*)::int as n from audit_events where owner_id = ${u.id} and action = 'auth.recovery_failed' and at > now() - interval '1 hour'`;
    if (f!.n >= 10) throw new UserError('recovery_locked', 'too many attempts, try again later', 429);
    const deny = async (reason: string) => { await audit(sql, actor, 'auth.recovery_failed', { ownerId: u.id, meta: { reason } }); return fail; };
    let step: number | null = null;
    if (u.totp_enabled_at && u.totp_secret) {
      step = totpVerify(unseal(masterKey(), u.totp_secret, `totp:${u.id}`), b.totp ?? '');
      if (step === null || (u.totp_last_step !== null && step <= Number(u.totp_last_step))) throw await deny('totp');
    }
    const ok = await tx(async (t) => {
      const [c] = await t`update recovery_codes set used_at = now() where user_id = ${u.id} and code_hash = ${codeHash(b.code)} and used_at is null returning id`;
      if (!c) return false;
      if (step !== null) await t`update users set totp_last_step = ${step} where id = ${u.id}`;
      await startSession(t, req, reply, u.id, 'recovery');
      await audit(t, { ...actor, kind: 'user', userId: u.id }, 'auth.recovery_used');
      await notify(t, u.id, 'security.recovery_used', { ip: req.ip });
      return true;
    });
    if (!ok) throw await deny('code');
    return { ok: true };
  });

  // --- re-authentication ---
  app.post('/api/v1/auth/reauth/options', { ...authed, ...strict }, async (req) => {
    const u = userOf(req);
    const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'required',
      allowCredentials: (await passkeysOf(u.id)).map((c) => ({ id: c.credential_id, transports: c.transports as never })) });
    return { challengeId: await putChallenge('reauth', options.challenge, u.id), options };
  });
  app.post('/api/v1/auth/reauth/verify', { ...authed, ...strict }, async (req) => {
    const b = z.object({ challengeId: z.uuid(), response: z.any() }).parse(req.body);
    const u = userOf(req);
    const ch = await takeChallenge(b.challengeId, 'reauth', u.id);
    await verifyAssertion(b.response, ch.challenge, u.id);
    await sql`update sessions set reauth_at = now() where id = ${req.session!.id}`;
    return { ok: true };
  });

  // --- passkeys ---
  app.get('/api/v1/account/passkeys', authedOrRecovery, async (req) =>
    (await passkeysOf(userOf(req).id)).map((c) => ({ id: c.id, label: c.label, deviceType: c.device_type, backedUp: c.backed_up, transports: c.transports, createdAt: c.created_at, lastUsedAt: c.last_used_at })));
  app.post('/api/v1/account/passkeys/options', recoveryStrict, async (req) => {
    const u = userOf(req);
    if (req.session!.method !== 'recovery') requireFreshAuth(req);
    const [row] = await sql<{ webauthn_handle: Buffer }[]>`select webauthn_handle from users where id = ${u.id}`;
    const options = await regOptions({ handle: row!.webauthn_handle, email: u.email, displayName: u.display_name }, await passkeysOf(u.id));
    return { challengeId: await putChallenge('add-passkey', options.challenge, u.id), options };
  });
  app.post('/api/v1/account/passkeys/verify', recoveryStrict, async (req, reply) => {
    const b = z.object({ challengeId: z.uuid(), response: z.any(), label: Label }).parse(req.body);
    const u = userOf(req);
    if (req.session!.method !== 'recovery') requireFreshAuth(req);
    const ch = await takeChallenge(b.challengeId, 'add-passkey', u.id);
    const cred = await verifyReg(b.response, ch.challenge);
    await tx(async (t) => {
      await insertPasskey(t, u.id, cred, b.label || 'Passkey');
      await audit(t, actorOf(req), 'account.passkey_added', { meta: { viaRecovery: req.session!.method === 'recovery' } });
      await notify(t, u.id, 'security.passkey_added', { label: b.label || 'Passkey' });
      if (req.session!.method === 'recovery') { // the recovery session ends here; a normal one replaces it
        await t`update sessions set revoked_at = now() where id = ${req.session!.id}`;
        await startSession(t, req, reply, u.id, 'passkey');
      }
    });
    return { ok: true };
  });
  app.patch('/api/v1/account/passkeys/:id', authed, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { label } = z.object({ label: z.string().trim().min(1).max(60) }).parse(req.body);
    const [r] = await sql`update passkeys set label = ${label} where id = ${id} and user_id = ${userOf(req).id} returning id`;
    if (!r) throw notFound();
    return { ok: true };
  });
  app.delete('/api/v1/account/passkeys/:id', authed, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const u = userOf(req);
    requireFreshAuth(req);
    await tx(async (t) => {
      const all = await t<{ id: string }[]>`select id from passkeys where user_id = ${u.id} for update`;
      if (!all.some((p) => p.id === id)) throw notFound();
      if (all.length <= 1) throw new UserError('last_passkey', 'the last passkey cannot be removed', 409);
      await t`delete from passkeys where id = ${id}`;
      await audit(t, actorOf(req), 'account.passkey_removed', { targetType: 'passkey', targetId: id });
      await notify(t, u.id, 'security.passkey_removed', {});
    });
    return { ok: true };
  });

  // --- sessions / devices ---
  app.get('/api/v1/account/sessions', authed, async (req) =>
    (await sql<{ id: string; created_at: Date; last_seen_at: Date; ip: string; user_agent: string; method: string; kind: string; device_name: string }[]>`select id, created_at, last_seen_at, ip, user_agent, method, kind, device_name from sessions
      where user_id = ${userOf(req).id} and revoked_at is null and expires_at > now()
        and last_seen_at > now() - (case when kind = 'device' then ${`${DEVICE_IDLE_DAYS} days`}::interval else ${`${IDLE_DAYS} days`}::interval end) order by last_seen_at desc`)
      .map((s) => ({ id: s.id, createdAt: s.created_at, lastSeenAt: s.last_seen_at, ip: s.ip, userAgent: s.user_agent, method: s.method, kind: s.kind, deviceName: s.device_name, current: s.id === req.session!.id })));
  app.delete('/api/v1/account/sessions/:id', authed, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [r] = await sql`update sessions set revoked_at = now() where id = ${id} and user_id = ${userOf(req).id} and revoked_at is null returning id`;
    if (!r) throw notFound();
    await audit(sql, actorOf(req), 'account.session_revoked', { targetType: 'session', targetId: id });
    return { ok: true };
  });
  app.post('/api/v1/account/sessions/revoke-others', authed, async (req) => {
    const r = await sql`update sessions set revoked_at = now() where user_id = ${userOf(req).id} and id <> ${req.session!.id} and revoked_at is null returning id`;
    await audit(sql, actorOf(req), 'account.sessions_revoked', { meta: { count: r.length } });
    return { revoked: r.length };
  });

  // --- recovery codes and TOTP ---
  app.get('/api/v1/account/security', authed, async (req) => {
    const u = userOf(req);
    const [r] = await sql<{ n: number; totp: boolean }[]>`select (select count(*)::int from recovery_codes where user_id = ${u.id} and used_at is null) as n,
      (select totp_enabled_at is not null from users where id = ${u.id}) as totp`;
    return { recoveryCodesLeft: r!.n, totpEnabled: r!.totp };
  });
  app.post('/api/v1/account/recovery-codes', authed, async (req) => {
    requireFreshAuth(req);
    const codes = await tx(async (t) => { const c = await issueRecoveryCodes(t, userOf(req).id); await audit(t, actorOf(req), 'account.recovery_codes_regenerated'); return c; });
    return { recoveryCodes: codes };
  });
  app.post('/api/v1/account/totp/setup', authed, async (req) => {
    requireFreshAuth(req);
    const u = userOf(req);
    const secret = randomBytes(20);
    const challengeId = await putChallenge('totp', '-', u.id, { sealed: seal(masterKey(), secret, `totp:${u.id}`).toString('base64url') });
    const s = base32(secret);
    return { challengeId, secret: s, uri: `otpauth://totp/${encodeURIComponent(`SP Drive:${u.email}`)}?secret=${s}&issuer=${encodeURIComponent('SP Drive')}&algorithm=SHA1&digits=6&period=30` };
  });
  app.post('/api/v1/account/totp/enable', { ...authed, ...strict }, async (req) => {
    const b = z.object({ challengeId: z.uuid(), code: z.string().trim() }).parse(req.body);
    requireFreshAuth(req);
    const u = userOf(req);
    const [c] = await sql<{ data: { sealed: string } }[]>`select data from auth_challenges where id = ${b.challengeId} and kind = 'totp' and user_id = ${u.id} and expires_at > now()`;
    if (!c) throw new UserError('challenge_expired', 'setup expired, start again', 401);
    const sealed = Buffer.from(c.data.sealed, 'base64url');
    const step = totpVerify(unseal(masterKey(), sealed, `totp:${u.id}`), b.code);
    if (step === null) throw new UserError('totp_invalid', 'code not accepted', 400);
    await tx(async (t) => {
      await t`update users set totp_secret = ${sealed}, totp_enabled_at = now(), totp_last_step = ${step} where id = ${u.id}`;
      await t`delete from auth_challenges where id = ${b.challengeId}`;
      await audit(t, actorOf(req), 'account.totp_enabled');
    });
    return { ok: true };
  });
  app.delete('/api/v1/account/totp', authed, async (req) => {
    requireFreshAuth(req);
    await tx(async (t) => { await t`update users set totp_secret = null, totp_enabled_at = null, totp_last_step = null where id = ${userOf(req).id}`; await audit(t, actorOf(req), 'account.totp_disabled'); });
    return { ok: true };
  });
  app.patch('/api/v1/account', authed, async (req) => {
    const b = z.object({ displayName: z.string().trim().min(1).max(80).optional(), locale: z.enum(['fr', 'en']).optional() }).parse(req.body);
    await sql`update users set display_name = coalesce(${b.displayName ?? null}, display_name), locale = coalesce(${b.locale ?? null}, locale) where id = ${userOf(req).id}`;
    return { ok: true };
  });
  /** Sign-ins, failures and security changes of the account. */
  app.get('/api/v1/account/activity', authed, async (req) =>
    (await sql<{ id: string; at: Date; action: string; ip: string; user_agent: string; meta: unknown }[]>`select id::text, at, action, ip, user_agent, meta from audit_events
      where owner_id = ${userOf(req).id} and (action like 'auth.%' or action like 'account.%') order by at desc limit 100`)
      .map((e) => ({ id: e.id, at: e.at, action: e.action, ip: e.ip, userAgent: e.user_agent, meta: e.meta })));

  // --- administration ---
  const admin = { preHandler: [requireUser, async (req: FastifyRequest) => requireAdmin(req)] };
  app.get('/api/v1/admin/users', admin, async () =>
    (await sql<{ id: string; email: string; display_name: string; role: string; disabled_at: Date | null; created_at: Date; limit_bytes: string; used: string; passkeys: number }[]>`
      select u.id, u.email, u.display_name, u.role, u.disabled_at, u.created_at, q.limit_bytes::text,
        (select coalesce(sum(size), 0)::text from storage_objects o where o.owner_id = u.id) as used,
        (select count(*)::int from passkeys p where p.user_id = u.id) as passkeys
      from users u join quotas q on q.user_id = u.id order by u.created_at`)
      .map((u) => ({ id: u.id, email: u.email, displayName: u.display_name, role: u.role, disabled: !!u.disabled_at, createdAt: u.created_at, quota: Number(u.limit_bytes), used: Number(u.used), passkeys: u.passkeys })));
  app.patch('/api/v1/admin/users/:id', admin, async (req) => {
    requireFreshAuth(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const b = z.object({ quotaBytes: z.number().int().min(0).max(1e15).optional(), disabled: z.boolean().optional(), role: z.enum(['admin', 'user']).optional() }).parse(req.body);
    if (id === userOf(req).id && (b.disabled || b.role === 'user')) throw new UserError('self_lockout', 'you cannot disable or demote your own account', 409);
    await tx(async (t) => {
      const [u] = await t`select id from users where id = ${id} for update`;
      if (!u) throw notFound();
      if (b.quotaBytes !== undefined) await t`update quotas set limit_bytes = ${b.quotaBytes}, updated_at = now() where user_id = ${id}`;
      if (b.role) await t`update users set role = ${b.role} where id = ${id}`;
      if (b.disabled !== undefined) {
        await t`update users set disabled_at = ${b.disabled ? new Date() : null} where id = ${id}`;
        if (b.disabled) await t`update sessions set revoked_at = now() where user_id = ${id} and revoked_at is null`;
      }
      await audit(t, actorOf(req), 'admin.user_updated', { ownerId: id, targetType: 'user', targetId: id, meta: b });
    });
    return { ok: true };
  });
  app.get('/api/v1/admin/invites', admin, async () =>
    (await sql<{ id: string; email: string; role: string; expires_at: Date; used_at: Date | null; created_at: Date }[]>`select id, email, role, expires_at, used_at, created_at from invites order by created_at desc limit 100`)
      .map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expires_at, usedAt: i.used_at, createdAt: i.created_at })));
  app.post('/api/v1/admin/invites', admin, async (req) => {
    requireFreshAuth(req);
    const b = z.object({ email: z.email().max(200), role: z.enum(['admin', 'user']).default('user'), quotaBytes: z.number().int().min(0).max(1e15).optional() }).parse(req.body);
    const [taken] = await sql`select 1 from users where email = ${b.email}`;
    if (taken) throw new UserError('email_taken', 'an account already uses this address', 409);
    const inv = await createInvite(sql, { ...b, createdBy: userOf(req).id });
    await audit(sql, actorOf(req), 'admin.invite_created', { targetType: 'invite', targetId: inv.id, meta: { role: b.role } });
    return { id: inv.id, url: `${config.origin}/invite/${inv.token}` };
  });
  app.delete('/api/v1/admin/invites/:id', admin, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [r] = await sql`delete from invites where id = ${id} and used_at is null returning id`;
    if (!r) throw notFound();
    return { ok: true };
  });
}
