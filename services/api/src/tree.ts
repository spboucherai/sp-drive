// The owner's tree: folders, files, versions, trash. Every function that changes names or structure must run inside a
// transaction that holds lockOwner(ownerId); the unique indexes are the backstop, not the mechanism.
import { nameKey, nextFreeName, previewKind, sanitizeName } from '@spd/shared';
import type { ObjectRow } from './blob.ts';
import { config, notFound, UserError } from './config.ts';
import type { Db } from './db.ts';
import { enqueue } from './jobs.ts';

export type OnConflict = 'fail' | 'rename' | 'version';
export interface FolderRow { id: string; owner_id: string; parent_id: string | null; name: string; name_key: string; workspace_name?: string | null; starred_at: Date | null; trashed_at: Date | null; trash_root: string | null; created_at: Date; updated_at: Date; rev?: bigint | number | string }
export interface FileRow {
  id: string; owner_id: string; folder_id: string; name: string; name_key: string; current_version_id: string; size: string; sha256: string; origin: string;
  starred_at: Date | null; trashed_at: Date | null; trash_root: string | null; created_at: Date; updated_at: Date;
  scan_status?: string; thumb?: string | null; tag_ids?: string[]; versions?: number; object_id?: string;
  rev?: bigint | number | string; version_seq?: number; content_at?: Date;
}

export const folderJson = (f: FolderRow) => ({ id: f.id, type: 'folder' as const, name: f.name, parentId: f.parent_id, starred: !!f.starred_at, createdAt: f.created_at, updatedAt: f.updated_at, trashedAt: f.trashed_at,
  trashRoot: f.trash_root === f.id, rev: Number(f.rev ?? 0), workspaceName: f.workspace_name ?? null });
export const fileJson = (f: FileRow) => ({
  id: f.id, type: 'file' as const, name: f.name, folderId: f.folder_id, size: Number(f.size), sha256: f.sha256, kind: previewKind(f.name), origin: f.origin, starred: !!f.starred_at,
  createdAt: f.created_at, updatedAt: f.updated_at, trashedAt: f.trashed_at, scan: f.scan_status ?? 'pending', thumb: f.thumb === 'ready', tagIds: f.tag_ids ?? [], versions: f.versions ?? 1,
  trashRoot: f.trash_root === f.id, rev: Number(f.rev ?? 0), versionId: f.current_version_id, versionSeq: f.version_seq ?? 1, contentAt: f.content_at ?? f.updated_at,
});
/** Columns every file listing needs; alias the files table as f. */
export const fileSelect = (t: Db) => t`f.*, f.size::text as size, o.scan_status, o.id as object_id, v.seq as version_seq, v.created_at as content_at,
  (select status from previews p where p.object_id = o.id and p.kind = 'thumb') as thumb,
  coalesce((select array_agg(ft.tag_id) from file_tags ft where ft.file_id = f.id), '{}') as tag_ids,
  (select count(*)::int from file_versions v2 where v2.file_id = f.id) as versions`;
export const fileJoin = (t: Db) => t`join file_versions v on v.id = f.current_version_id join storage_objects o on o.id = v.object_id`;

const conflict = (name: string) => new UserError('name_conflict', `an item named "${name}" already exists here`, 409, { name });

export async function rootOf(t: Db, ownerId: string): Promise<FolderRow> {
  const [r] = await t<FolderRow[]>`select * from folders where owner_id = ${ownerId} and parent_id is null`;
  if (!r) throw notFound('root folder missing');
  return r;
}
/** A live folder of this owner ('root' = the root). Foreign or unknown ids are indistinguishable: 404. */
export async function getFolder(t: Db, ownerId: string, id: string): Promise<FolderRow> {
  if (id === 'root') return rootOf(t, ownerId);
  const [r] = await t<FolderRow[]>`select * from folders where id = ${id} and owner_id = ${ownerId} and trashed_at is null`;
  if (!r) throw notFound('folder not found');
  return r;
}
export async function getFile(t: Db, ownerId: string, id: string, o: { trashed?: boolean } = {}): Promise<FileRow> {
  const [r] = await t<FileRow[]>`select ${fileSelect(t)} from files f ${fileJoin(t)} where f.id = ${id} and f.owner_id = ${ownerId} ${o.trashed ? t`` : t`and f.trashed_at is null`}`;
  if (!r) throw notFound('file not found');
  return r;
}
export async function breadcrumbs(t: Db, folder: FolderRow): Promise<{ id: string; name: string }[]> {
  const rows = await t<{ id: string; name: string; depth: number }[]>`
    with recursive up as (select id, parent_id, name, 0 as depth from folders where id = ${folder.id}
      union all select p.id, p.parent_id, p.name, up.depth + 1 from folders p join up on p.id = up.parent_id where up.depth < 200)
    select id, name, depth from up order by depth desc`;
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
/** Name keys of the live children (folders and files) of a folder. */
async function takenKeys(t: Db, folderId: string, except?: { folderId?: string; fileId?: string }): Promise<Map<string, { type: 'folder' | 'file'; id: string }>> {
  const rows = await t<{ id: string; name_key: string; type: 'folder' | 'file' }[]>`
    select id, name_key, 'folder' as type from folders where parent_id = ${folderId} and trashed_at is null
    union all select id, name_key, 'file' as type from files where folder_id = ${folderId} and trashed_at is null`;
  const m = new Map<string, { type: 'folder' | 'file'; id: string }>();
  for (const r of rows) if (r.id !== except?.folderId && r.id !== except?.fileId) m.set(r.name_key, { type: r.type, id: r.id });
  return m;
}
const touch = (t: Db, folderId: string) => t`update folders set updated_at = now() where id = ${folderId}`;

/** Create a folder. `reuse` returns the existing folder of that name (folder uploads, portal sub-folders). */
export async function createFolder(t: Db, ownerId: string, parentId: string, rawName: string, onConflict: 'fail' | 'rename' | 'reuse' = 'fail'): Promise<FolderRow> {
  let name = sanitizeName(rawName, 'Nouveau dossier');
  const taken = await takenKeys(t, parentId);
  const hit = taken.get(nameKey(name));
  if (hit) {
    if (onConflict === 'reuse' && hit.type === 'folder') { const [f] = await t<FolderRow[]>`select * from folders where id = ${hit.id}`; return f!; }
    if (onConflict === 'fail') throw conflict(name);
    name = nextFreeName(name, (k) => taken.has(k));
  }
  const [f] = await t<FolderRow[]>`insert into folders (owner_id, parent_id, name, name_key) values (${ownerId}, ${parentId}, ${name}, ${nameKey(name)}) returning *`;
  await touch(t, parentId);
  return f!;
}
/** Walk/create "a/b/c" below a folder, reusing existing folders. */
export async function ensurePath(t: Db, ownerId: string, baseId: string, segments: string[]): Promise<string> {
  let cur = baseId;
  for (const s of segments.slice(0, 32)) cur = (await createFolder(t, ownerId, cur, s, 'reuse')).id;
  return cur;
}

/**
 * Put content at folder/name. A name already used by a file: `version` appends a version, `rename` picks a free name,
 * `fail` raises 409. A name used by a folder can never be versioned. Returns the file and whether it is new.
 */
export async function addFile(t: Db, o: { ownerId: string; folderId: string; name: string; object: ObjectRow; onConflict: OnConflict; origin?: 'upload' | 'request' | 'copy'; actorId?: string | null }): Promise<{ file: FileRow; created: boolean }> {
  let name = sanitizeName(o.name);
  const taken = await takenKeys(t, o.folderId);
  const hit = taken.get(nameKey(name));
  if (hit) {
    if (o.onConflict === 'version' && hit.type === 'file') return { file: await addVersion(t, o.ownerId, hit.id, o.object, o.actorId ?? null), created: false };
    if (o.onConflict !== 'rename') throw conflict(name);
    name = nextFreeName(name, (k) => taken.has(k));
  }
  const [f] = await t<{ id: string }[]>`insert into files (owner_id, folder_id, name, name_key, size, sha256, origin)
    values (${o.ownerId}, ${o.folderId}, ${name}, ${nameKey(name)}, ${o.object.size}, ${o.object.sha256}, ${o.origin ?? 'upload'}) returning id`;
  const [v] = await t<{ id: string }[]>`insert into file_versions (file_id, seq, object_id, size, sha256, created_by)
    values (${f!.id}, 1, ${o.object.id}, ${o.object.size}, ${o.object.sha256}, ${o.actorId ?? null}) returning id`;
  await t`update files set current_version_id = ${v!.id} where id = ${f!.id}`;
  await touch(t, o.folderId);
  await afterNewContent(t, o.object);
  return { file: await getFile(t, o.ownerId, f!.id), created: true };
}
export async function addVersion(t: Db, ownerId: string, fileId: string, object: ObjectRow, actorId: string | null, note = ''): Promise<FileRow> {
  const [cur] = await t<{ seq: number; sha256: string }[]>`select v.seq, v.sha256 from files f join file_versions v on v.id = f.current_version_id where f.id = ${fileId} and f.owner_id = ${ownerId} and f.trashed_at is null for update of f`;
  if (!cur) throw notFound('file not found');
  if (cur.sha256 === object.sha256) return getFile(t, ownerId, fileId); // identical content: nothing to record
  const [m] = await t<{ seq: number }[]>`select max(seq) as seq from file_versions where file_id = ${fileId}`;
  const [v] = await t<{ id: string }[]>`insert into file_versions (file_id, seq, object_id, size, sha256, created_by, note)
    values (${fileId}, ${m!.seq + 1}, ${object.id}, ${object.size}, ${object.sha256}, ${actorId}, ${note}) returning id`;
  await t`update files set current_version_id = ${v!.id}, size = ${object.size}, sha256 = ${object.sha256}, updated_at = now() where id = ${fileId}`;
  await afterNewContent(t, object);
  return getFile(t, ownerId, fileId);
}
/** Antivirus scan and previews for content that just became reachable. */
async function afterNewContent(t: Db, object: ObjectRow): Promise<void> {
  if (object.scan_status === 'pending') await enqueue(t, 'scan_object', { objectId: object.id }, { dedupeKey: `scan:${object.id}` });
  await enqueue(t, 'preview', { objectId: object.id }, { dedupeKey: `preview:${object.id}` });
  // content already known to be clean (the owner's identical object, a portal deposit) is indexed at once; the rest after its scan
  if ((object.scan_status === 'clean' || (config.avMode === 'optional' && object.scan_status === 'error')) && config.indexContent) await enqueue(t, 'extract_text', { objectId: object.id }, { dedupeKey: `text:${object.id}`, maxAttempts: 2 });
}

export async function renameFolder(t: Db, ownerId: string, id: string, rawName: string): Promise<void> {
  const f = await getFolder(t, ownerId, id);
  if (!f.parent_id) throw new UserError('root_immutable', 'the root folder cannot be changed', 400);
  const name = sanitizeName(rawName);
  if ((await takenKeys(t, f.parent_id, { folderId: id })).has(nameKey(name))) throw conflict(name);
  await t`update folders set name = ${name}, name_key = ${nameKey(name)}, updated_at = now() where id = ${id}`;
}
export async function renameFile(t: Db, ownerId: string, id: string, rawName: string): Promise<void> {
  const f = await getFile(t, ownerId, id);
  const name = sanitizeName(rawName);
  if ((await takenKeys(t, f.folder_id, { fileId: id })).has(nameKey(name))) throw conflict(name);
  await t`update files set name = ${name}, name_key = ${nameKey(name)}, updated_at = now() where id = ${id}`;
}

export interface Selection { fileIds: string[]; folderIds: string[] }
/** Move items into a folder. `rename` resolves collisions with a free name; `fail` aborts the whole move. */
export async function moveItems(t: Db, ownerId: string, sel: Selection, destId: string, onConflict: 'fail' | 'rename' = 'fail'): Promise<void> {
  const dest = await getFolder(t, ownerId, destId);
  const taken = await takenKeys(t, dest.id);
  const free = (name: string) => {
    if (!taken.has(nameKey(name))) return name;
    if (onConflict === 'fail') throw conflict(name);
    return nextFreeName(name, (k) => taken.has(k));
  };
  for (const id of sel.folderIds) {
    const f = await getFolder(t, ownerId, id);
    if (!f.parent_id) throw new UserError('root_immutable', 'the root folder cannot be moved', 400);
    if (f.parent_id === dest.id) continue;
    const [cycle] = await t`with recursive up as (select id, parent_id from folders where id = ${dest.id}
      union all select p.id, p.parent_id from folders p join up on p.id = up.parent_id) select 1 from up where id = ${id}`;
    if (cycle) throw new UserError('move_into_self', 'a folder cannot be moved into itself', 409);
    const name = free(f.name);
    await t`update folders set parent_id = ${dest.id}, name = ${name}, name_key = ${nameKey(name)}, updated_at = now() where id = ${id}`;
    taken.set(nameKey(name), { type: 'folder', id });
  }
  for (const id of sel.fileIds) {
    const f = await getFile(t, ownerId, id);
    if (f.folder_id === dest.id) continue;
    const name = free(f.name);
    await t`update files set folder_id = ${dest.id}, name = ${name}, name_key = ${nameKey(name)}, updated_at = now() where id = ${id}`;
    taken.set(nameKey(name), { type: 'file', id });
  }
  await touch(t, dest.id);
}

const COPY_LIMIT = 20000;
/** Copy items into a folder (current versions only). Content is shared with the originals: no extra quota. */
export async function copyItems(t: Db, ownerId: string, sel: Selection, destId: string): Promise<{ files: number; folders: number }> {
  const dest = await getFolder(t, ownerId, destId);
  const count = { files: 0, folders: 0 };
  const copyFile = async (id: string, folderId: string, taken: Map<string, unknown>) => {
    const f = await getFile(t, ownerId, id);
    const name = nextFreeName(f.name, (k) => taken.has(k));
    const [n] = await t<{ id: string }[]>`insert into files (owner_id, folder_id, name, name_key, size, sha256, origin) values (${ownerId}, ${folderId}, ${name}, ${nameKey(name)}, ${f.size}, ${f.sha256}, 'copy') returning id`;
    const [v] = await t<{ id: string }[]>`insert into file_versions (file_id, seq, object_id, size, sha256, created_by) values (${n!.id}, 1, ${f.object_id!}, ${f.size}, ${f.sha256}, ${ownerId}) returning id`;
    await t`update files set current_version_id = ${v!.id} where id = ${n!.id}`;
    await t`insert into file_tags (file_id, tag_id) select ${n!.id}, tag_id from file_tags where file_id = ${id}`;
    taken.set(nameKey(name), true);
    if (++count.files + count.folders > COPY_LIMIT) throw new UserError('too_many_items', 'too many items to copy at once', 413);
  };
  const copyFolder = async (id: string, parentId: string, taken: Map<string, unknown>, depth: number) => {
    if (depth > 100) throw new UserError('too_deep', 'folder nesting too deep', 413);
    const src = await getFolder(t, ownerId, id);
    const name = nextFreeName(src.name, (k) => taken.has(k));
    const [n] = await t<{ id: string }[]>`insert into folders (owner_id, parent_id, name, name_key) values (${ownerId}, ${parentId}, ${name}, ${nameKey(name)}) returning id`;
    taken.set(nameKey(name), true);
    if (count.files + ++count.folders > COPY_LIMIT) throw new UserError('too_many_items', 'too many items to copy at once', 413);
    const inner = new Map<string, unknown>();
    // children are read before any insert below `n`, so copying a folder into itself terminates
    const subs = await t<{ id: string }[]>`select id from folders where parent_id = ${id} and trashed_at is null and id <> ${n!.id}`;
    const files = await t<{ id: string }[]>`select id from files where folder_id = ${id} and trashed_at is null`;
    for (const f of files) await copyFile(f.id, n!.id, inner);
    for (const s of subs) await copyFolder(s.id, n!.id, inner, depth + 1);
  };
  const taken = await takenKeys(t, dest.id);
  for (const id of sel.folderIds) await copyFolder(id, dest.id, taken, 0);
  for (const id of sel.fileIds) await copyFile(id, dest.id, taken);
  await touch(t, dest.id);
  return count;
}

/** Move items to the trash. A trashed folder takes its whole live subtree with it, under one trash_root. */
export async function trashItems(t: Db, ownerId: string, sel: Selection): Promise<void> {
  for (const id of sel.folderIds) {
    const f = await getFolder(t, ownerId, id);
    if (!f.parent_id) throw new UserError('root_immutable', 'the root folder cannot be deleted', 400);
    const sub = t`with recursive sub as (select id from folders where id = ${id}
      union all select c.id from folders c join sub on c.parent_id = sub.id where c.trashed_at is null) select id from sub`;
    await t`update files set trashed_at = now(), trash_root = ${id} where trashed_at is null and folder_id in (${sub})`;
    await t`update folders set trashed_at = now(), trash_root = ${id} where trashed_at is null and id in (${sub})`;
  }
  for (const id of sel.fileIds) {
    await getFile(t, ownerId, id);
    await t`update files set trashed_at = now(), trash_root = ${id} where id = ${id}`;
  }
}
/** Restore trash roots. Falls back to the root folder when the parent is gone; renames on collision. */
export async function restoreItems(t: Db, ownerId: string, sel: Selection): Promise<void> {
  const root = await rootOf(t, ownerId);
  const liveParent = async (parentId: string | null) => {
    if (!parentId) return root.id;
    const [p] = await t`select 1 from folders where id = ${parentId} and owner_id = ${ownerId} and trashed_at is null`;
    return p ? parentId : root.id;
  };
  for (const id of sel.folderIds) {
    const [f] = await t<FolderRow[]>`select * from folders where id = ${id} and owner_id = ${ownerId} and trash_root = ${id}`;
    if (!f) throw notFound('item not in trash');
    const parent = await liveParent(f.parent_id);
    const taken = await takenKeys(t, parent);
    const name = nextFreeName(f.name, (k) => taken.has(k));
    await t`update files set trashed_at = null, trash_root = null where trash_root = ${id} and owner_id = ${ownerId}`;
    await t`update folders set trashed_at = null, trash_root = null where trash_root = ${id} and owner_id = ${ownerId} and id <> ${id}`;
    await t`update folders set trashed_at = null, trash_root = null, parent_id = ${parent}, name = ${name}, name_key = ${nameKey(name)}, updated_at = now() where id = ${id}`;
  }
  for (const id of sel.fileIds) {
    const [f] = await t<FileRow[]>`select * from files where id = ${id} and owner_id = ${ownerId} and trash_root = ${id}`;
    if (!f) throw notFound('item not in trash');
    const parent = await liveParent(f.folder_id);
    const taken = await takenKeys(t, parent);
    const name = nextFreeName(f.name, (k) => taken.has(k));
    await t`update files set trashed_at = null, trash_root = null, folder_id = ${parent}, name = ${name}, name_key = ${nameKey(name)}, updated_at = now() where id = ${id}`;
  }
}
/** Delete trash roots for good (or the whole trash). Content is reclaimed by the garbage collector. */
export async function purgeItems(t: Db, ownerId: string, sel: Selection | 'all'): Promise<void> {
  const root = await rootOf(t, ownerId);
  if (sel === 'all') {
    await t`delete from files where owner_id = ${ownerId} and trashed_at is not null`;
    await t`delete from folders where owner_id = ${ownerId} and trashed_at is not null`;
  } else {
    for (const id of sel.folderIds) {
      const [f] = await t`select 1 from folders where id = ${id} and owner_id = ${ownerId} and trash_root = ${id}`;
      if (!f) throw notFound('item not in trash');
      // items trashed on their own that still sit inside this subtree are separate trash entries: they survive, re-homed at the root
      const inside = t`select id from folders where owner_id = ${ownerId} and trash_root = ${id}`;
      await t`update files set folder_id = ${root.id} where owner_id = ${ownerId} and trash_root is distinct from ${id} and folder_id in (${inside})`;
      await t`update folders set parent_id = ${root.id} where owner_id = ${ownerId} and trash_root is distinct from ${id} and parent_id in (${inside})`;
      await t`delete from files where owner_id = ${ownerId} and trash_root = ${id}`;
      await t`delete from folders where owner_id = ${ownerId} and trash_root = ${id}`;
    }
    for (const id of sel.fileIds) {
      const r = await t`delete from files where id = ${id} and owner_id = ${ownerId} and trash_root = ${id} returning id`;
      if (!r.length) throw notFound('item not in trash');
    }
  }
  await enqueue(t, 'gc_objects', { ownerId }, { dedupeKey: `gc:${ownerId}`, delayS: 2 });
}

/** True when `itemFolderId` is `ancestorId` or a live descendant of it. */
export async function isWithin(t: Db, ancestorId: string, itemFolderId: string): Promise<boolean> {
  const [r] = await t`with recursive up as (select id, parent_id, trashed_at, 0 as depth from folders where id = ${itemFolderId}
    union all select p.id, p.parent_id, p.trashed_at, up.depth + 1 from folders p join up on p.id = up.parent_id where up.id <> ${ancestorId} and up.depth < 200)
    select bool_and(trashed_at is null) and bool_or(id = ${ancestorId}) as ok from up`;
  return !!r?.ok;
}
/** Live files below a folder with their relative paths (ZIP export, share listing). Capped. */
export async function subtreeFiles(t: Db, folderId: string, limit = 20000): Promise<{ id: string; path: string; size: string }[]> {
  return t<{ id: string; path: string; size: string }[]>`
    with recursive sub as (select id, ''::text as path, 0 as depth from folders where id = ${folderId} and trashed_at is null
      union all select c.id, sub.path || c.name || '/', sub.depth + 1 from folders c join sub on c.parent_id = sub.id where c.trashed_at is null and sub.depth < 100)
    select f.id, sub.path || f.name as path, f.size::text as size from files f join sub on sub.id = f.folder_id where f.trashed_at is null order by 2 limit ${limit + 1}`;
}
