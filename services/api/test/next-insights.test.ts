// 2.0: smart collections (rule → whitelisted SQL), activity, storage overview, upload history, versions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '../src/db.ts';
import { Rule } from '../src/collections.ts';
import { closeAll, signup, work } from './harness.ts';

afterAll(closeAll);
let a: Awaited<ReturnType<typeof signup>>;
const F: Record<string, any> = {};
let dossier: any, sous: any, tag: any;
const up = async (folderId: string, name: string, data: string | Buffer, c = a, o = {}) => { const r = await c.client.upload(folderId, name, Buffer.isBuffer(data) ? data : Buffer.from(data), o); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body.file; };
const preview = async (rule: unknown, c = a) => { const r = await c.client.post('/api/v1/collections/preview', { rule }); return r.status === 200 ? r.body.files.map((f: any) => f.name) : r; };
beforeAll(async () => {
  a = await signup();
  dossier = (await a.client.post('/api/v1/folders', { parentId: 'root', name: 'Projets' })).body;
  sous = (await a.client.post('/api/v1/folders', { parentId: dossier.id, name: 'Archives' })).body;
  tag = (await a.client.post('/api/v1/tags', { name: 'Important' })).body;
  F.rapport = await up(a.rootId, 'Rapport annuel.pdf', '%PDF-1.4 faux');
  F.photo = await up(dossier.id, 'photo.jpg', Buffer.alloc(5000, 1));
  F.notes = await up(dossier.id, 'notes.txt', 'Le budget du projet Pélican est serré.');
  F.vieux = await up(sous.id, 'vieux.txt', 'archive');
  F.tableur = await up(sous.id, 'Budget.xlsx', Buffer.alloc(20000, 2));
  await a.client.patch(`/api/v1/files/${F.rapport.id}`, { tagIds: [tag.id], starred: true });
  await sql`update files set updated_at = now() - interval '400 days', created_at = now() - interval '400 days' where id = ${F.vieux.id}`;
  await work();
});

describe('collections', () => {
  it('compiles every field and operator of the contract', async () => {
    const one = (c: object, match = 'all') => preview({ match, conditions: [c] });
    expect(await one({ field: 'kind', op: 'is', value: 'pdf' })).toEqual(['Rapport annuel.pdf']);
    expect(await one({ field: 'kind', op: 'isNot', value: 'text' })).toEqual(['Budget.xlsx', 'photo.jpg', 'Rapport annuel.pdf']);
    expect(await one({ field: 'ext', op: 'is', value: 'TXT' })).toEqual(['notes.txt', 'vieux.txt']);
    expect(await one({ field: 'ext', op: 'isNot', value: 'txt' })).toHaveLength(3);
    expect(await one({ field: 'name', op: 'contains', value: 'BUDG' })).toEqual(['Budget.xlsx']);
    expect(await one({ field: 'name', op: 'is', value: 'photo.JPG' })).toEqual(['photo.jpg']);
    expect(await one({ field: 'name', op: 'isNot', value: 'photo.jpg' })).toHaveLength(4);
    expect(await one({ field: 'tag', op: 'is', value: tag.id })).toEqual(['Rapport annuel.pdf']);
    expect(await one({ field: 'tag', op: 'isNot', value: tag.id })).toHaveLength(4);
    expect(await one({ field: 'untagged', op: 'is', value: true })).toHaveLength(4);
    expect(await one({ field: 'untagged', op: 'is', value: false })).toEqual(['Rapport annuel.pdf']);
    expect(await one({ field: 'size', op: 'gt', value: 4999 })).toEqual(['Budget.xlsx', 'photo.jpg']);
    expect(await one({ field: 'size', op: 'lt', value: 10 })).toEqual(['vieux.txt']);
    expect(await one({ field: 'modified', op: 'within', value: 30 })).toHaveLength(4);
    expect(await one({ field: 'modified', op: 'lt', value: new Date(Date.now() - 100 * 86400e3).toISOString() })).toEqual(['vieux.txt']);
    expect(await one({ field: 'created', op: 'gt', value: new Date(Date.now() - 86400e3).toISOString().slice(0, 10) })).toHaveLength(4);
    expect(await one({ field: 'starred', op: 'is', value: true })).toEqual(['Rapport annuel.pdf']);
    expect(await one({ field: 'folder', op: 'is', value: dossier.id })).toEqual(['Budget.xlsx', 'notes.txt', 'photo.jpg', 'vieux.txt']); // the whole subtree
    expect(await one({ field: 'folder', op: 'isNot', value: dossier.id })).toEqual(['Rapport annuel.pdf']);
    expect(await one({ field: 'text', op: 'contains', value: 'pélican' })).toEqual(['notes.txt']);
    expect(await one({ field: 'shared', op: 'is', value: true })).toEqual([]);
    await a.client.post('/api/v1/shares', { fileId: F.photo.id });
    expect(await one({ field: 'shared', op: 'is', value: true })).toEqual(['photo.jpg']);
    expect(await one({ field: 'shared', op: 'is', value: false })).toHaveLength(4);
    // all / any, and sort
    expect(await preview({ match: 'all', conditions: [{ field: 'ext', op: 'is', value: 'txt' }, { field: 'folder', op: 'is', value: sous.id }] })).toEqual(['vieux.txt']);
    expect(await preview({ match: 'any', conditions: [{ field: 'kind', op: 'is', value: 'pdf' }, { field: 'size', op: 'gt', value: 10000 }], sort: { by: 'size', dir: 'desc' } })).toEqual(['Budget.xlsx', 'Rapport annuel.pdf']);
  });
  it('treats every value as data: injection attempts match nothing or are refused, and change nothing', async () => {
    const before = (await sql`select count(*)::int as n from files`)[0]!.n;
    const evil = ["'; drop table files; --", "x' or '1'='1", '%', '_', "\\'); delete from users; --", '$1', 'a" or ""="', "' union select token_hash from sessions --"];
    for (const v of evil) {
      expect(await preview({ match: 'any', conditions: [{ field: 'name', op: 'contains', value: v }, { field: 'name', op: 'is', value: v }, { field: 'text', op: 'contains', value: v }] }), v).toEqual([]);
      for (const field of ['ext', 'tag', 'folder', 'kind', 'size', 'modified', 'starred']) expect((await a.client.post('/api/v1/collections/preview', { rule: { match: 'all', conditions: [{ field, op: field === 'size' || field === 'modified' ? 'gt' : 'is', value: v }] } })).status, `${field}=${v}`).toBe(400);
    }
    // a field, an operator or a key outside the whitelist never reaches SQL
    const bad = [
      { match: 'all', conditions: [{ field: 'owner_id', op: 'is', value: a.userId }] }, { match: 'all', conditions: [{ field: 'name', op: 'regex', value: '.*' }] },
      { match: 'all', conditions: [{ field: 'name; drop table files', op: 'is', value: 'x' }] }, { match: 'all or 1=1', conditions: [{ field: 'starred', op: 'is', value: true }] },
      { match: 'all', conditions: [{ field: 'size', op: 'gt', value: '1; drop table files' }] }, { match: 'all', conditions: [{ field: 'modified', op: 'within', value: '1 day\'; --' }] },
      { match: 'all', conditions: [{ field: 'starred', op: 'is', value: true }], sort: { by: 'name_key; drop table files', dir: 'asc' } }, { match: 'all', conditions: [{ field: 'starred', op: 'is', value: true }], sort: { by: 'name', dir: 'asc; --' } },
      { match: 'all', conditions: [] }, { match: 'all', conditions: Array.from({ length: 21 }, () => ({ field: 'starred', op: 'is', value: true })) }, { match: 'all', conditions: [{ field: 'starred', op: 'is', value: true }], sql: 'select 1' },
    ];
    for (const rule of bad) expect((await a.client.post('/api/v1/collections/preview', { rule })).status, JSON.stringify(rule).slice(0, 80)).toBe(400);
    expect(Rule.safeParse({ match: 'all', conditions: [{ field: 'name', op: 'contains', value: 'x' }] }).success).toBe(true);
    expect((await sql`select count(*)::int as n from files`)[0]!.n).toBe(before);
    expect((await sql`select 1 from information_schema.tables where table_name in ('files', 'users', 'sessions')`)).toHaveLength(3);
    // a rule cannot reach another account, even by naming its folder or tag
    const b = await signup();
    await up(b.rootId, 'secret de b.txt', 'x', b);
    expect((await a.client.post('/api/v1/collections/preview', { rule: { match: 'any', conditions: [{ field: 'folder', op: 'is', value: b.rootId }] } })).status).toBe(404);
    expect(await preview({ match: 'any', conditions: [{ field: 'name', op: 'contains', value: 'secret' }, { field: 'size', op: 'gt', value: 0 }, { field: 'starred', op: 'is', value: false }] })).not.toContain('secret de b.txt');
    expect((await b.client.post('/api/v1/collections/preview', { rule: { match: 'all', conditions: [{ field: 'tag', op: 'is', value: tag.id }] } })).status).toBe(404);
  });
  it('saves, lists with counts, updates, serves items and deletes; a collection is the owner\'s alone', async () => {
    const rule = { match: 'all', conditions: [{ field: 'ext', op: 'is', value: 'txt' }], sort: { by: 'name', dir: 'desc' } };
    const c = await a.client.post('/api/v1/collections', { name: 'Textes', icon: 'doc.text', color: 'blue', rule });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ name: 'Textes', icon: 'doc.text', color: 'blue', rule });
    expect((await a.client.post('/api/v1/collections', { name: 'textes', rule })).body.error).toBe('name_conflict');
    expect((await a.client.get('/api/v1/collections')).body).toMatchObject([{ id: c.body.id, name: 'Textes', count: 2 }]);
    let items = (await a.client.get(`/api/v1/collections/${c.body.id}/items`)).body;
    expect(items.files.map((f: any) => f.name)).toEqual(['vieux.txt', 'notes.txt']); expect(items.total).toBe(2);
    expect((await a.client.get(`/api/v1/collections/${c.body.id}/items?limit=1&offset=1`)).body.files.map((f: any) => f.name)).toEqual(['notes.txt']);
    // live: a new matching file appears without touching the collection; trashed files leave it
    await up(a.rootId, 'nouveau.txt', 'n');
    await a.client.post('/api/v1/trash', { fileIds: [F.vieux.id], folderIds: [] });
    items = (await a.client.get(`/api/v1/collections/${c.body.id}/items`)).body;
    expect(items.files.map((f: any) => f.name)).toEqual(['nouveau.txt', 'notes.txt']);
    await a.client.post('/api/v1/restore', { fileIds: [F.vieux.id], folderIds: [] });
    const p = await a.client.patch(`/api/v1/collections/${c.body.id}`, { name: 'PDF', rule: { match: 'all', conditions: [{ field: 'kind', op: 'is', value: 'pdf' }] } });
    expect(p.body).toMatchObject({ name: 'PDF' });
    expect((await a.client.get(`/api/v1/collections/${c.body.id}/items`)).body.files.map((f: any) => f.name)).toEqual(['Rapport annuel.pdf']);
    const b = await signup();
    for (const r of [await b.client.get(`/api/v1/collections/${c.body.id}/items`), await b.client.patch(`/api/v1/collections/${c.body.id}`, { name: 'x' }), await b.client.del(`/api/v1/collections/${c.body.id}`)]) expect(r.status).toBe(404);
    expect((await b.client.get('/api/v1/collections')).body).toEqual([]);
    // a collection never copies bytes: deleting it deletes no file
    const used = (await a.client.get('/api/v1/auth/state')).body.quota.used;
    expect((await a.client.del(`/api/v1/collections/${c.body.id}`)).status).toBe(200);
    expect((await a.client.get('/api/v1/auth/state')).body.quota.used).toBe(used);
    expect((await a.client.get(`/api/v1/files/${F.rapport.id}`)).status).toBe(200);
  });
});

describe('activity', () => {
  it('tells the history of a file from the audit trail: upload, rename, move, download, version, restore, share, trash', async () => {
    const u = await signup();
    const d = (await u.client.post('/api/v1/folders', { parentId: 'root', name: 'Dest' })).body;
    const f = await up(u.rootId, 'journal.txt', 'v1', u);
    const other = await up(u.rootId, 'autre.txt', 'autre', u);
    await u.client.patch(`/api/v1/files/${f.id}`, { name: 'journal de bord.txt' });
    await u.client.patch(`/api/v1/files/${f.id}`, { starred: true }); // a star is not an event
    await u.client.post('/api/v1/move', { fileIds: [f.id, other.id], folderIds: [], destinationId: d.id });
    expect((await u.client.get(`/api/v1/files/${f.id}/content?download=1`)).status).toBe(200);
    expect((await u.client.get(`/api/v1/files/${f.id}/content`)).status).toBe(200); // an inline read is not a download
    await u.client.upload(u.rootId, 'x', Buffer.from('v2'), { fileId: f.id });
    const v1 = (await u.client.get(`/api/v1/files/${f.id}/versions`)).body.versions.find((v: any) => v.seq === 1);
    await u.client.post(`/api/v1/files/${f.id}/versions/${v1.id}/restore`);
    await u.client.post('/api/v1/shares', { fileId: f.id });
    await u.client.post('/api/v1/trash', { fileIds: [f.id], folderIds: [] });
    await u.client.post('/api/v1/restore', { fileIds: [f.id], folderIds: [] });
    const act = (await u.client.get(`/api/v1/files/${f.id}/activity`)).body;
    expect(act.events.map((e: any) => e.action).reverse()).toEqual(['file.uploaded', 'file.renamed', 'items.moved', 'file.downloaded', 'file.version_added', 'file.version_restored', 'share.created', 'items.trashed', 'items.restored']);
    expect(act.more).toBe(false);
    const renamed = act.events.find((e: any) => e.action === 'file.renamed');
    expect(renamed).toMatchObject({ actor: { kind: 'user', userId: u.userId, me: true, displayName: expect.any(String) }, target: { type: 'file', id: f.id }, meta: { from: 'journal.txt' } });
    expect(act.events.find((e: any) => e.action === 'items.moved').meta).toMatchObject({ files: 2, destinationId: d.id });
    expect(act.events.find((e: any) => e.action === 'file.version_restored').meta).toEqual({ from: 1 });
    expect(JSON.stringify(act)).not.toMatch(/"ip"|userAgent|token/);
    // the other file has its own, shorter story
    expect((await u.client.get(`/api/v1/files/${other.id}/activity`)).body.events.map((e: any) => e.action).reverse()).toEqual(['file.uploaded', 'items.moved']);
    // the account feed pages backwards and leaves sign-ins to /account/activity
    const all = (await u.client.get('/api/v1/activity?limit=4')).body;
    expect(all.events).toHaveLength(4); expect(all.more).toBe(true);
    const next = (await u.client.get(`/api/v1/activity?limit=200&before=${all.events[3].id}`)).body;
    expect(next.events.every((e: any) => Number(e.id) < Number(all.events[3].id))).toBe(true);
    expect([...all.events, ...next.events].some((e: any) => e.action.startsWith('auth.') || e.action.startsWith('account.'))).toBe(false);
    expect([...all.events, ...next.events].map((e: any) => e.action)).toContain('folder.created');
    // foreign and unknown identifiers
    const b = await signup();
    expect((await b.client.get(`/api/v1/files/${f.id}/activity`)).status).toBe(404);
    expect((await b.client.get('/api/v1/activity')).body.events.map((e: any) => e.action)).toEqual([]);
  });
});

describe('versions', () => {
  it('lists versions, serves an old one, and restoring never destroys anything', async () => {
    const u = await signup();
    const f = await up(u.rootId, 'texte.txt', 'première', u);
    await u.client.upload(u.rootId, 'x', Buffer.from('deuxième'), { fileId: f.id });
    await u.client.upload(u.rootId, 'x', Buffer.from('troisième'), { fileId: f.id });
    let v = (await u.client.get(`/api/v1/files/${f.id}/versions`)).body;
    expect(v.versions.map((x: any) => [x.seq, x.current, x.size])).toEqual([[3, true, 10], [2, false, 9], [1, false, 9]]);
    expect(v.versions[0]).toMatchObject({ createdBy: { userId: u.userId, me: true }, note: '', scan: expect.any(String) });
    expect(v.currentVersionId).toBe(v.versions[0].id);
    const first = v.versions[2];
    const old = await u.client.get(`/api/v1/files/${f.id}/versions/${first.id}/content`);
    expect(old.status).toBe(200); expect(old.raw.toString()).toBe('première');
    expect((await u.client.get(`/api/v1/files/${f.id}/versions/${first.id}/content?download=1`)).headers['content-disposition']).toMatch(/^attachment/);
    // restore: the old content becomes a NEW current version; the three earlier versions are all still there
    const r = await u.client.post(`/api/v1/files/${f.id}/versions/${first.id}/restore`);
    expect(r.status).toBe(200); expect(r.body.versionSeq).toBe(4);
    v = (await u.client.get(`/api/v1/files/${f.id}/versions`)).body;
    expect(v.versions.map((x: any) => [x.seq, x.current, x.note])).toEqual([[4, true, 'restored from version 1'], [3, false, ''], [2, false, ''], [1, false, '']]);
    expect((await u.client.get(`/api/v1/files/${f.id}/content`)).raw.toString()).toBe('première');
    for (const [seq, text] of [[3, 'troisième'], [2, 'deuxième'], [1, 'première']] as const) expect((await u.client.get(`/api/v1/files/${f.id}/versions/${v.versions.find((x: any) => x.seq === seq).id}/content`)).raw.toString()).toBe(text);
    // garbage collection after a restore removes no object a version still needs
    await work();
    expect((await u.client.get(`/api/v1/files/${f.id}/versions/${v.versions.find((x: any) => x.seq === 3).id}/content`)).raw.toString()).toBe('troisième');
    // restoring what is already current records nothing new
    expect((await u.client.post(`/api/v1/files/${f.id}/versions/${v.versions[0].id}/restore`)).body.versionSeq).toBe(4);
    // a version of another file, or of another account, is not found
    const g = await up(u.rootId, 'autre.txt', 'autre', u);
    const gv = (await u.client.get(`/api/v1/files/${g.id}/versions`)).body.versions[0];
    expect((await u.client.get(`/api/v1/files/${f.id}/versions/${gv.id}/content`)).status).toBe(404);
    const b = await signup();
    expect((await b.client.get(`/api/v1/files/${f.id}/versions`)).status).toBe(404);
    expect((await b.client.get(`/api/v1/files/${f.id}/versions/${first.id}/content`)).status).toBe(404);
  });
});

describe('storage and upload history', () => {
  it('breaks storage down by kind, folder, age and versions, and drills into folders', async () => {
    const o = (await a.client.get('/api/v1/storage/overview')).body;
    expect(o.quota).toMatchObject({ limit: 1024 ** 3, uploading: 0 }); expect(o.quota.used).toBeGreaterThan(25000);
    expect(o.counts).toMatchObject({ files: 6, folders: 2, trashedFiles: 0 });
    expect(Object.fromEntries(o.byKind.map((k: any) => [k.kind, [k.files, k.bytes]]))).toMatchObject({ sheet: [1, 20000], image: [1, 5000], pdf: [1, 13] });
    expect(o.byKind[0].kind).toBe('sheet'); // largest first
    expect(o.byFolder[0]).toMatchObject({ folder: { id: dossier.id, name: 'Projets' }, files: 4 }); // its whole subtree
    expect(o.byFolder[0].bytes).toBe(5000 + 40 + 7 + 20000);
    expect(o.byFolder.at(-1)).toMatchObject({ direct: true, files: 2 });
    expect(o.largest.map((f: any) => f.name).slice(0, 2)).toEqual(['Budget.xlsx', 'photo.jpg']);
    expect(o.growth.at(-1)).toMatchObject({ date: new Date().toISOString().slice(0, 10) }); expect(o.growth.at(-1).bytes).toBeGreaterThan(25000);
    expect(o.duplicates).toEqual({ groups: 0, duplicateBytes: 0, reclaimableBytes: 0 });
    expect(o.oldVersionBytes).toBe(0); expect(o.trashBytes).toBe(0);
    // an old version and a trashed file show up where they belong
    await a.client.upload(a.rootId, 'x', Buffer.alloc(3000, 9), { fileId: F.notes.id });
    await a.client.post('/api/v1/trash', { fileIds: [F.photo.id], folderIds: [] });
    await up(a.rootId, 'copie du tableur.xlsx', Buffer.alloc(20000, 2));
    const o2 = (await a.client.get('/api/v1/storage/overview')).body;
    expect(o2.oldVersionBytes).toBe(40); expect(o2.trashBytes).toBe(5000); expect(o2.counts.trashedFiles).toBe(1);
    expect(o2.duplicates).toEqual({ groups: 1, duplicateBytes: 20000, reclaimableBytes: 0 }); // identical content is stored once
    expect(o2.quota.used).toBe(o.quota.used + 3000);
    await a.client.post('/api/v1/restore', { fileIds: [F.photo.id], folderIds: [] });
    const d = (await a.client.get(`/api/v1/storage/folder/${dossier.id}`)).body;
    expect(d.folder.id).toBe(dossier.id); expect(d.breadcrumbs.map((c: any) => c.name)).toEqual(['', 'Projets']);
    expect(d.children).toEqual([expect.objectContaining({ folder: expect.objectContaining({ name: 'Archives' }), files: 2, bytes: 20007 })]);
    expect(d.direct).toEqual({ files: 2, bytes: 8000 }); expect(d.total).toEqual({ files: 4, bytes: 28007 });
    expect(d.files.map((f: any) => f.name)).toEqual(['photo.jpg', 'notes.txt']);
    const b = await signup();
    expect((await b.client.get(`/api/v1/storage/folder/${dossier.id}`)).status).toBe(404);
    expect((await b.client.get('/api/v1/storage/overview')).body.counts).toMatchObject({ files: 0, folders: 0 });
  });
  it('keeps the upload history of the account', async () => {
    const u = await signup();
    const done = await up(u.rootId, 'fini.bin', Buffer.alloc(100, 1), u);
    const open = (await u.client.post('/api/v1/uploads', { folderId: u.rootId, name: 'en cours.bin', size: 1000 })).body;
    await u.client.patch(`/api/v1/uploads/${open.id}?offset=0`, Buffer.alloc(400, 2));
    const dropped = (await u.client.post('/api/v1/uploads', { folderId: u.rootId, name: 'abandonné.bin', size: 10 })).body;
    await u.client.del(`/api/v1/uploads/${dropped.id}`);
    const h = (await u.client.get('/api/v1/uploads?state=recent')).body.uploads;
    expect(Object.fromEntries(h.map((x: any) => [x.name, [x.status, x.size, x.received, x.fileId, x.fileExists]]))).toEqual({
      'fini.bin': ['done', 100, 100, done.id, true], 'en cours.bin': ['active', 1000, 400, null, false], 'abandonné.bin': ['aborted', 10, 0, null, false] });
    expect(h[0]).toMatchObject({ folderId: u.rootId, grantId: null, createdAt: expect.any(String), updatedAt: expect.any(String) });
    expect((await u.client.get('/api/v1/uploads?state=active')).body.uploads.map((x: any) => x.name)).toEqual(['en cours.bin']);
    await u.client.post('/api/v1/trash', { fileIds: [done.id], folderIds: [] });
    expect((await u.client.get('/api/v1/uploads')).body.uploads.find((x: any) => x.name === 'fini.bin').fileExists).toBe(false);
    expect((await (await signup()).client.get('/api/v1/uploads')).body.uploads).toEqual([]);
    expect((await u.client.get('/api/v1/uploads?state=all')).status).toBe(400);
    expect((await u.client.get(`/api/v1/uploads/${open.id}`)).body.received).toBe(400); // the 1.0 route is untouched
  });
});
