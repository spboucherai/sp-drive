import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createInvite } from '../src/auth.ts';
import { config } from '../src/config.ts';
import { migrate, sql } from '../src/db.ts';
import { drain } from '../src/jobs.ts';
import { buildServer } from '../src/server.ts';
import { handlers } from '../src/worker.ts';
import { SoftAuthenticator } from './authenticator.ts';

let app: FastifyInstance | undefined;
export async function server(): Promise<FastifyInstance> {
  if (!app) { await migrate(); app = await buildServer({ logger: false }); if (process.env.SPD_TEST_ERRORS) app.addHook('onError', async (req, _reply, err) => { if (!(err as { status?: number }).status && err.name !== 'ZodError' && !(err as { statusCode?: number }).statusCode) console.error('UNHANDLED', req.method, req.url, err); }); await app.ready(); }
  return app;
}
export async function closeAll(): Promise<void> { await app?.close(); app = undefined; await sql.end({ timeout: 5 }); }
/** Run every queued job to completion (scans, previews, submissions, garbage collection), including delayed ones. */
export async function work(): Promise<void> {
  await sql`update jobs set run_at = now() where status = 'queued'`; // jobs waiting for a retry get one more try
  for (let i = 0; i < 50; i++) {
    if ((await drain(handlers)) === 0) return;
    await sql`update jobs set run_at = now() where status = 'queued' and attempts = 0`; // jobs created by the jobs that just ran
  }
}

export interface Res<T = any> { status: number; body: T; headers: Record<string, any>; raw: Buffer }
/** An HTTP client with its own cookie jar, talking to the in-process server. */
export class Client {
  cookies = new Map<string, string>();
  ip = '10.0.0.1';
  constructor(public auth?: SoftAuthenticator) {}
  async call<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> {
    const a = await server();
    const isRaw = Buffer.isBuffer(body);
    const res = await a.inject({
      method: method as 'GET', url, remoteAddress: this.ip,
      headers: { ...(method !== 'GET' && method !== 'HEAD' ? { 'x-spd-csrf': '1', origin: config.origin } : {}), ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(isRaw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      payload: isRaw ? (body as Buffer) : body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.cookies) { if (c.value === '' || (c.expires && c.expires.getTime() < Date.now()) || c.maxAge === 0) this.cookies.delete(c.name); else this.cookies.set(c.name, c.value); }
    let parsed: any = undefined;
    if (String(res.headers['content-type'] ?? '').includes('json')) { try { parsed = res.json(); } catch { /* not json */ } }
    return { status: res.statusCode, body: parsed as T, headers: res.headers, raw: res.rawPayload };
  }
  get = <T = any>(url: string, headers?: Record<string, string>) => this.call<T>('GET', url, undefined, headers);
  post = <T = any>(url: string, body: unknown = {}, headers?: Record<string, string>) => this.call<T>('POST', url, body, headers);
  patch = <T = any>(url: string, body: unknown = {}, headers?: Record<string, string>) => this.call<T>('PATCH', url, body, headers);
  del = <T = any>(url: string) => this.call<T>('DELETE', url);

  /** Re-authenticate with the passkey (sensitive operations). */
  async reauth(): Promise<void> {
    const o = await this.post('/api/v1/auth/reauth/options');
    const r = await this.post('/api/v1/auth/reauth/verify', { challengeId: o.body.challengeId, response: this.auth!.get(o.body.options) });
    if (r.status !== 200) throw new Error(`reauth failed: ${JSON.stringify(r.body)}`);
  }
  async login(): Promise<Res> {
    const o = await this.post('/api/v1/auth/login/options');
    return this.post('/api/v1/auth/login/verify', { challengeId: o.body.challengeId, response: this.auth!.get(o.body.options) });
  }
  /** Upload bytes through the resumable protocol and wait for nothing: returns the completed upload answer. */
  async upload(folderId: string, name: string, data: Buffer, o: { onConflict?: string; relativePath?: string; fileId?: string; chunk?: number } = {}): Promise<Res> {
    const created = await this.post('/api/v1/uploads', { folderId, name, size: data.length, onConflict: o.onConflict, relativePath: o.relativePath, fileId: o.fileId });
    if (created.status !== 200) return created;
    const step = o.chunk ?? 4 * 1024 * 1024;
    for (let off = 0; off < data.length; off += step) {
      const part = data.subarray(off, off + step);
      const r = await this.patch(`/api/v1/uploads/${created.body.id}?offset=${off}`, part, { 'x-chunk-sha256': sha(part) });
      if (r.status !== 200) return r;
    }
    return this.post(`/api/v1/uploads/${created.body.id}/complete`, { sha256: sha(data) });
  }
}
export const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let ipSeq = 0;
/** An anonymous visitor on its own address (the per-address rate limits stay active in tests, visitors just do not share one). */
export const anon = () => { const c = new Client(); ipSeq++; c.ip = `10.${100 + Math.floor(ipSeq / 60000)}.${Math.floor(ipSeq / 250) % 250}.${1 + (ipSeq % 250)}`; return c; };

let n = 0;
/** Create an account through the real invitation + passkey registration flow. */
export async function signup(o: { role?: 'admin' | 'user'; quotaBytes?: number } = {}): Promise<{ client: Client; email: string; userId: string; recoveryCodes: string[]; rootId: string }> {
  await server();
  const email = `user${++n}-${randomBytes(3).toString('hex')}@example.test`;
  const inv = await createInvite(sql, { email, role: o.role ?? 'user', quotaBytes: o.quotaBytes });
  const client = new Client(new SoftAuthenticator(config.origin, config.rpId));
  const opt = await client.post('/api/v1/auth/register/options', { invite: inv.token, displayName: `Test ${n}` });
  if (opt.status !== 200) throw new Error(`register options: ${JSON.stringify(opt.body)}`);
  const ver = await client.post('/api/v1/auth/register/verify', { invite: inv.token, challengeId: opt.body.challengeId, response: client.auth!.create(opt.body.options), label: 'Test key' });
  if (ver.status !== 200) throw new Error(`register verify: ${JSON.stringify(ver.body)}`);
  const state = await client.get('/api/v1/auth/state');
  const root = await client.get('/api/v1/folders/root');
  return { client, email, userId: state.body.user.id, recoveryCodes: ver.body.recoveryCodes, rootId: root.body.folder.id };
}

/** A native client: bearer token, no cookie, no CSRF header, no Origin. */
export class Device {
  constructor(public token: string, public clientHeader?: string) {}
  async call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const a = await server();
    const raw = Buffer.isBuffer(body);
    const res = await a.inject({ method: method as 'GET', url, remoteAddress: '10.9.0.1',
      headers: { authorization: `Bearer ${this.token}`, ...(this.clientHeader ? { 'x-spd-client': this.clientHeader } : {}), ...(raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      payload: raw ? (body as Buffer) : body !== undefined ? JSON.stringify(body) : undefined });
    let parsed: any; try { parsed = res.json(); } catch { /* not json */ }
    return { status: res.statusCode, body: parsed, headers: res.headers, raw: res.rawPayload };
  }
  get = (url: string) => this.call('GET', url);
  post = (url: string, body: unknown = {}) => this.call('POST', url, body);
}
/** Sign in as a native client with the account's passkey; `clientHeader` is sent as X-SPD-Client. */
export async function nativeLogin(client: Client, name = 'Mac de test', clientHeader?: string): Promise<Device> {
  const fresh = new Client(client.auth);
  const o = await fresh.post('/api/v1/auth/login/options');
  const res = await fresh.post('/api/v1/auth/login/verify', { challengeId: o.body.challengeId, response: client.auth!.get(o.body.options), client: { kind: 'native', name } }, clientHeader ? { 'x-spd-client': clientHeader } : {});
  if (res.status !== 200) throw new Error(`native login: ${JSON.stringify(res.body)}`);
  return new Device(res.body.token, clientHeader);
}
/** Events of a Server-Sent Events body ("event: x\ndata: {...}\n\n" blocks; comments are kept as { event: ':' }). */
export function parseSse(text: string): { event: string; data: any }[] {
  return text.split('\n\n').filter((b) => b.trim()).map((block) => {
    if (block.startsWith(':')) return { event: ':', data: block.slice(1).trim() };
    const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message', data = /^data: (.*)$/m.exec(block)?.[1];
    return { event, data: data === undefined ? undefined : JSON.parse(data) };
  });
}
/** A minimal one-page PDF with a real text layer (Helvetica, WinAnsi). */
export function pdfWithText(lines: string[], size = 14): Buffer {
  const esc = (l: string) => l.replace(/[()\\]/g, '\\$&');
  const content = `BT /F1 ${size} Tf 50 ${760 - size} Td ${Math.round(size * 1.4)} TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  let out = '%PDF-1.4\n'; const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
