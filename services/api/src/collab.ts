// Private sharing and workspaces. A folder is granted to another account with a role:
//   viewer   — browse, read, preview, download           editor — the same, plus create, rename, move, trash, upload
//   uploader — may only send files in; lists nothing, reads nothing
// Two route families, on purpose. The owner's routes (/folders/:id/members…) are owner-scoped like the rest of the
// API. A grantee never touches those: it goes through /shared/:grantId/…, where EVERY call re-checks that the grant
// is live, that the caller is its grantee, that the target sits inside the granted subtree and that nothing on the
// way is in the trash. A failed check is a 404 (nothing reveals that something exists); a role too weak is a 403.
// Bytes sent through a grant belong to the folder's owner: the owner's quota, the owner's antivirus pipeline.
import { rm } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { MAX_CHUNK_BYTES, safePathSegments, sanitizeName } from '@spd/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorOf, requireUser, userOf } from './auth.ts';
import { ensureObject } from './blob.ts';
import { config, notFound, UserError } from './config.ts';
import { contentOf, sendPreview, sendSealed } from './content.ts';
import { type Actor, audit, type Db, lockOwner, notify, sql, tx } from './db.ts';
import { type ActivityRow, activityJson, activitySelect } from './insights.ts';
import { addFile, createFolder, ensurePath, type FileRow, fileJoin, fileJson, fileSelect, type FolderRow, folderJson, getFile, getFolder, isWithin, moveItems, renameFile, renameFolder, trashItems } from './tree.ts';
import { appendChunk, assertQuota, sealCheck, uploadJson, uploadPath, type UploadRow } from './uploads.ts';

const Id = z.uuid();
const Role = z.enum(['viewer', 'editor', 'uploader']);
type RoleT = z.infer<typeof Role>;
interface Grant { id: string; folder_id: string; owner_id: string; grantee_id: string; role: RoleT; created_at: Date }
const forbidden = () => new UserError('forbidden', 'your role on this shared folder does not allow this', 403);
const CAN = { read: ['viewer', 'editor'], write: ['editor'], upload: ['editor', 'uploader'] } as const;

/** The caller's live grant, or 404. Live = not revoked, its folder not in the trash, its owner not disabled. */
async function grantOf(t: Db, req: FastifyRequest, grantId: string, need: keyof typeof CAN): Promise<Grant> {
  const [g] = await t<Grant[]>`select g.id, g.folder_id, g.owner_id, g.grantee_id, g.role, g.created_at from folder_grants g join folders d on d.id = g.folder_id join users o on o.id = g.owner_id
    where g.id = ${grantId} and g.grantee_id = ${userOf(req).id} and g.revoked_at is null and d.trashed_at is null and d.owner_id = g.owner_id and o.disabled_at is null`;
  if (!g) throw notFound();
  if (!(CAN[need] as readonly string[]).includes(g.role)) throw forbidden();
  return g;
}
/** A live folder inside the grant (the granted folder itself when no id is given), or 404. */
async function folderIn(t: Db, g: Grant, folderId?: string): Promise<FolderRow> {
  const f = await getFolder(t, g.owner_id, folderId ?? g.folder_id).catch(() => { throw notFound(); });
  // trashing a folder trashes its whole live subtree, so a live granted folder never hangs below a trashed one
  if (f.id !== g.folder_id && !(await isWithin(t, g.folder_id, f.id))) throw notFound();
  return f;
}
/** A live file inside the grant, or 404. */
async function fileIn(t: Db, g: Grant, fileId: string): Promise<FileRow> {
  const f = await getFile(t, g.owner_id, fileId).catch(() => { throw notFound(); });
  if (!(await isWithin(t, g.folder_id, f.folder_id))) throw notFound();
  return f;
}
/** What a grantee sees of a folder: never the owner's ids above the granted folder. */
const sharedFolderJson = (f: FolderRow, g: Grant) => ({ ...folderJson(f), parentId: f.id === g.folder_id ? null : f.parent_id, isGrantRoot: f.id === g.folder_id });
/** Path from the granted folder down to `folder` (the owner's tree above it stays hidden). */
async function crumbsIn(t: Db, g: Grant, folder: FolderRow): Promise<{ id: string; name: string }[]> {
  const rows = await t<{ id: string; name: string; depth: number }[]>`
    with recursive up as (select id, parent_id, name, 0 as depth from folders where id = ${folder.id}
      union all select p.id, p.parent_id, p.name, up.depth + 1 from folders p join up on p.id = up.parent_id where up.id <> ${g.folder_id} and up.depth < 200)
    select id, name, depth from up order by depth desc`;
  const start = rows.findIndex((r) => r.id === g.folder_id);
  return rows.slice(Math.max(0, start)).map((r) => ({ id: r.id, name: r.name }));
}
/** The grantee acts, the owner's trail records it. */
const actorIn = (req: FastifyRequest): Actor => actorOf(req);
const auditIn = (t: Db, req: FastifyRequest, g: Grant, action: string, o: { targetType?: string; targetId?: string; meta?: Record<string, unknown> } = {}) =>
  audit(t, actorIn(req), action, { ownerId: g.owner_id, ...o, meta: { ...o.meta, grantId: g.id, via: 'grant' } });

export function collabRoutes(app: FastifyInstance): void {
  const authed = { preHandler: requireUser };

  // =================================================== owner side ===================================================
  /** Find an account by its exact address. No listing, no partial match, tight limits: this cannot enumerate accounts. */
  app.post('/api/v1/collab/resolve', { ...authed, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ email: z.email().max(200) }).parse(req.body);
    const me = userOf(req);
    const [u] = await sql<{ id: string; display_name: string }[]>`select id, display_name from users where email = ${b.email} and disabled_at is null and id <> ${me.id}`;
    if (!u) throw notFound('no account with this address');
    return { userId: u.id, displayName: u.display_name };
  });

  const ownFolder = async (t: Db, ownerId: string, id: string) => {
    const f = await getFolder(t, ownerId, id);
    if (!f.parent_id) throw new UserError('root_immutable', 'the root folder cannot be shared', 400);
    return f;
  };
  interface MemberRow { id: string; grantee_id: string; role: RoleT; created_at: Date; display_name: string; email: string }
  const memberJson = (m: MemberRow) => ({ grantId: m.id, userId: m.grantee_id, displayName: m.display_name, email: m.email, role: m.role, createdAt: m.created_at });
  const membersOf = (t: Db, folderId: string) => t<MemberRow[]>`select g.id, g.grantee_id, g.role, g.created_at, u.display_name, u.email from folder_grants g join users u on u.id = g.grantee_id
    where g.folder_id = ${folderId} and g.revoked_at is null order by g.created_at`;

  app.get('/api/v1/folders/:id/members', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const f = await ownFolder(sql, userOf(req).id, id);
    return { folder: folderJson(f), members: (await membersOf(sql, f.id)).map(memberJson) };
  });
  app.post('/api/v1/folders/:id/members', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const b = z.object({ userId: Id.optional(), email: z.email().max(200).optional(), role: Role, workspaceName: z.string().trim().min(1).max(80).optional() }).refine((x) => !!x.userId !== !!x.email, 'give userId or email').parse(req.body);
    const me = userOf(req);
    return tx(async (t) => {
      await lockOwner(t, me.id);
      const f = await ownFolder(t, me.id, id);
      const [target] = await t<{ id: string; display_name: string; email: string }[]>`select id, display_name, email from users where disabled_at is null and id <> ${me.id} and ${b.userId ? t`id = ${b.userId}` : t`email = ${b.email!}`}`;
      if (!target) throw notFound('no such account');
      const [g] = await t<{ id: string; created_at: Date }[]>`insert into folder_grants (folder_id, owner_id, grantee_id, role) values (${f.id}, ${me.id}, ${target.id}, ${b.role})
        on conflict (folder_id, grantee_id) where revoked_at is null do nothing returning id, created_at`;
      if (!g) throw new UserError('already_member', 'this account already has access to this folder', 409);
      if (b.workspaceName) await t`update folders set workspace_name = ${sanitizeName(b.workspaceName)} where id = ${f.id}`;
      await audit(t, actorOf(req), 'collab.member_added', { targetType: 'folder', targetId: f.id, meta: { grantId: g.id, userId: target.id, role: b.role } });
      await notify(t, target.id, 'collab.shared', { grantId: g.id, role: b.role, folderName: b.workspaceName ?? f.workspace_name ?? f.name, ownerName: me.display_name });
      return memberJson({ id: g.id, grantee_id: target.id, role: b.role, created_at: g.created_at, display_name: target.display_name, email: target.email });
    });
  });
  app.patch('/api/v1/folders/:id/members/:userId', authed, async (req) => {
    const p = z.object({ id: Id, userId: Id }).parse(req.params);
    const b = z.object({ role: Role }).parse(req.body);
    const me = userOf(req);
    return tx(async (t) => {
      const f = await ownFolder(t, me.id, p.id);
      const [g] = await t<{ id: string }[]>`update folder_grants set role = ${b.role} where folder_id = ${f.id} and owner_id = ${me.id} and grantee_id = ${p.userId} and revoked_at is null returning id`;
      if (!g) throw notFound('member not found');
      // an upload begun under the former role does not outlive it
      if (b.role === 'viewer') await t`update uploads set status = 'aborted', updated_at = now() where grant_id = ${g.id} and status = 'active'`;
      await audit(t, actorOf(req), 'collab.member_updated', { targetType: 'folder', targetId: f.id, meta: { grantId: g.id, userId: p.userId, role: b.role } });
      await notify(t, p.userId, 'collab.role_changed', { grantId: g.id, role: b.role, folderName: f.workspace_name ?? f.name, ownerName: me.display_name });
      const [m] = (await membersOf(t, f.id)).filter((x) => x.grantee_id === p.userId);
      return memberJson(m!);
    });
  });
  app.delete('/api/v1/folders/:id/members/:userId', authed, async (req) => {
    const p = z.object({ id: Id, userId: Id }).parse(req.params);
    const me = userOf(req);
    const stale = await tx(async (t) => {
      // the folder may sit in the trash: access must still be removable
      const [f] = await t<FolderRow[]>`select * from folders where id = ${p.id} and owner_id = ${me.id}`;
      if (!f) throw notFound('folder not found');
      const [g] = await t<{ id: string }[]>`update folder_grants set revoked_at = now() where folder_id = ${f.id} and owner_id = ${me.id} and grantee_id = ${p.userId} and revoked_at is null returning id`;
      if (!g) throw notFound('member not found');
      const ups = await t<UploadRow[]>`update uploads set status = 'aborted', updated_at = now() where grant_id = ${g.id} and status in ('active', 'completing') returning *, size::text, received::text`;
      await audit(t, actorOf(req), 'collab.member_removed', { targetType: 'folder', targetId: f.id, meta: { grantId: g.id, userId: p.userId } });
      await notify(t, p.userId, 'collab.revoked', { grantId: g.id, folderName: f.workspace_name ?? f.name, ownerName: me.display_name });
      return ups;
    });
    for (const u of stale) await rm(uploadPath(u), { force: true });
    return { ok: true };
  });
  /** Name (or un-name) a workspace: a shared folder with a name of its own for its members. */
  app.patch('/api/v1/folders/:id/workspace', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const b = z.object({ name: z.string().trim().min(1).max(80).nullable() }).parse(req.body);
    const me = userOf(req);
    return tx(async (t) => {
      await lockOwner(t, me.id);
      const f = await ownFolder(t, me.id, id);
      const [r] = await t<FolderRow[]>`update folders set workspace_name = ${b.name === null ? null : sanitizeName(b.name)} where id = ${f.id} returning *`;
      await audit(t, actorOf(req), 'collab.workspace_named', { targetType: 'folder', targetId: f.id, meta: { named: b.name !== null } });
      return folderJson(r!);
    });
  });
  /** Folders this account shares with others (badges in the explorer, the "shared by me" view). */
  app.get('/api/v1/collab/outgoing', authed, async (req) => {
    const me = userOf(req);
    const rows = await sql<(FolderRow & { members: number })[]>`select d.*, (select count(*)::int from folder_grants g where g.folder_id = d.id and g.revoked_at is null) as members
      from folders d where d.owner_id = ${me.id} and d.trashed_at is null and exists (select 1 from folder_grants g where g.folder_id = d.id and g.revoked_at is null) order by d.name_key limit 1000`;
    return rows.map((r) => ({ folder: folderJson(r), members: r.members }));
  });
  /** Everything that happened in a folder of mine and below it, members' actions included. */
  app.get('/api/v1/folders/:id/activity', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const q = z.object({ before: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const me = userOf(req);
    const f = await getFolder(sql, me.id, id);
    return subtreeActivity(me.id, f.id, me.id, q);
  });

  // ================================================== grantee side ==================================================
  app.get('/api/v1/shared-with-me', authed, async (req) => {
    const me = userOf(req);
    const rows = await sql<(Grant & { owner_name: string; name: string; workspace_name: string | null; updated_at: Date })[]>`
      select g.id, g.folder_id, g.owner_id, g.grantee_id, g.role, g.created_at, o.display_name as owner_name, d.name, d.workspace_name, d.updated_at
      from folder_grants g join folders d on d.id = g.folder_id join users o on o.id = g.owner_id
      where g.grantee_id = ${me.id} and g.revoked_at is null and d.trashed_at is null and o.disabled_at is null order by g.created_at desc limit 1000`;
    return rows.map((r) => ({ grantId: r.id, role: r.role, owner: { displayName: r.owner_name }, folder: { id: r.folder_id, name: r.name, workspaceName: r.workspace_name, updatedAt: r.updated_at }, createdAt: r.created_at }));
  });

  const G = z.object({ grantId: Id });
  app.get('/api/v1/shared/:grantId/children', authed, async (req) => {
    const { grantId } = G.parse(req.params);
    const q = z.object({ folderId: Id.optional() }).parse(req.query);
    const g = await grantOf(sql, req, grantId, 'read');
    const folder = await folderIn(sql, g, q.folderId);
    const [folders, files, crumbs] = await Promise.all([
      sql<FolderRow[]>`select d.* from folders d where d.parent_id = ${folder.id} and d.owner_id = ${g.owner_id} and d.trashed_at is null order by d.name_key, d.id limit 5000`,
      sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.folder_id = ${folder.id} and f.owner_id = ${g.owner_id} and f.trashed_at is null order by f.name_key, f.id limit 5000`,
      crumbsIn(sql, g, folder),
    ]);
    return { grantId: g.id, role: g.role, folder: sharedFolderJson(folder, g), breadcrumbs: crumbs, folders: folders.map((d) => sharedFolderJson(d, g)), files: files.map(sharedFileJson) };
  });
  app.get('/api/v1/shared/:grantId/files/:fileId', authed, async (req) => {
    const p = G.extend({ fileId: Id }).parse(req.params);
    const g = await grantOf(sql, req, p.grantId, 'read');
    const f = await fileIn(sql, g, p.fileId);
    const [folder] = await sql<FolderRow[]>`select * from folders where id = ${f.folder_id}`;
    return { grantId: g.id, role: g.role, file: sharedFileJson(f), path: await crumbsIn(sql, g, folder!) };
  });
  app.route({ method: 'GET', url: '/api/v1/shared/:grantId/files/:fileId/content', ...authed, handler: async (req, reply) => {
    const p = G.extend({ fileId: Id }).parse(req.params);
    const q = z.object({ download: z.string().optional(), as: z.enum(['text']).optional() }).parse(req.query);
    const g = await grantOf(sql, req, p.grantId, 'read');
    const f = await fileIn(sql, g, p.fileId);
    const c = await contentOf(sql, f.id);
    if (c.scan_status === 'infected') throw new UserError('infected', 'this file was flagged by the antivirus', 451); // a member never takes an infected file out
    if (q.download && !req.headers.range) await auditIn(sql, req, g, 'file.downloaded', { targetType: 'file', targetId: f.id });
    return sendSealed(req, reply, c, { name: f.name, etag: c.sha256, mode: q.download ? 'download' : q.as === 'text' ? 'text' : 'inline' });
  } });
  app.get('/api/v1/shared/:grantId/files/:fileId/preview/:kind', authed, async (req, reply) => {
    const p = G.extend({ fileId: Id, kind: z.string().max(20) }).parse(req.params);
    const g = await grantOf(sql, req, p.grantId, 'read');
    const f = await fileIn(sql, g, p.fileId);
    const c = await contentOf(sql, f.id);
    if (c.scan_status === 'infected') throw new UserError('infected', 'this file was flagged by the antivirus', 451);
    return sendPreview(sql, req, reply, c.object_id, p.kind, f.name);
  });
  app.get('/api/v1/shared/:grantId/activity', authed, async (req) => {
    const { grantId } = G.parse(req.params);
    const q = z.object({ before: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const g = await grantOf(sql, req, grantId, 'read');
    await folderIn(sql, g);
    return subtreeActivity(g.owner_id, g.folder_id, userOf(req).id, q);
  });

  // --- editor ---
  app.post('/api/v1/shared/:grantId/folders', authed, async (req) => {
    const { grantId } = G.parse(req.params);
    const b = z.object({ parentId: Id.optional(), name: z.string().min(1).max(1000), onConflict: z.enum(['fail', 'rename']).default('fail') }).parse(req.body);
    return tx(async (t) => {
      const g = await grantOf(t, req, grantId, 'write');
      await lockOwner(t, g.owner_id);
      const parent = await folderIn(t, g, b.parentId);
      const f = await createFolder(t, g.owner_id, parent.id, b.name, b.onConflict);
      await auditIn(t, req, g, 'folder.created', { targetType: 'folder', targetId: f.id });
      return sharedFolderJson(f, g);
    });
  });
  /** Rename an item, or move it to another folder of the same grant. The granted folder itself is the owner's to change. */
  app.patch('/api/v1/shared/:grantId/items/:id', authed, async (req) => {
    const p = G.extend({ id: Id }).parse(req.params);
    const b = z.object({ name: z.string().min(1).max(1000).optional(), parentId: Id.optional(), onConflict: z.enum(['fail', 'rename']).default('fail') }).refine((x) => x.name !== undefined || x.parentId !== undefined, 'nothing to change').parse(req.body);
    return tx(async (t) => {
      const g = await grantOf(t, req, p.grantId, 'write');
      await lockOwner(t, g.owner_id);
      const [isFolder] = await t`select 1 from folders where id = ${p.id} and owner_id = ${g.owner_id}`;
      if (isFolder) {
        const d = await folderIn(t, g, p.id);
        if (d.id === g.folder_id) throw forbidden();
        if (b.parentId) { const dest = await folderIn(t, g, b.parentId); await moveItems(t, g.owner_id, { fileIds: [], folderIds: [d.id] }, dest.id, b.onConflict); await auditIn(t, req, g, 'items.moved', { meta: { files: 0, folders: 1, folderIds: [d.id], destinationId: dest.id } }); }
        if (b.name !== undefined) { await renameFolder(t, g.owner_id, d.id, b.name); await auditIn(t, req, g, 'folder.renamed', { targetType: 'folder', targetId: d.id, meta: { from: d.name } }); }
        return sharedFolderJson(await folderIn(t, g, d.id), g);
      }
      const f = await fileIn(t, g, p.id);
      if (b.parentId) { const dest = await folderIn(t, g, b.parentId); await moveItems(t, g.owner_id, { fileIds: [f.id], folderIds: [] }, dest.id, b.onConflict); await auditIn(t, req, g, 'items.moved', { meta: { files: 1, folders: 0, fileIds: [f.id], destinationId: dest.id } }); }
      if (b.name !== undefined) { await renameFile(t, g.owner_id, f.id, b.name); await auditIn(t, req, g, 'file.renamed', { targetType: 'file', targetId: f.id, meta: { from: f.name } }); }
      return sharedFileJson(await fileIn(t, g, f.id));
    });
  });
  /** Move items of the grant to the OWNER's trash (the owner alone restores or purges). */
  app.post('/api/v1/shared/:grantId/trash', authed, async (req) => {
    const { grantId } = G.parse(req.params);
    const b = z.object({ fileIds: z.array(Id).max(500).default([]), folderIds: z.array(Id).max(500).default([]) }).refine((s) => s.fileIds.length + s.folderIds.length > 0, 'empty selection').parse(req.body);
    await tx(async (t) => {
      const g = await grantOf(t, req, grantId, 'write');
      await lockOwner(t, g.owner_id);
      for (const id of b.folderIds) { const d = await folderIn(t, g, id); if (d.id === g.folder_id) throw forbidden(); }
      for (const id of b.fileIds) await fileIn(t, g, id);
      await trashItems(t, g.owner_id, b);
      await auditIn(t, req, g, 'items.trashed', { meta: { files: b.fileIds.length, folders: b.folderIds.length, fileIds: b.fileIds.slice(0, 200), folderIds: b.folderIds.slice(0, 200) } });
    });
    return { ok: true };
  });

  // --- uploads through a grant (editor and uploader): same resumable protocol as /api/v1/uploads ---
  /** The caller's own upload on this grant; re-checks the grant and the role on every call. */
  const uploadIn = async (t: Db, req: FastifyRequest, grantId: string, id: string) => {
    const g = await grantOf(t, req, grantId, 'upload');
    const [u] = await t<UploadRow[]>`select *, size::text, received::text from uploads where id = ${id} and grant_id = ${g.id} and actor_user_id = ${g.grantee_id}`;
    if (!u) throw notFound('upload not found');
    return { g, u };
  };
  app.post('/api/v1/shared/:grantId/uploads', authed, async (req) => {
    const { grantId } = G.parse(req.params);
    const b = z.object({ folderId: Id.optional(), name: z.string().min(1).max(1000), size: z.number().int().min(0), relativePath: z.string().max(4000).optional(), onConflict: z.enum(['fail', 'rename', 'version']).default('rename') }).parse(req.body);
    if (b.size > config.maxFileBytes) throw new UserError('file_too_large', 'file exceeds the maximum size', 413, { max: config.maxFileBytes });
    const row = await tx(async (t) => {
      const g = await grantOf(t, req, grantId, 'upload');
      // an uploader adds files; it never replaces one it cannot see
      if (g.role === 'uploader' && b.onConflict !== 'rename') throw forbidden();
      await lockOwner(t, g.owner_id);
      await assertQuota(t, g.owner_id, b.size); // the owner's quota
      let folderId = (await folderIn(t, g, b.folderId)).id;
      const segs = b.relativePath ? safePathSegments(b.relativePath).slice(0, -1) : [];
      if (segs.length) folderId = await ensurePath(t, g.owner_id, folderId, segs);
      const [r] = await t<UploadRow[]>`insert into uploads (owner_id, actor_user_id, grant_id, folder_id, name, size, on_conflict, expires_at)
        values (${g.owner_id}, ${g.grantee_id}, ${g.id}, ${folderId}, ${sanitizeName(b.name)}, ${b.size}, ${b.onConflict}, now() + interval '7 days') returning *, size::text, received::text`;
      return r!;
    });
    return uploadJson(row);
  });
  app.get('/api/v1/shared/:grantId/uploads/:id', authed, async (req) => {
    const p = G.extend({ id: Id }).parse(req.params);
    return uploadJson((await uploadIn(sql, req, p.grantId, p.id)).u);
  });
  app.patch('/api/v1/shared/:grantId/uploads/:id', { ...authed, bodyLimit: MAX_CHUNK_BYTES + 4096 }, async (req) => {
    const p = G.extend({ id: Id }).parse(req.params);
    const q = z.object({ offset: z.coerce.number().int().min(0) }).parse(req.query);
    const sha = req.headers['x-chunk-sha256'];
    const u = await appendChunk(p.id, q.offset, req.body as Readable, typeof sha === 'string' ? z.string().regex(/^[0-9a-fA-F]{64}$/).parse(sha) : undefined,
      async (t, row) => { const g = await grantOf(t, req, p.grantId, 'upload'); if (row.grant_id !== g.id || row.actor_user_id !== g.grantee_id) throw notFound('upload not found'); });
    return uploadJson(u);
  });
  app.delete('/api/v1/shared/:grantId/uploads/:id', authed, async (req) => {
    const p = G.extend({ id: Id }).parse(req.params);
    const { u } = await uploadIn(sql, req, p.grantId, p.id);
    const [gone] = await sql<UploadRow[]>`update uploads set status = 'aborted', updated_at = now() where id = ${u.id} and status = 'active' returning *, size::text, received::text`;
    if (!gone) throw notFound('upload not found');
    await rm(uploadPath(gone), { force: true });
    return { ok: true };
  });
  app.post('/api/v1/shared/:grantId/uploads/:id/complete', authed, async (req) => {
    const p = G.extend({ id: Id }).parse(req.params);
    const b = z.object({ sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional() }).parse(req.body ?? {});
    const first = await uploadIn(sql, req, p.grantId, p.id);
    const done = (u: UploadRow, f: FileRow, g: Grant) => ({ ...uploadJson(u), file: g.role === 'uploader' ? { id: f.id, name: f.name, size: Number(f.size) } : sharedFileJson(f) });
    const [claimed] = await sql<UploadRow[]>`update uploads set status = 'completing', updated_at = now() where id = ${p.id} and grant_id = ${first.g.id} and actor_user_id = ${first.g.grantee_id} and status = 'active' returning *, size::text, received::text`;
    if (!claimed) {
      if (first.u.status === 'done' && first.u.file_id) { const f = await getFile(sql, first.g.owner_id, first.u.file_id, { trashed: true }).catch(() => null); if (f) return done(first.u, f, first.g); }
      throw new UserError('upload_closed', 'this upload is no longer active', 409);
    }
    try {
      const sha = await sealCheck(claimed, b.sha256);
      const result = await tx(async (t) => {
        const g = await grantOf(t, req, p.grantId, 'upload'); // revoked while the bytes travelled: nothing is placed
        await lockOwner(t, g.owner_id);
        await assertQuota(t, g.owner_id, Number(claimed.size), claimed.id);
        const folder = await folderIn(t, g, claimed.folder_id ?? undefined).catch(() => folderIn(t, g)); // target trashed meanwhile → the granted folder
        const [object] = await ensureObject(t, g.owner_id, uploadPath(claimed), Number(claimed.size), sha);
        const { file, created } = await addFile(t, { ownerId: g.owner_id, folderId: folder.id, name: claimed.name, object, onConflict: g.role === 'uploader' ? 'rename' : claimed.on_conflict, actorId: g.grantee_id });
        const [row] = await t<UploadRow[]>`update uploads set status = 'done', file_id = ${file.id}, updated_at = now() where id = ${claimed.id} returning *, size::text, received::text`;
        await auditIn(t, req, g, created ? 'file.uploaded' : 'file.version_added', { targetType: 'file', targetId: file.id, meta: { size: Number(claimed.size) } });
        // one unread notice per grant is enough for the owner: a folder of a thousand files is one event
        const [pendingNotice] = await t`select 1 from notifications where user_id = ${g.owner_id} and kind = 'collab.upload' and read_at is null and data->>'grantId' = ${g.id} and created_at > now() - interval '30 minutes'`;
        if (!pendingNotice) await notify(t, g.owner_id, 'collab.upload', { grantId: g.id, folderId: g.folder_id, byName: userOf(req).display_name });
        return { ...done(row!, file, g), created };
      });
      await rm(uploadPath(claimed), { force: true });
      return result;
    } catch (e) {
      await sql`update uploads set status = 'active' where id = ${claimed.id} and status = 'completing'`;
      throw e;
    }
  });
}

/** A file as a member sees it: no tags (they are the owner's private labels). */
const sharedFileJson = (f: FileRow) => ({ ...fileJson(f), tagIds: [] as string[], starred: false });

/** Audit events about a folder and everything live below it. `viewer` is the account reading (for the `me` flag). */
async function subtreeActivity(ownerId: string, folderId: string, viewer: string, q: { before?: number; limit: number }) {
  const folders = (await sql<{ id: string }[]>`with recursive sub as (select id, 0 as depth from folders where id = ${folderId} and owner_id = ${ownerId}
    union all select c.id, sub.depth + 1 from folders c join sub on c.parent_id = sub.id where sub.depth < 100) select id from sub limit 5000`).map((r) => r.id);
  const files = (await sql<{ id: string }[]>`select id from files where owner_id = ${ownerId} and folder_id = any(${folders}) limit 20000`).map((r) => r.id);
  const rows = await sql<ActivityRow[]>`select ${activitySelect(sql)} from audit_events e where e.owner_id = ${ownerId} ${q.before ? sql`and e.id < ${q.before}` : sql``}
    and ((e.target_type = 'folder' and e.target_id = any(${folders})) or (e.target_type = 'file' and e.target_id = any(${files})) or e.meta->'fileIds' ?| ${files} or e.meta->'folderIds' ?| ${folders} or e.meta->>'destinationId' = any(${folders}))
    order by e.id desc limit ${q.limit + 1}`;
  return { events: rows.slice(0, q.limit).map((e) => activityJson(e, viewer)), more: rows.length > q.limit };
}
