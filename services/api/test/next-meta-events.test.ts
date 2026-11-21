/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/test/next-meta-events.test.ts
 * Module           : services
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
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

// 2.0: capability discovery, client identification on device sessions, sync events (Server-Sent Events).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.ts';
import { sql } from '../src/db.ts';
import { eventStats } from '../src/events.ts';
import { parseClientHeader } from '../src/auth.ts';
import { closeAll, nativeLogin, parseSse, server, signup } from './harness.ts';

let port = 0;
beforeAll(async () => { const app = await server(); await app.listen({ port: 0, host: '127.0.0.1' }); port = (app.server.address() as AddressInfo).port; });
afterAll(closeAll);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A real HTTP client reading the event stream as it arrives. */
function listen(headers: Record<string, string>) {
  const events: { event: string; data: any }[] = [];
  let status = 0, resHeaders: http.IncomingHttpHeaders = {}, buffer = '', ended = false;
  const req = http.get({ host: '127.0.0.1', port, path: '/api/v1/sync/events', headers }, (res) => {
    status = res.statusCode ?? 0; resHeaders = res.headers;
    res.setEncoding('utf8');
    res.on('data', (c: string) => { buffer += c; const cut = buffer.lastIndexOf('\n\n'); if (cut >= 0) { events.push(...parseSse(buffer.slice(0, cut + 2))); buffer = buffer.slice(cut + 2); } });
    res.on('end', () => { ended = true; }); res.on('close', () => { ended = true; });
  });
  req.on('error', () => { ended = true; });
  const until = async (pred: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error(`timeout; got ${JSON.stringify(events)}`); await sleep(20); } };
  return { events, until, close: () => req.destroy(), get status() { return status; }, get headers() { return resHeaders; }, get ended() { return ended; }, of: (name: string) => events.filter((e) => e.event === name) };
}
const cookieOf = (c: { cookies: Map<string, string> }) => [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ');

describe('capability discovery', () => {
  it('GET /meta answers without a session and lists only what works here', async () => {
    const res = await (await server()).inject({ method: 'GET', url: '/api/v1/meta' });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.api).toBe(2); expect(m.version).toBe('2.0.0');
    expect(m.features).toEqual(expect.arrayContaining(['events', 'content-search', 'collab', 'collections', 'activity', 'storage', 'upload-history']));
    expect(m.features).not.toContain('ai'); // no provider is configured in the test environment
    // a server with content indexing switched off does not announce it
    config.indexContent = false;
    try { expect((await (await server()).inject({ method: 'GET', url: '/api/v1/meta' })).json().features).not.toEqual(expect.arrayContaining(['content-search'])); } finally { config.indexContent = true; }
  });
  it('parses X-SPD-Client strictly', () => {
    expect(parseClientHeader('macos/2.0.0 (27.0)')).toEqual({ platform: 'macos', version: '2.0.0', os: '27.0' });
    expect(parseClientHeader('ipados/2.1.0-beta+3')).toEqual({ platform: 'ipados', version: '2.1.0-beta+3', os: '' });
    for (const bad of ['windows/1.0', 'macos/', 'macos/1.0 (a\u0007b)', 'macos/1.0 (x) trailing', `ios/${'9'.repeat(40)}`, undefined, 42]) expect(parseClientHeader(bad)).toBeNull();
  });
  it('records platform and app version on the device session and shows them in the devices list', async () => {
    const u = await signup();
    const mac = await nativeLogin(u.client, 'Mac Studio', 'macos/2.0.0 (27.0)');
    const old = await nativeLogin(u.client, 'Vieil iPhone'); // a 1.0 client sends no header
    expect((await mac.get('/api/v1/auth/state')).status).toBe(200); expect((await old.get('/api/v1/auth/state')).status).toBe(200);
    let list = (await u.client.get('/api/v1/account/sessions')).body;
    expect(list.find((s: any) => s.deviceName === 'Mac Studio').client).toEqual({ platform: 'macos', version: '2.0.0', os: '27.0' });
    expect(list.find((s: any) => s.deviceName === 'Vieil iPhone').client).toBeNull();
    expect(list.find((s: any) => s.kind === 'web').client).toBeNull();
    // the application is updated: the next request carries the new version
    mac.clientHeader = 'macos/2.0.1 (27.1)';
    await mac.get('/api/v1/sync/cursor');
    list = (await u.client.get('/api/v1/account/sessions')).body;
    expect(list.find((s: any) => s.deviceName === 'Mac Studio').client).toEqual({ platform: 'macos', version: '2.0.1', os: '27.1' });
    // a malformed header changes nothing
    mac.clientHeader = '<script>/9';
    await mac.get('/api/v1/sync/cursor');
    expect((await u.client.get('/api/v1/account/sessions')).body.find((s: any) => s.deviceName === 'Mac Studio').client.version).toBe('2.0.1');
  });
});

describe('sync events', () => {
  it('refuses a stream without a session', async () => {
    const s = listen({});
    await s.until(() => s.status !== 0 || s.ended);
    expect(s.status).toBe(401); s.close();
  });
  it('says hello with the head, then hints at changes; cookie and bearer both work; other accounts hear nothing', async () => {
    const a = await signup(), b = await signup();
    const dev = await nativeLogin(a.client, 'Mac', 'macos/2.0.0 (27.0)');
    const web = listen({ cookie: cookieOf(a.client) }), native = listen({ authorization: `Bearer ${dev.token}` }), other = listen({ cookie: cookieOf(b.client) });
    await web.until(() => web.of('hello').length === 1); await native.until(() => native.of('hello').length === 1); await other.until(() => other.of('hello').length === 1);
    expect(web.status).toBe(200);
    expect(web.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(web.headers['cache-control']).toContain('no-transform'); // a proxy must not compress or batch the stream
    expect(web.headers['x-accel-buffering']).toBe('no');
    expect(web.headers['x-content-type-options']).toBe('nosniff');
    const head0 = (await a.client.get('/api/v1/sync/cursor')).body.head;
    expect(web.of('hello')[0]!.data).toEqual({ head: head0 });

    const f = await a.client.post('/api/v1/folders', { parentId: 'root', name: 'Nouveau' });
    await web.until(() => web.of('change').length === 1); await native.until(() => native.of('change').length === 1);
    const head1 = (await a.client.get('/api/v1/sync/cursor')).body.head;
    expect(head1).toBeGreaterThan(head0);
    expect(web.of('change')[0]!.data).toEqual({ head: head1 }); // no item in the event: the client reads /sync/changes
    expect(native.of('change')[0]!.data).toEqual({ head: head1 });
    expect((await dev.get(`/api/v1/sync/changes?since=${head0}`)).body.items.map((i: any) => i.id)).toContain(f.body.id);
    await sleep(300);
    expect(other.of('change')).toHaveLength(0);
    web.close(); native.close(); other.close();
  });
  it('coalesces a burst into one event and spaces events by a second', async () => {
    const a = await signup();
    const s = listen({ cookie: cookieOf(a.client) });
    await s.until(() => s.of('hello').length === 1);
    for (let i = 0; i < 25; i++) await a.client.post('/api/v1/folders', { parentId: 'root', name: `Lot ${i}` });
    await s.until(() => s.of('change').length >= 1);
    await sleep(1300);
    const n = s.of('change').length;
    expect(n).toBeLessThanOrEqual(2); // 25 changes: one event, at most a second one for the tail of the burst
    expect(s.of('change').at(-1)!.data.head).toBe((await a.client.get('/api/v1/sync/cursor')).body.head);
    // a later change is announced again
    await a.client.post('/api/v1/folders', { parentId: 'root', name: 'Après' });
    await s.until(() => s.of('change').length === n + 1);
    s.close();
  });
  it('announces notifications, pings, and ends the stream of a revoked session', async () => {
    const a = await signup();
    const saved = config.eventsPingMs; config.eventsPingMs = 150;
    try {
      const dev = await nativeLogin(a.client, 'iPhone', 'ios/2.0.0 (27.0)');
      const s = listen({ authorization: `Bearer ${dev.token}` });
      await s.until(() => s.of('hello').length === 1);
      await sql`insert into notifications (user_id, kind, data) values (${a.userId}, 'collab.shared', '{}')`;
      await s.until(() => s.of('notify').length === 1);
      expect(s.of('notify')[0]!.data).toEqual({ kind: 'collab.shared' });
      await s.until(() => s.of(':').length >= 2);
      expect(s.of(':')[0]!.data).toBe('ping');
      // the owner revokes the device from the browser: its stream is closed at the next ping
      const row = (await a.client.get('/api/v1/account/sessions')).body.find((x: any) => x.kind === 'device');
      expect((await a.client.del(`/api/v1/account/sessions/${row.id}`)).status).toBe(200);
      await s.until(() => s.ended);
    } finally { config.eventsPingMs = saved; }
  });
  it('releases everything when clients disconnect, and caps the streams of one account', async () => {
    const a = await signup();
    const before = eventStats();
    const many = Array.from({ length: 16 }, () => listen({ cookie: cookieOf(a.client) }));
    for (const s of many) await s.until(() => s.of('hello').length === 1);
    expect(eventStats().streams).toBe(before.streams + 16);
    const extra = listen({ cookie: cookieOf(a.client) });
    await extra.until(() => extra.status !== 0);
    expect(extra.status).toBe(429); extra.close();
    await a.client.post('/api/v1/folders', { parentId: 'root', name: 'x' }); // a timer may be pending when they leave
    for (const s of many) s.close();
    const t0 = Date.now(); while (eventStats().streams !== before.streams && Date.now() - t0 < 5000) await sleep(20);
    expect(eventStats()).toEqual({ owners: before.owners, streams: before.streams, timers: 0 });
    // the single LISTEN connection is still healthy for the next client
    const again = listen({ cookie: cookieOf(a.client) });
    await again.until(() => again.of('hello').length === 1);
    await a.client.post('/api/v1/folders', { parentId: 'root', name: 'y' });
    await again.until(() => again.of('change').length === 1);
    again.close();
  });
});
