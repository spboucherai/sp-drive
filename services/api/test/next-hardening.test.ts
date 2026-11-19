// 2.0 hardening (security review before deployment): one regression test per finding. Hostile inputs must cost a
// bounded amount of time and memory, a member must see only what the grant model promises, and limits must hold
// under concurrency.
import { execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { config } from '../src/config.ts';
import { sql } from '../src/db.ts';
import { eventSlots } from '../src/events.ts';
import { groupByDistance, SIMILAR_MAX_GROUP_FILES, SIMILAR_MAX_IMAGES } from '../src/insights.ts';
import { UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN } from '../src/server.ts';
import { xmlToText } from '../src/textextract.ts';
import { embedQuery, semanticBackend, vectorCacheStats } from '../src/textindex.ts';
import { helperStats, resetTextkitProbe, textkitDhash, textkitInfo, textutilToText, withWorkDir } from '../src/tools.ts';
import { Client, closeAll, server, sha, signup, work } from './harness.ts';

let port = 0;
const FX = `${process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test'}/fixtures-hardening`;
beforeAll(async () => { mkdirSync(FX, { recursive: true }); const app = await server(); if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' }); port = (app.server.address() as AddressInfo).port; });
afterAll(closeAll);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timed = <T>(fn: () => T): [T, number] => { const t0 = performance.now(); const r = fn(); return [r, performance.now() - t0]; };
const up = async (c: Awaited<ReturnType<typeof signup>>, name: string, data: Buffer, o = {}) => { const r = await c.client.upload(c.rootId, name, data, o); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body.file; };
const text = async (c: Awaited<ReturnType<typeof signup>>, id: string) => (await c.client.get(`/api/v1/files/${id}/text`)).body;

describe('1 · text extraction cannot freeze the worker', () => {
  it('the tag scanner is linear on the inputs that were quadratic', () => {
    const cases: [string, string][] = [
      ['unclosed <script> repeated', '<script>'.repeat(400_000)],
      ['"<" repeated', '<'.repeat(4_000_000)],
      ['"<" repeated then one ">"', `${'<'.repeat(3_000_000)}>`],
      ['unclosed tags with attributes', '<a href="x" '.repeat(400_000)],
      ['<style> never closed, with text', `${'<style>'.repeat(200_000)}${'a'.repeat(1_000_000)}`],
      ['"</script" without ">"', `<script>${'</script'.repeat(400_000)}`],
      ['entities', '&amp;'.repeat(800_000)],
      ['"&" repeated', '&'.repeat(4_000_000)],
    ];
    for (const [label, input] of cases) { const [, ms] = timed(() => xmlToText(input)); expect(ms, `${label}: ${Math.round(ms)} ms for ${input.length} characters`).toBeLessThan(1500); }
    // twice the input costs about twice the time, not four times
    const [, t1] = timed(() => xmlToText('<script>'.repeat(250_000))), [, t2] = timed(() => xmlToText('<script>'.repeat(1_000_000)));
    expect(t2).toBeLessThan(Math.max(400, t1 * 12));
    // …and it still reads documents correctly
    expect(xmlToText('<p>Un &amp; deux</p><SCRIPT type="x">alert("<p>non</p>")</SCRIPT><p>trois&#233;</p>').trim().split(/\s*\n\s*/)).toEqual(['Un & deux', 'troisé']);
    expect(xmlToText('<w:p><w:r><w:t>Ligne 1</w:t></w:r></w:p><w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>')).toBe('Ligne 1\na\tb\n');
    expect(xmlToText('<tr><td>a</td><td>b</td></tr>x<br/>y<br>z')).toBe('a\tb\t\nx\ny\nz');
    expect(xmlToText('1 < 2 et 3 > 2')).toBe('1 < 2 et 3 > 2');
    expect(xmlToText('<style>p { color: red }</style>visible<script src="x"/>aussi')).toBe(' visibleaussi');
    expect(xmlToText('avant <script>jamais fermé et du texte')).toBe('avant ');
    expect(xmlToText('<p>abcdef</p>'.repeat(1000), 50).length).toBeLessThanOrEqual(50); // output cap
  });
  it('a hostile HTML file and a hostile office file are handled out of process, within a bound, without holding the event loop', async () => {
    const a = await signup();
    const html = await up(a, 'piège.html', Buffer.from(`<p>début visible</p>${'<script>'.repeat(1_200_000)}`)); // ~10 MB
    // an office file whose XML part inflates to 60 MB of "<" from a few kilobytes
    const z = new yazl.ZipFile();
    z.addReadStream(Readable.from((function* () { yield Buffer.from('<w:p><w:t>titre visible</w:t></w:p>'); const blk = Buffer.alloc(1 << 20, '<'); for (let i = 0; i < 60; i++) yield blk; })()), 'word/document.xml');
    z.end(); await pipeline(z.outputStream, createWriteStream(join(FX, 'piège.docx')));
    expect(readFileSync(join(FX, 'piège.docx')).length).toBeLessThan(200_000);
    const docx = await up(a, 'piège.docx', readFileSync(join(FX, 'piège.docx')));
    let worst = 0, last = performance.now();
    const probe = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last - 20); last = now; }, 20);
    const t0 = performance.now();
    await work();
    clearInterval(probe);
    expect(performance.now() - t0).toBeLessThan(60_000);
    expect(worst, `the event loop was held for ${Math.round(worst)} ms`).toBeLessThan(1500);
    expect(await text(a, html.id)).toMatchObject({ status: 'ready', excerpt: 'début visible' });
    expect((await text(a, docx.id)).status).toMatch(/^(ready|empty)$/); // read up to the cap, never hung
    expect(await sql`select 1 from jobs where kind = 'extract_text' and status in ('queued', 'running')`).toHaveLength(0);
  });
  it('the extraction child is killed at its time limit and the file is reported as failed', async () => {
    const a = await signup();
    const saved = config.nodeExtractTimeoutMs; config.nodeExtractTimeoutMs = 1;
    try {
      const f = await up(a, 'lent.txt', Buffer.from('un texte ordinaire'));
      const t0 = performance.now(); await work();
      expect(performance.now() - t0).toBeLessThan(20_000);
      expect(await text(a, f.id)).toMatchObject({ status: 'failed' }); expect((await text(a, f.id)).error).toMatch(/exceeded/);
    } finally { config.nodeExtractTimeoutMs = saved; }
  });
});

describe('14 · a content is indexed under the name of the file that shows it', () => {
  it('a new version whose bytes were first seen under an unreadable name becomes searchable', async () => {
    const a = await signup();
    const body = Buffer.from('Le héron cendré niche près de la rivière Batiscan.');
    const blob = await up(a, 'export.bin', body);
    const notes = await up(a, 'observations.txt', Buffer.from('première version'));
    await work();
    expect((await text(a, blob.id)).status).toBe('unsupported');
    // the same bytes become the current version of a text file, sent under any upload name
    const r = await a.client.upload(a.rootId, 'whatever.bin', body, { fileId: notes.id });
    expect(r.body.file.versionSeq).toBe(2);
    await work();
    expect(await text(a, notes.id)).toMatchObject({ status: 'ready', source: 'text' });
    expect((await a.client.get('/api/v1/search?q=batiscan')).body.files.map((f: any) => f.name).sort()).toEqual(['export.bin', 'observations.txt']); // one content, two files
  });
});

describe('2 · a member reads a reduced activity feed', () => {
  it('nothing from before the grant, no identifiers, no downloads, no former names, nothing about trashed items', async () => {
    const owner = await signup(), member = await signup(), other = await signup();
    const folder = (await owner.client.post('/api/v1/folders', { parentId: 'root', name: 'Dossier partagé' })).body;
    const old = await up(owner, 'ANCIEN-NOM-CONFIDENTIEL.txt', Buffer.from('a'));
    await owner.client.post('/api/v1/move', { fileIds: [old.id], folderIds: [], destinationId: folder.id });
    await owner.client.patch(`/api/v1/files/${old.id}`, { name: 'rapport.txt' });
    const gone = (await owner.client.upload(folder.id, 'PROJET-ABANDONNE.txt', Buffer.from('b'))).body.file;
    await owner.client.post('/api/v1/folders/' + folder.id + '/members', { email: other.email, role: 'viewer' });
    await sleep(15);
    const g = (await owner.client.post(`/api/v1/folders/${folder.id}/members`, { email: member.email, role: 'editor' })).body;
    await sleep(15);
    // after the grant: things a member may know about, and things it may not
    await owner.client.get(`/api/v1/files/${old.id}/content?download=1`);
    await owner.client.patch(`/api/v1/files/${old.id}`, { name: 'rapport final.txt' });
    await owner.client.post('/api/v1/shares', { fileId: old.id });
    await owner.client.post('/api/v1/trash', { fileIds: [gone.id], folderIds: [] });
    const fresh = (await owner.client.upload(folder.id, 'nouveau.txt', Buffer.from('c'))).body.file;
    const tossed = (await member.client.post(`/api/v1/shared/${g.grantId}/folders`, { name: 'JETE-PAR-LE-MEMBRE' })).body;
    await member.client.post(`/api/v1/shared/${g.grantId}/trash`, { folderIds: [tossed.id] });
    const feed = (await member.client.get(`/api/v1/shared/${g.grantId}/activity?limit=200`)).body;
    expect(feed.events.map((e: any) => e.action).sort()).toEqual(['file.renamed', 'file.uploaded']);
    const raw = JSON.stringify(feed);
    for (const secret of ['ANCIEN-NOM-CONFIDENTIEL', 'PROJET-ABANDONNE', 'JETE-PAR-LE-MEMBRE', 'rapport.txt', owner.userId, other.userId, member.userId, g.grantId, other.email, owner.email, 'grantId', 'download', 'share.', 'collab.', 'trash', '"from"', '"ip"'])
      expect(raw, secret).not.toContain(secret);
    expect(feed.events.every((e: any) => e.actor.userId === null && typeof e.actor.displayName === 'string')).toBe(true);
    expect(feed.events.find((e: any) => e.action === 'file.renamed')).toMatchObject({ target: { type: 'file', id: old.id, name: 'rapport final.txt' }, meta: {}, actor: { me: false } });
    expect(feed.events.find((e: any) => e.action === 'file.uploaded')).toMatchObject({ target: { id: fresh.id, name: 'nouveau.txt' }, meta: { size: 1 } });
    // the owner's own view is untouched: full trail, identifiers included
    const mine = (await owner.client.get(`/api/v1/folders/${folder.id}/activity?limit=200`)).body.events.map((e: any) => e.action);
    expect(mine).toEqual(expect.arrayContaining(['file.downloaded', 'items.trashed', 'collab.member_added', 'share.created', 'file.renamed']));
  });
});

describe('3 · event stream limits hold under concurrency', () => {
  const open = (cookie: string) => new Promise<{ status: number; close: () => void }>((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/v1/sync/events', headers: { cookie } }, (res) => { res.resume(); resolve({ status: res.statusCode ?? 0, close: () => req.destroy() }); });
    req.on('error', () => resolve({ status: 0, close: () => {} }));
  });
  it('forty simultaneous opens give sixteen streams, and the process has a ceiling of its own', async () => {
    const a = await signup(), cookie = [...a.client.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const before = eventSlots().total;
    const all = await Promise.all(Array.from({ length: 40 }, () => open(cookie)));
    expect(all.filter((s) => s.status === 200)).toHaveLength(16);
    expect(all.filter((s) => s.status === 429)).toHaveLength(24);
    expect(eventSlots().total).toBe(before + 16);
    for (const s of all) s.close();
    const t0 = Date.now(); while (eventSlots().total !== before && Date.now() - t0 < 5000) await sleep(20);
    expect(eventSlots().total).toBe(before); // every slot came back, refused requests included
    const saved = config.eventsMaxStreams; config.eventsMaxStreams = before + 2;
    try {
      const b = await signup(), cb = [...b.client.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      const mixed = await Promise.all([open(cookie), open(cookie), open(cb), open(cb), open(cb)]);
      expect(mixed.filter((s) => s.status === 200)).toHaveLength(2);
      expect(mixed.filter((s) => s.status === 503)).toHaveLength(3);
      for (const s of mixed) s.close();
    } finally { config.eventsMaxStreams = saved; }
    const t1 = Date.now(); while (eventSlots().total !== before && Date.now() - t1 < 5000) await sleep(20);
    expect(eventSlots()).toMatchObject({ total: before });
  });
});

describe('4 · a refused chunk request is still counted', () => {
  it('PATCH /uploads/<id> with a cookie and no CSRF header ends in 429, not in endless 403', async () => {
    const c = new Client(); c.ip = '10.55.0.9'; c.cookies.set('spd', 'not-a-session');
    const app = await server();
    const codes: number[] = [];
    for (let i = 0; i < UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN + 40; i++) {
      const res = await app.inject({ method: 'PATCH', url: '/api/v1/uploads/00000000-0000-4000-8000-000000000000?offset=0', remoteAddress: c.ip, headers: { cookie: 'spd=whatever', 'content-type': 'application/octet-stream' }, payload: Buffer.from('x') });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN).every((s) => s === 403)).toBe(true);
    expect(codes.slice(UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN).every((s) => s === 429)).toBe(true);
    // the same for the shared-folder upload route
    const shared = await app.inject({ method: 'PATCH', url: '/api/v1/shared/00000000-0000-4000-8000-000000000000/uploads/00000000-0000-4000-8000-000000000000?offset=0', remoteAddress: c.ip, headers: { cookie: 'spd=whatever' }, payload: 'x' });
    expect(shared.statusCode).toBe(429);
  });
});

describe('5 · similar-image grouping is bounded', () => {
  it('thousands of hashes, alike or not, group quickly and the answer is capped', async () => {
    const rnd = () => Array.from({ length: 16 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    const [g1, t1] = timed(() => groupByDistance(Array.from({ length: SIMILAR_MAX_IMAGES }, rnd), 6));
    expect(t1).toBeLessThan(3000); expect(g1.length).toBeLessThan(50); // random hashes are almost never 6 bits apart
    const [g2, t2] = timed(() => groupByDistance(Array.from({ length: SIMILAR_MAX_IMAGES }, () => 'a5a5a5a5a5a5a5a5'), 6));
    expect(t2).toBeLessThan(3000); expect(g2).toHaveLength(1); expect(g2[0]).toHaveLength(SIMILAR_MAX_IMAGES);
    expect(groupByDistance(['00000000000000ff', '00000000000000fe', 'ffffffff00000000'], 2)).toEqual([[0, 1]]);
    // through the route: 500 different pictures with near-identical hashes
    const a = await signup();
    await sql`insert into storage_objects (owner_id, sha256, size, storage_key, wrapped_key, scan_status)
      select ${a.userId}, md5(i::text) || md5(i::text), 10, 'zz/zz/' || gen_random_uuid(), '\\x00'::bytea, 'clean' from generate_series(1, 500) i`;
    await sql`insert into files (owner_id, folder_id, name, name_key, size, sha256) select ${a.userId}, ${a.rootId}, 'img-' || sha256 || '.jpg', 'img-' || sha256 || '.jpg', 10, sha256 from storage_objects where owner_id = ${a.userId}`;
    await sql`insert into file_versions (file_id, seq, object_id, size, sha256) select f.id, 1, o.id, 10, o.sha256 from files f join storage_objects o on o.owner_id = f.owner_id and o.sha256 = f.sha256 where f.owner_id = ${a.userId}`;
    await sql`update files f set current_version_id = v.id from file_versions v where v.file_id = f.id and f.owner_id = ${a.userId}`;
    await sql`insert into object_phash (object_id, dhash) select id, 'a5a5a5a5a5a5a5a' || (row_number() over () % 2)::text from storage_objects where owner_id = ${a.userId}`;
    const t0 = performance.now();
    const r = (await a.client.get('/api/v1/duplicates?mode=similar-images')).body;
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(r.groups).toHaveLength(1); expect(r.groups[0].files).toHaveLength(SIMILAR_MAX_GROUP_FILES); expect(r.groups[0].maxDistance).toBeLessThanOrEqual(1);
    await sql`delete from files where owner_id = ${a.userId}`; await sql`delete from storage_objects where owner_id = ${a.userId}`;
  });
});

describe('6, 7 · vectors and helper starts are bounded', () => {
  it('one probe and one embedding per distinct question however many requests ask at once; two helpers at most', async () => {
    resetTextkitProbe();
    const probes = Array.from({ length: 30 }, () => textkitInfo());
    expect(new Set(probes).size).toBe(1); // thirty callers, one process
    const app = await server();
    const metas = await Promise.all(Array.from({ length: 30 }, () => app.inject({ method: 'GET', url: '/api/v1/meta' })));
    expect(metas.every((m) => m.statusCode === 200)).toBe(true);
    if (!(await semanticBackend()).available) return;
    let peak = 0; const watch = setInterval(() => { peak = Math.max(peak, helperStats().running); }, 2);
    const same = await Promise.all(Array.from({ length: 20 }, () => embedQuery('la même question pour tous')));
    const distinct = await Promise.all(Array.from({ length: 8 }, (_, i) => embedQuery(`question numéro ${i} ${Math.random()}`)));
    clearInterval(watch);
    expect(same.every((v) => v === same[0])).toBe(true); // the very same array: computed once
    expect(distinct.every((v) => v?.length === 512)).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(helperStats()).toEqual({ running: 0, queued: 0 });
  });
  it('the vector cache is bounded in bytes across accounts and still answers correctly', async () => {
    if (!(await semanticBackend()).available) return;
    const a = await signup(), b = await signup();
    await up(a, 'jardin.txt', Buffer.from('Semer les tomates en mars et pailler le potager en été.'));
    await up(b, 'voiture.txt', Buffer.from('Vidange du moteur et remplacement des plaquettes de frein.'));
    await work();
    const saved = config.semanticCacheBytes; config.semanticCacheBytes = 3000; // room for one account's vectors, not two
    try {
      const ra = (await a.client.get('/api/v1/search/semantic?q=potager')).body, rb = (await b.client.get('/api/v1/search/semantic?q=garage')).body;
      expect(ra.hits.map((h: any) => h.file.name)).toEqual(['jardin.txt']); expect(rb.hits.map((h: any) => h.file.name)).toEqual(['voiture.txt']);
      expect(ra.hits[0].score).toBeGreaterThan(0.3); expect(ra.hits[0].score).toBeLessThanOrEqual(1.0001); // vectors read back exactly
      expect(vectorCacheStats().accounts).toBe(1); expect(vectorCacheStats().bytes).toBeLessThan(3000);
      expect((await a.client.get('/api/v1/search/semantic?q=potager')).body.hits.map((h: any) => h.file.name)).toEqual(['jardin.txt']); // evicted, reloaded
    } finally { config.semanticCacheBytes = saved; }
  });
});

describe('8, 9, 10 · grants under pressure', () => {
  it('one member cannot reserve the owner\'s quota with unsent uploads, and such uploads expire in a day', async () => {
    const owner = await signup(), m = await signup();
    const folder = (await owner.client.post('/api/v1/folders', { parentId: 'root', name: 'Dépôt' })).body;
    const g = (await owner.client.post(`/api/v1/folders/${folder.id}/members`, { email: m.email, role: 'uploader' })).body.grantId;
    const saved = config.grantPendingMaxBytes; config.grantPendingMaxBytes = 5000;
    try {
      const one = await m.client.post(`/api/v1/shared/${g}/uploads`, { name: 'a.bin', size: 3000 });
      expect(one.status).toBe(200);
      const two = await m.client.post(`/api/v1/shared/${g}/uploads`, { name: 'b.bin', size: 3000 });
      expect(two.status).toBe(413); expect(two.body).toMatchObject({ error: 'too_many_pending_uploads', pending: 3000, max: 5000 });
      const [row] = await sql<{ h: number }[]>`select extract(epoch from expires_at - now()) / 3600 as h from uploads where id = ${one.body.id}`;
      expect(Number(row!.h)).toBeGreaterThan(23); expect(Number(row!.h)).toBeLessThanOrEqual(24);
      await m.client.del(`/api/v1/shared/${g}/uploads/${one.body.id}`);
      expect((await m.client.post(`/api/v1/shared/${g}/uploads`, { name: 'b.bin', size: 3000 })).status).toBe(200); // room again
      // the owner's own uploads are not concerned by the per-grant cap
      expect((await owner.client.post('/api/v1/uploads', { folderId: owner.rootId, name: 'c.bin', size: 50_000 })).status).toBe(200);
    } finally { config.grantPendingMaxBytes = saved; }
  });
  it('revoking or lowering a role stops an upload that is being completed, and a completion racing a revocation never places a file after it', async () => {
    const owner = await signup(), m = await signup();
    const folder = (await owner.client.post('/api/v1/folders', { parentId: 'root', name: 'Course' })).body;
    const member = async (role: string) => (await owner.client.post(`/api/v1/folders/${folder.id}/members`, { email: m.email, role })).body.grantId as string;
    const data = Buffer.from('abc');
    const ready = async (g: string, name: string) => { const u = await m.client.post(`/api/v1/shared/${g}/uploads`, { name, size: 3 }); await m.client.patch(`/api/v1/shared/${g}/uploads/${u.body.id}?offset=0`, data); return u.body.id as string; };
    // an upload caught in the middle of its completion
    let g = await member('editor');
    const stuck = await ready(g, 'coincé.txt');
    await sql`update uploads set status = 'completing' where id = ${stuck}`;
    await owner.client.patch(`/api/v1/folders/${folder.id}/members/${m.userId}`, { role: 'viewer' });
    expect((await sql`select status from uploads where id = ${stuck}`)[0]!.status).toBe('aborted');
    await owner.client.del(`/api/v1/folders/${folder.id}/members/${m.userId}`);
    // completion and revocation started together, twelve times: whoever wins, the outcome is consistent
    for (let i = 0; i < 12; i++) {
      g = await member('editor');
      const id = await ready(g, `course-${i}.txt`);
      const [done, revoked] = await Promise.all([m.client.post(`/api/v1/shared/${g}/uploads/${id}/complete`, { sha256: sha(data) }), owner.client.del(`/api/v1/folders/${folder.id}/members/${m.userId}`)]);
      expect(revoked.status).toBe(200);
      const placed = await sql`select 1 from files where owner_id = ${owner.userId} and name = ${`course-${i}.txt`}`;
      const [u] = await sql<{ status: string }[]>`select status from uploads where id = ${id}`;
      if (done.status === 200) { expect(placed).toHaveLength(1); expect(u!.status).toBe('done'); }
      else { expect([404, 409]).toContain(done.status); expect(placed).toHaveLength(0); expect(u!.status).toBe('aborted'); }
    }
    expect(await sql`select 1 from uploads where owner_id = ${owner.userId} and status in ('active', 'completing')`).toHaveLength(0);
  });
});

describe('11 · the text helper refuses what would exhaust memory', () => {
  /** A valid PNG header declaring a huge picture, a few dozen bytes long. */
  const pngHeader = (w: number, h: number) => {
    const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
    const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(64))), chunk('IEND', Buffer.alloc(0))]);
  };
  it('a picture declaring billions of pixels is refused from its header, in the helper and through the pipeline', async () => {
    const bomb = pngHeader(60000, 60000);
    expect(bomb.length).toBeLessThan(200);
    await withWorkDir(async (w) => {
      writeFileSync(join(w, 'bombe.png'), bomb);
      const t0 = performance.now();
      await expect(textkitDhash(w, join(w, 'bombe.png'))).rejects.toThrow(/could not be hashed/);
      expect(performance.now() - t0).toBeLessThan(5000);
    });
    // through the pipeline: refused quickly, reported as failed, nothing retried
    const a = await signup();
    const f = await up(a, 'bombe.png', bomb);
    let t0 = performance.now(); await work();
    expect(performance.now() - t0).toBeLessThan(30_000);
    expect((await text(a, f.id)).status).toBe('failed');
    // the limit itself, on a picture that decodes perfectly well: its declared size is what is judged, before decoding
    writeFileSync(join(FX, 'px.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    execFileSync('/usr/bin/sips', ['-z', '300', '400', join(FX, 'px.png'), '--out', join(FX, 'photo.png')], { stdio: 'pipe' });
    const saved = config.imageMaxPixels; config.imageMaxPixels = 100_000; // 400 × 300 = 120 000 pixels
    try {
      const g = await up(a, 'photo.png', readFileSync(join(FX, 'photo.png')));
      t0 = performance.now(); await work();
      expect(await text(a, g.id)).toMatchObject({ status: 'failed' }); expect((await text(a, g.id)).error).toMatch(/too large to decode \(400 x 300 pixels\)/);
      expect(await sql`select 1 from object_phash h join file_versions v on v.object_id = h.object_id where v.file_id = ${g.id}`).toHaveLength(0);
    } finally { config.imageMaxPixels = saved; }
  });
  it('documents read by textutil have an input cap and a bounded read of the result', async () => {
    const rtf = Buffer.from(`{\\rtf1\\ansi ${'Mot repete. '.repeat(5000)}}`);
    await withWorkDir(async (w) => {
      writeFileSync(join(w, 'long.rtf'), rtf);
      const t = await textutilToText(w, join(w, 'long.rtf'), 100);
      expect(t.length).toBeLessThanOrEqual(100); expect(t).toMatch(/^Mot repete\. Mot/);
    });
    const a = await signup();
    const saved = config.textutilMaxBytes; config.textutilMaxBytes = 1000;
    try {
      const f = await up(a, 'long.rtf', rtf); await work();
      expect(await text(a, f.id)).toMatchObject({ status: 'unsupported' }); expect((await text(a, f.id)).error).toMatch(/too large/);
    } finally { config.textutilMaxBytes = saved; }
    const ok = await up(a, 'court.rtf', Buffer.from('{\\rtf1\\ansi Le castor construit une digue.}')); await work();
    expect(await text(a, ok.id)).toMatchObject({ status: 'ready', source: 'textutil' }); expect((await text(a, ok.id)).excerpt).toContain('castor');
    execFileSync('/usr/bin/true');
  });
});
