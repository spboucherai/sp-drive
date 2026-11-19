import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.ts';
import { sql } from '../src/db.ts';
import { clamdPing } from '../src/tools.ts';
import { housekeeping } from '../src/worker.ts';
import { anon, Client, closeAll, sha, signup, work } from './harness.ts';

afterAll(closeAll);
const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'), randomBytes(2000)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]), randomBytes(500)]);
const P = '/api/v1/public';
let a: Awaited<ReturnType<typeof signup>>, b: Awaited<ReturnType<typeof signup>>;
beforeAll(async () => { a = await signup(); b = await signup(); expect(await clamdPing(), 'clamd must be running for these tests (brew install clamav + freshclam into ~/.cache/sp-drive-clamav)').toBe(true); });

let seq = 0;
async function portal(over: Record<string, unknown> = {}, owner = a) {
  const folder = (await owner.client.post('/api/v1/folders', { parentId: owner.rootId, name: `Dépôts ${++seq}` })).body;
  const r = await owner.client.post('/api/v1/requests', { folderId: folder.id, title: `Portail ${seq}`, ...over });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { id: r.body.request.id as string, token: (r.body.url as string).split('/request/')[1]!, folderId: folder.id as string };
}
interface F { name: string; data: Buffer }
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
async function start(token: string, files: F[], fields: Record<string, unknown> = {}, c: Client = anon()) {
  const r = await c.post(`${P}/requests/${token}/submissions`, { ...fields, files: files.map((f) => ({ name: f.name, size: f.data.length })) });
  return { c, r, token: r.body?.submissionToken as string, items: (r.body?.items ?? []) as { uploadId: string; name: string }[] };
}
async function send(c: Client, subToken: string, uploadId: string, data: Buffer, chunk = 1024 * 1024) {
  let last;
  for (let off = 0; off < data.length; off += chunk) { last = await c.patch(`${P}/uploads/${uploadId}?offset=${off}`, data.subarray(off, off + chunk), bearer(subToken)); if (last.status !== 200) return last; }
  return last!;
}
/** A complete deposit: admission, transfer, finalisation, background processing. */
async function deposit(token: string, files: F[], fields: Record<string, unknown> = {}) {
  const s = await start(token, files, fields);
  expect(s.r.status, JSON.stringify(s.r.body)).toBe(200);
  for (const [i, it] of s.items.entries()) expect((await send(s.c, s.token, it.uploadId, files[i]!.data)).status).toBe(200);
  const fin = await s.c.post(`${P}/submissions/finalize`, {}, bearer(s.token));
  await work();
  const status = await s.c.get(`${P}/submissions/status`, bearer(s.token));
  return { ...s, fin, status: status.body };
}
const tree = async (c: Client, folderId: string): Promise<string[]> => {
  const l = (await c.get(`/api/v1/folders/${folderId}`)).body;
  const out: string[] = l.files.map((f: any) => f.name);
  for (const d of l.folders) out.push(...(await tree(c, d.id)).map((n) => `${d.name}/${n}`));
  return out.sort();
};

describe('deposit portals', () => {
  it('accepts a deposit without an account and places it atomically in a sub-folder, with a journal and a notification', async () => {
    const p = await portal({ description: 'Vos pièces', confirmationMessage: 'Merci, bien reçu.', fields: { name: 'required', email: 'optional', reference: 'optional', custom: [{ key: 'dossier', label: 'No de dossier', required: true }] } });
    const info = (await anon().get(`${P}/requests/${p.token}`)).body;
    expect(info).toMatchObject({ title: `Portail ${seq}`, needsPassword: false, description: 'Vos pièces' });
    expect(JSON.stringify(info)).not.toMatch(/folder|owner|Dépôts|submissions|bytesReceived|"id"/i); // nothing about the destination or the owner
    const big = randomBytes(2_500_000);
    const d = await deposit(p.token, [{ name: 'pièce.pdf', data: PDF }, { name: 'photo.png', data: PNG }, { name: 'gros.bin', data: big }], { name: 'Marie Tremblay', email: 'marie@example.test', custom: { dossier: 'D-42' } });
    expect(d.fin.body.status).toBe('processing');
    expect(d.status).toMatchObject({ status: 'completed', confirmationMessage: 'Merci, bien reçu.' });
    expect(d.status.ref).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(d.status.items).toEqual([{ name: 'pièce.pdf', status: 'accepted', reason: null }, { name: 'photo.png', status: 'accepted', reason: null }, { name: 'gros.bin', status: 'accepted', reason: null }]);
    const files = await tree(a.client, p.folderId);
    expect(files).toHaveLength(3);
    expect(files[0]).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2} Marie Tremblay ${d.status.ref}/gros\\.bin$`));
    // content is intact and marked clean by the scan that preceded placement
    const sub = (await a.client.get(`/api/v1/folders/${p.folderId}`)).body.folders[0];
    const placed = (await a.client.get(`/api/v1/folders/${sub.id}`)).body.files;
    const g = placed.find((f: any) => f.name === 'gros.bin');
    expect(g).toMatchObject({ size: big.length, sha256: sha(big), origin: 'request', scan: 'clean' });
    expect((await a.client.get(`/api/v1/files/${g.id}/content?download=1`)).raw.equals(big)).toBe(true);
    for (const it of d.items) expect(existsSync(`${config.quarantineDir}/up-${it.uploadId}`)).toBe(false); // quarantine emptied
    // owner's view: submission, form answers, journal, notification
    const subs = (await a.client.get(`/api/v1/requests/${p.id}/submissions`)).body;
    expect(subs[0]).toMatchObject({ ref: d.status.ref, status: 'completed', name: 'Marie Tremblay', files: 3, placed: 3, rejected: 0 });
    const detail = (await a.client.get(`/api/v1/submissions/${subs[0].id}`)).body;
    expect(detail.meta).toEqual({ dossier: 'D-42' });
    expect(detail.events.map((e: any) => e.action)).toEqual(['submission.started', 'submission.finalized', 'submission.completed']);
    expect(detail.items.every((i: any) => i.status === 'placed' && i.fileId)).toBe(true);
    const note = (await a.client.get('/api/v1/notifications')).body.find((n: any) => n.kind === 'request.submission');
    expect(note.data).toMatchObject({ ref: d.status.ref, placed: 3, rejected: 0, name: 'Marie Tremblay' });
    expect((await a.client.get('/api/v1/requests')).body.find((r: any) => r.id === p.id)).toMatchObject({ submissions: 1, bytesReceived: PDF.length + PNG.length + big.length });
  });

  it('a depositor can never list, read, search, replace or delete anything — not the folder, not other deposits', async () => {
    const p = await portal({ subfolderPerSubmission: false });
    const existing = (await a.client.upload(p.folderId, 'rapport.pdf', PDF)).body.file;
    const other = await start(p.token, [{ name: 'autre.pdf', data: PDF }]);
    const me = await start(p.token, [{ name: 'rapport.pdf', data: Buffer.concat([PDF, Buffer.from('v2')]) }]);
    const h = bearer(me.token);
    // the submission token opens no owner route, with or without cookies
    for (const [m, url, body] of [['GET', '/api/v1/folders/root'], ['GET', `/api/v1/folders/${p.folderId}`], ['GET', `/api/v1/files/${existing.id}`], ['GET', `/api/v1/files/${existing.id}/content`],
      ['GET', '/api/v1/search?q=rapport'], ['GET', '/api/v1/recent'], ['GET', `/api/v1/zip?folders=${p.folderId}`], ['GET', `/api/v1/requests/${p.id}/submissions`], ['GET', '/api/v1/requests'],
      ['POST', '/api/v1/trash', { fileIds: [existing.id] }], ['POST', '/api/v1/uploads', { folderId: p.folderId, name: 'x', size: 1 }], ['PATCH', `/api/v1/files/${existing.id}`, { name: 'pris.pdf' }]] as const)
      expect([url, (await me.c.call(m, url, body, h)).status]).toEqual([url, 401]);
    // nor another submission's upload, status or finalisation
    expect((await me.c.get(`${P}/uploads/${other.items[0]!.uploadId}`, h)).status).toBe(404);
    expect((await me.c.patch(`${P}/uploads/${other.items[0]!.uploadId}?offset=0`, PDF, h)).status).toBe(404);
    expect((await anon().get(`${P}/uploads/${me.items[0]!.uploadId}`)).status).toBe(401);
    expect((await anon().get(`${P}/submissions/status`, bearer('a'.repeat(43)))).status).toBe(401);
    // an owner upload id is not reachable through the public upload route
    const ownerUpload = (await a.client.post('/api/v1/uploads', { folderId: p.folderId, name: 'o.bin', size: 5 })).body;
    expect((await me.c.patch(`${P}/uploads/${ownerUpload.id}?offset=0`, Buffer.from('12345'), h)).status).toBe(404);
    // and a portal upload is not reachable through the owner upload route by another account
    expect((await b.client.patch(`/api/v1/uploads/${me.items[0]!.uploadId}?offset=0`, PDF)).status).toBe(404);
    // depositing a file with an existing name never replaces it
    await send(me.c, me.token, me.items[0]!.uploadId, Buffer.concat([PDF, Buffer.from('v2')]));
    await me.c.post(`${P}/submissions/finalize`, {}, h); await work();
    const st = (await me.c.get(`${P}/submissions/status`, h)).body;
    expect(JSON.stringify(st)).not.toMatch(/folder|autre\.pdf|fileId|"id"/); // own files only, no identifiers
    const names = (await a.client.get(`/api/v1/folders/${p.folderId}`)).body.files.map((f: any) => f.name).sort();
    expect(names).toEqual(['rapport (2).pdf', 'rapport.pdf']);
    expect((await a.client.get(`/api/v1/files/${existing.id}`)).body.versions).toHaveLength(1);
    expect((await a.client.get(`/api/v1/files/${existing.id}/content?download=1`)).raw.equals(PDF)).toBe(true);
    // once finalised the token cannot send anything more
    expect((await me.c.patch(`${P}/uploads/${me.items[0]!.uploadId}?offset=0`, PDF, h)).status).toBe(410);
    expect((await me.c.post(`${P}/submissions/finalize`, {}, h)).status).toBe(410);
    // other accounts see nothing of the portal
    for (const url of [`/api/v1/requests/${p.id}`, `/api/v1/requests/${p.id}/submissions`]) expect((await b.client.get(url)).status).toBe(404);
    const subId = (await a.client.get(`/api/v1/requests/${p.id}/submissions`)).body[0].id;
    expect((await b.client.get(`/api/v1/submissions/${subId}`)).status).toBe(404);
    for (const [m, url] of [['PATCH', `/api/v1/requests/${p.id}`], ['DELETE', `/api/v1/requests/${p.id}`], ['POST', `/api/v1/requests/${p.id}/rotate`]] as const) expect((await b.client.call(m, url, {})).status).toBe(404);
  });

  it('quarantines, scans with the real antivirus and inspects signatures before anything reaches the folder', async () => {
    const p = await portal();
    const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), randomBytes(600)]);
    const zipAsPdf = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 8, 0]), randomBytes(300)]);
    const script = Buffer.from('#!/bin/sh\nrm -rf ~\n');
    const d = await deposit(p.token, [{ name: 'virus.pdf', data: EICAR }, { name: 'vacances.jpg', data: exe }, { name: 'facture.pdf', data: zipAsPdf }, { name: 'notes.txt', data: script }, { name: 'bon.pdf', data: PDF }, { name: 'liste.csv', data: Buffer.from('a;b\n1;2\n') }]);
    expect(Object.fromEntries(d.status.items.map((i: any) => [i.name, i.reason ?? 'ok']))).toEqual({ 'virus.pdf': 'infected', 'vacances.jpg': 'executable', 'facture.pdf': 'type_mismatch', 'notes.txt': 'executable', 'bon.pdf': 'ok', 'liste.csv': 'ok' });
    expect(d.status.status).toBe('completed');
    expect((await tree(a.client, p.folderId)).map((n) => n.split('/')[1])).toEqual(['bon.pdf', 'liste.csv']);
    // the infected bytes exist nowhere any more: not in quarantine, not as a stored object
    for (const it of d.items) expect(existsSync(`${config.quarantineDir}/up-${it.uploadId}`)).toBe(false);
    expect(await sql`select 1 from storage_objects where sha256 = ${sha(EICAR)} and owner_id = ${a.userId}`).toHaveLength(0); // this account's: other suites keep their own infected fixtures
    const subId = (await a.client.get(`/api/v1/requests/${p.id}/submissions`)).body[0].id;
    const detail = (await a.client.get(`/api/v1/submissions/${subId}`)).body;
    const rejected = detail.events.filter((e: any) => e.action === 'submission.item_rejected');
    expect(rejected).toHaveLength(4);
    expect(rejected.find((e: any) => e.meta.code === 'infected').meta.signature).toMatch(/eicar/i);
    // a deposit where everything is refused is "rejected" and creates no folder
    const p2 = await portal();
    const d2 = await deposit(p2.token, [{ name: 'virus.txt', data: EICAR }]);
    expect(d2.status.status).toBe('rejected');
    expect(await tree(a.client, p2.folderId)).toEqual([]);
    expect((await a.client.get(`/api/v1/folders/${p2.folderId}`)).body.folders).toEqual([]);
  });

  it('keeps deposits in quarantine while the antivirus is unavailable, then places them when it returns', async () => {
    const p = await portal();
    const socket = config.clamdSocket;
    config.clamdSocket = `${(process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test')}/absent.sock`;
    let s;
    try {
      s = await start(p.token, [{ name: 'attente.pdf', data: PDF }]);
      await send(s.c, s.token, s.items[0]!.uploadId, PDF);
      await s.c.post(`${P}/submissions/finalize`, {}, bearer(s.token));
      await work();
      expect((await s.c.get(`${P}/submissions/status`, bearer(s.token))).body).toMatchObject({ status: 'processing', items: [{ name: 'attente.pdf', status: 'pending' }] });
      expect(await tree(a.client, p.folderId)).toEqual([]); // fail closed: nothing placed unscanned
      expect(existsSync(`${config.quarantineDir}/up-${s.items[0]!.uploadId}`)).toBe(true);
      expect((await a.client.get('/api/v1/health/ready')).status).toBe(503);
    } finally { config.clamdSocket = socket; }
    await work();
    expect((await s.c.get(`${P}/submissions/status`, bearer(s.token))).body.status).toBe('completed');
    expect(await tree(a.client, p.folderId)).toHaveLength(1);
  });

  it('applies expiry, pause and revocation to transfers that started before', async () => {
    for (const how of ['expire', 'pause', 'revoke', 'trash-target'] as const) {
      const p = await portal({ expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      const data = randomBytes(3 * 1024 * 1024);
      const s = await start(p.token, [{ name: 'long.bin', data }]);
      expect((await s.c.patch(`${P}/uploads/${s.items[0]!.uploadId}?offset=0`, data.subarray(0, 1024 * 1024), bearer(s.token))).status).toBe(200);
      if (how === 'expire') await sql`update upload_requests set expires_at = now() - interval '1 second' where id = ${p.id}`;
      if (how === 'pause') await a.client.patch(`/api/v1/requests/${p.id}`, { active: false });
      if (how === 'revoke') await a.client.del(`/api/v1/requests/${p.id}`);
      if (how === 'trash-target') await a.client.post('/api/v1/trash', { folderIds: [p.folderId] });
      const next = await s.c.patch(`${P}/uploads/${s.items[0]!.uploadId}?offset=${1024 * 1024}`, data.subarray(1024 * 1024), bearer(s.token));
      expect([how, next.status, next.body.error]).toEqual([how, 410, 'portal_closed']);
      expect([how, (await s.c.post(`${P}/submissions/finalize`, {}, bearer(s.token))).status]).toEqual([how, 410]);
      expect([how, (await anon().get(`${P}/requests/${p.token}`)).status]).toEqual([how, how === 'revoke' ? 404 : 410]);
      expect([how, (await start(p.token, [{ name: 'x.pdf', data: PDF }])).r.status]).toEqual([how, how === 'revoke' ? 404 : 410]);
      await work();
      if (how !== 'trash-target') expect(await tree(a.client, p.folderId)).toEqual([]);
      if (how === 'pause') { // resuming the portal lets the same deposit finish
        await a.client.patch(`/api/v1/requests/${p.id}`, { active: true });
        expect((await s.c.patch(`${P}/uploads/${s.items[0]!.uploadId}?offset=${1024 * 1024}`, data.subarray(1024 * 1024), bearer(s.token))).status).toBe(200);
        await s.c.post(`${P}/submissions/finalize`, {}, bearer(s.token)); await work();
        expect(await tree(a.client, p.folderId)).toHaveLength(1);
      }
      if (how === 'revoke') expect(existsSync(`${config.quarantineDir}/up-${s.items[0]!.uploadId}`)).toBe(false); // partial bytes are destroyed at once
      else if (how !== 'pause') expect(existsSync(`${config.quarantineDir}/up-${s.items[0]!.uploadId}`)).toBe(true); // until housekeeping expires the deposit
    }
  });

  it('refuses a target that disappears between admission and placement', async () => {
    const p = await portal();
    const s = await start(p.token, [{ name: 'tard.pdf', data: PDF }]);
    await send(s.c, s.token, s.items[0]!.uploadId, PDF);
    await s.c.post(`${P}/submissions/finalize`, {}, bearer(s.token));
    await a.client.post('/api/v1/trash', { folderIds: [p.folderId] });
    await work();
    expect((await s.c.get(`${P}/submissions/status`, bearer(s.token))).body).toMatchObject({ status: 'rejected', items: [{ status: 'rejected', reason: 'target_unavailable' }] });
    expect(existsSync(`${config.quarantineDir}/up-${s.items[0]!.uploadId}`)).toBe(false);
  });

  it('enforces every limit at admission: type, size, count, totals, frequency, owner quota', async () => {
    const p = await portal({ allowedExtensions: ['pdf', 'png'], maxFileBytes: 100_000, maxFilesPerSubmission: 2, maxTotalBytes: 150_000, submissionsPerHour: 3 });
    const tryOne = async (files: F[], c?: Client) => { const r = (await start(p.token, files, {}, c)).r; return r.body.error ?? r.status; };
    expect(await tryOne([{ name: 'macro.docm', data: PDF }])).toBe('type_not_allowed');
    expect(await tryOne([{ name: 'outil.exe', data: PDF }])).toBe('type_not_allowed');
    expect(await tryOne([{ name: 'gros.pdf', data: randomBytes(100_001) }])).toBe('file_too_large');
    expect(await tryOne([{ name: '1.pdf', data: PDF }, { name: '2.pdf', data: PDF }, { name: '3.pdf', data: PDF }])).toBe('too_many_files');
    expect(await tryOne([{ name: 'a.pdf', data: randomBytes(90_000) }, { name: 'b.pdf', data: randomBytes(90_000) }])).toBe('portal_full');
    // totals count deposits in flight: two visitors cannot both reserve the last bytes
    const race = await Promise.all([0, 1, 2, 3].map(() => start(p.token, [{ name: 'c.pdf', data: randomBytes(60_000) }])));
    expect(race.filter((x) => x.r.status === 200)).toHaveLength(2);
    expect(race.filter((x) => x.r.body.error === 'portal_full')).toHaveLength(2);
    // more bytes than declared are refused at the chunk
    const ok = race.find((x) => x.r.status === 200)!;
    expect((await ok.c.patch(`${P}/uploads/${ok.items[0]!.uploadId}?offset=0`, randomBytes(60_001), bearer(ok.token))).status).toBe(413);
    // frequency per address
    const p2 = await portal({ submissionsPerHour: 2 });
    const same = anon();
    expect((await start(p2.token, [{ name: 'a.pdf', data: PDF }], {}, same)).r.status).toBe(200);
    expect((await start(p2.token, [{ name: 'a.pdf', data: PDF }], {}, same)).r.status).toBe(200);
    expect((await start(p2.token, [{ name: 'a.pdf', data: PDF }], {}, same)).r.status).toBe(429);
    expect((await start(p2.token, [{ name: 'a.pdf', data: PDF }])).r.status).toBe(200); // another address is not punished
    // number of deposits
    const p3 = await portal({ maxSubmissions: 1 });
    expect((await deposit(p3.token, [{ name: 'a.pdf', data: PDF }])).status.status).toBe('completed');
    expect((await anon().get(`${P}/requests/${p3.token}`)).status).toBe(410);
    expect((await a.client.get(`/api/v1/requests/${p3.id}`)).body.request.state).toBe('full');
    // the owner's account quota bounds every portal, without telling the depositor anything about the account
    const small = await signup({ quotaBytes: 50_000 });
    const p4 = await portal({}, small);
    const r = (await start(p4.token, [{ name: 'a.pdf', data: randomBytes(60_000) }])).r;
    expect(r.body.error).toBe('portal_full'); expect(JSON.stringify(r.body)).not.toMatch(/quota|used|limit/);
    // settings are validated: no portal above the scanner's capacity, no negative limits
    expect((await a.client.post('/api/v1/requests', { folderId: a.rootId, title: 'x', maxFileBytes: 3 * 1024 ** 3 })).status).toBe(400);
  });

  it('checks the form: required fields, custom fields, consent', async () => {
    const p = await portal({ requireConsent: true, consentText: 'J’accepte.', fields: { name: 'required', email: 'required', reference: 'off', custom: [{ key: 'matricule', label: 'Matricule', required: true }] } });
    const files = [{ name: 'a.pdf', data: PDF }];
    expect((await start(p.token, files, { email: 'x@example.test', custom: { matricule: '1' }, consent: true })).r.body).toMatchObject({ error: 'field_required', field: 'name' });
    expect((await start(p.token, files, { name: 'X', email: 'pas un courriel', custom: { matricule: '1' }, consent: true })).r.status).toBe(400);
    expect((await start(p.token, files, { name: 'X', email: 'x@example.test', consent: true })).r.body).toMatchObject({ error: 'field_required', field: 'matricule' });
    expect((await start(p.token, files, { name: 'X', email: 'x@example.test', custom: { matricule: '1' } })).r.body.error).toBe('consent_required');
    const ok = await deposit(p.token, files, { name: '<script>alert(1)</script>', email: 'x@example.test', custom: { matricule: '1', inconnu: 'ignoré' }, consent: true });
    expect(ok.status.status).toBe('completed');
    const subId = (await a.client.get(`/api/v1/requests/${p.id}/submissions`)).body[0].id;
    const detail = (await a.client.get(`/api/v1/submissions/${subId}`)).body;
    expect(detail.meta).toEqual({ matricule: '1' }); expect(detail.consentAt).toBeTruthy();
    // a hostile submitter name cannot shape a path: the sub-folder name is sanitised
    expect((await a.client.get(`/api/v1/folders/${p.folderId}`)).body.folders[0].name).not.toMatch(/[<>/\\]/);
  });

  it('neutralises dangerous file names', async () => {
    const p = await portal({ subfolderPerSubmission: false });
    const d = await deposit(p.token, [{ name: '../../../etc/cron.d/x.pdf', data: PDF }, { name: '..\\..\\boot.png', data: PNG }, { name: 'a\u0000b‮gnp.pdf', data: Buffer.concat([PDF, Buffer.from('2')]) },
      { name: '.htaccess.pdf', data: Buffer.concat([PDF, Buffer.from('3')]) }, { name: 'CON.pdf', data: Buffer.concat([PDF, Buffer.from('4')]) }, { name: 'même.PDF', data: Buffer.concat([PDF, Buffer.from('5')]) }, { name: 'MÊME.pdf', data: Buffer.concat([PDF, Buffer.from('6')]) }]);
    expect(d.status.status).toBe('completed');
    const names = (await a.client.get(`/api/v1/folders/${p.folderId}`)).body.files.map((f: any) => f.name);
    expect(names).toHaveLength(7);
    for (const n of names) { expect(n).not.toMatch(/[/\\\u0000-\u001f‮]/); expect(n.startsWith('.')).toBe(false); }
    expect(new Set(names.map((n: string) => n.toLowerCase())).size).toBe(7);
    expect((await a.client.get(`/api/v1/folders/${a.rootId}`)).body.files.filter((f: any) => /cron|boot/.test(f.name))).toEqual([]);
    // nothing was written outside the data directory by a name
    expect(existsSync(`${(process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test')}/etc`)).toBe(false);
  });

  it('protects a portal with a hashed password and stops guessing', async () => {
    const p = await portal({ password: 'sésame ouvre-toi' });
    const [row] = await sql<{ password_hash: string }[]>`select password_hash from upload_requests where id = ${p.id}`;
    expect(row!.password_hash.startsWith('scrypt$')).toBe(true);
    const files = [{ name: 'a.pdf', data: PDF }];
    expect((await anon().get(`${P}/requests/${p.token}`)).body.needsPassword).toBe(true);
    expect((await start(p.token, files)).r.body.error).toBe('password_required');
    expect((await start(p.token, files, { password: 'faux' })).r.body.error).toBe('password_invalid');
    expect((await start(p.token, files, { password: 'sésame ouvre-toi' })).r.status).toBe(200);
    for (let i = 0; i < 19; i++) await start(p.token, files, { password: `essai ${i}` });
    expect((await start(p.token, files, { password: 'sésame ouvre-toi' })).r.status).toBe(429); // locked for a while, from any address
    expect(JSON.stringify(await sql`select meta from audit_events where action = 'request.password_failed'`)).not.toMatch(/essai|sésame/);
  });

  it('rotates, deletes and cleans up', async () => {
    const p = await portal();
    await deposit(p.token, [{ name: 'gardé.pdf', data: PDF }]);
    const rot = await a.client.post(`/api/v1/requests/${p.id}/rotate`);
    const fresh = (rot.body.url as string).split('/request/')[1]!;
    expect((await anon().get(`${P}/requests/${p.token}`)).status).toBe(404);
    expect((await anon().get(`${P}/requests/${fresh}`)).status).toBe(200);
    // an abandoned deposit is expired by housekeeping and its bytes destroyed
    const s = await start(fresh, [{ name: 'abandon.pdf', data: PDF }]);
    await s.c.patch(`${P}/uploads/${s.items[0]!.uploadId}?offset=0`, PDF.subarray(0, 500), bearer(s.token));
    expect(existsSync(`${config.quarantineDir}/up-${s.items[0]!.uploadId}`)).toBe(true);
    await sql`update upload_submissions set created_at = now() - interval '25 hours' where token_hash is not null and status = 'open'`;
    await housekeeping();
    expect(readdirSync(config.quarantineDir)).toHaveLength(0); // every abandoned deposit of this run is gone
    expect((await s.c.get(`${P}/submissions/status`, bearer(s.token))).body).toMatchObject({ status: 'expired', items: [{ status: 'rejected', reason: 'expired' }] });
    // deleting the portal keeps what was deposited
    expect((await a.client.del(`/api/v1/requests/${p.id}?purge=1`)).status).toBe(200);
    expect((await anon().get(`${P}/requests/${fresh}`)).status).toBe(404);
    expect(await tree(a.client, p.folderId)).toHaveLength(1);
    expect((await a.client.get(`/api/v1/requests/${p.id}`)).status).toBe(404);
  });

  it('an incomplete file is refused at finalisation while complete ones go through', async () => {
    const p = await portal();
    const s = await start(p.token, [{ name: 'complet.pdf', data: PDF }, { name: 'partiel.png', data: PNG }]);
    await send(s.c, s.token, s.items[0]!.uploadId, PDF);
    await s.c.patch(`${P}/uploads/${s.items[1]!.uploadId}?offset=0`, PNG.subarray(0, 100), bearer(s.token));
    await s.c.post(`${P}/submissions/finalize`, {}, bearer(s.token)); await work();
    expect((await s.c.get(`${P}/submissions/status`, bearer(s.token))).body.items).toEqual([{ name: 'complet.pdf', status: 'accepted', reason: null }, { name: 'partiel.png', status: 'rejected', reason: 'incomplete' }]);
  });
});
