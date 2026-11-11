// Share links. The owner manages them; anonymous visitors use them through /api/v1/public/shares/<token>/….
// The token is shown once and stored hashed. Every public request re-reads the share: revocation is immediate.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { extOf, INLINE_MIME, previewKind } from '@spd/shared';
import { z } from 'zod';
import { actorOf, requireUser, userOf } from './auth.ts';
import { masterKey } from './blob.ts';
import { config, notFound, secureCookies, UserError } from './config.ts';
import { contentOf, previewPlan, sendPreview, sendSealed, sendZip, type ZipEntry } from './content.ts';
import { hashPassword, hmacHex, newToken, safeEqual, TOKEN_RE, tokenHash, verifyPassword } from './crypto.ts';
import { audit, type Db, sql } from './db.ts';
import { type FileRow, fileJoin, fileJson, fileSelect, type FolderRow, getFile, getFolder, isWithin, subtreeFiles } from './tree.ts';

interface ShareRow {
  id: string; owner_id: string; file_id: string | null; folder_id: string | null; token_hash: string; label: string; can_download: boolean; password_hash: string | null;
  expires_at: Date | null; max_views: number | null; view_count: number; max_downloads: number | null; download_count: number; single_use: boolean; revoked_at: Date | null; created_at: Date; last_access_at: Date | null;
  target_name?: string | null; target_live?: boolean;
}
const status = (s: ShareRow): 'active' | 'revoked' | 'expired' | 'exhausted' | 'target_missing' =>
  s.revoked_at ? 'revoked' : s.expires_at && s.expires_at < new Date() ? 'expired'
    : (s.max_views !== null && s.view_count >= s.max_views) || (s.single_use && s.view_count > 0) || (s.max_downloads !== null && s.download_count >= s.max_downloads) ? 'exhausted'
      : s.target_live === false ? 'target_missing' : 'active';
const shareJson = (s: ShareRow) => ({
  id: s.id, type: s.file_id ? 'file' as const : 'folder' as const, targetId: s.file_id ?? s.folder_id, targetName: s.target_name ?? '', label: s.label, canDownload: s.can_download, hasPassword: !!s.password_hash,
  expiresAt: s.expires_at, maxViews: s.max_views, viewCount: s.view_count, maxDownloads: s.max_downloads, downloadCount: s.download_count, singleUse: s.single_use,
  revokedAt: s.revoked_at, createdAt: s.created_at, lastAccessAt: s.last_access_at, status: status(s),
});
const ownSelect = (t: Db) => t`s.*, coalesce(f.name, d.name) as target_name, coalesce(f.trashed_at is null, d.trashed_at is null, false) as target_live
  from shares s left join files f on f.id = s.file_id left join folders d on d.id = s.folder_id`;

const Settings = z.object({
  label: z.string().trim().max(120).optional(), canDownload: z.boolean().optional(), password: z.string().min(4).max(200).nullable().optional(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(), maxViews: z.number().int().min(1).max(1_000_000).nullable().optional(),
  maxDownloads: z.number().int().min(1).max(1_000_000).nullable().optional(), singleUse: z.boolean().optional(),
});
const Id = z.uuid();

export function shareRoutes(app: FastifyInstance): void {
  const authed = { preHandler: requireUser };

  app.get('/api/v1/shares', authed, async (req) => {
    const q = z.object({ fileId: Id.optional(), folderId: Id.optional() }).parse(req.query);
    const rows = await sql<ShareRow[]>`select ${ownSelect(sql)} where s.owner_id = ${userOf(req).id}
      ${q.fileId ? sql`and s.file_id = ${q.fileId}` : sql``} ${q.folderId ? sql`and s.folder_id = ${q.folderId}` : sql``} order by s.created_at desc limit 1000`;
    return rows.map(shareJson);
  });
  app.post('/api/v1/shares', authed, async (req) => {
    const b = Settings.and(z.object({ fileId: Id.optional(), folderId: Id.optional() })).parse(req.body);
    if (!b.fileId === !b.folderId) throw new UserError('bad_target', 'choose one file or one folder', 400);
    const u = userOf(req);
    if (b.fileId) { const f = await getFile(sql, u.id, b.fileId); if (f.scan_status === 'infected') throw new UserError('infected', 'a file flagged by the antivirus cannot be shared', 409); }
    else { const d = await getFolder(sql, u.id, b.folderId!); if (!d.parent_id) throw new UserError('bad_target', 'the root folder cannot be shared', 400); }
    if (b.expiresAt && new Date(b.expiresAt) <= new Date()) throw new UserError('bad_expiry', 'the expiry must be in the future', 400);
    const token = newToken();
    const [s] = await sql<{ id: string }[]>`insert into shares (owner_id, file_id, folder_id, token_hash, label, can_download, password_hash, expires_at, max_views, max_downloads, single_use)
      values (${u.id}, ${b.fileId ?? null}, ${b.folderId ?? null}, ${tokenHash(token)}, ${b.label ?? ''}, ${b.canDownload ?? true}, ${b.password ? await hashPassword(b.password) : null},
        ${b.expiresAt ?? null}, ${b.maxViews ?? null}, ${b.maxDownloads ?? null}, ${b.singleUse ?? false}) returning id`;
    await audit(sql, actorOf(req), 'share.created', { targetType: 'share', targetId: s!.id, meta: { target: b.fileId ? 'file' : 'folder', password: !!b.password, expires: !!b.expiresAt } });
    const [row] = await sql<ShareRow[]>`select ${ownSelect(sql)} where s.id = ${s!.id}`;
    return { share: shareJson(row!), url: `${config.origin}/s/${token}` }; // the only time the link is available
  });
  app.patch('/api/v1/shares/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const b = Settings.parse(req.body);
    const u = userOf(req);
    const set = async <K extends keyof typeof b>(k: K, col: string, v: unknown) => { if (b[k] !== undefined) await sql`update shares set ${sql(col)} = ${v as never} where id = ${id} and owner_id = ${u.id}`; };
    const [own] = await sql`select 1 from shares where id = ${id} and owner_id = ${u.id}`;
    if (!own) throw notFound('share not found');
    await set('label', 'label', b.label); await set('canDownload', 'can_download', b.canDownload); await set('expiresAt', 'expires_at', b.expiresAt);
    await set('maxViews', 'max_views', b.maxViews); await set('maxDownloads', 'max_downloads', b.maxDownloads); await set('singleUse', 'single_use', b.singleUse);
    if (b.password !== undefined) await set('password', 'password_hash', b.password === null ? null : await hashPassword(b.password));
    await audit(sql, actorOf(req), 'share.updated', { targetType: 'share', targetId: id });
    const [row] = await sql<ShareRow[]>`select ${ownSelect(sql)} where s.id = ${id}`;
    return shareJson(row!);
  });
  /** Revocation is immediate: the next public request, including one in the middle of a browsing session, is refused. */
  app.delete('/api/v1/shares/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const q = z.object({ purge: z.string().optional() }).parse(req.query);
    const u = userOf(req);
    const r = q.purge ? await sql`delete from shares where id = ${id} and owner_id = ${u.id} returning id`
      : await sql`update shares set revoked_at = coalesce(revoked_at, now()) where id = ${id} and owner_id = ${u.id} returning id`;
    if (!r.length) throw notFound('share not found');
    await audit(sql, actorOf(req), q.purge ? 'share.deleted' : 'share.revoked', { targetType: 'share', targetId: id });
    return { ok: true };
  });
  /** New link for the same share; the old link stops working at once. */
  app.post('/api/v1/shares/:id/rotate', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const token = newToken();
    const r = await sql`update shares set token_hash = ${tokenHash(token)} where id = ${id} and owner_id = ${userOf(req).id} and revoked_at is null returning id`;
    if (!r.length) throw notFound('share not found');
    await audit(sql, actorOf(req), 'share.rotated', { targetType: 'share', targetId: id });
    return { url: `${config.origin}/s/${token}` };
  });
  app.get('/api/v1/shares/:id/events', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const [own] = await sql`select 1 from shares where id = ${id} and owner_id = ${userOf(req).id}`;
    if (!own) throw notFound('share not found');
    return (await sql<{ id: string; at: Date; kind: string; ok: boolean; ip: string; user_agent: string; detail: string }[]>`select id::text, at, kind, ok, ip, user_agent, detail from share_access_events where share_id = ${id} order by at desc limit 500`)
      .map((e) => ({ id: e.id, at: e.at, kind: e.kind, ok: e.ok, ip: e.ip, userAgent: e.user_agent, detail: e.detail }));
  });

  // ============================ public side ============================
  const gone = () => new UserError('share_unavailable', 'this link is not available', 404);
  const event = (s: ShareRow, req: FastifyRequest, kind: string, ok: boolean, o: { fileId?: string; detail?: string } = {}) =>
    sql`insert into share_access_events (share_id, kind, ok, ip, user_agent, file_id, detail) values (${s.id}, ${kind}, ${ok}, ${req.ip}, ${String(req.headers['user-agent'] ?? '').slice(0, 300)}, ${o.fileId ?? null}, ${o.detail ?? ''})`;
  const grantName = (s: ShareRow) => `spd_g_${s.id.slice(0, 8)}`;
  const grantKey = () => Buffer.from(hmacHex(masterKey(), 'spd-share-grant-key-v1'), 'hex');
  const grantMac = (s: ShareRow, exp: number) => hmacHex(grantKey(), `share-grant-v1|${s.id}|${s.token_hash}|${s.password_hash ?? ''}|${exp}`);

  /** The share behind a token, if it can still be used at all. Unknown, revoked, expired and orphaned links look the same. */
  async function liveShare(req: FastifyRequest): Promise<ShareRow> {
    const { token } = req.params as { token?: string };
    if (!token || !TOKEN_RE.test(token)) throw gone();
    const [s] = await sql<ShareRow[]>`select s.* from shares s join users u on u.id = s.owner_id and u.disabled_at is null where s.token_hash = ${tokenHash(token)}`;
    if (!s || s.revoked_at || (s.expires_at && s.expires_at < new Date())) throw gone();
    const [live] = s.file_id
      ? await sql`select 1 from files f join file_versions v on v.id = f.current_version_id join storage_objects o on o.id = v.object_id where f.id = ${s.file_id} and f.trashed_at is null and o.scan_status <> 'infected'`
      : await sql`select 1 from folders where id = ${s.folder_id} and trashed_at is null`;
    if (!live) throw gone();
    return s;
  }
  /** A visitor who opened the share (password given, view counted) holds a short-lived grant cookie. */
  async function granted(req: FastifyRequest): Promise<ShareRow> {
    const s = await liveShare(req);
    const [exp, mac] = String(req.cookies[grantName(s)] ?? '').split('.');
    if (!exp || !mac || Number(exp) < Date.now() || !safeEqual(mac, grantMac(s, Number(exp)))) throw new UserError('share_locked', 'open the link first', 401);
    return s;
  }
  /** A live file reachable through the share (the shared file itself, or a file below the shared folder). */
  async function sharedFile(s: ShareRow, fileId: string): Promise<FileRow> {
    const [f] = await sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.id = ${fileId} and f.owner_id = ${s.owner_id} and f.trashed_at is null`;
    if (!f || f.scan_status === 'infected') throw notFound('file not found');
    if (s.file_id ? f.id !== s.file_id : !(await isWithin(sql, s.folder_id!, f.folder_id))) throw notFound('file not found');
    return f;
  }
  const publicFile = (f: FileRow) => { const j = fileJson(f); return { id: j.id, name: j.name, size: j.size, kind: j.kind, updatedAt: j.updatedAt, thumb: j.thumb, previews: previewPlan(j.name) }; };
  const limited = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

  app.get('/api/v1/public/shares/:token', limited(60), async (req) => {
    const s = await liveShare(req);
    return { needsPassword: !!s.password_hash };
  });
  app.post('/api/v1/public/shares/:token/open', limited(20), async (req, reply) => {
    const b = z.object({ password: z.string().max(200).optional() }).parse(req.body ?? {});
    const s = await liveShare(req);
    if (s.password_hash) {
      const [f] = await sql<{ n: number }[]>`select count(*)::int as n from share_access_events where share_id = ${s.id} and kind = 'password' and not ok and at > now() - interval '15 minutes'`;
      if (f!.n >= 20) throw new UserError('too_many_attempts', 'too many attempts, try again later', 429);
      if (!b.password) throw new UserError('password_required', 'this link is protected by a password', 401);
      if (!(await verifyPassword(b.password, s.password_hash))) { await event(s, req, 'password', false); throw new UserError('password_invalid', 'wrong password', 401); }
    }
    // counting the view and checking the limits is one atomic statement: two visitors cannot both take the last view
    const [counted] = await sql<ShareRow[]>`update shares set view_count = view_count + 1, last_access_at = now() where id = ${s.id} and revoked_at is null
      and (expires_at is null or expires_at > now()) and (max_views is null or view_count < max_views) and (not single_use or view_count = 0) returning *`;
    if (!counted) { await event(s, req, 'open', false, { detail: 'limit' }); throw gone(); }
    await event(s, req, 'open', true);
    const exp = Date.now() + (s.single_use ? 15 : 60) * 60_000;
    reply.setCookie(grantName(s), `${exp}.${grantMac(s, exp)}`, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/api/v1/public/shares/', expires: new Date(exp) });
    const [owner] = await sql<{ display_name: string }[]>`select display_name from users where id = ${s.owner_id}`;
    const base = { label: s.label, owner: owner!.display_name, canDownload: s.can_download, expiresAt: s.expires_at };
    if (s.file_id) return { ...base, type: 'file' as const, file: publicFile(await sharedFile(s, s.file_id)) };
    const [d] = await sql<FolderRow[]>`select * from folders where id = ${s.folder_id}`;
    return { ...base, type: 'folder' as const, root: { id: d!.id, name: d!.name } };
  });
  app.get('/api/v1/public/shares/:token/list', limited(120), async (req) => {
    const s = await granted(req);
    if (!s.folder_id) throw notFound();
    const q = z.object({ folder: Id.optional() }).parse(req.query);
    const folderId = q.folder ?? s.folder_id;
    const [d] = await sql<FolderRow[]>`select * from folders where id = ${folderId} and owner_id = ${s.owner_id} and trashed_at is null`;
    if (!d || !(await isWithin(sql, s.folder_id, d.id))) throw notFound('folder not found');
    const [folders, files, crumbs] = await Promise.all([
      sql<FolderRow[]>`select * from folders where parent_id = ${d.id} and trashed_at is null order by name_key limit 5000`,
      sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.folder_id = ${d.id} and f.trashed_at is null and o.scan_status <> 'infected' order by f.name_key limit 5000`,
      // path from the shared folder down, never above it
      sql<{ id: string; name: string; depth: number }[]>`with recursive up as (select id, parent_id, name, 0 as depth from folders where id = ${d.id}
        union all select p.id, p.parent_id, p.name, up.depth + 1 from folders p join up on p.id = up.parent_id where up.id <> ${s.folder_id} and up.depth < 200) select id, name, depth from up order by depth desc`,
    ]);
    return { folder: { id: d.id, name: d.name }, breadcrumbs: crumbs.map((c) => ({ id: c.id, name: c.name })), folders: folders.map((x) => ({ id: x.id, name: x.name, updatedAt: x.updated_at })), files: files.map(publicFile) };
  });
  /** Count a download against the limit, atomically. */
  async function countDownload(s: ShareRow, req: FastifyRequest, fileId?: string): Promise<void> {
    const [ok] = await sql`update shares set download_count = download_count + 1, last_access_at = now() where id = ${s.id} and revoked_at is null and (max_downloads is null or download_count < max_downloads) returning id`;
    if (!ok) { await event(s, req, 'download', false, { fileId, detail: 'limit' }); throw new UserError('download_limit', 'the download limit of this link is reached', 403); }
    await event(s, req, 'download', true, { fileId });
  }
  app.route({ method: 'GET', url: '/api/v1/public/shares/:token/files/:fileId/content', ...limited(600), handler: async (req: FastifyRequest, reply: FastifyReply) => {
    const s = await granted(req);
    const { fileId } = z.object({ fileId: Id, token: z.string() }).parse(req.params);
    const q = z.object({ download: z.string().optional(), as: z.enum(['text']).optional() }).parse(req.query);
    const f = await sharedFile(s, fileId);
    const c = await contentOf(sql, f.id);
    if (q.download) {
      if (!s.can_download) throw new UserError('download_forbidden', 'downloading is not allowed for this link', 403);
      const firstBytes = !req.headers.range || /^bytes=0-/.test(req.headers.range);
      if (req.method === 'GET' && firstBytes) await countDownload(s, req, f.id);
      return sendSealed(req, reply, c, { name: f.name, etag: c.sha256, mode: 'download' });
    }
    // view-only: only what the viewer can display is ever sent
    const kind = previewKind(f.name);
    const viewable = q.as === 'text' ? ['text', 'markdown', 'csv', 'json'].includes(kind) : !!INLINE_MIME[extOf(f.name)];
    if (!viewable) throw new UserError('preview_unsupported', 'no preview for this format', 404);
    return sendSealed(req, reply, c, { name: f.name, etag: c.sha256, mode: q.as === 'text' ? 'text' : 'inline' });
  } });
  app.get('/api/v1/public/shares/:token/files/:fileId/preview/:kind', limited(600), async (req, reply) => {
    const s = await granted(req);
    const p = z.object({ fileId: Id, kind: z.string().max(20), token: z.string() }).parse(req.params);
    const f = await sharedFile(s, p.fileId);
    return sendPreview(sql, req, reply, f.object_id!, p.kind, f.name);
  });
  app.get('/api/v1/public/shares/:token/zip', limited(10), async (req, reply) => {
    const s = await granted(req);
    if (!s.folder_id) throw notFound();
    if (!s.can_download) throw new UserError('download_forbidden', 'downloading is not allowed for this link', 403);
    const q = z.object({ folder: Id.optional() }).parse(req.query);
    const [d] = await sql<FolderRow[]>`select * from folders where id = ${q.folder ?? s.folder_id} and owner_id = ${s.owner_id} and trashed_at is null`;
    if (!d || !(await isWithin(sql, s.folder_id, d.id))) throw notFound('folder not found');
    const entries: ZipEntry[] = [];
    for (const f of await subtreeFiles(sql, d.id)) { const c = await contentOf(sql, f.id); if (c.scan_status !== 'infected') entries.push({ path: f.path, content: c }); }
    if (!entries.length) throw new UserError('empty_selection', 'nothing to download', 400);
    await countDownload(s, req);
    return sendZip(reply, `${d.name}.zip`, entries);
  });
}
