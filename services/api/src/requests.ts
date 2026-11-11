// Deposit portals ("file requests"). A portal points at one folder of its owner. A depositor gets a submission token
// that can do exactly two things: send the files it declared, and read the state of its own submission. Nothing on
// the public side ever lists, reads or names anything in the target folder or in other submissions.
import { randomInt } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BLOCKED_EXT, DEFAULT_FIELDS, extOf, MAX_CHUNK_BYTES, type RequestFields, sanitizeName } from '@spd/shared';
import { z } from 'zod';
import { actorOf, requireUser, userOf } from './auth.ts';
import { config, notFound, UserError } from './config.ts';
import { hashPassword, newToken, TOKEN_RE, tokenHash, verifyPassword } from './crypto.ts';
import { audit, type Db, lockOwner, sql, tx } from './db.ts';
import { enqueue } from './jobs.ts';
import { breadcrumbs, getFolder } from './tree.ts';
import { appendChunk, assertQuota, sealCheck, uploadJson, uploadPath, type UploadRow } from './uploads.ts';

const GIB = 1024 ** 3, MIB = 1024 ** 2;
/** Largest file a portal may accept: what the antivirus can scan in one stream. */
export const PORTAL_MAX_FILE = 2 * GIB;
export { BLOCKED_EXT };

export interface RequestRow {
  id: string; owner_id: string; folder_id: string; token_hash: string; title: string; description: string; instructions: string; confirmation_message: string; brand_name: string; brand_color: string;
  password_hash: string | null; expires_at: Date | null; active: boolean; revoked_at: Date | null; max_file_bytes: string; max_total_bytes: string; max_files_per_submission: number; max_submissions: number | null;
  submissions_per_hour: number; allowed_extensions: string[]; fields: RequestFields; require_consent: boolean; consent_text: string; retention_note: string; subfolder_per_submission: boolean; notify_owner: boolean;
  bytes_received: string; created_at: Date; updated_at: Date; folder_live?: boolean; submissions?: number;
}
type State = 'open' | 'paused' | 'revoked' | 'expired' | 'full' | 'target_missing';
const stateOf = (r: RequestRow): State =>
  r.revoked_at ? 'revoked' : !r.active ? 'paused' : r.expires_at && r.expires_at < new Date() ? 'expired' : r.folder_live === false ? 'target_missing'
    : Number(r.bytes_received) >= Number(r.max_total_bytes) || (r.max_submissions !== null && (r.submissions ?? 0) >= r.max_submissions) ? 'full' : 'open';
const requestJson = (r: RequestRow) => ({
  id: r.id, folderId: r.folder_id, title: r.title, description: r.description, instructions: r.instructions, confirmationMessage: r.confirmation_message, brandName: r.brand_name, brandColor: r.brand_color,
  hasPassword: !!r.password_hash, expiresAt: r.expires_at, active: r.active, revokedAt: r.revoked_at, maxFileBytes: Number(r.max_file_bytes), maxTotalBytes: Number(r.max_total_bytes),
  maxFilesPerSubmission: r.max_files_per_submission, maxSubmissions: r.max_submissions, submissionsPerHour: r.submissions_per_hour, allowedExtensions: r.allowed_extensions, fields: r.fields,
  requireConsent: r.require_consent, consentText: r.consent_text, retentionNote: r.retention_note, subfolderPerSubmission: r.subfolder_per_submission, notifyOwner: r.notify_owner,
  bytesReceived: Number(r.bytes_received), submissions: r.submissions ?? 0, createdAt: r.created_at, state: stateOf(r),
});
const withState = (t: Db) => t`r.*, r.max_file_bytes::text, r.max_total_bytes::text, r.bytes_received::text, (d.trashed_at is null) as folder_live,
  (select count(*)::int from upload_submissions s where s.request_id = r.id and s.status in ('open', 'processing', 'completed')) as submissions
  from upload_requests r join folders d on d.id = r.folder_id`;

const Ext = z.string().trim().toLowerCase().regex(/^[a-z0-9]{1,10}$/);
const Fields = z.object({
  name: z.enum(['off', 'optional', 'required']), email: z.enum(['off', 'optional', 'required']), reference: z.enum(['off', 'optional', 'required']),
  custom: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]{1,30}$/), label: z.string().trim().min(1).max(80), required: z.boolean() })).max(10),
});
const Body = z.object({
  title: z.string().trim().min(1).max(120), description: z.string().trim().max(2000), instructions: z.string().trim().max(4000), confirmationMessage: z.string().trim().max(1000),
  brandName: z.string().trim().max(80), brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), password: z.string().min(4).max(200).nullable(), expiresAt: z.iso.datetime({ offset: true }).nullable(), active: z.boolean(),
  maxFileBytes: z.number().int().min(1024).max(PORTAL_MAX_FILE), maxTotalBytes: z.number().int().min(1024).max(1e15), maxFilesPerSubmission: z.number().int().min(1).max(200),
  maxSubmissions: z.number().int().min(1).max(1_000_000).nullable(), submissionsPerHour: z.number().int().min(1).max(1000), allowedExtensions: z.array(Ext).max(60), fields: Fields,
  requireConsent: z.boolean(), consentText: z.string().trim().max(2000), retentionNote: z.string().trim().max(1000), subfolderPerSubmission: z.boolean(), notifyOwner: z.boolean(),
}).partial();
const Id = z.uuid();
/** Reference shown to the depositor: no ambiguous characters, not guessable enough to matter (it grants nothing). */
const publicRef = () => Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('').replace(/^(.{5})/, '$1-');

export function requestRoutes(app: FastifyInstance): void {
  const authed = { preHandler: requireUser };
  const own = async (t: Db, userId: string, id: string) => {
    const [r] = await t<RequestRow[]>`select ${withState(t)} where r.id = ${id} and r.owner_id = ${userId}`;
    if (!r) throw notFound('portal not found');
    return r;
  };

  // ============================ owner side ============================
  app.get('/api/v1/requests', authed, async (req) => {
    const rows = await sql<(RequestRow & { folder_name: string })[]>`select d.name as folder_name, ${withState(sql)} where r.owner_id = ${userOf(req).id} order by r.created_at desc limit 1000`;
    return rows.map((r) => ({ ...requestJson(r), folderName: r.folder_name }));
  });
  app.post('/api/v1/requests', authed, async (req) => {
    const b = Body.and(z.object({ folderId: z.union([Id, z.literal('root')]), title: z.string().trim().min(1).max(120) })).parse(req.body);
    const u = userOf(req);
    const folder = await getFolder(sql, u.id, b.folderId);
    if (b.expiresAt && new Date(b.expiresAt) <= new Date()) throw new UserError('bad_expiry', 'the expiry must be in the future', 400);
    const token = newToken();
    const [r] = await sql<{ id: string }[]>`insert into upload_requests (owner_id, folder_id, token_hash, title, description, instructions, confirmation_message, brand_name, brand_color, password_hash, expires_at, active,
        max_file_bytes, max_total_bytes, max_files_per_submission, max_submissions, submissions_per_hour, allowed_extensions, fields, require_consent, consent_text, retention_note, subfolder_per_submission, notify_owner)
      values (${u.id}, ${folder.id}, ${tokenHash(token)}, ${b.title}, ${b.description ?? ''}, ${b.instructions ?? ''}, ${b.confirmationMessage ?? ''}, ${b.brandName ?? ''}, ${b.brandColor ?? '#2563eb'},
        ${b.password ? await hashPassword(b.password) : null}, ${b.expiresAt ?? null}, ${b.active ?? true}, ${b.maxFileBytes ?? 200 * MIB}, ${b.maxTotalBytes ?? 5 * GIB}, ${b.maxFilesPerSubmission ?? 20},
        ${b.maxSubmissions ?? null}, ${b.submissionsPerHour ?? 20}, ${b.allowedExtensions ?? []}, ${sql.json((b.fields ?? DEFAULT_FIELDS) as never)}, ${b.requireConsent ?? false}, ${b.consentText ?? ''},
        ${b.retentionNote ?? ''}, ${b.subfolderPerSubmission ?? true}, ${b.notifyOwner ?? true}) returning id`;
    await audit(sql, actorOf(req), 'request.created', { targetType: 'request', targetId: r!.id });
    return { request: requestJson(await own(sql, u.id, r!.id)), url: `${config.origin}/request/${token}` }; // the only time the link is available
  });
  app.get('/api/v1/requests/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const r = await own(sql, userOf(req).id, id);
    const [folder] = await sql<Parameters<typeof breadcrumbs>[1][]>`select * from folders where id = ${r.folder_id}`;
    return { request: requestJson(r), folderPath: await breadcrumbs(sql, folder!) };
  });
  app.patch('/api/v1/requests/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const b = Body.and(z.object({ folderId: Id.optional() })).parse(req.body);
    const u = userOf(req);
    await own(sql, u.id, id);
    const folderId = b.folderId ? (await getFolder(sql, u.id, b.folderId)).id : undefined;
    const cols: Record<string, unknown> = {
      title: b.title, description: b.description, instructions: b.instructions, confirmation_message: b.confirmationMessage, brand_name: b.brandName, brand_color: b.brandColor, expires_at: b.expiresAt, active: b.active,
      max_file_bytes: b.maxFileBytes, max_total_bytes: b.maxTotalBytes, max_files_per_submission: b.maxFilesPerSubmission, max_submissions: b.maxSubmissions, submissions_per_hour: b.submissionsPerHour,
      allowed_extensions: b.allowedExtensions, require_consent: b.requireConsent, consent_text: b.consentText, retention_note: b.retentionNote, subfolder_per_submission: b.subfolderPerSubmission, notify_owner: b.notifyOwner, folder_id: folderId,
    };
    if (b.password !== undefined) cols.password_hash = b.password === null ? null : await hashPassword(b.password);
    await tx(async (t) => {
      for (const [k, v] of Object.entries(cols)) if (v !== undefined) await t`update upload_requests set ${t(k)} = ${v as never}, updated_at = now() where id = ${id}`;
      if (b.fields) await t`update upload_requests set fields = ${t.json(b.fields as never)}, updated_at = now() where id = ${id}`;
      await audit(t, actorOf(req), 'request.updated', { targetType: 'request', targetId: id, meta: { changed: Object.keys(b).filter((k) => k !== 'password') } });
    });
    return requestJson(await own(sql, u.id, id));
  });
  /** Revoke: the link is dead for good, uploads in flight are refused at their next chunk. `?purge=1` also deletes the portal and its journal (deposited files stay). */
  app.delete('/api/v1/requests/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const q = z.object({ purge: z.string().optional() }).parse(req.query);
    const u = userOf(req);
    await own(sql, u.id, id);
    const pending = await sql<UploadRow[]>`select u.* from uploads u join upload_items i on i.id = u.item_id join upload_submissions s on s.id = i.submission_id where s.request_id = ${id} and s.status = 'open'`;
    await tx(async (t) => {
      await t`update upload_submissions set status = 'expired' where request_id = ${id} and status = 'open'`;
      if (q.purge) await t`delete from upload_requests where id = ${id}`;
      else await t`update upload_requests set revoked_at = coalesce(revoked_at, now()), active = false, updated_at = now() where id = ${id}`;
      await audit(t, actorOf(req), q.purge ? 'request.deleted' : 'request.revoked', { targetType: 'request', targetId: id });
    });
    for (const p of pending) await rm(uploadPath(p), { force: true });
    return { ok: true };
  });
  /** New link for the same portal; the previous link stops working at once. */
  app.post('/api/v1/requests/:id/rotate', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const token = newToken();
    const r = await sql`update upload_requests set token_hash = ${tokenHash(token)}, updated_at = now() where id = ${id} and owner_id = ${userOf(req).id} and revoked_at is null returning id`;
    if (!r.length) throw notFound('portal not found');
    await audit(sql, actorOf(req), 'request.rotated', { targetType: 'request', targetId: id });
    return { url: `${config.origin}/request/${token}` };
  });
  app.get('/api/v1/requests/:id/submissions', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    await own(sql, userOf(req).id, id);
    const rows = await sql<{ id: string; public_ref: string; status: string; submitter_name: string; submitter_email: string; reference: string; created_at: Date; completed_at: Date | null; folder_id: string | null; files: number; placed: number; rejected: number; bytes: string }[]>`
      select s.id, s.public_ref, s.status, s.submitter_name, s.submitter_email, s.reference, s.created_at, s.completed_at, s.folder_id,
        count(i.id)::int as files, count(i.id) filter (where i.status = 'placed')::int as placed, count(i.id) filter (where i.status = 'rejected')::int as rejected, coalesce(sum(i.size) filter (where i.status = 'placed'), 0)::text as bytes
      from upload_submissions s left join upload_items i on i.submission_id = s.id where s.request_id = ${id} group by s.id order by s.created_at desc limit 1000`;
    return rows.map((s) => ({ id: s.id, ref: s.public_ref, status: s.status, name: s.submitter_name, email: s.submitter_email, reference: s.reference, createdAt: s.created_at, completedAt: s.completed_at, folderId: s.folder_id, files: s.files, placed: s.placed, rejected: s.rejected, bytes: Number(s.bytes) }));
  });
  app.get('/api/v1/submissions/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const [s] = await sql<{ id: string; request_id: string; public_ref: string; status: string; submitter_name: string; submitter_email: string; reference: string; meta: unknown; consent_at: Date | null; ip: string; user_agent: string; created_at: Date; completed_at: Date | null; folder_id: string | null }[]>`
      select s.* from upload_submissions s join upload_requests r on r.id = s.request_id where s.id = ${id} and r.owner_id = ${userOf(req).id}`;
    if (!s) throw notFound('submission not found');
    const [items, events] = await Promise.all([
      sql<{ id: string; original_name: string; safe_name: string; size: string | null; declared_size: string; sha256: string | null; detected_mime: string | null; status: string; reject_code: string | null; file_id: string | null }[]>`
        select id, original_name, safe_name, size::text, declared_size::text, sha256, detected_mime, status, reject_code, file_id from upload_items where submission_id = ${id} order by position, id`,
      sql<{ id: string; at: Date; action: string; meta: unknown }[]>`select id::text, at, action, meta from audit_events where target_type = 'submission' and target_id = ${id} order by at, id`,
    ]);
    return {
      id: s.id, requestId: s.request_id, ref: s.public_ref, status: s.status, name: s.submitter_name, email: s.submitter_email, reference: s.reference, meta: s.meta, consentAt: s.consent_at, ip: s.ip, userAgent: s.user_agent,
      createdAt: s.created_at, completedAt: s.completed_at, folderId: s.folder_id,
      items: items.map((i) => ({ id: i.id, name: i.safe_name, originalName: i.original_name, size: Number(i.size ?? i.declared_size), sha256: i.sha256, mime: i.detected_mime, status: i.status, rejectCode: i.reject_code, fileId: i.file_id })),
      events: events.map((e) => ({ id: e.id, at: e.at, action: e.action, meta: e.meta })),
    };
  });

  // ============================ public side ============================
  const limited = (max: number, timeWindow = '1 minute') => ({ config: { rateLimit: { max, timeWindow } } });
  const unknown = () => new UserError('portal_unavailable', 'this deposit link is not available', 404);
  const closed = () => new UserError('portal_closed', 'this portal no longer accepts deposits', 410);
  /** The portal behind a link token, open for business right now. Called on every public request. */
  async function openPortal(t: Db, token: string | undefined): Promise<RequestRow> {
    if (!token || !TOKEN_RE.test(token)) throw unknown();
    const [r] = await t<RequestRow[]>`select ${withState(t)} join users u on u.id = r.owner_id and u.disabled_at is null where r.token_hash = ${tokenHash(token)}`;
    if (!r || r.revoked_at) throw unknown();
    if (stateOf(r) !== 'open') throw closed();
    return r;
  }
  const bearer = (req: FastifyRequest): string => {
    const m = /^Bearer ([A-Za-z0-9_-]{20,64})$/.exec(String(req.headers.authorization ?? ''));
    if (!m) throw new UserError('unauthenticated', 'submission token required', 401);
    return tokenHash(m[1]!);
  };
  interface Sub { id: string; request_id: string; status: string; public_ref: string }
  /** The submission a bearer token designates, with its portal re-validated when `mustBeOpen`. */
  async function submissionOf(t: Db, req: FastifyRequest, mustBeOpen: boolean): Promise<{ sub: Sub; portal: RequestRow }> {
    const [sub] = await t<Sub[]>`select id, request_id, status, public_ref from upload_submissions where token_hash = ${bearer(req)}`;
    if (!sub) throw new UserError('unauthenticated', 'submission token required', 401);
    const [portal] = await t<RequestRow[]>`select ${withState(t)} where r.id = ${sub.request_id}`;
    if (!portal) throw unknown();
    if (mustBeOpen) {
      // the totals of a portal that became "full" must not stop a submission that was admitted before it filled up
      const s = stateOf(portal);
      if (sub.status !== 'open' || (s !== 'open' && s !== 'full')) throw closed();
    }
    return { sub, portal };
  }

  app.get('/api/v1/public/requests/:token', limited(60), async (req) => {
    const r = await openPortal(sql, (req.params as { token?: string }).token);
    return {
      title: r.title, description: r.description, instructions: r.instructions, brandName: r.brand_name, brandColor: r.brand_color, needsPassword: !!r.password_hash, expiresAt: r.expires_at,
      maxFileBytes: Number(r.max_file_bytes), maxFiles: r.max_files_per_submission, remainingBytes: Math.max(0, Number(r.max_total_bytes) - Number(r.bytes_received)),
      allowedExtensions: r.allowed_extensions, fields: r.fields, requireConsent: r.require_consent, consentText: r.consent_text, retentionNote: r.retention_note, chunkBytes: MAX_CHUNK_BYTES / 2,
    };
  });

  const text = (max: number) => z.string().trim().max(max).default('');
  const Submit = z.object({
    password: z.string().max(200).optional(), name: text(120), email: z.union([z.email().max(200), z.literal('')]).default(''), reference: text(120),
    custom: z.record(z.string().regex(/^[a-z0-9_]{1,30}$/), z.string().trim().max(500)).default({}), consent: z.boolean().default(false),
    files: z.array(z.object({ name: z.string().min(1).max(1000), size: z.number().int().min(1) })).min(1).max(200),
  });
  app.post('/api/v1/public/requests/:token/submissions', limited(30), async (req) => {
    const b = Submit.parse(req.body);
    const token = (req.params as { token?: string }).token;
    const actor = actorOf(req);
    const pre = await openPortal(sql, token);
    if (pre.password_hash) {
      const [f] = await sql<{ n: number }[]>`select count(*)::int as n from audit_events where target_type = 'request' and target_id = ${pre.id} and action = 'request.password_failed' and at > now() - interval '15 minutes'`;
      if (f!.n >= 20) throw new UserError('too_many_attempts', 'too many attempts, try again later', 429);
      if (!b.password) throw new UserError('password_required', 'this portal is protected by a password', 401);
      if (!(await verifyPassword(b.password, pre.password_hash))) {
        await audit(sql, actor, 'request.password_failed', { ownerId: pre.owner_id, targetType: 'request', targetId: pre.id });
        throw new UserError('password_invalid', 'wrong password', 401);
      }
    }
    const submissionToken = newToken();
    const out = await tx(async (t) => {
      await lockOwner(t, pre.owner_id); // serialises admission: quotas and counters are read and reserved atomically
      const r = await openPortal(t, token);
      const bad = (code: string, message: string, extra: Record<string, unknown> = {}) => new UserError(code, message, 422, extra);
      // --- form ---
      const f = r.fields;
      for (const [k, v] of [['name', b.name], ['email', b.email], ['reference', b.reference]] as const) if (f[k] === 'required' && !v) throw bad('field_required', `${k} is required`, { field: k });
      const meta: Record<string, string> = {};
      for (const c of f.custom) { const v = b.custom[c.key] ?? ''; if (c.required && !v) throw bad('field_required', `${c.label} is required`, { field: c.key }); if (v) meta[c.key] = v; }
      if (r.require_consent && !b.consent) throw bad('consent_required', 'consent is required');
      // --- files ---
      if (b.files.length > r.max_files_per_submission) throw bad('too_many_files', 'too many files', { max: r.max_files_per_submission });
      const names = new Set<string>();
      const items = b.files.map((file) => {
        let safe = sanitizeName(file.name);
        const ext = extOf(safe);
        if (BLOCKED_EXT.has(ext) || (r.allowed_extensions.length && !r.allowed_extensions.includes(ext))) throw bad('type_not_allowed', 'this file type is not accepted', { name: safe });
        if (file.size > Number(r.max_file_bytes)) throw bad('file_too_large', 'a file exceeds the maximum size', { name: safe, max: Number(r.max_file_bytes) });
        for (let i = 2; names.has(safe.toLowerCase()); i++) safe = sanitizeName(file.name.replace(/(\.[^.]*)?$/, ` (${i})$1`));
        names.add(safe.toLowerCase());
        return { original: file.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500), safe, size: file.size };
      });
      const declared = items.reduce((n, i) => n + i.size, 0);
      // --- limits: per address, per portal, per owner ---
      const [rate] = await t<{ n: number }[]>`select count(*)::int as n from upload_submissions where request_id = ${r.id} and ip = ${req.ip} and created_at > now() - interval '1 hour'`;
      if (rate!.n >= r.submissions_per_hour) throw new UserError('rate_limited', 'too many submissions, try again later', 429);
      const [open] = await t<{ n: number; bytes: string }[]>`select count(*)::int as n, coalesce(sum(declared_bytes), 0)::text as bytes from upload_submissions where request_id = ${r.id} and status in ('open', 'processing')`;
      if (open!.n >= 200) throw new UserError('rate_limited', 'this portal is busy, try again later', 429);
      if (Number(r.bytes_received) + Number(open!.bytes) + declared > Number(r.max_total_bytes)) throw bad('portal_full', 'this portal cannot accept that much data');
      await assertQuota(t, r.owner_id, declared).catch(() => { throw bad('portal_full', 'this portal cannot accept that much data'); }); // do not reveal the owner's account state
      // --- admit ---
      const [s] = await t<{ id: string; public_ref: string }[]>`insert into upload_submissions (request_id, public_ref, token_hash, status, submitter_name, submitter_email, reference, meta, consent_at, declared_bytes, ip, user_agent)
        values (${r.id}, ${publicRef()}, ${tokenHash(submissionToken)}, 'open', ${b.name}, ${b.email}, ${b.reference}, ${t.json(meta)}, ${r.require_consent ? new Date() : null}, ${declared}, ${req.ip}, ${actor.userAgent?.slice(0, 300) ?? ''})
        returning id, public_ref`;
      const outItems = [];
      for (const [position, i] of items.entries()) {
        const [item] = await t<{ id: string }[]>`insert into upload_items (submission_id, position, original_name, safe_name, declared_size, status) values (${s!.id}, ${position}, ${i.original}, ${i.safe}, ${i.size}, 'uploading') returning id`;
        const [up] = await t<{ id: string }[]>`insert into uploads (owner_id, item_id, name, size, expires_at) values (${r.owner_id}, ${item!.id}, ${i.safe}, ${i.size}, now() + interval '24 hours') returning id`;
        outItems.push({ uploadId: up!.id, name: i.safe, size: i.size });
      }
      await audit(t, actor, 'submission.started', { ownerId: r.owner_id, targetType: 'submission', targetId: s!.id, meta: { files: items.length, bytes: declared } });
      return { ref: s!.public_ref, items: outItems };
    });
    return { ...out, submissionToken };
  });

  /** One of this submission's uploads (and nothing else). */
  const guard = (req: FastifyRequest) => async (t: Db, u: UploadRow) => {
    const { sub } = await submissionOf(t, req, true);
    const [mine] = await t`select 1 from upload_items where id = ${u.item_id} and submission_id = ${sub.id} and status = 'uploading'`;
    if (!u.item_id || !mine) throw notFound('upload not found');
  };
  app.get('/api/v1/public/uploads/:id', limited(300), async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const [u] = await sql<UploadRow[]>`select *, size::text, received::text from uploads where id = ${id}`;
    if (!u) throw notFound('upload not found');
    await guard(req)(sql, u);
    const j = uploadJson(u);
    return { id: j.id, size: j.size, received: j.received, status: j.status };
  });
  app.patch('/api/v1/public/uploads/:id', { ...limited(600), bodyLimit: MAX_CHUNK_BYTES + 4096 }, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const q = z.object({ offset: z.coerce.number().int().min(0) }).parse(req.query);
    const sha = req.headers['x-chunk-sha256'];
    const u = await appendChunk(id, q.offset, req.body as Readable, typeof sha === 'string' && /^[0-9a-fA-F]{64}$/.test(sha) ? sha : undefined, guard(req));
    return { id: u.id, size: Number(u.size), received: Number(u.received) };
  });
  /** The depositor is done: complete files go to quarantine for inspection, incomplete ones are refused. */
  app.post('/api/v1/public/submissions/finalize', limited(30), async (req) => {
    const actor = actorOf(req);
    const { sub, portal } = await submissionOf(sql, req, true);
    const [claimed] = await sql`update upload_submissions set status = 'processing', finalized_at = now() where id = ${sub.id} and status = 'open' returning id`;
    if (!claimed) throw closed();
    const uploads = await sql<(UploadRow & { item: string })[]>`select u.*, u.size::text, u.received::text, i.id as item from uploads u join upload_items i on i.id = u.item_id where i.submission_id = ${sub.id}`;
    let kept = 0;
    for (const u of uploads) {
      try {
        const sha = await sealCheck(u);
        await sql`update upload_items set status = 'quarantined', size = ${u.size}, sha256 = ${sha}, quarantine_path = ${uploadPath(u)}, updated_at = now() where id = ${u.item}`;
        kept++;
      } catch {
        await rm(uploadPath(u), { force: true });
        await sql`update upload_items set status = 'rejected', reject_code = 'incomplete', updated_at = now() where id = ${u.item}`;
      }
      await sql`update uploads set status = 'done', updated_at = now() where id = ${u.id}`;
    }
    await tx(async (t) => {
      await audit(t, actor, 'submission.finalized', { ownerId: portal.owner_id, targetType: 'submission', targetId: sub.id, meta: { received: kept, incomplete: uploads.length - kept } });
      if (kept) await enqueue(t, 'process_submission', { submissionId: sub.id }, { dedupeKey: `submission:${sub.id}`, maxAttempts: 30 });
      else await t`update upload_submissions set status = 'rejected', completed_at = now() where id = ${sub.id}`;
    });
    return { ref: sub.public_ref, status: kept ? 'processing' : 'rejected' };
  });
  /** What a depositor may know afterwards: the state of their own submission, file by file. */
  app.get('/api/v1/public/submissions/status', limited(120), async (req) => {
    const { sub, portal } = await submissionOf(sql, req, false);
    const items = await sql<{ safe_name: string; status: string; reject_code: string | null }[]>`select safe_name, status, reject_code from upload_items where submission_id = ${sub.id} order by position, id`;
    return { ref: sub.public_ref, status: sub.status, confirmationMessage: sub.status === 'completed' ? portal.confirmation_message : '',
      items: items.map((i) => ({ name: i.safe_name, status: i.status === 'placed' ? 'accepted' : i.status === 'rejected' ? 'rejected' : 'pending', reason: i.reject_code })) };
  });
}
