// 2.0: private sharing and workspaces. The point of this file is security: every promise of the grant model is
// attacked from the grantee's side and from a stranger's side, through the grantee routes AND through the owner routes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '../src/db.ts';
import { Client, closeAll, sha, signup, work } from './harness.ts';

afterAll(closeAll);
type U = Awaited<ReturnType<typeof signup>>;
let owner: U, viewer: U, editor: U, uploader: U, stranger: U;
let shared: any, inner: any, privateFolder: any, doc: any, innerDoc: any, privateDoc: any;
const G: Record<string, string> = {};
const up = async (c: U, folderId: string, name: string, data: string) => { const r = await c.client.upload(folderId, name, Buffer.from(data)); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body.file; };
const S = (who: string, path = '') => `/api/v1/shared/${G[who]}${path}`;
/** Upload through a grant with the resumable protocol. */
async function upShared(c: Client, grantId: string, body: Record<string, unknown>, data: Buffer) {
  const created = await c.post(`/api/v1/shared/${grantId}/uploads`, { ...body, size: data.length });
  if (created.status !== 200) return created;
  const p = await c.patch(`/api/v1/shared/${grantId}/uploads/${created.body.id}?offset=0`, data, { 'x-chunk-sha256': sha(data) });
  if (p.status !== 200) return p;
  return c.post(`/api/v1/shared/${grantId}/uploads/${created.body.id}/complete`, { sha256: sha(data) });
}
const grant = async (folderId: string, u: U, role: string, extra = {}) => { const r = await owner.client.post(`/api/v1/folders/${folderId}/members`, { userId: u.userId, role, ...extra }); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); return r.body; };

beforeAll(async () => {
  [owner, viewer, editor, uploader, stranger] = [await signup({ quotaBytes: 100_000 }), await signup(), await signup(), await signup(), await signup()];
  shared = (await owner.client.post('/api/v1/folders', { parentId: 'root', name: 'Équipe' })).body;
  inner = (await owner.client.post('/api/v1/folders', { parentId: shared.id, name: 'Plans' })).body;
  privateFolder = (await owner.client.post('/api/v1/folders', { parentId: 'root', name: 'Privé' })).body;
  doc = await up(owner, shared.id, 'charte.txt', 'Charte de l\'équipe');
  innerDoc = await up(owner, inner.id, 'plan.txt', 'Plan secret mais partagé');
  privateDoc = await up(owner, privateFolder.id, 'journal intime.txt', 'jamais partagé');
  await work();
});

describe('owner side', () => {
  it('resolves an exact address only, and never enumerates', async () => {
    const r = await owner.client.post('/api/v1/collab/resolve', { email: viewer.email.toUpperCase() });
    expect(r.body).toEqual({ userId: viewer.userId, displayName: expect.any(String) });
    expect(Object.keys(r.body)).toEqual(['userId', 'displayName']);
    for (const email of [viewer.email.replace(/^.{4}/, 'zzzz'), `x${viewer.email}`, 'nobody@example.test', owner.email]) expect((await owner.client.post('/api/v1/collab/resolve', { email })).status).toBe(404);
    expect((await owner.client.post('/api/v1/collab/resolve', { email: 'not an address' })).status).toBe(400);
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await owner.client.post('/api/v1/collab/resolve', { email: `guess${i}@example.test` })).status);
    expect(codes).toContain(429); // ten a minute per address: no directory harvesting
    owner.client.ip = '10.0.0.77';
  });
  it('grants, lists, changes and names; only the owner can', async () => {
    G.viewer = (await grant(shared.id, viewer, 'viewer', { workspaceName: 'Équipe Projet' })).grantId;
    G.editor = (await grant(shared.id, editor, 'editor')).grantId;
    G.uploader = (await owner.client.post(`/api/v1/folders/${shared.id}/members`, { email: uploader.email, role: 'uploader' })).body.grantId;
    const m = (await owner.client.get(`/api/v1/folders/${shared.id}/members`)).body;
    expect(m.folder).toMatchObject({ id: shared.id, workspaceName: 'Équipe Projet' });
    expect(m.members.map((x: any) => [x.userId, x.role, x.grantId])).toEqual([[viewer.userId, 'viewer', G.viewer], [editor.userId, 'editor', G.editor], [uploader.userId, 'uploader', G.uploader]]);
    expect(m.members[0]).toMatchObject({ email: viewer.email, displayName: expect.any(String), createdAt: expect.any(String) });
    expect((await owner.client.post(`/api/v1/folders/${shared.id}/members`, { userId: viewer.userId, role: 'editor' })).body.error).toBe('already_member');
    expect((await owner.client.post(`/api/v1/folders/${shared.id}/members`, { userId: owner.userId, role: 'editor' })).status).toBe(404); // not to oneself
    expect((await owner.client.post(`/api/v1/folders/${owner.rootId}/members`, { userId: viewer.userId, role: 'viewer' })).body.error).toBe('root_immutable');
    expect((await owner.client.post(`/api/v1/folders/${shared.id}/members`, { userId: viewer.userId, role: 'admin' })).status).toBe(400);
    expect((await owner.client.get('/api/v1/collab/outgoing')).body).toMatchObject([{ folder: { id: shared.id }, members: 3 }]);
    expect((await owner.client.patch(`/api/v1/folders/${shared.id}/workspace`, { name: 'Atelier' })).body.workspaceName).toBe('Atelier');
    // members were told
    expect((await viewer.client.get('/api/v1/notifications')).body[0]).toMatchObject({ kind: 'collab.shared', data: { grantId: G.viewer, role: 'viewer', folderName: 'Équipe Projet' } });
    // nobody else can manage the folder's members: not a stranger, not a member, not even an editor
    for (const u of [stranger, viewer, editor]) {
      expect((await u.client.get(`/api/v1/folders/${shared.id}/members`)).status).toBe(404);
      expect((await u.client.post(`/api/v1/folders/${shared.id}/members`, { userId: stranger.userId, role: 'editor' })).status).toBe(404);
      expect((await u.client.patch(`/api/v1/folders/${shared.id}/members/${viewer.userId}`, { role: 'editor' })).status).toBe(404);
      expect((await u.client.del(`/api/v1/folders/${shared.id}/members/${viewer.userId}`)).status).toBe(404);
      expect((await u.client.patch(`/api/v1/folders/${shared.id}/workspace`, { name: 'Pris' })).status).toBe(404);
      expect((await u.client.get(`/api/v1/folders/${shared.id}/activity`)).status).toBe(404);
    }
    expect((await sql`select count(*)::int as n from folder_grants where folder_id = ${shared.id} and revoked_at is null`)[0]!.n).toBe(3);
  });
  it('a grant opens nothing on the owner routes: tenant isolation holds by construction', async () => {
    for (const u of [viewer, editor, uploader]) {
      for (const url of [`/api/v1/folders/${shared.id}`, `/api/v1/folders/${shared.id}/children`, `/api/v1/files/${doc.id}`, `/api/v1/files/${doc.id}/content`, `/api/v1/files/${doc.id}/text`, `/api/v1/files/${doc.id}/versions`,
        `/api/v1/files/${doc.id}/activity`, `/api/v1/storage/folder/${shared.id}`, `/api/v1/zip?folders=${shared.id}`, `/api/v1/zip?files=${doc.id}`]) expect((await u.client.get(url)).status, url).toBe(404);
      expect((await u.client.patch(`/api/v1/files/${doc.id}`, { name: 'x.txt' })).status).toBe(404);
      expect((await u.client.post('/api/v1/trash', { fileIds: [doc.id], folderIds: [] })).status).toBe(404);
      expect((await u.client.post('/api/v1/move', { fileIds: [doc.id], folderIds: [], destinationId: 'root' })).status).toBe(404);
      expect((await u.client.post('/api/v1/copy', { fileIds: [doc.id], folderIds: [], destinationId: 'root' })).status).toBe(404);
      expect((await u.client.post('/api/v1/shares', { fileId: doc.id })).status).toBe(404); // a member cannot publish the owner's file
      expect((await u.client.post('/api/v1/uploads', { folderId: shared.id, name: 'x', size: 1 })).status).toBe(404);
      expect((await u.client.get(`/api/v1/search?q=charte`)).body.files).toEqual([]);
      expect((await u.client.post('/api/v1/sync/items', { fileIds: [doc.id], folderIds: [shared.id] })).body).toEqual({ folders: [], files: [] });
      expect((await u.client.get('/api/v1/sync/changes?since=0')).body.items.map((i: any) => i.id)).not.toContain(doc.id);
    }
  });
});

describe('grantee side', () => {
  it('lists what is shared with me', async () => {
    const mine = (await viewer.client.get('/api/v1/shared-with-me')).body;
    expect(mine).toEqual([{ grantId: G.viewer, role: 'viewer', owner: { displayName: expect.any(String) }, folder: { id: shared.id, name: 'Équipe', workspaceName: 'Atelier', updatedAt: expect.any(String) }, createdAt: expect.any(String) }]);
    expect(JSON.stringify(mine)).not.toContain(owner.email); // the owner's address is not handed out
    expect((await stranger.client.get('/api/v1/shared-with-me')).body).toEqual([]);
    expect((await owner.client.get('/api/v1/shared-with-me')).body).toEqual([]);
  });
  it('a viewer browses, reads and previews inside the grant, and cannot write', async () => {
    const root = (await viewer.client.get(S('viewer', '/children'))).body;
    expect(root).toMatchObject({ grantId: G.viewer, role: 'viewer', folder: { id: shared.id, parentId: null, isGrantRoot: true } });
    expect(root.breadcrumbs).toEqual([{ id: shared.id, name: 'Équipe' }]); // nothing of the owner's tree above the grant
    expect(root.folders.map((f: any) => f.name)).toEqual(['Plans']); expect(root.files.map((f: any) => f.name)).toEqual(['charte.txt']);
    const sub = (await viewer.client.get(S('viewer', `/children?folderId=${inner.id}`))).body;
    expect(sub.files.map((f: any) => f.name)).toEqual(['plan.txt']); expect(sub.breadcrumbs.map((c: any) => c.name)).toEqual(['Équipe', 'Plans']);
    expect((await viewer.client.get(S('viewer', `/files/${innerDoc.id}`))).body).toMatchObject({ role: 'viewer', file: { id: innerDoc.id, name: 'plan.txt', tagIds: [], starred: false }, path: [{ name: 'Équipe' }, { name: 'Plans' }] });
    const c = await viewer.client.get(S('viewer', `/files/${innerDoc.id}/content`));
    expect(c.status).toBe(200); expect(c.raw.toString()).toBe('Plan secret mais partagé');
    expect((await viewer.client.get(S('viewer', `/files/${innerDoc.id}/content`), { range: 'bytes=5-10' })).raw.toString()).toBe('secret');
    expect((await viewer.client.get(S('viewer', `/files/${innerDoc.id}/content?download=1`))).headers['content-disposition']).toMatch(/^attachment/);
    expect((await viewer.client.get(S('viewer', `/files/${innerDoc.id}/preview/thumb`))).status).toBe(404); // a text file has no thumbnail; the route itself answers
    // …and cannot write, whatever the route
    expect((await viewer.client.post(S('viewer', '/folders'), { name: 'Nouveau' })).status).toBe(403);
    expect((await viewer.client.patch(S('viewer', `/items/${doc.id}`), { name: 'renommé.txt' })).status).toBe(403);
    expect((await viewer.client.patch(S('viewer', `/items/${doc.id}`), { parentId: inner.id })).status).toBe(403);
    expect((await viewer.client.post(S('viewer', '/trash'), { fileIds: [doc.id] })).status).toBe(403);
    expect((await viewer.client.post(S('viewer', '/uploads'), { name: 'x.txt', size: 3 })).status).toBe(403);
    expect((await upShared(viewer.client, G.viewer!, { name: 'x.txt' }, Buffer.from('abc'))).status).toBe(403);
    expect((await owner.client.get(`/api/v1/folders/${shared.id}`)).body.files.map((f: any) => f.name)).toEqual(['charte.txt']);
  });
  it('an uploader sends files in and sees nothing', async () => {
    for (const path of ['/children', `/children?folderId=${inner.id}`, `/files/${doc.id}`, `/files/${doc.id}/content`, `/files/${doc.id}/preview/thumb`, '/activity']) expect((await uploader.client.get(S('uploader', path))).status, path).toBe(403);
    expect((await uploader.client.post(S('uploader', '/folders'), { name: 'x' })).status).toBe(403);
    expect((await uploader.client.patch(S('uploader', `/items/${doc.id}`), { name: 'x.txt' })).status).toBe(403);
    expect((await uploader.client.post(S('uploader', '/trash'), { fileIds: [doc.id] })).status).toBe(403);
    const r = await upShared(uploader.client, G.uploader!, { name: 'charte.txt' }, Buffer.from('dépôt du fournisseur'));
    expect(r.status).toBe(200);
    expect(r.body.file).toEqual({ id: expect.any(String), name: 'charte (2).txt', size: Buffer.byteLength('dépôt du fournisseur') }); // never replaces a file it cannot see
    expect(Object.keys(r.body.file)).toEqual(['id', 'name', 'size']);
    expect((await uploader.client.post(S('uploader', '/uploads'), { name: 'charte.txt', size: 3, onConflict: 'version' })).status).toBe(403);
    expect((await uploader.client.get(S('uploader', `/files/${r.body.file.id}/content`))).status).toBe(403); // not even its own upload
    expect((await uploader.client.get(`/api/v1/files/${r.body.file.id}`)).status).toBe(404);
    // the owner received it, in the owner's name, through the scan pipeline
    const [row] = await sql`select f.owner_id, f.folder_id, o.scan_status, v.created_by from files f join file_versions v on v.id = f.current_version_id join storage_objects o on o.id = v.object_id where f.id = ${r.body.file.id}`;
    expect(row).toMatchObject({ owner_id: owner.userId, folder_id: shared.id, scan_status: 'pending', created_by: uploader.userId });
    expect(await sql`select 1 from jobs where kind = 'scan_object' and status = 'queued' and payload->>'objectId' = (select object_id::text from file_versions where file_id = ${r.body.file.id})`).toHaveLength(1);
    await work();
    expect((await owner.client.get(`/api/v1/files/${r.body.file.id}`)).body.file.scan).toBe('clean');
    expect((await owner.client.get('/api/v1/notifications')).body.find((n: any) => n.kind === 'collab.upload')).toMatchObject({ data: { grantId: G.uploader, folderId: shared.id } });
    // the upload shows in the uploader's own history, without the owner's folder id
    expect((await uploader.client.get('/api/v1/uploads')).body.uploads[0]).toMatchObject({ name: 'charte.txt', status: 'done', grantId: G.uploader, folderId: null });
  });
  it('an infected upload through a grant is caught like any other, and no member can take it out', async () => {
    const r = await upShared(uploader.client, G.uploader!, { name: 'facture.txt' }, Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'));
    expect(r.status).toBe(200);
    await work();
    expect((await owner.client.get(`/api/v1/files/${r.body.file.id}`)).body.file.scan).toBe('infected');
    expect((await viewer.client.get(S('viewer', `/files/${r.body.file.id}/content`))).status).toBe(451);
    expect((await viewer.client.get(S('viewer', `/files/${r.body.file.id}/content?download=1&infected=ack`))).status).toBe(451); // the owner's acknowledgement is not a member's
    expect((await editor.client.get(S('editor', `/files/${r.body.file.id}/preview/thumb`))).status).toBe(451);
    await owner.client.post('/api/v1/trash', { fileIds: [r.body.file.id], folderIds: [] }); await owner.client.post('/api/v1/purge', { all: true }); await work();
  });
  it('bytes sent through a grant are charged to the owner, and the owner\'s quota stops them', async () => {
    const before = { owner: (await owner.client.get('/api/v1/auth/state')).body.quota.used, editor: (await editor.client.get('/api/v1/auth/state')).body.quota.used };
    const r = await upShared(editor.client, G.editor!, { folderId: inner.id, name: 'gros.bin' }, Buffer.alloc(40_000, 7));
    expect(r.status).toBe(200);
    expect((await owner.client.get('/api/v1/auth/state')).body.quota.used).toBe(before.owner + 40_000);
    expect((await editor.client.get('/api/v1/auth/state')).body.quota.used).toBe(before.editor); // nothing on the member's own account
    expect((await editor.client.get('/api/v1/folders/root')).body.files).toEqual([]);
    // the owner has 100 kB in all: a member cannot overflow it, even though the member's own quota is a gigabyte
    const tooBig = await editor.client.post(S('editor', '/uploads'), { name: 'trop.bin', size: 70_000 });
    expect(tooBig.status).toBe(413); expect(tooBig.body.error).toBe('quota_exceeded');
    // promised bytes count too: two uploads in flight cannot together exceed the owner's quota
    const one = await editor.client.post(S('editor', '/uploads'), { name: 'a.bin', size: 30_000 });
    expect(one.status).toBe(200);
    expect((await uploader.client.post(S('uploader', '/uploads'), { name: 'b.bin', size: 30_000 })).status).toBe(413);
    expect((await editor.client.del(S('editor', `/uploads/${one.body.id}`))).status).toBe(200);
  });
  it('an editor creates, renames, moves and trashes inside the grant only', async () => {
    const f = await editor.client.post(S('editor', '/folders'), { parentId: inner.id, name: 'Croquis' });
    expect(f.status).toBe(200); expect(f.body).toMatchObject({ name: 'Croquis', parentId: inner.id, isGrantRoot: false });
    expect((await sql`select owner_id from folders where id = ${f.body.id}`)[0]!.owner_id).toBe(owner.userId);
    expect((await editor.client.patch(S('editor', `/items/${doc.id}`), { name: 'charte v2.txt' })).body).toMatchObject({ id: doc.id, name: 'charte v2.txt' });
    expect((await editor.client.patch(S('editor', `/items/${doc.id}`), { parentId: f.body.id })).body).toMatchObject({ folderId: f.body.id });
    expect((await editor.client.patch(S('editor', `/items/${f.body.id}`), { name: 'Esquisses' })).body).toMatchObject({ name: 'Esquisses' });
    // a new version of a visible file
    const v = await upShared(editor.client, G.editor!, { folderId: f.body.id, name: 'charte v2.txt', onConflict: 'version' }, Buffer.from('Charte révisée'));
    expect(v.body.file).toMatchObject({ id: doc.id, versionSeq: 2 });
    expect((await owner.client.get(`/api/v1/files/${doc.id}/versions`)).body.versions[0].createdBy).toMatchObject({ userId: editor.userId, me: false });
    // the granted folder itself is the owner's
    expect((await editor.client.patch(S('editor', `/items/${shared.id}`), { name: 'À moi' })).status).toBe(403);
    expect((await editor.client.post(S('editor', '/trash'), { folderIds: [shared.id] })).status).toBe(403);
    // trash goes to the OWNER's trash; the member cannot restore or purge
    const tmp = (await upShared(editor.client, G.editor!, { name: 'brouillon.txt' }, Buffer.from('brouillon'))).body.file;
    expect((await editor.client.post(S('editor', '/trash'), { fileIds: [tmp.id] })).status).toBe(200);
    expect((await owner.client.get('/api/v1/trash')).body.files.map((x: any) => x.id)).toContain(tmp.id);
    expect((await editor.client.get('/api/v1/trash')).body.files).toEqual([]);
    expect((await editor.client.post('/api/v1/restore', { fileIds: [tmp.id], folderIds: [] })).status).toBe(404);
    expect((await editor.client.post('/api/v1/purge', { fileIds: [tmp.id], folderIds: [] })).status).toBe(404);
    // the owner's trail names who did what
    const act = (await owner.client.get(`/api/v1/folders/${shared.id}/activity?limit=100`)).body.events;
    const mine = act.filter((e: any) => e.actor.userId === editor.userId).map((e: any) => e.action);
    expect(mine).toEqual(expect.arrayContaining(['folder.created', 'file.renamed', 'items.moved', 'folder.renamed', 'file.version_added', 'file.uploaded', 'items.trashed']));
    expect(act.find((e: any) => e.action === 'file.renamed' && e.target.id === doc.id)).toMatchObject({ actor: { me: false, displayName: expect.any(String) }, meta: { grantId: G.editor, via: 'grant', from: 'charte.txt' } });
    // members see the workspace feed too (viewer and editor), never the uploader
    const feed = (await viewer.client.get(S('viewer', '/activity'))).body.events;
    expect(feed.map((e: any) => e.action)).toContain('file.renamed'); expect(JSON.stringify(feed)).not.toMatch(/"ip"|userAgent/);
  });
});

describe('boundaries', () => {
  it('nothing outside the granted subtree can be reached or targeted: 404', async () => {
    for (const who of ['viewer', 'editor']) {
      const c = who === 'viewer' ? viewer.client : editor.client;
      for (const path of [`/children?folderId=${privateFolder.id}`, `/children?folderId=${owner.rootId}`, `/files/${privateDoc.id}`, `/files/${privateDoc.id}/content`, `/files/${privateDoc.id}/content?download=1`, `/files/${privateDoc.id}/preview/thumb`,
        `/children?folderId=00000000-0000-4000-8000-000000000000`, `/files/00000000-0000-4000-8000-000000000000`]) expect((await c.get(S(who, path))).status, `${who} ${path}`).toBe(404);
    }
    // an editor cannot move things out of the grant, pull things into it, or aim an upload elsewhere
    expect((await editor.client.patch(S('editor', `/items/${innerDoc.id}`), { parentId: privateFolder.id })).status).toBe(404);
    expect((await editor.client.patch(S('editor', `/items/${innerDoc.id}`), { parentId: owner.rootId })).status).toBe(404);
    expect((await editor.client.patch(S('editor', `/items/${privateDoc.id}`), { parentId: inner.id })).status).toBe(404);
    expect((await editor.client.patch(S('editor', `/items/${privateDoc.id}`), { name: 'volé.txt' })).status).toBe(404);
    expect((await editor.client.patch(S('editor', `/items/${privateFolder.id}`), { name: 'Volé' })).status).toBe(404);
    expect((await editor.client.post(S('editor', '/trash'), { fileIds: [innerDoc.id, privateDoc.id] })).status).toBe(404);
    expect((await owner.client.get(`/api/v1/files/${innerDoc.id}`)).body.file.trashedAt).toBeNull(); // the whole request was refused, not half applied
    expect((await editor.client.post(S('editor', '/trash'), { folderIds: [privateFolder.id] })).status).toBe(404);
    expect((await editor.client.post(S('editor', '/folders'), { parentId: privateFolder.id, name: 'x' })).status).toBe(404);
    expect((await editor.client.post(S('editor', '/uploads'), { folderId: privateFolder.id, name: 'x.txt', size: 1 })).status).toBe(404);
    expect((await uploader.client.post(S('uploader', '/uploads'), { folderId: owner.rootId, name: 'x.txt', size: 1 })).status).toBe(404);
    // relative paths cannot climb out
    const climb = await upShared(editor.client, G.editor!, { name: 'x.txt', relativePath: '../../Privé/x.txt' }, Buffer.from('x'));
    expect(climb.status).toBe(200);
    expect((await owner.client.get(`/api/v1/folders/${privateFolder.id}`)).body.files.map((f: any) => f.name)).toEqual(['journal intime.txt']);
    expect(await sql`select 1 from files f join folders d on d.id = f.folder_id where f.id = ${climb.body.file.id} and d.parent_id = ${shared.id} and d.name = 'Privé'`).toHaveLength(1); // a folder named "Privé" INSIDE the grant
    // the owner's own content and the member's own are untouched
    expect((await owner.client.get(`/api/v1/files/${privateDoc.id}`)).body.file).toMatchObject({ name: 'journal intime.txt', folderId: privateFolder.id, trashedAt: null });
  });
  it('a foreign grant, another member\'s grant, an unknown grant: 404 on every route', async () => {
    const routes = (g: string): [string, string, unknown?][] => [
      ['GET', `/api/v1/shared/${g}/children`], ['GET', `/api/v1/shared/${g}/files/${doc.id}`], ['GET', `/api/v1/shared/${g}/files/${doc.id}/content`], ['GET', `/api/v1/shared/${g}/files/${doc.id}/preview/thumb`], ['GET', `/api/v1/shared/${g}/activity`],
      ['POST', `/api/v1/shared/${g}/folders`, { name: 'x' }], ['PATCH', `/api/v1/shared/${g}/items/${doc.id}`, { name: 'x.txt' }], ['POST', `/api/v1/shared/${g}/trash`, { fileIds: [doc.id] }],
      ['POST', `/api/v1/shared/${g}/uploads`, { name: 'x.txt', size: 1 }], ['GET', `/api/v1/shared/${g}/uploads/00000000-0000-4000-8000-000000000000`], ['POST', `/api/v1/shared/${g}/uploads/00000000-0000-4000-8000-000000000000/complete`, {}],
    ];
    for (const [who, g] of [[stranger, G.editor], [viewer, G.editor], [uploader, G.viewer], [owner, G.editor], [stranger, '00000000-0000-4000-8000-000000000000']] as const)
      for (const [m, url, body] of routes(g!)) expect((await who.client.call(m, url, body)).status, `${m} ${url}`).toBe(404);
    expect((await stranger.client.get('/api/v1/shared/not-a-uuid/children')).status).toBe(400);
    // an upload belongs to the member who opened it, on the grant it was opened on
    const mine = await editor.client.post(S('editor', '/uploads'), { name: 'à moi.txt', size: 3 });
    for (const [who, g] of [[uploader, G.uploader], [viewer, G.viewer], [stranger, G.editor]] as const) {
      expect((await who.client.get(`/api/v1/shared/${g}/uploads/${mine.body.id}`)).status).toBeGreaterThanOrEqual(403);
      expect((await who.client.patch(`/api/v1/shared/${g}/uploads/${mine.body.id}?offset=0`, Buffer.from('abc'))).status).toBeGreaterThanOrEqual(403);
      expect((await who.client.post(`/api/v1/shared/${g}/uploads/${mine.body.id}/complete`, {})).status).toBeGreaterThanOrEqual(403);
    }
    // …and it cannot be finished through the owner-scoped upload routes (it would land in the member's own drive)
    expect((await editor.client.get(`/api/v1/uploads/${mine.body.id}`)).status).toBe(404);
    expect((await editor.client.patch(`/api/v1/uploads/${mine.body.id}?offset=0`, Buffer.from('abc'))).status).toBe(404);
    expect((await editor.client.post(`/api/v1/uploads/${mine.body.id}/complete`, {})).status).toBe(404);
    expect((await editor.client.patch(`/api/v1/uploads/${mine.body.id}/options`, { onConflict: 'version' })).status).toBe(404);
    expect((await editor.client.del(`/api/v1/uploads/${mine.body.id}`)).status).toBe(404);
    expect((await owner.client.get(`/api/v1/uploads/${mine.body.id}`)).status).toBe(404); // nor by the owner
    expect((await sql`select received::int as r, status from uploads where id = ${mine.body.id}`)[0]).toEqual({ r: 0, status: 'active' });
    await editor.client.del(S('editor', `/uploads/${mine.body.id}`));
  });
  it('trashed content is invisible; a trashed granted folder closes the grant until it is restored', async () => {
    const t = await up(owner, inner.id, 'à jeter.txt', 'poubelle');
    await owner.client.post('/api/v1/trash', { fileIds: [t.id], folderIds: [] });
    expect((await viewer.client.get(S('viewer', `/children?folderId=${inner.id}`))).body.files.map((f: any) => f.name)).not.toContain('à jeter.txt');
    for (const path of [`/files/${t.id}`, `/files/${t.id}/content`, `/files/${t.id}/preview/thumb`]) expect((await viewer.client.get(S('viewer', path))).status).toBe(404);
    expect((await editor.client.patch(S('editor', `/items/${t.id}`), { name: 'ressuscité.txt' })).status).toBe(404);
    // a trashed sub-folder disappears with everything in it
    await owner.client.post('/api/v1/trash', { fileIds: [], folderIds: [inner.id] });
    expect((await viewer.client.get(S('viewer', '/children'))).body.folders.map((f: any) => f.name)).not.toContain('Plans');
    for (const path of [`/children?folderId=${inner.id}`, `/files/${innerDoc.id}`, `/files/${innerDoc.id}/content`]) expect((await viewer.client.get(S('viewer', path))).status, path).toBe(404);
    expect((await editor.client.post(S('editor', '/uploads'), { folderId: inner.id, name: 'x.txt', size: 1 })).status).toBe(404);
    await owner.client.post('/api/v1/restore', { fileIds: [], folderIds: [inner.id] });
    expect((await viewer.client.get(S('viewer', `/files/${innerDoc.id}/content`))).status).toBe(200);
    // the granted folder itself in the trash: the grant answers 404 everywhere and leaves the list
    await owner.client.post('/api/v1/trash', { fileIds: [], folderIds: [shared.id] });
    expect((await viewer.client.get('/api/v1/shared-with-me')).body).toEqual([]);
    for (const [c, who, path] of [[viewer, 'viewer', '/children'], [viewer, 'viewer', `/files/${innerDoc.id}/content`], [editor, 'editor', '/children']] as const) expect((await c.client.get(S(who, path))).status).toBe(404);
    expect((await upShared(uploader.client, G.uploader!, { name: 'tard.txt' }, Buffer.from('x'))).status).toBe(404);
    await owner.client.post('/api/v1/restore', { fileIds: [], folderIds: [shared.id] });
    expect((await viewer.client.get(S('viewer', '/children'))).status).toBe(200);
  });
  it('a role change and a revocation take effect at once, mid-upload included', async () => {
    // an upload in flight when the role drops to viewer
    const u1 = await editor.client.post(S('editor', '/uploads'), { name: 'en vol.txt', size: 6 });
    await editor.client.patch(S('editor', `/uploads/${u1.body.id}?offset=0`), Buffer.from('abc'));
    expect((await owner.client.patch(`/api/v1/folders/${shared.id}/members/${editor.userId}`, { role: 'viewer' })).body).toMatchObject({ role: 'viewer', grantId: G.editor });
    expect((await editor.client.patch(S('editor', `/uploads/${u1.body.id}?offset=3`), Buffer.from('def'))).status).toBe(403);
    expect((await editor.client.post(S('editor', `/uploads/${u1.body.id}/complete`), {})).status).toBe(403);
    expect((await editor.client.post(S('editor', '/folders'), { name: 'x' })).status).toBe(403);
    expect((await editor.client.get(S('editor', '/children'))).status).toBe(200); // still a viewer
    await owner.client.patch(`/api/v1/folders/${shared.id}/members/${editor.userId}`, { role: 'editor' });
    // an upload complete but not yet placed when access is revoked: nothing is placed
    const u2 = await editor.client.post(S('editor', '/uploads'), { name: 'trop tard.txt', size: 3 });
    await editor.client.patch(S('editor', `/uploads/${u2.body.id}?offset=0`), Buffer.from('abc'));
    expect((await owner.client.del(`/api/v1/folders/${shared.id}/members/${editor.userId}`)).status).toBe(200);
    expect((await editor.client.post(S('editor', `/uploads/${u2.body.id}/complete`), { sha256: sha(Buffer.from('abc')) })).status).toBe(404);
    expect(await sql`select 1 from files where name = 'trop tard.txt'`).toHaveLength(0);
    for (const [m, path, body] of [['GET', '/children'], ['GET', `/files/${doc.id}/content`], ['POST', '/folders', { name: 'x' }], ['POST', '/uploads', { name: 'x', size: 1 }], ['POST', '/trash', { fileIds: [doc.id] }], ['GET', '/activity']] as const)
      expect((await editor.client.call(m, S('editor', path), body)).status, path).toBe(404);
    expect((await editor.client.get('/api/v1/shared-with-me')).body).toEqual([]);
    expect((await editor.client.get('/api/v1/notifications')).body[0]).toMatchObject({ kind: 'collab.revoked', data: { grantId: G.editor } });
    expect((await owner.client.del(`/api/v1/folders/${shared.id}/members/${editor.userId}`)).status).toBe(404); // already gone
    // access given again is a NEW grant: the old identifier stays dead
    const again = await grant(shared.id, editor, 'viewer');
    expect(again.grantId).not.toBe(G.editor);
    expect((await editor.client.get(S('editor', '/children'))).status).toBe(404);
    expect((await editor.client.get(`/api/v1/shared/${again.grantId}/children`)).status).toBe(200);
    // other members were not disturbed
    expect((await viewer.client.get(S('viewer', '/children'))).status).toBe(200);
  });
  it('a disabled owner\'s folders close; purging the folder removes the grants', async () => {
    await sql`update users set disabled_at = now() where id = ${owner.userId}`;
    try { expect((await viewer.client.get(S('viewer', '/children'))).status).toBe(404); expect((await viewer.client.get('/api/v1/shared-with-me')).body).toEqual([]); }
    finally { await sql`update users set disabled_at = null where id = ${owner.userId}`; }
    const again = await owner.client.login(); expect(again.status).toBe(200);
    expect((await viewer.client.get(S('viewer', '/children'))).status).toBe(200);
    await owner.client.post('/api/v1/trash', { fileIds: [], folderIds: [shared.id] });
    await owner.client.post('/api/v1/purge', { fileIds: [], folderIds: [shared.id] });
    expect(await sql`select 1 from folder_grants where folder_id = ${shared.id}`).toHaveLength(0);
    expect((await viewer.client.get(S('viewer', '/children'))).status).toBe(404);
    expect((await owner.client.get('/api/v1/collab/outgoing')).body).toEqual([]);
  });
});
