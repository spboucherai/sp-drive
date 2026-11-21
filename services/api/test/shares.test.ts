/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/test/shares.test.ts
 * Module           : services
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-11
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '../src/db.ts';
import { redactUrl } from '../src/server.ts';
import { anon, Client, closeAll, sha, signup } from './harness.ts';

afterAll(closeAll);
let a: Awaited<ReturnType<typeof signup>>, b: Awaited<ReturnType<typeof signup>>;
let docs: string, sub: string, outside: string, f1: any, f2: any, secret: any;
const data1 = randomBytes(300_000);
beforeAll(async () => {
  a = await signup(); b = await signup();
  docs = (await a.client.post('/api/v1/folders', { parentId: a.rootId, name: 'Partagé' })).body.id;
  sub = (await a.client.post('/api/v1/folders', { parentId: docs, name: 'Sous' })).body.id;
  outside = (await a.client.post('/api/v1/folders', { parentId: a.rootId, name: 'Privé' })).body.id;
  f1 = (await a.client.upload(docs, 'contrat.pdf', data1)).body.file;
  f2 = (await a.client.upload(sub, 'notes.txt', Buffer.from('notes partagées'))).body.file;
  secret = (await a.client.upload(outside, 'secret.txt', Buffer.from('jamais partagé'))).body.file;
});
const tokenOf = (url: string) => url.split('/s/')[1]!;
const share = async (body: Record<string, unknown>) => { const r = await a.client.post('/api/v1/shares', body); expect(r.status).toBe(200); return { id: r.body.share.id as string, token: tokenOf(r.body.url) }; };
const open = async (token: string, password?: string) => { const c = anon(); const r = await c.post(`/api/v1/public/shares/${token}/open`, password ? { password } : {}); return { c, r }; };
const P = '/api/v1/public/shares';

describe('share links', () => {
  it('stores only a hash of the token and never returns the link again', async () => {
    const s = await share({ fileId: f1.id });
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await sql<{ token_hash: string }[]>`select token_hash from shares where id = ${s.id}`;
    expect(rows[0]!.token_hash).not.toContain(s.token);
    expect(JSON.stringify((await a.client.get('/api/v1/shares')).body)).not.toContain(s.token);
    expect(redactUrl(`/api/v1/public/shares/${s.token}/open`)).toBe('/api/v1/public/shares/[redacted]/open');
    expect(redactUrl(`/s/${s.token}`)).toBe('/s/[redacted]'); expect(redactUrl(`/request/${s.token}?x=1`)).toBe('/request/[redacted]?x=1');
  });
  it('serves a shared file to an anonymous visitor only after the link is opened', async () => {
    const s = await share({ fileId: f1.id });
    expect((await anon().get(`${P}/${s.token}/files/${f1.id}/content?download=1`)).status).toBe(401); // no grant yet
    const { c, r } = await open(s.token);
    expect(r.body).toMatchObject({ type: 'file', canDownload: true, file: { name: 'contrat.pdf', size: data1.length } });
    expect(JSON.stringify(r.body)).not.toMatch(/storage_key|wrapped|owner_id|folder_id|sha256/);
    const dl = await c.get(`${P}/${s.token}/files/${f1.id}/content?download=1`);
    expect(dl.raw.equals(data1)).toBe(true);
    // the grant cookie is scoped and hardened
    const cookie = [...c.cookies.keys()][0]!;
    expect(cookie.startsWith('spd_g_')).toBe(true);
    // the same link gives access to nothing else, by any identifier
    for (const id of [f2.id, secret.id]) expect((await c.get(`${P}/${s.token}/files/${id}/content`)).status).toBe(404);
    expect((await c.get(`${P}/${s.token}/list`)).status).toBe(404);
    expect((await c.get(`${P}/${s.token}/zip`)).status).toBe(404);
    // and it does not make the visitor a user
    expect((await c.get(`/api/v1/files/${f1.id}/content`)).status).toBe(401);
    expect((await c.get('/api/v1/folders/root')).status).toBe(401);
    const events = (await a.client.get(`/api/v1/shares/${s.id}/events`)).body;
    expect(events.map((e: any) => `${e.kind}:${e.ok}`).sort()).toEqual(['download:true', 'open:true']);
    expect((await b.client.get(`/api/v1/shares/${s.id}/events`)).status).toBe(404);
  });
  it('revocation is immediate, even for a visitor in the middle of a session', async () => {
    const s = await share({ folderId: docs });
    const { c } = await open(s.token);
    expect((await c.get(`${P}/${s.token}/list`)).status).toBe(200);
    expect((await a.client.del(`/api/v1/shares/${s.id}`)).status).toBe(200);
    for (const url of [`${P}/${s.token}/list`, `${P}/${s.token}/files/${f1.id}/content`, `${P}/${s.token}/files/${f1.id}/content?download=1`, `${P}/${s.token}/zip`, `${P}/${s.token}`])
      expect([url, (await c.get(url)).status]).toEqual([url, 404]);
    expect((await open(s.token)).r.status).toBe(404);
  });
  it('confines a folder link to the folder: listing, files, breadcrumbs and ZIP', async () => {
    const s = await share({ folderId: docs });
    const { c, r } = await open(s.token);
    expect(r.body).toMatchObject({ type: 'folder', root: { name: 'Partagé' } });
    const top = (await c.get(`${P}/${s.token}/list`)).body;
    expect(top.files.map((f: any) => f.name)).toEqual(['contrat.pdf']); expect(top.folders.map((f: any) => f.name)).toEqual(['Sous']);
    const inner = (await c.get(`${P}/${s.token}/list?folder=${sub}`)).body;
    expect(inner.breadcrumbs.map((x: any) => x.name)).toEqual(['Partagé', 'Sous']); // never above the shared root
    expect((await c.get(`${P}/${s.token}/files/${f2.id}/content?as=text`)).raw.toString()).toBe('notes partagées');
    // escapes
    expect((await c.get(`${P}/${s.token}/list?folder=${a.rootId}`)).status).toBe(404);
    expect((await c.get(`${P}/${s.token}/list?folder=${outside}`)).status).toBe(404);
    expect((await c.get(`${P}/${s.token}/files/${secret.id}/content`)).status).toBe(404);
    expect((await c.get(`${P}/${s.token}/zip?folder=${a.rootId}`)).status).toBe(404);
    const other = (await b.client.upload(b.rootId, 'b.txt', Buffer.from('b'))).body.file;
    expect((await c.get(`${P}/${s.token}/files/${other.id}/content`)).status).toBe(404);
    const zip = await c.get(`${P}/${s.token}/zip`);
    expect(zip.status).toBe(200); expect(zip.raw.includes(Buffer.from('Sous/notes.txt'))).toBe(true); expect(zip.raw.includes(Buffer.from('secret'))).toBe(false);
    // a file moved out of the shared folder leaves the share at once; trashed content too
    await a.client.post('/api/v1/move', { fileIds: [f2.id], destinationId: outside });
    expect((await c.get(`${P}/${s.token}/files/${f2.id}/content?as=text`)).status).toBe(404);
    await a.client.post('/api/v1/move', { fileIds: [f2.id], destinationId: sub });
    await a.client.post('/api/v1/trash', { folderIds: [sub] });
    expect((await c.get(`${P}/${s.token}/files/${f2.id}/content?as=text`)).status).toBe(404);
    expect((await c.get(`${P}/${s.token}/list?folder=${sub}`)).status).toBe(404);
    await a.client.post('/api/v1/restore', { folderIds: [sub] });
    expect((await c.get(`${P}/${s.token}/files/${f2.id}/content?as=text`)).status).toBe(200);
    // trashing the shared folder itself kills the link until it is restored
    await a.client.post('/api/v1/trash', { folderIds: [docs] });
    expect((await c.get(`${P}/${s.token}/list`)).status).toBe(404);
    await a.client.post('/api/v1/restore', { folderIds: [docs] });
    expect((await c.get(`${P}/${s.token}/list`)).status).toBe(200);
  });
  it('protects with a hashed password and slows down guessing', async () => {
    const s = await share({ fileId: f1.id, password: 'correct horse' });
    const [row] = await sql<{ password_hash: string }[]>`select password_hash from shares where id = ${s.id}`;
    expect(row!.password_hash.startsWith('scrypt$')).toBe(true); expect(row!.password_hash).not.toContain('correct');
    expect((await anon().get(`${P}/${s.token}`)).body).toEqual({ needsPassword: true });
    expect((await open(s.token)).r.body.error).toBe('password_required');
    expect((await open(s.token, 'wrong')).r.body.error).toBe('password_invalid');
    const { c, r } = await open(s.token, 'correct horse');
    expect(r.status).toBe(200);
    expect((await c.get(`${P}/${s.token}/files/${f1.id}/content?download=1`)).status).toBe(200);
    // changing the password invalidates grants already given
    await a.client.patch(`/api/v1/shares/${s.id}`, { password: 'another one' });
    expect((await c.get(`${P}/${s.token}/files/${f1.id}/content?download=1`)).status).toBe(401);
    // brute force: after 20 failures the share refuses even the right password for a while, whatever the address
    await sql`insert into share_access_events (share_id, kind, ok) select ${s.id}, 'password', false from generate_series(1, 19)`;
    const late = anon(); late.ip = '10.7.7.7';
    expect((await late.post(`${P}/${s.token}/open`, { password: 'another one' })).status).toBe(429);
  });
  it('expires, including in the middle of a visit', async () => {
    const s = await share({ fileId: f1.id, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    const { c } = await open(s.token);
    expect((await c.get(`${P}/${s.token}/files/${f1.id}/content?download=1`)).status).toBe(200);
    await sql`update shares set expires_at = now() - interval '1 second' where id = ${s.id}`;
    expect((await c.get(`${P}/${s.token}/files/${f1.id}/content?download=1`)).status).toBe(404);
    expect((await open(s.token)).r.status).toBe(404);
    expect((await a.client.get('/api/v1/shares')).body.find((x: any) => x.id === s.id).status).toBe('expired');
    expect((await a.client.post('/api/v1/shares', { fileId: f1.id, expiresAt: new Date(Date.now() - 1000).toISOString() })).body.error).toBe('bad_expiry');
  });
  it('counts views and downloads atomically against their limits', async () => {
    const s = await share({ fileId: f1.id, maxViews: 3, maxDownloads: 2 });
    const opens = await Promise.all(Array.from({ length: 8 }, () => open(s.token)));
    expect(opens.filter((o) => o.r.status === 200)).toHaveLength(3);
    const c = opens.find((o) => o.r.status === 200)!.c;
    const dls = await Promise.all(Array.from({ length: 6 }, () => c.get(`${P}/${s.token}/files/${f1.id}/content?download=1`)));
    expect(dls.filter((d) => d.status === 200)).toHaveLength(2);
    expect(dls.filter((d) => d.status === 403)).toHaveLength(4);
    const st = (await a.client.get('/api/v1/shares')).body.find((x: any) => x.id === s.id);
    expect(st).toMatchObject({ viewCount: 3, downloadCount: 2, status: 'exhausted' });
    // resuming a download with Range does not burn another download
    const s2 = await share({ fileId: f1.id, maxDownloads: 1 });
    const v = (await open(s2.token)).c;
    expect((await v.get(`${P}/${s2.token}/files/${f1.id}/content?download=1`, { range: 'bytes=0-99' })).status).toBe(206);
    expect((await v.get(`${P}/${s2.token}/files/${f1.id}/content?download=1`, { range: 'bytes=100-199' })).status).toBe(206);
    expect((await v.get(`${P}/${s2.token}/files/${f1.id}/content?download=1`)).status).toBe(403);
  });
  it('single-use links open once', async () => {
    const s = await share({ fileId: f1.id, singleUse: true });
    const first = await open(s.token);
    expect(first.r.status).toBe(200);
    expect((await open(s.token)).r.status).toBe(404);
    expect((await first.c.get(`${P}/${s.token}/files/${f1.id}/content?download=1`)).status).toBe(200); // the one visitor can still take the file
  });
  it('view-only links never send an attachment nor a format the viewer cannot display', async () => {
    const bin = (await a.client.upload(docs, 'données.bin', randomBytes(100))).body.file;
    const s = await share({ folderId: docs, canDownload: false });
    const { c, r } = await open(s.token);
    expect(r.body.canDownload).toBe(false);
    expect((await c.get(`${P}/${s.token}/files/${f1.id}/content?download=1`)).status).toBe(403);
    expect((await c.get(`${P}/${s.token}/zip`)).status).toBe(403);
    const view = await c.get(`${P}/${s.token}/files/${f1.id}/content`);
    expect(view.status).toBe(200); expect(view.headers['content-disposition']).toContain('inline'); expect(view.headers['content-type']).toBe('application/pdf');
    expect((await c.get(`${P}/${s.token}/files/${bin.id}/content`)).status).toBe(404);
  });
  it('rotating a link kills the old one; a link cannot be made for the root, for foreign items or for infected files', async () => {
    const s = await share({ fileId: f1.id });
    const rotated = await a.client.post(`/api/v1/shares/${s.id}/rotate`);
    expect((await open(s.token)).r.status).toBe(404);
    expect((await open(tokenOf(rotated.body.url))).r.status).toBe(200);
    expect((await a.client.post('/api/v1/shares', { folderId: a.rootId })).status).toBe(400);
    expect((await a.client.post('/api/v1/shares', { fileId: f1.id, folderId: docs })).status).toBe(400);
    expect((await b.client.post(`/api/v1/shares/${s.id}/rotate`)).status).toBe(404);
    expect((await b.client.patch(`/api/v1/shares/${s.id}`, { label: 'x' })).status).toBe(404);
    expect((await b.client.del(`/api/v1/shares/${s.id}`)).status).toBe(404);
    // an infected file: existing links stop, new ones are refused
    const live = await open(tokenOf(rotated.body.url));
    await sql`update storage_objects set scan_status = 'infected' where sha256 = ${sha(data1)}`;
    expect((await live.c.get(`${P}/${tokenOf(rotated.body.url)}/files/${f1.id}/content?download=1`)).status).toBe(404);
    expect((await a.client.post('/api/v1/shares', { fileId: f1.id })).body.error).toBe('infected');
    expect((await a.client.get(`/api/v1/files/${f1.id}/content`)).status).toBe(451);
    expect((await a.client.get(`/api/v1/files/${f1.id}/content?download=1&infected=ack`)).status).toBe(200);
    await sql`update storage_objects set scan_status = 'clean' where sha256 = ${sha(data1)}`;
  });
  it('gives nothing to malformed or guessed tokens and does not log tokens', async () => {
    for (const t of ['x', 'a'.repeat(43), '../../etc/passwd', `${'a'.repeat(42)}%00`]) expect((await anon().get(`${P}/${encodeURIComponent(t)}`)).status).toBe(404);
    const rows = await sql<{ t: string }[]>`select row_to_json(e)::text as t from share_access_events e union all select row_to_json(x)::text from audit_events x`;
    const s = await share({ fileId: f1.id });
    await open(s.token);
    const all = (await sql<{ t: string }[]>`select row_to_json(e)::text as t from share_access_events e union all select row_to_json(x)::text from audit_events x`).map((r) => r.t).join('\n');
    expect(all).not.toContain(s.token); expect(rows.length).toBeGreaterThan(0);
  });
});
