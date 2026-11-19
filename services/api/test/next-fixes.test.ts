// 2.0 fixes reported by the native clients: a thumbnail that becomes ready is announced by the change feed, and the
// chunk traffic of resumable uploads has its own per-account budget instead of eating the per-address one.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN } from '../src/server.ts';
import { closeAll, server, signup, work } from './harness.ts';

afterAll(closeAll);
const FX = `${(process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test')}/fixtures-next-fixes`;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('a thumbnail that becomes ready advances the revision', () => {
  it('the change feed reports every live file showing that content, once, with thumb: true', async () => {
    mkdirSync(FX, { recursive: true });
    writeFileSync(join(FX, 'px.png'), PNG_1PX);
    execFileSync('/usr/bin/sips', ['-z', '120', '160', join(FX, 'px.png'), '--out', join(FX, 'photo.png')], { stdio: 'pipe' });
    const a = await signup();
    const data = readFileSync(join(FX, 'photo.png'));
    const one = (await a.client.upload(a.rootId, 'photo.png', data)).body.file;
    const two = (await a.client.upload(a.rootId, 'copie.png', data)).body.file; // same content, another file
    const gone = (await a.client.upload(a.rootId, 'jetee.png', data)).body.file;
    await a.client.post('/api/v1/trash', { fileIds: [gone.id], folderIds: [] });
    expect(one.thumb).toBe(false);
    const cursor = (await a.client.get('/api/v1/sync/cursor')).body.head as number;
    await work();
    const after = (await a.client.get(`/api/v1/sync/changes?since=${cursor}`)).body;
    const seen = new Map<string, any>(after.items.map((i: any) => [i.id, i]));
    expect(seen.get(one.id)).toMatchObject({ thumb: true });
    expect(seen.get(two.id)).toMatchObject({ thumb: true });
    expect(seen.get(one.id).rev).toBeGreaterThan(one.rev);
    expect((await a.client.get('/api/v1/sync/cursor')).body.head).toBeGreaterThan(cursor);
    // nothing more once it is ready: running the worker again moves nothing
    const head = (await a.client.get('/api/v1/sync/cursor')).body.head;
    await work();
    expect((await a.client.get('/api/v1/sync/cursor')).body.head).toBe(head);
  });
});

describe('upload chunk requests have their own budget', () => {
  const inject = async (o: { method: 'GET' | 'PATCH'; url: string; ip: string; headers?: Record<string, string> }) => (await (await server()).inject({ method: o.method, url: o.url, remoteAddress: o.ip, headers: o.headers ?? {} })).statusCode;

  it('a signed-in account can make far more than 900 chunk requests a minute without touching the address budget', async () => {
    const a = await signup();
    a.client.ip = '10.44.0.1';
    const up = (await a.client.post('/api/v1/uploads', { folderId: a.rootId, name: 'gros.bin', size: 10 })).body;
    let refused = 0;
    for (let i = 0; i < 1500; i++) if ((await a.client.get(`/api/v1/uploads/${up.id}`)).status !== 200) refused++;
    expect(refused).toBe(0);
    // the per-address budget is intact: 890 ordinary requests still pass after those 1500
    let ok = 0;
    for (let i = 0; i < 890; i++) if ((await a.client.get('/api/v1/sync/cursor')).status === 200) ok++;
    expect(ok).toBe(890);
  });

  it('an invalid credential on a chunk route is limited tightly, per address', async () => {
    const url = '/api/v1/uploads/00000000-0000-4000-8000-000000000000?offset=0';
    const codes: number[] = [];
    for (let i = 0; i < UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN + 5; i++) codes.push(await inject({ method: 'GET', url, ip: '10.44.0.2', headers: { authorization: `Bearer ${String(i).padStart(4, "0")}-not-a-live-device-token-xxxx` } }));
    expect(codes.slice(0, UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN).every((c) => c === 401)).toBe(true);
    expect(codes.slice(UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN)).toEqual([429, 429, 429, 429, 429]);
  });

  it('without any credential the chunk route stays under the ordinary per-address limit', async () => {
    const url = '/api/v1/uploads/00000000-0000-4000-8000-000000000000';
    let last = 0, first429 = -1;
    for (let i = 0; i < 905; i++) { last = await inject({ method: 'GET', url, ip: '10.44.0.3' }); if (last === 429 && first429 < 0) first429 = i; }
    expect(first429).toBe(900);
    expect(last).toBe(429);
  });
});
