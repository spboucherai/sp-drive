// Read-only views over what the drive already records: activity (the audit trail), storage, upload history, versions,
// similar images. Every query is scoped by owner; nothing here deletes or changes anything.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requireUser, userOf } from './auth.ts';
import { usedBytes } from './blob.ts';
import { KIND_EXT } from './collections.ts';
import { notFound, UserError } from './config.ts';
import { contentOf, sendSealed } from './content.ts';
import { audit, type Db, sql } from './db.ts';
import { breadcrumbs, type FileRow, fileJoin, fileJson, fileSelect, type FolderRow, folderJson, getFile, getFolder } from './tree.ts';

const Id = z.uuid();

// --- activity ------------------------------------------------------------------------------------------------
/** Actions that tell the story of files and folders (sign-ins and security changes live in /account/activity). */
const FILE_ACTIONS = ['file.uploaded', 'file.version_added', 'file.version_restored', 'file.version_deleted', 'file.renamed', 'file.downloaded', 'folder.created', 'folder.renamed', 'items.moved', 'items.copied',
  'items.trashed', 'items.restored', 'items.purged', 'zip.downloaded', 'share.created', 'share.updated', 'share.revoked', 'share.deleted', 'share.rotated', 'submission.completed', 'scan.infected',
  'collab.member_added', 'collab.member_updated', 'collab.member_removed', 'collab.workspace_named'];
export interface ActivityRow { id: string; at: Date; action: string; actor_kind: string; actor_user_id: string | null; actor_name: string | null; target_type: string; target_id: string; meta: Record<string, unknown>; target_name?: string | null }
export const activitySelect = (t: Db) => t`e.id::text, e.at, e.action, e.actor_kind, e.actor_user_id, (select display_name from users x where x.id = e.actor_user_id) as actor_name, e.target_type, e.target_id, e.meta,
  case e.target_type when 'file' then (select f.name from files f where f.id = nullif(e.target_id, '')::uuid and f.owner_id = e.owner_id)
    when 'folder' then (select d.name from folders d where d.id = nullif(e.target_id, '')::uuid and d.owner_id = e.owner_id and d.parent_id is not null) end as target_name`;
export const activityJson = (e: ActivityRow, me: string) => ({
  id: e.id, at: e.at, action: e.action,
  actor: { kind: e.actor_kind, userId: e.actor_user_id, displayName: e.actor_kind === 'system' ? null : e.actor_name, me: e.actor_user_id === me },
  // `name` is the present name of a file or folder that still exists (null once purged, for the root, and for other target types)
  target: e.target_type ? { type: e.target_type, id: e.target_id, name: e.target_name ?? null } : null, meta: e.meta,
});
/** Events about one file: aimed at it, or a bulk operation that names it. */
export const aboutFile = (t: Db, fileId: string) => t`((e.target_type = 'file' and e.target_id = ${fileId}) or e.meta->'fileIds' ? ${fileId} or e.meta->>'fileId' = ${fileId})`;
const Page = z.object({ before: z.coerce.number().int().min(1).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

// --- storage -------------------------------------------------------------------------------------------------
const kindOfExt = (ext: string) => Object.entries(KIND_EXT).find(([, list]) => list.includes(ext))?.[0] ?? 'other';
/** Files and bytes below each direct child of a folder (live items only), plus the files directly inside it. */
async function childSizes(ownerId: string, folderId: string) {
  return sql<{ id: string; files: number; bytes: string }[]>`
    with recursive sub as (select id, id as top, 0 as depth from folders where parent_id = ${folderId} and owner_id = ${ownerId} and trashed_at is null
      union all select c.id, sub.top, sub.depth + 1 from folders c join sub on c.parent_id = sub.id where c.trashed_at is null and sub.depth < 100)
    select sub.top as id, count(f.id)::int as files, coalesce(sum(f.size), 0)::text as bytes from sub left join files f on f.folder_id = sub.id and f.trashed_at is null group by sub.top`;
}
async function folderBreakdown(ownerId: string, folder: FolderRow) {
  const [children, sizes, direct] = await Promise.all([
    sql<FolderRow[]>`select * from folders where parent_id = ${folder.id} and owner_id = ${ownerId} and trashed_at is null order by name_key limit 2000`,
    childSizes(ownerId, folder.id),
    sql<{ files: number; bytes: string }[]>`select count(*)::int as files, coalesce(sum(size), 0)::text as bytes from files where folder_id = ${folder.id} and owner_id = ${ownerId} and trashed_at is null`,
  ]);
  const by = new Map(sizes.map((s) => [s.id, s]));
  const rows = children.map((c) => ({ folder: folderJson(c), files: by.get(c.id)?.files ?? 0, bytes: Number(by.get(c.id)?.bytes ?? 0) })).sort((a, b) => b.bytes - a.bytes);
  return { children: rows, direct: { files: direct[0]!.files, bytes: Number(direct[0]!.bytes) } };
}

// --- similar images ------------------------------------------------------------------------------------------
const popcount32 = (x: number) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
/** Number of differing bits between two 64-bit hashes written as sixteen hexadecimal digits. */
export const hamming = (a: string, b: string) => popcount32((parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) >>> 0) + popcount32((parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16)) >>> 0);
const SIMILAR_MAX_IMAGES = 6000;
/** Groups of live images that look alike (different bytes, close perceptual hashes). Single linkage, capped. */
async function similarImages(ownerId: string, distance: number) {
  const rows = await sql<(FileRow & { dhash: string })[]>`select ${fileSelect(sql)}, h.dhash from files f ${fileJoin(sql)} join object_phash h on h.object_id = o.id
    where f.owner_id = ${ownerId} and f.trashed_at is null order by f.created_at limit ${SIMILAR_MAX_IMAGES}`;
  // a blank or single-colour picture hashes to all zeros or all ones: such hashes say nothing about likeness
  const usable = rows.filter((r) => !/^(0{16}|f{16})$/.test(r.dhash));
  const hi = usable.map((r) => parseInt(r.dhash.slice(0, 8), 16)), lo = usable.map((r) => parseInt(r.dhash.slice(8), 16));
  const parent = usable.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const worst = new Map<string, number>();
  for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) {
    if (usable[i]!.sha256 === usable[j]!.sha256) continue; // identical bytes are the business of mode=exact
    const d = popcount32((hi[i]! ^ hi[j]!) >>> 0) + popcount32((lo[i]! ^ lo[j]!) >>> 0);
    if (d <= distance) { const a = find(i), b = find(j); if (a !== b) parent[b] = a; worst.set(`${i}:${j}`, d); }
  }
  const groups = new Map<number, number[]>();
  usable.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); });
  return [...groups.values()].filter((g) => new Set(g.map((i) => usable[i]!.sha256)).size > 1).map((g) => {
    let max = 0; for (const [k, d] of worst) { const [a, b] = k.split(':').map(Number); if (g.includes(a!) && g.includes(b!)) max = Math.max(max, d); }
    return { maxDistance: max, files: g.map((i) => ({ ...fileJson(usable[i]!), dhash: usable[i]!.dhash })) };
  }).sort((a, b) => b.files.length - a.files.length).slice(0, 500);
}
/** Groups of live files with identical content; `distinctNames` flags "same content, different names". */
async function exactDuplicates(ownerId: string) {
  const files = await sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.owner_id = ${ownerId} and f.trashed_at is null and f.size > 0
    and (f.sha256, f.size) in (select sha256, size from files where owner_id = ${ownerId} and trashed_at is null and size > 0 group by sha256, size having count(*) > 1)
    order by f.size desc, f.sha256, f.created_at limit 2000`;
  const groups = new Map<string, ReturnType<typeof fileJson>[]>();
  for (const f of files) { const k = `${f.sha256}:${f.size}`; groups.set(k, [...(groups.get(k) ?? []), fileJson(f)]); }
  return [...groups.values()].map((g) => ({ sha256: g[0]!.sha256, size: g[0]!.size, distinctNames: new Set(g.map((f) => f.name.normalize('NFC').toLowerCase())).size > 1, files: g }));
}
export async function duplicates(ownerId: string, query: unknown) {
  const q = z.object({ mode: z.enum(['exact', 'similar-images']).default('exact'), distance: z.coerce.number().int().min(0).max(16).default(6) }).parse(query);
  return q.mode === 'exact' ? { mode: q.mode, groups: await exactDuplicates(ownerId) } : { mode: q.mode, distance: q.distance, groups: await similarImages(ownerId, q.distance) };
}

export function insightRoutes(app: FastifyInstance): void {
  const authed = { preHandler: requireUser };

  app.get('/api/v1/files/:id/activity', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const q = Page.parse(req.query), u = userOf(req);
    await getFile(sql, u.id, id, { trashed: true });
    const rows = await sql<ActivityRow[]>`select ${activitySelect(sql)} from audit_events e where e.owner_id = ${u.id} and ${aboutFile(sql, id)} ${q.before ? sql`and e.id < ${q.before}` : sql``} order by e.id desc limit ${q.limit + 1}`;
    return { events: rows.slice(0, q.limit).map((e) => activityJson(e, u.id)), more: rows.length > q.limit };
  });
  app.get('/api/v1/activity', authed, async (req) => {
    const q = Page.parse(req.query), u = userOf(req);
    const rows = await sql<ActivityRow[]>`select ${activitySelect(sql)} from audit_events e where e.owner_id = ${u.id} and e.action = any(${FILE_ACTIONS}) ${q.before ? sql`and e.id < ${q.before}` : sql``} order by e.id desc limit ${q.limit + 1}`;
    return { events: rows.slice(0, q.limit).map((e) => activityJson(e, u.id)), more: rows.length > q.limit };
  });

  app.get('/api/v1/storage/overview', authed, async (req) => {
    const u = userOf(req);
    const root = await getFolder(sql, u.id, 'root');
    const [quota, used, counts, kinds, largest, growth, dup, breakdown] = await Promise.all([
      sql<{ limit_bytes: string }[]>`select limit_bytes::text from quotas where user_id = ${u.id}`,
      usedBytes(sql, u.id),
      sql<{ files: number; folders: number; versions: number; trashed_files: number; live_bytes: string; trash_bytes: string; old_version_bytes: string; uploading: string }[]>`select
        (select count(*)::int from files where owner_id = ${u.id} and trashed_at is null) as files,
        (select count(*)::int from folders where owner_id = ${u.id} and trashed_at is null and parent_id is not null) as folders,
        (select count(*)::int from file_versions v join files f on f.id = v.file_id where f.owner_id = ${u.id}) as versions,
        (select count(*)::int from files where owner_id = ${u.id} and trashed_at is not null) as trashed_files,
        (select coalesce(sum(size), 0)::text from files where owner_id = ${u.id} and trashed_at is null) as live_bytes,
        -- bytes only the trash still needs: objects no live file's current version uses, but a trashed file's does
        (select coalesce(sum(o.size), 0)::text from storage_objects o where o.owner_id = ${u.id}
          and exists (select 1 from files f join file_versions v on v.id = f.current_version_id where v.object_id = o.id and f.trashed_at is not null)
          and not exists (select 1 from files f join file_versions v on v.id = f.current_version_id where v.object_id = o.id and f.trashed_at is null)) as trash_bytes,
        -- bytes only old versions still need: objects that are nobody's current version
        (select coalesce(sum(o.size), 0)::text from storage_objects o where o.owner_id = ${u.id}
          and not exists (select 1 from files f join file_versions v on v.id = f.current_version_id where v.object_id = o.id)) as old_version_bytes,
        (select coalesce(sum(size), 0)::text from uploads where owner_id = ${u.id} and status in ('active', 'completing')) as uploading`,
      sql<{ ext: string | null; files: number; bytes: string }[]>`select lower(substring(name from '\\.([^.]+)$')) as ext, count(*)::int as files, coalesce(sum(size), 0)::text as bytes from files where owner_id = ${u.id} and trashed_at is null group by 1`,
      sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.owner_id = ${u.id} and f.trashed_at is null order by f.size desc, f.id limit 20`,
      sql<{ day: string; bytes: string; versions: number }[]>`select to_char(date_trunc('day', v.created_at), 'YYYY-MM-DD') as day, coalesce(sum(v.size), 0)::text as bytes, count(*)::int as versions
        from file_versions v join files f on f.id = v.file_id where f.owner_id = ${u.id} and v.created_at >= now() - interval '90 days' group by 1 order by 1`,
      sql<{ groups: number; bytes: string }[]>`select count(*)::int as groups, coalesce(sum(size * (n - 1)), 0)::text as bytes from (select size, count(*) as n from files where owner_id = ${u.id} and trashed_at is null and size > 0 group by sha256, size having count(*) > 1) d`,
      folderBreakdown(u.id, root),
    ]);
    const byKind = new Map<string, { files: number; bytes: number }>();
    for (const k of kinds) { const kind = kindOfExt(k.ext ?? ''); const e = byKind.get(kind) ?? { files: 0, bytes: 0 }; e.files += k.files; e.bytes += Number(k.bytes); byKind.set(kind, e); }
    const c = counts[0]!;
    return {
      quota: { limit: Number(quota[0]?.limit_bytes ?? 0), used, uploading: Number(c.uploading) },
      liveBytes: Number(c.live_bytes), trashBytes: Number(c.trash_bytes), oldVersionBytes: Number(c.old_version_bytes),
      counts: { files: c.files, folders: c.folders, versions: c.versions, trashedFiles: c.trashed_files },
      byKind: [...byKind].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.bytes - a.bytes),
      byFolder: [...breakdown.children.slice(0, 50), ...(breakdown.direct.files ? [{ folder: folderJson(root), files: breakdown.direct.files, bytes: breakdown.direct.bytes, direct: true }] : [])],
      largest: largest.map(fileJson),
      growth: growth.map((g) => ({ date: g.day, bytes: Number(g.bytes), versions: g.versions })),
      // identical content is stored once per account: duplicate files cost names, not bytes
      duplicates: { groups: dup[0]!.groups, duplicateBytes: Number(dup[0]!.bytes), reclaimableBytes: 0 },
    };
  });
  app.get('/api/v1/storage/folder/:id', authed, async (req) => {
    const { id } = z.object({ id: z.union([Id, z.literal('root')]) }).parse(req.params);
    const u = userOf(req);
    const folder = await getFolder(sql, u.id, id);
    const [b, files, crumbs] = await Promise.all([
      folderBreakdown(u.id, folder),
      sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.folder_id = ${folder.id} and f.owner_id = ${u.id} and f.trashed_at is null order by f.size desc, f.id limit 100`,
      breadcrumbs(sql, folder),
    ]);
    const total = b.children.reduce((n, c) => ({ files: n.files + c.files, bytes: n.bytes + c.bytes }), { ...b.direct });
    return { folder: folderJson(folder), breadcrumbs: crumbs, total, direct: b.direct, children: b.children, files: files.map(fileJson) };
  });

  /** Upload history of the account (transfer centre): what this account sent in the last days, finished or not. */
  app.get('/api/v1/uploads', authed, async (req) => {
    const q = z.object({ state: z.enum(['recent', 'active']).default('recent'), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    const u = userOf(req);
    const rows = await sql<{ id: string; name: string; size: string; received: string; status: string; file_id: string | null; folder_id: string | null; grant_id: string | null; created_at: Date; updated_at: Date; file_live: boolean }[]>`
      select p.id, p.name, p.size::text, p.received::text, p.status, p.file_id, p.folder_id, p.grant_id, p.created_at, p.updated_at,
        exists (select 1 from files f where f.id = p.file_id and f.trashed_at is null) as file_live
      from uploads p where p.actor_user_id = ${u.id} ${q.state === 'active' ? sql`and p.status in ('active', 'completing')` : sql``} order by p.updated_at desc, p.id limit ${q.limit}`;
    return { uploads: rows.map((r) => ({ id: r.id, name: r.name, size: Number(r.size), received: Number(r.received), status: r.status, fileId: r.status === 'done' ? r.file_id : null, fileExists: r.status === 'done' && r.file_live,
      folderId: r.grant_id ? null : r.folder_id, grantId: r.grant_id, createdAt: r.created_at, updatedAt: r.updated_at })) };
  });

  app.get('/api/v1/files/:id/versions', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const u = userOf(req);
    const f = await getFile(sql, u.id, id, { trashed: true });
    const rows = await sql<{ id: string; seq: number; size: string; sha256: string; created_at: Date; note: string; created_by: string | null; author: string | null; scan_status: string }[]>`
      select v.id, v.seq, v.size::text, v.sha256, v.created_at, v.note, v.created_by, (select display_name from users x where x.id = v.created_by) as author, o.scan_status
      from file_versions v join storage_objects o on o.id = v.object_id where v.file_id = ${id} order by v.seq desc`;
    return { fileId: f.id, currentVersionId: f.current_version_id, versions: rows.map((v) => ({ id: v.id, seq: v.seq, size: Number(v.size), sha256: v.sha256, createdAt: v.created_at, note: v.note, current: v.id === f.current_version_id,
      scan: v.scan_status, createdBy: v.created_by ? { userId: v.created_by, displayName: v.author, me: v.created_by === u.id } : null })) };
  });
  app.route({ method: 'GET', url: '/api/v1/files/:id/versions/:versionId/content', ...authed, handler: async (req, reply) => {
    const p = z.object({ id: Id, versionId: Id }).parse(req.params);
    const q = z.object({ download: z.string().optional(), infected: z.string().optional() }).parse(req.query);
    const f = await getFile(sql, userOf(req).id, p.id, { trashed: true });
    const c = await contentOf(sql, f.id, p.versionId).catch(() => { throw notFound('version not found'); });
    if (c.scan_status === 'infected' && !(q.download && q.infected === 'ack')) throw new UserError('infected', 'this file was flagged by the antivirus', 451);
    if (q.download && !req.headers.range) await audit(sql, actorOf(req), 'file.downloaded', { targetType: 'file', targetId: f.id, meta: { versionId: p.versionId } });
    return sendSealed(req, reply, c, { name: f.name, etag: c.sha256, mode: q.download ? 'download' : 'inline' });
  } });
}
