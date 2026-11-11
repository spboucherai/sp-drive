// Explorer API for the signed-in owner. Every query is scoped by owner_id; an id that belongs to someone else is 404.
import type { FastifyInstance } from 'fastify';
import { nameKey, sanitizeName } from '@spd/shared';
import { z } from 'zod';
import { actorOf, requireUser, userOf } from './auth.ts';
import { notFound, UserError } from './config.ts';
import { contentOf, previewPlan, sendPreview, sendSealed, sendZip, type ZipEntry } from './content.ts';
import { audit, type Db, lockOwner, sql, tx } from './db.ts';
import {
  breadcrumbs, copyItems, createFolder, type FileRow, fileJoin, fileJson, fileSelect, type FolderRow, folderJson, getFile, getFolder, moveItems,
  purgeItems, renameFile, renameFolder, restoreItems, subtreeFiles, trashItems, addVersion,
} from './tree.ts';
import type { ObjectRow } from './blob.ts';

const Id = z.uuid();
const Sel = z.object({ fileIds: z.array(Id).max(2000).default([]), folderIds: z.array(Id).max(2000).default([]) }).refine((s) => s.fileIds.length + s.folderIds.length > 0, 'empty selection');
const SORTS = { name: 'name_key', updated: 'updated_at', size: 'size', created: 'created_at' } as const;
const Sort = z.object({ sort: z.enum(['name', 'updated', 'size', 'created']).default('name'), dir: z.enum(['asc', 'desc']).default('asc') });
const order = (t: Db, s: z.infer<typeof Sort>, alias: string, hasSize: boolean) =>
  t`${t(alias)}.${t(s.sort === 'size' && !hasSize ? 'name_key' : SORTS[s.sort])} ${s.dir === 'desc' ? t`desc` : t`asc`}, ${t(alias)}.id`;

export function fileRoutes(app: FastifyInstance): void {
  const authed = { preHandler: requireUser };

  // --- browse ---
  app.get('/api/v1/folders/:id', authed, async (req) => {
    const { id } = z.object({ id: z.union([Id, z.literal('root')]) }).parse(req.params);
    const s = Sort.parse(req.query);
    const u = userOf(req);
    const folder = await getFolder(sql, u.id, id);
    const [folders, files, crumbs] = await Promise.all([
      sql<FolderRow[]>`select d.* from folders d where d.parent_id = ${folder.id} and d.trashed_at is null order by ${order(sql, s, 'd', false)} limit 5000`,
      sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.folder_id = ${folder.id} and f.trashed_at is null order by ${order(sql, s, 'f', true)} limit 5000`,
      breadcrumbs(sql, folder),
    ]);
    return { folder: folderJson(folder), breadcrumbs: crumbs, folders: folders.map(folderJson), files: files.map(fileJson) };
  });
  /** Folder tree for the move/copy picker: direct children only. */
  app.get('/api/v1/folders/:id/children', authed, async (req) => {
    const { id } = z.object({ id: z.union([Id, z.literal('root')]) }).parse(req.params);
    const folder = await getFolder(sql, userOf(req).id, id);
    const rows = await sql<(FolderRow & { has_children: boolean })[]>`select d.*, exists(select 1 from folders c where c.parent_id = d.id and c.trashed_at is null) as has_children
      from folders d where d.parent_id = ${folder.id} and d.trashed_at is null order by d.name_key limit 5000`;
    return { folder: folderJson(folder), children: rows.map((r) => ({ ...folderJson(r), hasChildren: r.has_children })) };
  });
  app.post('/api/v1/folders', authed, async (req) => {
    const b = z.object({ parentId: z.union([Id, z.literal('root')]), name: z.string().min(1).max(1000), onConflict: z.enum(['fail', 'rename']).default('fail') }).parse(req.body);
    const u = userOf(req);
    return tx(async (t) => {
      await lockOwner(t, u.id);
      const parent = await getFolder(t, u.id, b.parentId);
      const f = await createFolder(t, u.id, parent.id, b.name, b.onConflict);
      await audit(t, actorOf(req), 'folder.created', { targetType: 'folder', targetId: f.id });
      return folderJson(f);
    });
  });
  app.patch('/api/v1/folders/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const b = z.object({ name: z.string().min(1).max(1000).optional(), starred: z.boolean().optional() }).parse(req.body);
    const u = userOf(req);
    return tx(async (t) => {
      await lockOwner(t, u.id);
      if (b.name !== undefined) await renameFolder(t, u.id, id, b.name);
      if (b.starred !== undefined) { await getFolder(t, u.id, id); await t`update folders set starred_at = ${b.starred ? new Date() : null} where id = ${id}`; }
      return folderJson(await getFolder(t, u.id, id));
    });
  });

  app.get('/api/v1/files/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const u = userOf(req);
    const f = await getFile(sql, u.id, id, { trashed: true });
    const [versions, folder, shares, previews] = await Promise.all([
      sql<{ id: string; seq: number; size: string; sha256: string; created_at: Date; note: string }[]>`select id, seq, size::text, sha256, created_at, note from file_versions where file_id = ${id} order by seq desc`,
      sql<FolderRow[]>`select * from folders where id = ${f.folder_id}`,
      sql<{ n: number }[]>`select count(*)::int as n from shares where file_id = ${id} and revoked_at is null`,
      sql<{ kind: string; status: string; error: string | null }[]>`select kind, status, error from previews where object_id = ${f.object_id!}`,
    ]);
    return {
      file: fileJson(f), path: folder[0] ? await breadcrumbs(sql, folder[0]) : [], shares: shares[0]!.n,
      versions: versions.map((v) => ({ id: v.id, seq: v.seq, size: Number(v.size), sha256: v.sha256, createdAt: v.created_at, note: v.note, current: v.id === f.current_version_id })),
      previews: Object.fromEntries(previewPlan(f.name).map((k) => [k, previews.find((p) => p.kind === k)?.status ?? 'pending'])),
    };
  });
  app.patch('/api/v1/files/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const b = z.object({ name: z.string().min(1).max(1000).optional(), starred: z.boolean().optional(), tagIds: z.array(Id).max(50).optional() }).parse(req.body);
    const u = userOf(req);
    return tx(async (t) => {
      await lockOwner(t, u.id);
      await getFile(t, u.id, id);
      if (b.name !== undefined) await renameFile(t, u.id, id, b.name);
      if (b.starred !== undefined) await t`update files set starred_at = ${b.starred ? new Date() : null} where id = ${id}`;
      if (b.tagIds) {
        const own = await t<{ id: string }[]>`select id from tags where owner_id = ${u.id} and id = any(${b.tagIds})`;
        if (own.length !== new Set(b.tagIds).size) throw notFound('tag not found');
        await t`delete from file_tags where file_id = ${id}`;
        for (const tag of own) await t`insert into file_tags (file_id, tag_id) values (${id}, ${tag.id})`;
      }
      return fileJson(await getFile(t, u.id, id));
    });
  });

  // --- content ---
  const Content = z.object({ v: Id.optional(), download: z.string().optional(), as: z.enum(['text']).optional(), infected: z.string().optional() });
  app.route({ method: 'GET', url: '/api/v1/files/:id/content', ...authed, handler: async (req, reply) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const q = Content.parse(req.query);
    const f = await getFile(sql, userOf(req).id, id, { trashed: true });
    const c = await contentOf(sql, f.id, q.v);
    // the owner may still take an infected file out, but only as an explicit download
    if (c.scan_status === 'infected' && !(q.download && q.infected === 'ack')) throw new UserError('infected', 'this file was flagged by the antivirus', 451);
    return sendSealed(req, reply, c, { name: f.name, etag: c.sha256, mode: q.download ? 'download' : q.as === 'text' ? 'text' : 'inline' });
  } });
  app.get('/api/v1/files/:id/preview/:kind', authed, async (req, reply) => {
    const { id, kind } = z.object({ id: Id, kind: z.string().max(20) }).parse(req.params);
    const q = z.object({ v: Id.optional() }).parse(req.query);
    const f = await getFile(sql, userOf(req).id, id, { trashed: true });
    const c = await contentOf(sql, f.id, q.v);
    if (c.scan_status === 'infected') throw new UserError('infected', 'this file was flagged by the antivirus', 451);
    return sendPreview(sql, req, reply, c.object_id, kind, f.name);
  });
  app.get('/api/v1/zip', authed, async (req, reply) => {
    const csv = z.string().max(80000).optional().transform((s) => (s ? s.split(',') : [])).pipe(z.array(Id).max(2000));
    const q = z.object({ files: csv, folders: csv }).parse(req.query);
    const u = userOf(req);
    const entries: ZipEntry[] = [];
    let zipName = 'sp-drive.zip';
    const push = async (fileId: string, path: string) => { const c = await contentOf(sql, fileId); if (c.scan_status !== 'infected') entries.push({ path, content: c }); };
    for (const id of q.folders) {
      const d = await getFolder(sql, u.id, id);
      if (q.folders.length === 1 && !q.files.length) zipName = `${d.name || 'sp-drive'}.zip`;
      for (const f of await subtreeFiles(sql, d.id)) await push(f.id, `${d.name}/${f.path}`);
    }
    for (const id of q.files) { const f = await getFile(sql, u.id, id); await push(f.id, f.name); }
    if (!entries.length) throw new UserError('empty_selection', 'nothing to download', 400);
    await audit(sql, actorOf(req), 'zip.downloaded', { meta: { files: entries.length } });
    return sendZip(reply, zipName, entries);
  });

  // --- versions ---
  app.post('/api/v1/files/:id/versions/:versionId/restore', authed, async (req) => {
    const p = z.object({ id: Id, versionId: Id }).parse(req.params);
    const u = userOf(req);
    return tx(async (t) => {
      await lockOwner(t, u.id);
      await getFile(t, u.id, p.id);
      const [v] = await t<(ObjectRow & { seq: number })[]>`select o.*, v.seq from file_versions v join storage_objects o on o.id = v.object_id where v.id = ${p.versionId} and v.file_id = ${p.id}`;
      if (!v) throw notFound('version not found');
      const f = await addVersion(t, u.id, p.id, v, u.id, `restored from version ${v.seq}`);
      await audit(t, actorOf(req), 'file.version_restored', { targetType: 'file', targetId: p.id, meta: { from: v.seq } });
      return fileJson(f);
    });
  });
  app.delete('/api/v1/files/:id/versions/:versionId', authed, async (req) => {
    const p = z.object({ id: Id, versionId: Id }).parse(req.params);
    const u = userOf(req);
    await tx(async (t) => {
      await lockOwner(t, u.id);
      const f = await getFile(t, u.id, p.id);
      if (f.current_version_id === p.versionId) throw new UserError('current_version', 'the current version cannot be deleted', 409);
      const r = await t`delete from file_versions where id = ${p.versionId} and file_id = ${p.id} returning id`;
      if (!r.length) throw notFound('version not found');
      await t`insert into jobs (kind, payload, dedupe_key, run_at) values ('gc_objects', ${t.json({ ownerId: u.id })}, ${`gc:${u.id}`}, now() + interval '2 seconds')
        on conflict (dedupe_key) where status in ('queued', 'running') and dedupe_key is not null do nothing`;
      await audit(t, actorOf(req), 'file.version_deleted', { targetType: 'file', targetId: p.id });
    });
    return { ok: true };
  });

  // --- structure changes ---
  app.post('/api/v1/move', authed, async (req) => {
    const b = Sel.and(z.object({ destinationId: z.union([Id, z.literal('root')]), onConflict: z.enum(['fail', 'rename']).default('fail') })).parse(req.body);
    const u = userOf(req);
    await tx(async (t) => { await lockOwner(t, u.id); await moveItems(t, u.id, b, b.destinationId, b.onConflict); await audit(t, actorOf(req), 'items.moved', { meta: { files: b.fileIds.length, folders: b.folderIds.length } }); });
    return { ok: true };
  });
  app.post('/api/v1/copy', authed, async (req) => {
    const b = Sel.and(z.object({ destinationId: z.union([Id, z.literal('root')]) })).parse(req.body);
    const u = userOf(req);
    return tx(async (t) => { await lockOwner(t, u.id); const n = await copyItems(t, u.id, b, b.destinationId); await audit(t, actorOf(req), 'items.copied', { meta: n }); return n; });
  });
  app.post('/api/v1/trash', authed, async (req) => {
    const b = Sel.parse(req.body);
    const u = userOf(req);
    await tx(async (t) => { await lockOwner(t, u.id); await trashItems(t, u.id, b); await audit(t, actorOf(req), 'items.trashed', { meta: { files: b.fileIds.length, folders: b.folderIds.length } }); });
    return { ok: true };
  });
  app.post('/api/v1/restore', authed, async (req) => {
    const b = Sel.parse(req.body);
    const u = userOf(req);
    await tx(async (t) => { await lockOwner(t, u.id); await restoreItems(t, u.id, b); await audit(t, actorOf(req), 'items.restored', { meta: { files: b.fileIds.length, folders: b.folderIds.length } }); });
    return { ok: true };
  });
  app.post('/api/v1/purge', authed, async (req) => {
    const b = z.union([z.object({ all: z.literal(true) }), Sel]).parse(req.body);
    const u = userOf(req);
    await tx(async (t) => { await lockOwner(t, u.id); await purgeItems(t, u.id, 'all' in b ? 'all' : b); await audit(t, actorOf(req), 'items.purged', { meta: 'all' in b ? { all: true } : { files: b.fileIds.length, folders: b.folderIds.length } }); });
    return { ok: true };
  });

  // --- views ---
  app.get('/api/v1/trash', authed, async (req) => {
    const u = userOf(req);
    const [folders, files] = await Promise.all([
      sql<FolderRow[]>`select * from folders where owner_id = ${u.id} and trash_root = id order by trashed_at desc limit 2000`,
      sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.owner_id = ${u.id} and f.trash_root = f.id order by f.trashed_at desc limit 2000`,
    ]);
    return { folders: folders.map(folderJson), files: files.map(fileJson) };
  });
  app.get('/api/v1/recent', authed, async (req) => {
    const files = await sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.owner_id = ${userOf(req).id} and f.trashed_at is null order by f.updated_at desc limit 100`;
    return { folders: [], files: files.map(fileJson) };
  });
  app.get('/api/v1/starred', authed, async (req) => {
    const u = userOf(req);
    const [folders, files] = await Promise.all([
      sql<FolderRow[]>`select * from folders where owner_id = ${u.id} and trashed_at is null and starred_at is not null order by name_key limit 2000`,
      sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.owner_id = ${u.id} and f.trashed_at is null and f.starred_at is not null order by f.name_key limit 2000`,
    ]);
    return { folders: folders.map(folderJson), files: files.map(fileJson) };
  });
  /** Name search with filters. Accent- and case-insensitive; scoped to the owner's live items. */
  app.get('/api/v1/search', authed, async (req) => {
    const q = z.object({
      q: z.string().trim().max(200).default(''), kind: z.enum(['any', 'folder', 'image', 'pdf', 'document', 'sheet', 'video', 'audio', 'archive', 'text']).default('any'),
      tag: Id.optional(), starred: z.enum(['1']).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(), minSize: z.coerce.number().int().min(0).optional(), maxSize: z.coerce.number().int().min(0).optional(),
    }).and(Sort).parse(req.query);
    const u = userOf(req);
    const pattern = `%${nameKey(q.q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const EXT: Record<string, string[]> = {
      image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'svg'], pdf: ['pdf'], document: ['doc', 'docx', 'odt', 'ppt', 'pptx', 'odp', 'rtf', 'pages', 'key'], sheet: ['xlsx', 'xls', 'ods', 'csv', 'numbers'],
      video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'], audio: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'], archive: ['zip', 'tar', 'gz', 'tgz', '7z', 'rar'], text: ['txt', 'md', 'json', 'xml', 'log', 'yaml', 'yml', 'tex'],
    };
    const exts = EXT[q.kind];
    const fileOnly = q.kind !== 'any' && q.kind !== 'folder' || q.tag || q.minSize !== undefined || q.maxSize !== undefined;
    const match = (t: Db, a: string) => (q.q ? t`and unaccent(${t(a)}.name_key) like unaccent(${pattern})` : t``);
    const dates = (t: Db, a: string) => t`${q.from ? t`and ${t(a)}.updated_at >= ${q.from}::date` : t``} ${q.to ? t`and ${t(a)}.updated_at < ${q.to}::date + 1` : t``}`;
    const [folders, files] = await Promise.all([
      fileOnly ? [] : sql<FolderRow[]>`select d.* from folders d where d.owner_id = ${u.id} and d.trashed_at is null and d.parent_id is not null ${match(sql, 'd')} ${dates(sql, 'd')}
        ${q.starred ? sql`and d.starred_at is not null` : sql``} order by ${order(sql, q, 'd', false)} limit 300`,
      q.kind === 'folder' ? [] : sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.owner_id = ${u.id} and f.trashed_at is null ${match(sql, 'f')} ${dates(sql, 'f')}
        ${exts ? sql`and lower(substring(f.name from '\\.([^.]+)$')) = any(${exts})` : sql``}
        ${q.tag ? sql`and exists (select 1 from file_tags ft join tags tg on tg.id = ft.tag_id where ft.file_id = f.id and tg.id = ${q.tag} and tg.owner_id = ${u.id})` : sql``}
        ${q.starred ? sql`and f.starred_at is not null` : sql``} ${q.minSize !== undefined ? sql`and f.size >= ${q.minSize}` : sql``} ${q.maxSize !== undefined ? sql`and f.size <= ${q.maxSize}` : sql``}
        order by ${order(sql, q, 'f', true)} limit 500`,
    ]);
    return { folders: folders.map(folderJson), files: files.map(fileJson) };
  });
  /** Groups of live files with identical content, within this account only. */
  app.get('/api/v1/duplicates', authed, async (req) => {
    const u = userOf(req);
    const files = await sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.owner_id = ${u.id} and f.trashed_at is null and f.size > 0
      and (f.sha256, f.size) in (select sha256, size from files where owner_id = ${u.id} and trashed_at is null and size > 0 group by sha256, size having count(*) > 1)
      order by f.size desc, f.sha256, f.created_at limit 2000`;
    const groups = new Map<string, ReturnType<typeof fileJson>[]>();
    for (const f of files) { const k = `${f.sha256}:${f.size}`; groups.set(k, [...(groups.get(k) ?? []), fileJson(f)]); }
    return { groups: [...groups.values()].map((g) => ({ sha256: g[0]!.sha256, size: g[0]!.size, files: g })) };
  });

  // --- tags ---
  app.get('/api/v1/tags', authed, async (req) =>
    (await sql<{ id: string; name: string; color: string; n: number }[]>`select t.id, t.name, t.color, (select count(*)::int from file_tags ft join files f on f.id = ft.file_id where ft.tag_id = t.id and f.trashed_at is null) as n
      from tags t where t.owner_id = ${userOf(req).id} order by t.name_key`).map((t) => ({ id: t.id, name: t.name, color: t.color, files: t.n })));
  const TagBody = z.object({ name: z.string().trim().min(1).max(40), color: z.enum(['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink']).default('slate') });
  app.post('/api/v1/tags', authed, async (req) => {
    const b = TagBody.parse(req.body);
    const name = sanitizeName(b.name);
    const [t] = await sql<{ id: string }[]>`insert into tags (owner_id, name, name_key, color) values (${userOf(req).id}, ${name}, ${nameKey(name)}, ${b.color}) on conflict (owner_id, name_key) do nothing returning id`;
    if (!t) throw new UserError('name_conflict', 'a tag with this name already exists', 409, { name });
    return { id: t.id, name, color: b.color, files: 0 };
  });
  app.patch('/api/v1/tags/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const b = TagBody.partial().parse(req.body);
    const name = b.name ? sanitizeName(b.name) : null;
    const r = await sql`update tags set name = coalesce(${name}, name), name_key = coalesce(${name ? nameKey(name) : null}, name_key), color = coalesce(${b.color ?? null}, color)
      where id = ${id} and owner_id = ${userOf(req).id} returning id`.catch((e: { code?: string }) => { if (e.code === '23505') throw new UserError('name_conflict', 'a tag with this name already exists', 409); throw e; });
    if (!r.length) throw notFound('tag not found');
    return { ok: true };
  });
  app.delete('/api/v1/tags/:id', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const r = await sql`delete from tags where id = ${id} and owner_id = ${userOf(req).id} returning id`;
    if (!r.length) throw notFound('tag not found');
    return { ok: true };
  });

  // --- notifications ---
  app.get('/api/v1/notifications', authed, async (req) =>
    (await sql<{ id: string; kind: string; data: unknown; read_at: Date | null; created_at: Date }[]>`select id, kind, data, read_at, created_at from notifications where user_id = ${userOf(req).id} order by created_at desc limit 100`)
      .map((n) => ({ id: n.id, kind: n.kind, data: n.data, read: !!n.read_at, createdAt: n.created_at })));
  app.post('/api/v1/notifications/read', authed, async (req) => {
    const b = z.object({ ids: z.array(Id).max(200).optional() }).parse(req.body ?? {});
    await sql`update notifications set read_at = now() where user_id = ${userOf(req).id} and read_at is null ${b.ids ? sql`and id = any(${b.ids})` : sql``}`;
    return { ok: true };
  });
}
