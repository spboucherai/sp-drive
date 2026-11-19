import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.ts';
import { sql } from '../src/db.ts';
import { Client, closeAll, sha, signup, work } from './harness.ts';

afterAll(closeAll);
let a: Awaited<ReturnType<typeof signup>>, b: Awaited<ReturnType<typeof signup>>;
beforeAll(async () => { a = await signup(); b = await signup(); });
const mkdir = async (c: Client, parentId: string, name: string) => (await c.post('/api/v1/folders', { parentId, name })).body;
const ls = async (c: Client, id: string) => (await c.get(`/api/v1/folders/${id}`)).body;
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

describe('uploads', () => {
  it('stores a multi-chunk file, verifies its SHA-256 and serves it back with Range', async () => {
    const data = randomBytes(5 * 1024 * 1024 + 123);
    const up = await a.client.upload(a.rootId, 'gros.bin', data, { chunk: 1024 * 1024 });
    expect(up.status).toBe(200);
    expect(up.body.file).toMatchObject({ name: 'gros.bin', size: data.length, sha256: sha(data) });
    const id = up.body.file.id;
    const full = await a.client.get(`/api/v1/files/${id}/content?download=1`);
    expect(full.status).toBe(200);
    expect(full.raw.equals(data)).toBe(true);
    expect(full.headers['content-disposition']).toContain('attachment');
    expect(full.headers['content-security-policy']).toContain('sandbox');
    const mid = await a.client.get(`/api/v1/files/${id}/content`, { range: 'bytes=65530-200005' }); // crosses several cipher blocks
    expect(mid.status).toBe(206);
    expect(mid.headers['content-range']).toBe(`bytes 65530-200005/${data.length}`);
    expect(mid.raw.equals(data.subarray(65530, 200006))).toBe(true);
    const tail = await a.client.get(`/api/v1/files/${id}/content`, { range: 'bytes=-100' });
    expect(tail.raw.equals(data.subarray(data.length - 100))).toBe(true);
    expect((await a.client.get(`/api/v1/files/${id}/content`, { range: `bytes=${data.length}-` })).status).toBe(416);
    expect((await a.client.get(`/api/v1/files/${id}/content`, { 'if-none-match': `"${sha(data)}"` })).status).toBe(304);
  });
  it('never writes plaintext to the blob store, and detects tampering', async () => {
    const marker = Buffer.from(`PLAINTEXT-MARKER-${randomBytes(8).toString('hex')}-`.repeat(4000));
    const up = await a.client.upload(a.rootId, 'secret.txt', marker);
    const [o] = await sql<{ storage_key: string }[]>`select o.storage_key from storage_objects o where o.sha256 = ${sha(marker)}`;
    const blob = join(config.blobDir, o!.storage_key);
    expect(readFileSync(blob).includes(marker.subarray(0, 40))).toBe(false);
    expect(statSync(blob).mode & 0o077).toBe(0);
    for (const f of walk(config.blobDir)) expect(readFileSync(f).includes(marker.subarray(0, 40))).toBe(false);
    expect(readdirSync(config.tmpDir).filter((n) => n.startsWith('up-'))).toHaveLength(0); // temp file removed
    // flip one byte of the ciphertext: the read must fail, never return altered content
    const raw = readFileSync(blob); raw[100] = raw[100]! ^ 1; writeFileSync(blob, raw);
    const res = await a.client.get(`/api/v1/files/${up.body.file.id}/content?download=1`).catch((e) => ({ status: 599, raw: Buffer.alloc(0), error: e }));
    expect(res.status === 599 || !res.raw.equals(marker)).toBe(true);
    raw[100] = raw[100]! ^ 1; writeFileSync(blob, raw);
    expect((await a.client.get(`/api/v1/files/${up.body.file.id}/content?download=1`)).raw.equals(marker)).toBe(true);
  });
  it('resumes after an interruption from the offset the server reports', async () => {
    const data = randomBytes(3 * 1024 * 1024);
    const u = (await a.client.post('/api/v1/uploads', { folderId: a.rootId, name: 'reprise.bin', size: data.length })).body;
    expect((await a.client.patch(`/api/v1/uploads/${u.id}?offset=0`, data.subarray(0, 1024 * 1024))).body.received).toBe(1024 * 1024);
    // "connection lost": a new client instance asks where to continue
    const later = new Client(a.client.auth); await later.login();
    expect((await later.get(`/api/v1/uploads/${u.id}`)).body.received).toBe(1024 * 1024);
    // a chunk at the wrong place is refused and tells the right offset
    const wrong = await later.patch(`/api/v1/uploads/${u.id}?offset=${2 * 1024 * 1024}`, data.subarray(2 * 1024 * 1024));
    expect(wrong.status).toBe(409); expect(wrong.body.received).toBe(1024 * 1024);
    // a corrupted chunk is refused and leaves the offset untouched
    const corrupt = await later.patch(`/api/v1/uploads/${u.id}?offset=${1024 * 1024}`, data.subarray(1024 * 1024, 2 * 1024 * 1024), { 'x-chunk-sha256': sha(Buffer.from('other')) });
    expect(corrupt.status).toBe(422);
    expect((await later.get(`/api/v1/uploads/${u.id}`)).body.received).toBe(1024 * 1024);
    expect((await later.post(`/api/v1/uploads/${u.id}/complete`)).status).toBe(409); // not all bytes yet
    expect((await later.patch(`/api/v1/uploads/${u.id}?offset=${1024 * 1024}`, data.subarray(1024 * 1024))).body.received).toBe(data.length);
    expect((await later.post(`/api/v1/uploads/${u.id}/complete`, { sha256: sha(Buffer.from('not this')) })).status).toBe(422); // whole-file checksum
    const done = await later.post(`/api/v1/uploads/${u.id}/complete`, { sha256: sha(data) });
    expect(done.body.file.sha256).toBe(sha(data));
    expect((await later.post(`/api/v1/uploads/${u.id}/complete`, { sha256: sha(data) })).body.file.id).toBe(done.body.file.id); // idempotent
  });
  it('refuses bytes beyond the declared size and cancels cleanly', async () => {
    const u = (await a.client.post('/api/v1/uploads', { folderId: a.rootId, name: 'petit.bin', size: 10 })).body;
    expect((await a.client.patch(`/api/v1/uploads/${u.id}?offset=0`, randomBytes(11))).status).toBe(413);
    expect((await a.client.get(`/api/v1/uploads/${u.id}`)).body.received).toBe(0);
    expect((await a.client.del(`/api/v1/uploads/${u.id}`)).status).toBe(200);
    expect((await a.client.patch(`/api/v1/uploads/${u.id}?offset=0`, randomBytes(10))).status).toBe(410);
    expect(readdirSync(config.tmpDir).filter((n) => n.includes(u.id))).toHaveLength(0);
  });
  it('serialises concurrent chunks for one upload: exactly one wins each offset', async () => {
    const data = randomBytes(64 * 1024);
    const u = (await a.client.post('/api/v1/uploads', { folderId: a.rootId, name: 'course.bin', size: data.length })).body;
    const res = await Promise.all(Array.from({ length: 6 }, () => a.client.patch(`/api/v1/uploads/${u.id}?offset=0`, data)));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(5);
    const done = await a.client.post(`/api/v1/uploads/${u.id}/complete`, { sha256: sha(data) });
    expect(done.body.file.size).toBe(data.length);
  });
  it('handles name collisions explicitly: fail, rename or new version — never a silent overwrite', async () => {
    const dir = await mkdir(a.client, a.rootId, 'Collisions');
    const v1 = Buffer.from('version 1'), v2 = Buffer.from('version 2 plus longue');
    const first = await a.client.upload(dir.id, 'Rapport.pdf', v1);
    const fail = await a.client.upload(dir.id, 'rapport.PDF', v2, { onConflict: 'fail' }); // case-insensitive collision
    expect(fail.status).toBe(409); expect(fail.body).toMatchObject({ error: 'name_conflict', name: 'rapport.PDF' });
    const renamed = await a.client.upload(dir.id, 'Rapport.pdf', v2, { onConflict: 'rename' });
    expect(renamed.body.file.name).toBe('Rapport (2).pdf');
    const versioned = await a.client.upload(dir.id, 'Rapport.pdf', v2, { onConflict: 'version' });
    expect(versioned.body.file.id).toBe(first.body.file.id);
    const detail = (await a.client.get(`/api/v1/files/${first.body.file.id}`)).body;
    expect(detail.versions.map((v: any) => v.seq)).toEqual([2, 1]);
    expect((await a.client.get(`/api/v1/files/${first.body.file.id}/content?download=1`)).raw.equals(v2)).toBe(true);
    expect((await a.client.get(`/api/v1/files/${first.body.file.id}/content?download=1&v=${detail.versions[1].id}`)).raw.equals(v1)).toBe(true);
    // restoring version 1 records a version 3 with the old content
    expect((await a.client.post(`/api/v1/files/${first.body.file.id}/versions/${detail.versions[1].id}/restore`)).body.sha256).toBe(sha(v1));
    expect((await a.client.get(`/api/v1/files/${first.body.file.id}`)).body.versions).toHaveLength(3);
    // a folder and a file cannot share a name
    expect((await a.client.post('/api/v1/folders', { parentId: dir.id, name: 'rapport.pdf' })).status).toBe(409);
  });
  it('resolves a race of identical names: all uploads land, none is lost', async () => {
    const dir = await mkdir(a.client, a.rootId, 'Course');
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => a.client.upload(dir.id, 'photo.jpg', Buffer.from(`contenu ${i}`))));
    expect(res.every((r) => r.status === 200)).toBe(true);
    const names = (await ls(a.client, dir.id)).files.map((f: any) => f.name).sort();
    expect(new Set(names).size).toBe(8);
    expect(names).toContain('photo.jpg'); expect(names).toContain('photo (8).jpg');
    const folders = await Promise.all(Array.from({ length: 6 }, () => a.client.post('/api/v1/folders', { parentId: dir.id, name: 'Même nom' })));
    expect(folders.filter((r) => r.status === 200)).toHaveLength(1);
    expect(folders.filter((r) => r.status === 409)).toHaveLength(5);
  });
  it('creates the folder structure of a folder upload and neutralises hostile paths', async () => {
    const dir = await mkdir(a.client, a.rootId, 'Import');
    await a.client.upload(dir.id, 'a.txt', Buffer.from('a'), { relativePath: 'Projet/src/a.txt' });
    await a.client.upload(dir.id, 'b.txt', Buffer.from('b'), { relativePath: 'Projet/src/b.txt' });
    const evil = await a.client.upload(dir.id, '../../../evil.txt', Buffer.from('e'), { relativePath: '../../../../etc/evil.txt' });
    expect(evil.body.file.name).not.toMatch(/[/\\]/);
    const top = await ls(a.client, dir.id);
    expect(top.folders.map((f: any) => f.name).sort()).toEqual(['Projet', 'etc']);
    const projet = await ls(a.client, top.folders.find((f: any) => f.name === 'Projet').id);
    const src = await ls(a.client, projet.folders[0].id);
    expect(src.files.map((f: any) => f.name).sort()).toEqual(['a.txt', 'b.txt']);
    expect(src.breadcrumbs.map((c: any) => c.name)).toEqual(['', 'Import', 'Projet', 'src']);
    expect((await ls(a.client, a.rootId)).files.some((f: any) => f.name.includes('evil'))).toBe(false); // nothing escaped upward
  });
  it('enforces the quota, counting uploads in flight, and deduplicates within the account only', async () => {
    const small = await signup({ quotaBytes: 1024 * 1024 });
    expect((await small.client.post('/api/v1/uploads', { folderId: small.rootId, name: 'trop.bin', size: 2 * 1024 * 1024 })).body.error).toBe('quota_exceeded');
    const first = await small.client.post('/api/v1/uploads', { folderId: small.rootId, name: 'a.bin', size: 700 * 1024 });
    expect(first.status).toBe(200);
    expect((await small.client.post('/api/v1/uploads', { folderId: small.rootId, name: 'b.bin', size: 700 * 1024 })).body.error).toBe('quota_exceeded'); // reserved by the first
    await small.client.del(`/api/v1/uploads/${first.body.id}`);
    const data = randomBytes(400 * 1024);
    expect((await small.client.upload(small.rootId, 'un.bin', data)).status).toBe(200);
    expect((await small.client.upload(small.rootId, 'deux.bin', data)).status).toBe(200); // same bytes: one stored object
    expect((await small.client.get('/api/v1/auth/state')).body.quota.used).toBe(data.length);
    const dup = (await small.client.get('/api/v1/duplicates')).body.groups;
    expect(dup).toHaveLength(1); expect(dup[0].files).toHaveLength(2);
    // another account uploading the same bytes pays for them and learns nothing
    const other = await signup({ quotaBytes: 1024 * 1024 });
    expect((await other.client.upload(other.rootId, 'copie.bin', data)).status).toBe(200);
    expect((await other.client.get('/api/v1/auth/state')).body.quota.used).toBe(data.length);
    expect((await other.client.get('/api/v1/duplicates')).body.groups).toHaveLength(0);
    const objs = await sql`select owner_id from storage_objects where sha256 = ${sha(data)}`;
    expect(objs).toHaveLength(2);
  });
});

describe('explorer', () => {
  it('moves, copies, renames; refuses cycles and collisions', async () => {
    const top = await mkdir(a.client, a.rootId, 'Organisation');
    const x = await mkdir(a.client, top.id, 'X'), y = await mkdir(a.client, top.id, 'Y');
    const inner = await mkdir(a.client, x.id, 'Inner');
    const f = (await a.client.upload(x.id, 'note.txt', Buffer.from('note'))).body.file;
    expect((await a.client.post('/api/v1/move', { folderIds: [x.id], destinationId: inner.id })).body.error).toBe('move_into_self');
    expect((await a.client.post('/api/v1/move', { folderIds: [x.id], destinationId: x.id })).body.error).toBe('move_into_self');
    expect((await a.client.post('/api/v1/move', { fileIds: [f.id], destinationId: y.id })).status).toBe(200);
    expect((await ls(a.client, y.id)).files[0].name).toBe('note.txt');
    await a.client.upload(x.id, 'note.txt', Buffer.from('autre'));
    const back = await a.client.post('/api/v1/move', { fileIds: [f.id], destinationId: x.id });
    expect(back.status).toBe(409);
    expect((await a.client.post('/api/v1/move', { fileIds: [f.id], destinationId: x.id, onConflict: 'rename' })).status).toBe(200);
    expect((await ls(a.client, x.id)).files.map((q: any) => q.name).sort()).toEqual(['note (2).txt', 'note.txt']);
    expect((await a.client.patch(`/api/v1/files/${f.id}`, { name: 'note.txt' })).status).toBe(409);
    expect((await a.client.patch(`/api/v1/files/${f.id}`, { name: 'renommé.txt' })).body.name).toBe('renommé.txt');
    const copy = await a.client.post('/api/v1/copy', { folderIds: [x.id], destinationId: y.id });
    expect(copy.body).toEqual({ files: 2, folders: 2 });
    const copied = await ls(a.client, (await ls(a.client, y.id)).folders[0].id);
    expect(copied.files).toHaveLength(2); expect(copied.folders[0].name).toBe('Inner');
    expect((await a.client.post('/api/v1/copy', { folderIds: [x.id], destinationId: x.id })).status).toBe(200); // copy into itself terminates
    expect((await a.client.patch(`/api/v1/folders/${a.rootId}`, { name: 'x' })).status).toBe(400);
  });
  it('trashes, restores and purges whole subtrees; storage is reclaimed', async () => {
    const top = await mkdir(a.client, a.rootId, 'Corbeille-test');
    const sub = await mkdir(a.client, top.id, 'Sous');
    const data = randomBytes(200 * 1024);
    const f = (await a.client.upload(sub.id, 'doc.bin', data)).body.file;
    await a.client.post('/api/v1/trash', { folderIds: [top.id] });
    expect((await a.client.get(`/api/v1/folders/${sub.id}`)).status).toBe(404);
    expect((await a.client.get('/api/v1/search?q=doc.bin')).body.files).toHaveLength(0);
    const trash = (await a.client.get('/api/v1/trash')).body;
    expect(trash.folders.map((x: any) => x.id)).toEqual([top.id]); // one root, not every descendant
    // meanwhile the name is reused
    await mkdir(a.client, a.rootId, 'Corbeille-test');
    await a.client.post('/api/v1/restore', { folderIds: [top.id] });
    const names = (await ls(a.client, a.rootId)).folders.map((x: any) => x.name).filter((n: string) => n.startsWith('Corbeille-test')).sort();
    expect(names).toEqual(['Corbeille-test', 'Corbeille-test (2)']);
    expect((await ls(a.client, sub.id)).files[0].id).toBe(f.id);
    // purge
    await a.client.post('/api/v1/trash', { fileIds: [f.id] });
    const before = (await a.client.get('/api/v1/auth/state')).body.quota.used;
    expect((await a.client.post('/api/v1/purge', { fileIds: [sub.id] })).status).toBe(404); // not a trash root
    await a.client.post('/api/v1/purge', { fileIds: [f.id] });
    const [o] = await sql<{ storage_key: string }[]>`select storage_key from storage_objects where sha256 = ${sha(data)}`;
    await work();
    expect((await a.client.get('/api/v1/auth/state')).body.quota.used).toBe(before - data.length);
    expect(() => statSync(join(config.blobDir, o!.storage_key))).toThrow();
    // restoring an item whose folder is gone falls back to the root
    const g = (await a.client.upload(sub.id, 'orphelin.txt', Buffer.from('o'))).body.file;
    await a.client.post('/api/v1/trash', { fileIds: [g.id] });
    await a.client.post('/api/v1/trash', { folderIds: [sub.id] });
    await a.client.post('/api/v1/purge', { folderIds: [sub.id] });
    await a.client.post('/api/v1/restore', { fileIds: [g.id] });
    expect((await ls(a.client, a.rootId)).files.some((x: any) => x.id === g.id)).toBe(true);
  });
  it('searches by name without accents or case, with filters, tags, favourites and recents', async () => {
    const dir = await mkdir(a.client, a.rootId, 'Recherche');
    const f1 = (await a.client.upload(dir.id, 'Résumé été 2026.pdf', Buffer.from('%PDF-1.4 x'))).body.file;
    await a.client.upload(dir.id, 'budget.xlsx', Buffer.from('xx'));
    await a.client.upload(dir.id, '100%_fini.txt', Buffer.from('t'));
    expect((await a.client.get(`/api/v1/search?q=${encodeURIComponent('resume ETE')}`)).body.files.map((f: any) => f.id)).toEqual([f1.id]);
    expect((await a.client.get('/api/v1/search?q=&kind=sheet')).body.files.map((f: any) => f.name)).toContain('budget.xlsx');
    expect((await a.client.get(`/api/v1/search?q=${encodeURIComponent('100%_')}`)).body.files).toHaveLength(1); // wildcards are literal
    expect((await a.client.get(`/api/v1/search?q=${encodeURIComponent("' or 1=1 --")}`)).body.files).toHaveLength(0);
    const tag = (await a.client.post('/api/v1/tags', { name: 'Impôts', color: 'green' })).body;
    expect((await a.client.post('/api/v1/tags', { name: 'impôts' })).status).toBe(409);
    await a.client.patch(`/api/v1/files/${f1.id}`, { tagIds: [tag.id], starred: true });
    expect((await a.client.get(`/api/v1/search?tag=${tag.id}`)).body.files.map((f: any) => f.id)).toEqual([f1.id]);
    expect((await a.client.get('/api/v1/starred')).body.files.map((f: any) => f.id)).toContain(f1.id);
    expect((await a.client.get('/api/v1/recent')).body.files[0].name).toBe('100%_fini.txt');
    const foreignTag = (await b.client.post('/api/v1/tags', { name: 'Autre' })).body;
    expect((await a.client.patch(`/api/v1/files/${f1.id}`, { tagIds: [foreignTag.id] })).status).toBe(404);
  });
  it('exports a folder as a ZIP with its structure', async () => {
    const dir = await mkdir(a.client, a.rootId, 'Export');
    const sub = await mkdir(a.client, dir.id, 'Sous dossier');
    const one = randomBytes(70000), two = Buffer.from('deux');
    await a.client.upload(dir.id, 'un.bin', one); await a.client.upload(sub.id, 'deux é.txt', two);
    const zip = await a.client.get(`/api/v1/zip?folders=${dir.id}`);
    expect(zip.status).toBe(200); expect(zip.headers['content-type']).toBe('application/zip');
    const path = join((process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test'), 'export.zip'); writeFileSync(path, zip.raw);
    const listing = execFileSync('/usr/bin/unzip', ['-Z1', path]).toString().trim().split('\n').sort();
    expect(listing).toEqual(['Export/Sous dossier/deux é.txt', 'Export/un.bin']);
    expect(execFileSync('/usr/bin/unzip', ['-p', path, 'Export/un.bin'], { maxBuffer: 1e8 }).equals(one)).toBe(true);
  });
});

describe('isolation between accounts (IDOR)', () => {
  it('answers 404 for every route given another account\'s identifiers', async () => {
    const dir = await mkdir(a.client, a.rootId, 'Privé A');
    const f = (await a.client.upload(dir.id, 'privé.txt', Buffer.from('secret de A'))).body.file;
    const detail = (await a.client.get(`/api/v1/files/${f.id}`)).body;
    const up = (await a.client.post('/api/v1/uploads', { folderId: dir.id, name: 'x', size: 5 })).body;
    const tag = (await a.client.post('/api/v1/tags', { name: 'Privé' })).body;
    const mine = (await b.client.upload(b.rootId, 'à-moi.txt', Buffer.from('b'))).body.file;
    const tries: [string, string, unknown?][] = [
      ['GET', `/api/v1/folders/${dir.id}`], ['GET', `/api/v1/folders/${dir.id}/children`], ['PATCH', `/api/v1/folders/${dir.id}`, { name: 'pris' }],
      ['POST', '/api/v1/folders', { parentId: dir.id, name: 'intrus' }], ['GET', `/api/v1/files/${f.id}`], ['PATCH', `/api/v1/files/${f.id}`, { name: 'pris.txt' }],
      ['GET', `/api/v1/files/${f.id}/content`], ['GET', `/api/v1/files/${f.id}/content?download=1`], ['GET', `/api/v1/files/${f.id}/preview/thumb`],
      ['GET', `/api/v1/files/${mine.id}/content?v=${detail.versions[0].id}`], // own file, foreign version id
      ['POST', `/api/v1/files/${mine.id}/versions/${detail.versions[0].id}/restore`], ['GET', `/api/v1/zip?files=${f.id}`], ['GET', `/api/v1/zip?folders=${dir.id}`],
      ['POST', '/api/v1/move', { fileIds: [f.id], destinationId: b.rootId }], ['POST', '/api/v1/move', { fileIds: [mine.id], destinationId: dir.id }],
      ['POST', '/api/v1/copy', { fileIds: [f.id], destinationId: b.rootId }], ['POST', '/api/v1/copy', { folderIds: [dir.id], destinationId: b.rootId }],
      ['POST', '/api/v1/trash', { fileIds: [f.id] }], ['POST', '/api/v1/trash', { folderIds: [dir.id] }], ['POST', '/api/v1/restore', { fileIds: [f.id] }], ['POST', '/api/v1/purge', { fileIds: [f.id] }],
      ['POST', '/api/v1/uploads', { folderId: dir.id, name: 'intrus.txt', size: 1 }], ['POST', '/api/v1/uploads', { folderId: 'root', name: 'v.txt', size: 1, fileId: f.id }],
      ['GET', `/api/v1/uploads/${up.id}`], ['PATCH', `/api/v1/uploads/${up.id}?offset=0`, Buffer.from('12345')], ['POST', `/api/v1/uploads/${up.id}/complete`], ['DELETE', `/api/v1/uploads/${up.id}`],
      ['PATCH', `/api/v1/tags/${tag.id}`, { name: 'pris' }], ['DELETE', `/api/v1/tags/${tag.id}`],
      ['POST', '/api/v1/shares', { fileId: f.id }], ['POST', '/api/v1/shares', { folderId: dir.id }], ['POST', '/api/v1/requests', { folderId: dir.id, title: 'Vol' }],
    ];
    for (const [method, url, body] of tries) {
      const r = await b.client.call(method, url, body);
      expect([method, url, r.status]).toEqual([method, url, 404]);
      expect(JSON.stringify(r.body ?? '')).not.toContain('secret de A');
    }
    // nothing changed for A, nothing appeared for B
    expect((await ls(a.client, dir.id)).files.map((x: any) => x.name)).toEqual(['privé.txt']);
    expect((await a.client.get(`/api/v1/uploads/${up.id}`)).body.received).toBe(0);
    expect((await b.client.get('/api/v1/search?q=priv')).body).toEqual({ folders: [], files: [] });
    expect((await b.client.get('/api/v1/recent')).body.files.every((x: any) => x.id !== f.id)).toBe(true);
    // and anonymous callers get 401 everywhere
    const anon = new Client();
    for (const [method, url, body] of tries) expect([url, (await anon.call(method, url, body)).status]).toEqual([url, 401]);
  });
});
