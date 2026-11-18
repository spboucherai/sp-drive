// Change feed for syncing clients. One cursor per owner: `rev` grows with every committed change to a folder or a
// file of that owner (see migration 002). Trashed items stay items (with trashedAt); only purged ones are `deleted`.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, userOf } from './auth.ts';
import { type Db, sql } from './db.ts';
import { type FileRow, fileJoin, fileJson, fileSelect, type FolderRow, folderJson, rootOf } from './tree.ts';

const Id = z.uuid();
/** Highest revision of an owner (0 when nothing exists yet). */
export async function headRev(t: Db, ownerId: string): Promise<number> {
  const [r] = await t<{ head: string }[]>`select greatest(
    coalesce((select max(rev) from folders where owner_id = ${ownerId}), 0),
    coalesce((select max(rev) from files where owner_id = ${ownerId}), 0),
    coalesce((select max(rev) from sync_tombstones where owner_id = ${ownerId}), 0))::text as head`;
  return Number(r!.head);
}

export function syncRoutes(app: FastifyInstance): void {
  const authed = { preHandler: requireUser };

  app.get('/api/v1/sync/cursor', authed, async (req) => {
    const u = userOf(req);
    return { head: await headRev(sql, u.id), rootId: (await rootOf(sql, u.id)).id };
  });

  /**
   * Changes after `since`, oldest first, at most `limit`. `cursor` is the revision to send next; `more` tells whether
   * to ask again at once. A client whose cursor is above `head` (server restored from a backup) must start over from 0.
   */
  app.get('/api/v1/sync/changes', authed, async (req) => {
    const q = z.object({ since: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(2000).default(500) }).parse(req.query);
    const u = userOf(req);
    const n = q.limit + 1;
    const [folders, files, gone, head, root] = await Promise.all([
      sql<FolderRow[]>`select * from folders where owner_id = ${u.id} and rev > ${q.since} order by rev limit ${n}`,
      sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.owner_id = ${u.id} and f.rev > ${q.since} order by f.rev limit ${n}`,
      sql<{ item_id: string; kind: 'file' | 'folder'; rev: string }[]>`select item_id, kind, rev::text from sync_tombstones where owner_id = ${u.id} and rev > ${q.since} order by rev limit ${n}`,
      headRev(sql, u.id), rootOf(sql, u.id),
    ]);
    type Entry = { rev: number; item?: ReturnType<typeof folderJson> | ReturnType<typeof fileJson>; deleted?: { id: string; type: 'file' | 'folder'; rev: number } };
    const all: Entry[] = [
      ...folders.map((f) => ({ rev: Number(f.rev), item: folderJson(f) })), ...files.map((f) => ({ rev: Number(f.rev), item: fileJson(f) })),
      ...gone.map((g) => ({ rev: Number(g.rev), deleted: { id: g.item_id, type: g.kind, rev: Number(g.rev) } })),
    ].sort((a, b) => a.rev - b.rev);
    const page = all.slice(0, q.limit);
    const more = all.length > q.limit;
    return {
      items: page.filter((e) => e.item).map((e) => e.item!), deleted: page.filter((e) => e.deleted).map((e) => e.deleted!),
      cursor: page.length ? page[page.length - 1]!.rev : q.since, more, head, rootId: root.id,
    };
  });

  /** Current state of given items, trashed ones included; unknown or foreign identifiers are simply absent. */
  app.post('/api/v1/sync/items', authed, async (req) => {
    const b = z.object({ fileIds: z.array(Id).max(500).default([]), folderIds: z.array(Id).max(500).default([]) }).parse(req.body);
    const u = userOf(req);
    const [folders, files] = await Promise.all([
      b.folderIds.length ? sql<FolderRow[]>`select * from folders where owner_id = ${u.id} and id = any(${b.folderIds})` : [],
      b.fileIds.length ? sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.owner_id = ${u.id} and f.id = any(${b.fileIds})` : [],
    ]);
    return { folders: folders.map(folderJson), files: files.map(fileJson) };
  });
}
