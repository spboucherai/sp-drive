// Native clients: device sessions (bearer), device linking, the change feed, optimistic concurrency on content, AASA.
import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.ts';
import { sql } from '../src/db.ts';
import { Client, closeAll, type Res, server, sha, signup, work } from './harness.ts';

afterAll(closeAll);

/** A native client: bearer token, no cookie, no CSRF header, no Origin. */
class Device {
  constructor(public token: string) {}
  async call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const a = await server();
    const raw = Buffer.isBuffer(body);
    const res = await a.inject({ method: method as 'GET', url, remoteAddress: '10.9.0.1',
      headers: { authorization: `Bearer ${this.token}`, ...(raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      payload: raw ? (body as Buffer) : body !== undefined ? JSON.stringify(body) : undefined });
    let parsed: any; try { parsed = res.json(); } catch { /* not json */ }
    return { status: res.statusCode, body: parsed, raw: res.rawPayload, cookies: res.cookies };
  }
  get = (url: string) => this.call('GET', url);
  post = (url: string, body: unknown = {}) => this.call('POST', url, body);
  patch = (url: string, body: unknown = {}, headers?: Record<string, string>) => this.call('PATCH', url, body, headers);
  async upload(o: { folderId?: string; name?: string; fileId?: string; baseVersionId?: string; onConflict?: string }, data: Buffer): Promise<{ status: number; body: any; uploadId?: string }> {
    const c = await this.post('/api/v1/uploads', { folderId: o.folderId ?? 'root', name: o.name ?? 'x', size: data.length, fileId: o.fileId, baseVersionId: o.baseVersionId, onConflict: o.onConflict });
    if (c.status !== 200) return c;
    const p = await this.patch(`/api/v1/uploads/${c.body.id}?offset=0`, data, { 'x-chunk-sha256': sha(data) });
    if (p.status !== 200) return p;
    const done = await this.post(`/api/v1/uploads/${c.body.id}/complete`, { sha256: sha(data) });
    return { ...done, uploadId: c.body.id };
  }
}
async function nativeLogin(client: Client, name = 'Mac de test'): Promise<{ device: Device; res: Res }> {
  const fresh = new Client(client.auth); // no cookie jar shared with the browser session
  const o = await fresh.post('/api/v1/auth/login/options');
  const res = await fresh.post('/api/v1/auth/login/verify', { challengeId: o.body.challengeId, response: client.auth!.get(o.body.options), client: { kind: 'native', name } });
  return { device: new Device(res.body.token), res };
}
const changes = async (d: Device, since = 0, limit = 500) => (await d.get(`/api/v1/sync/changes?since=${since}&limit=${limit}`)).body;

describe('device sessions', () => {
  it('a native passkey sign-in returns a bearer token and sets no cookie', async () => {
    const u = await signup();
    const { device, res } = await nativeLogin(u.client, "MacBook de l’équipe\u0007");
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(res.headers['set-cookie']).toBeUndefined();
    const st = await device.get('/api/v1/auth/state');
    expect(st.body).toMatchObject({ authenticated: true, kind: 'device', recovery: false });
    expect(st.body.user.id).toBe(u.userId);
    expect(st.cookies).toEqual([]); // never rotated into a cookie
    // state-changing call without CSRF header nor Origin
    const f = await device.post('/api/v1/folders', { parentId: 'root', name: 'Depuis le Mac' });
    expect(f.status).toBe(200);
    const list = await u.client.get('/api/v1/account/sessions');
    const row = list.body.find((s: any) => s.kind === 'device');
    expect(row.deviceName).toBe('MacBook de l’équipe');
    const [db] = await sql`select token_hash from sessions where id = ${row.id}`;
    expect(db!.token_hash).not.toContain(device.token); // only a hash is stored
  });
  it('the token is refused as a cookie, a web cookie is refused as a bearer, and CSRF still protects cookie sessions', async () => {
    const u = await signup();
    const { device } = await nativeLogin(u.client);
    const a = await server();
    const asCookie = await a.inject({ method: 'GET', url: '/api/v1/auth/state', headers: { cookie: `spd=${device.token}` } });
    expect(asCookie.json().authenticated).toBe(false);
    const web = u.client.cookies.get('spd')!;
    expect((await new Device(web).get('/api/v1/auth/state')).body.authenticated).toBe(false);
    const noCsrf = await a.inject({ method: 'POST', url: '/api/v1/folders', headers: { cookie: `spd=${web}`, 'content-type': 'application/json' }, payload: JSON.stringify({ parentId: 'root', name: 'x' }) });
    expect(noCsrf.statusCode).toBe(403);
    // a bearer sent together with a cookie gets no CSRF exemption
    const both = await a.inject({ method: 'POST', url: '/api/v1/folders', headers: { cookie: `spd=${web}`, authorization: `Bearer ${device.token}`, 'content-type': 'application/json' }, payload: JSON.stringify({ parentId: 'root', name: 'x' }) });
    expect(both.statusCode).toBe(403);
  });
  it('revocation, sign-out and a disabled account end a device session at once; another account stays invisible', async () => {
    const u = await signup(), other = await signup();
    const { device } = await nativeLogin(u.client);
    const { device: d2 } = await nativeLogin(u.client, 'Second');
    const mine = await device.post('/api/v1/folders', { parentId: 'root', name: 'Privé' });
    const { device: foreign } = await nativeLogin(other.client);
    expect((await foreign.get(`/api/v1/folders/${mine.body.id}`)).status).toBe(404);
    expect((await foreign.post('/api/v1/sync/items', { folderIds: [mine.body.id] })).body.folders).toEqual([]);
    const list = await u.client.get('/api/v1/account/sessions');
    const row = list.body.find((s: any) => s.deviceName === 'Mac de test');
    expect((await u.client.del(`/api/v1/account/sessions/${row.id}`)).status).toBe(200);
    expect((await device.get('/api/v1/folders/root')).status).toBe(401);
    expect((await d2.post('/api/v1/auth/logout')).status).toBe(200);
    expect((await d2.get('/api/v1/folders/root')).status).toBe(401);
    const { device: d3 } = await nativeLogin(u.client);
    await sql`update users set disabled_at = now() where id = ${u.userId}`;
    expect((await d3.get('/api/v1/folders/root')).status).toBe(401);
  });
  it('a device session slides, and dies after a long silence', async () => {
    const u = await signup();
    const { device } = await nativeLogin(u.client);
    await sql`update sessions set expires_at = now() + interval '5 days' where kind = 'device' and user_id = ${u.userId}`;
    expect((await device.get('/api/v1/auth/state')).body.authenticated).toBe(true);
    const [s] = await sql<{ d: number }[]>`select extract(day from expires_at - now())::int as d from sessions where kind = 'device' and user_id = ${u.userId}`;
    expect(s!.d).toBeGreaterThan(300);
    await sql`update sessions set last_seen_at = now() - interval '91 days' where kind = 'device' and user_id = ${u.userId}`;
    expect((await device.get('/api/v1/auth/state')).body.authenticated).toBe(false);
  });
});

describe('device linking', () => {
  const start = async (name = 'iPad') => { const c = new Client(); c.ip = `10.8.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`; return (await c.post('/api/v1/auth/device/start', { name })).body; };
  const poll = async (deviceCode: string) => (await new Client().post('/api/v1/auth/device/poll', { deviceCode })).body;
  it('a signed-in browser approves the code with a fresh passkey; the token is handed over once', async () => {
    const u = await signup();
    const l = await start('Mac mini du bureau');
    expect(l.userCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(l.verifyUrl).toBe(`${config.origin}/appareil?code=${l.userCode}`);
    expect((await poll(l.deviceCode)).status).toBe('pending');
    expect((await new Client().get(`/api/v1/auth/device/info?code=${l.userCode}`)).status).toBe(401);
    const info = await u.client.get(`/api/v1/auth/device/info?code=${l.userCode.toLowerCase().replace('-', ' ')}`);
    expect(info.body.name).toBe('Mac mini du bureau');
    await sql`update sessions set reauth_at = now() - interval '10 minutes' where user_id = ${u.userId}`;
    expect((await u.client.post('/api/v1/auth/device/decide', { code: l.userCode, approve: true })).body.error).toBe('reauth_required');
    expect((await poll(l.deviceCode)).status).toBe('pending');
    await u.client.reauth();
    expect((await u.client.post('/api/v1/auth/device/decide', { code: l.userCode, approve: true })).status).toBe(200);
    const done = await poll(l.deviceCode);
    expect(done.status).toBe('approved');
    const d = new Device(done.token);
    const st = await d.get('/api/v1/auth/state');
    expect(st.body).toMatchObject({ authenticated: true, kind: 'device', freshAuth: false });
    expect(st.body.user.id).toBe(u.userId);
    expect((await poll(l.deviceCode)).status).toBe('expired'); // once
    expect((await u.client.post('/api/v1/auth/device/decide', { code: l.userCode, approve: true })).status).toBe(404);
    const notes = await u.client.get('/api/v1/notifications');
    expect(notes.body.some((n: any) => n.kind === 'security.device_linked')).toBe(true);
  });
  it('denied, expired and unknown codes give nothing; a device cannot approve a device', async () => {
    const u = await signup();
    const a = await start();
    expect((await u.client.post('/api/v1/auth/device/decide', { code: a.userCode, approve: false })).status).toBe(200);
    expect(await poll(a.deviceCode)).toEqual({ status: 'denied' });
    const b = await start();
    await sql`update device_links set expires_at = now() - interval '1 second' where user_code = ${b.userCode}`;
    expect((await u.client.get(`/api/v1/auth/device/info?code=${b.userCode}`)).status).toBe(404);
    expect(await poll(b.deviceCode)).toEqual({ status: 'expired' });
    expect(await poll('x'.repeat(43))).toEqual({ status: 'expired' });
    const c = await start();
    const { device } = await nativeLogin(u.client);
    expect((await device.post('/api/v1/auth/device/decide', { code: c.userCode, approve: true })).status).toBe(403);
    expect((await poll(c.deviceCode)).status).toBe('pending');
  });
});

describe('change feed', () => {
  it('reports creations, renames, moves, new versions, trash, restore and purge in commit order', async () => {
    const u = await signup();
    const { device: d } = await nativeLogin(u.client);
    const c0 = await d.get('/api/v1/sync/cursor');
    expect(c0.body.rootId).toBe(u.rootId);
    const first = await changes(d);
    expect(first.items.map((i: any) => i.id)).toEqual([u.rootId]); // the root folder itself
    expect(first.items[0].parentId).toBeNull();
    let cur = first.cursor;
    expect(cur).toBe(c0.body.head);

    const folder = (await d.post('/api/v1/folders', { parentId: 'root', name: 'Projets' })).body;
    const up = await d.upload({ folderId: folder.id, name: 'note.txt' }, Buffer.from('un'));
    expect(up.status).toBe(200);
    const file = up.body.file;
    expect(file).toMatchObject({ versionSeq: 1, sha256: sha(Buffer.from('un')) });
    expect(file.versionId).toMatch(/^[0-9a-f-]{36}$/);
    let ch = await changes(d, cur);
    expect(ch.deleted).toEqual([]);
    const ids = ch.items.map((i: any) => i.id);
    expect(ids).toContain(folder.id); expect(ids).toContain(file.id);
    expect(ch.items.map((i: any) => i.rev)).toEqual([...ch.items.map((i: any) => i.rev)].sort((a, b) => a - b));
    expect(ch.cursor).toBe(ch.head); expect(ch.more).toBe(false);
    cur = ch.cursor;
    expect((await changes(d, cur)).items).toEqual([]);

    // rename + new version + star
    await d.patch(`/api/v1/files/${file.id}`, { name: 'note finale.txt', starred: true });
    const v2 = await d.upload({ fileId: file.id, baseVersionId: file.versionId }, Buffer.from('deux'));
    expect(v2.body.file).toMatchObject({ versionSeq: 2, name: 'note finale.txt' });
    ch = await changes(d, cur);
    const f2 = ch.items.find((i: any) => i.id === file.id);
    expect(f2).toMatchObject({ name: 'note finale.txt', starred: true, versionSeq: 2, sha256: sha(Buffer.from('deux')), folderId: folder.id, trashedAt: null });
    expect(f2.versionId).not.toBe(file.versionId);
    cur = ch.cursor;

    // move the folder: only the folder row changes, the file keeps its parent
    const dest = (await d.post('/api/v1/folders', { parentId: 'root', name: 'Archives' })).body;
    cur = (await changes(d, cur)).cursor;
    await d.post('/api/v1/move', { folderIds: [folder.id], destinationId: dest.id });
    ch = await changes(d, cur);
    expect(ch.items.find((i: any) => i.id === folder.id).parentId).toBe(dest.id);
    expect(ch.items.find((i: any) => i.id === file.id)).toBeUndefined();
    cur = ch.cursor;

    // trash the folder: both come out as items with trashedAt, the folder is the trash root
    await d.post('/api/v1/trash', { folderIds: [folder.id] });
    ch = await changes(d, cur);
    expect(ch.deleted).toEqual([]);
    expect(ch.items.find((i: any) => i.id === folder.id)).toMatchObject({ trashRoot: true, parentId: dest.id });
    expect(ch.items.find((i: any) => i.id === folder.id).trashedAt).toBeTruthy();
    expect(ch.items.find((i: any) => i.id === file.id)).toMatchObject({ trashRoot: false, folderId: folder.id });
    expect(ch.items.find((i: any) => i.id === file.id).trashedAt).toBeTruthy();
    cur = ch.cursor;
    await d.post('/api/v1/restore', { folderIds: [folder.id] });
    ch = await changes(d, cur);
    expect(ch.items.find((i: any) => i.id === file.id).trashedAt).toBeNull();
    cur = ch.cursor;

    // purge: tombstones, and the items disappear from a full replay
    await d.post('/api/v1/trash', { folderIds: [folder.id] });
    await d.post('/api/v1/purge', { folderIds: [folder.id] });
    ch = await changes(d, cur);
    expect(ch.deleted.map((x: any) => `${x.type}:${x.id}`).sort()).toEqual([`file:${file.id}`, `folder:${folder.id}`].sort());
    expect(ch.items.find((i: any) => i.id === file.id)).toBeUndefined();
    const replay = await changes(d, 0);
    expect(replay.items.map((i: any) => i.id).sort()).toEqual([u.rootId, dest.id].sort());
    expect(replay.deleted.length).toBe(2);
    const items = await d.post('/api/v1/sync/items', { fileIds: [file.id], folderIds: [dest.id, folder.id] });
    expect(items.body.files).toEqual([]); expect(items.body.folders.map((x: any) => x.id)).toEqual([dest.id]);
    await work();
  });
  it('pages without loss or repetition, and never shows another account', async () => {
    const u = await signup(), other = await signup();
    const { device: d } = await nativeLogin(u.client);
    await other.client.post('/api/v1/folders', { parentId: 'root', name: 'Ailleurs' });
    const made: string[] = [];
    for (let i = 0; i < 7; i++) made.push((await d.post('/api/v1/folders', { parentId: 'root', name: `d${i}` })).body.id);
    for (let i = 0; i < 6; i++) made.push((await d.upload({ name: `f${i}.txt` }, Buffer.from(`contenu ${i}`))).body.file.id);
    await other.client.upload(other.rootId, 'x.txt', Buffer.from('x'));
    const seen: string[] = []; let cur = 0, rounds = 0, more = true;
    while (more) { const ch = await changes(d, cur, 4); expect(ch.items.length + ch.deleted.length).toBeLessThanOrEqual(4); seen.push(...ch.items.map((i: any) => i.id)); expect(ch.cursor).toBeGreaterThanOrEqual(cur); cur = ch.cursor; more = ch.more; if (++rounds > 30) throw new Error('no end'); }
    // the root is touched by each creation, so it may come more than once across pages; every item is present, none foreign
    expect(new Set(seen)).toEqual(new Set([u.rootId, ...made]));
    expect(seen.filter((x) => x !== u.rootId).length).toBe(made.length);
    expect(cur).toBe((await d.get('/api/v1/sync/cursor')).body.head);
    await work();
  });
  it('concurrent writers of one owner never commit revisions out of order', async () => {
    const u = await signup();
    const { device: d } = await nativeLogin(u.client);
    let cur = (await changes(d)).cursor;
    const seen = new Set<string>(); let stop = false;
    const reader = (async () => { while (!stop) { const ch = await changes(d, cur); for (const i of ch.items) seen.add(i.id); cur = ch.cursor; } })();
    const made = (await Promise.all(Array.from({ length: 40 }, (_, i) => d.post('/api/v1/folders', { parentId: 'root', name: `c${i}` })))).map((r) => r.body.id);
    stop = true; await reader;
    const ch = await changes(d, cur); for (const i of ch.items) seen.add(i.id);
    for (const id of made) expect(seen.has(id)).toBe(true);
  });
});

describe('optimistic concurrency on content', () => {
  it('a new version derived from an old one is refused, and becomes a conflict copy without sending the bytes again', async () => {
    const u = await signup();
    const { device: mac } = await nativeLogin(u.client, 'Mac');
    const base = (await mac.upload({ name: 'rapport.txt' }, Buffer.from('base'))).body.file;
    // another device replaces the content
    const web = await u.client.upload(u.rootId, 'rapport.txt', Buffer.from('version du web'), { fileId: base.id });
    expect(web.body.file.versionSeq).toBe(2);
    // refused at creation
    const early = await mac.post('/api/v1/uploads', { folderId: 'root', name: 'rapport.txt', size: 3, fileId: base.id, baseVersionId: base.versionId });
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ error: 'version_conflict', currentVersionId: web.body.file.versionId, sha256: sha(Buffer.from('version du web')) });
    // refused at completion when the change lands while the bytes are travelling
    const mine = Buffer.from('version du Mac');
    const up = await mac.post('/api/v1/uploads', { folderId: 'root', name: 'rapport.txt', size: mine.length, fileId: base.id, baseVersionId: web.body.file.versionId });
    expect(up.status).toBe(200);
    await mac.patch(`/api/v1/uploads/${up.body.id}?offset=0`, mine);
    const third = await u.client.upload(u.rootId, 'rapport.txt', Buffer.from('encore le web'), { fileId: base.id });
    const late = await mac.post(`/api/v1/uploads/${up.body.id}/complete`, { sha256: sha(mine) });
    expect(late.status).toBe(409); expect(late.body.error).toBe('version_conflict');
    expect((await mac.get(`/api/v1/files/${base.id}`)).body.file.sha256).toBe(sha(Buffer.from('encore le web'))); // nothing overwritten
    // the same upload becomes a separate file
    expect((await mac.patch(`/api/v1/uploads/${up.body.id}/options`, { asNewFile: { name: 'rapport (conflit Mac).txt' } })).status).toBe(200);
    const copy = await mac.post(`/api/v1/uploads/${up.body.id}/complete`, { sha256: sha(mine) });
    expect(copy.status).toBe(200);
    expect(copy.body.file).toMatchObject({ name: 'rapport (conflit Mac).txt', sha256: sha(mine), versionSeq: 1 });
    expect(copy.body.file.id).not.toBe(base.id);
    const content = await mac.get(`/api/v1/files/${copy.body.file.id}/content?download=1`);
    expect(content.raw.toString()).toBe('version du Mac');
    expect((await mac.get(`/api/v1/files/${base.id}`)).body.versions.length).toBe(3);
    // sent from the current version with the bytes the server already has: accepted, no new version recorded
    const same = await mac.upload({ fileId: base.id, baseVersionId: third.body.file.versionId }, Buffer.from('encore le web'));
    expect(same.status).toBe(200); expect(same.body.file.versionSeq).toBe(3);
    await work();
  });
  it('baseVersionId needs fileId; without it the old behaviour is unchanged', async () => {
    const u = await signup();
    const { device: d } = await nativeLogin(u.client);
    expect((await d.post('/api/v1/uploads', { folderId: 'root', name: 'a.txt', size: 1, baseVersionId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    const a = (await d.upload({ name: 'a.txt' }, Buffer.from('1'))).body.file;
    const b = await d.upload({ fileId: a.id }, Buffer.from('2'));
    expect(b.body.file.versionSeq).toBe(2);
    expect((await d.patch(`/api/v1/uploads/${b.uploadId}/options`, { asNewFile: { name: 'z' } })).status).toBe(404); // finished upload
    await work();
  });
});

describe('apple-app-site-association', () => {
  it('lists the configured application identifiers as JSON, publicly', async () => {
    const a = await server();
    const r = await a.inject({ method: 'GET', url: '/.well-known/apple-app-site-association' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('application/json');
    expect(r.json()).toEqual({ webcredentials: { apps: config.appleAppIds } });
  });
});
