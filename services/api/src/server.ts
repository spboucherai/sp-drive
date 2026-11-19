import { readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiRoutes } from './ai/routes.ts';
import { authRoutes, hasBearer, loadSession, requireAdmin, requireUser } from './auth.ts';
import { collabRoutes } from './collab.ts';
import { collectionRoutes } from './collections.ts';
import { config, UserError } from './config.ts';
import { sql } from './db.ts';
import { eventRoutes, eventStats } from './events.ts';
import { fileRoutes } from './files.ts';
import { insightRoutes } from './insights.ts';
import { features, metaRoutes } from './meta.ts';
import { requestRoutes } from './requests.ts';
import { shareRoutes } from './shares.ts';
import { syncRoutes } from './sync.ts';
import { semanticBackend, textRoutes } from './textindex.ts';
import { clamdPing } from './tools.ts';
import { uploadRoutes } from './uploads.ts';

/** Link tokens never reach the logs: the secret part of public URLs is replaced before a request is logged. */
export const redactUrl = (url: string) => url.replace(/(\/(?:s|request|invite)\/|\/public\/(?:shares|requests)\/)[A-Za-z0-9_-]{16,}/g, '$1[redacted]');

const CSP = ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' blob:", "font-src 'self' data:",
  "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');

/** Chunk traffic of a resumable upload: `PATCH` (a chunk) and `GET` (where to resume) of one upload, owner or grant route. */
const UPLOAD_CHUNK_URL = /^\/api\/v1\/(?:shared\/[0-9a-f-]{36}\/)?uploads\/[0-9a-f-]{36}(?:\?|$)/i;
export const isUploadChunk = (method: string, url: string): boolean => (method === 'PATCH' || method === 'GET') && UPLOAD_CHUNK_URL.test(url);
/** Per account: 100 chunk requests a second on average — 6 to 8 parallel uploads on a fast local network stay far below. */
export const UPLOAD_CHUNKS_PER_MIN = 6000;
/** Per address, for chunk requests whose cookie or bearer is not a live session (they never reach a handler). */
export const UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN = 120;
/** Fixed one-minute windows in memory (one API process; the same scope as the plugin's default store). */
class MinuteBudget {
  private hits = new Map<string, { n: number; until: number }>();
  /** Count one request; returns 0 when allowed, else the seconds to wait. */
  take(key: string, max: number): number {
    const now = Date.now();
    if (this.hits.size > 20_000) for (const [k, v] of this.hits) if (v.until <= now) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || h.until <= now) { this.hits.set(key, { n: 1, until: now + 60_000 }); return 0; }
    return ++h.n > max ? Math.max(1, Math.ceil((h.until - now) / 1000)) : 0;
  }
}
const chunkBudget = new MinuteBudget();

export async function buildServer(o: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.trustProxy, bodyLimit: 1024 * 1024,
    logger: o.logger === false ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'],
      serializers: { req: (r) => ({ method: r.method, url: redactUrl(r.url), ip: r.ip }), res: (r) => ({ statusCode: r.statusCode }) } },
  });
  await app.register(cookie);
  // Every address has 900 requests a minute. The chunks of resumable uploads (PATCH and status GET of one upload) are
  // counted apart: a signed-in client sending several large files in parallel makes thousands of them, so they leave
  // the per-address budget when the request carries a credential, and the hook below counts them per account
  // (UPLOAD_CHUNKS_PER_MIN) once the session is known — or per address, tightly, when the credential is not valid.
  await app.register(rateLimit, { global: true, max: 900, timeWindow: '1 minute', keyGenerator: (req) => req.ip,
    allowList: (req) => isUploadChunk(req.method, req.url) && (hasBearer(req) || !!req.headers.cookie),
    errorResponseBuilder: (_req, ctx) => { const e = new UserError('rate_limited', 'too many requests, slow down', 429, { retryAfterS: Math.ceil(ctx.ttl / 1000) }); return e; } });
  // upload chunks arrive as a raw stream and are written straight to disk
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY')
      .header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()').header('Cross-Origin-Opener-Policy', 'same-origin');
    if (config.origin.startsWith('https://')) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!req.url.startsWith('/api/')) { reply.header('Content-Security-Policy', CSP); return; }
    reply.header('Cache-Control', 'no-store');
    // CSRF: state-changing calls must come from our own pages (custom header forces a preflight we never grant, origin must match)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      // a bearer token is not an ambient credential: no other site can make a browser send it, so native clients skip the header
      if (!(hasBearer(req) && !req.headers.cookie) && (req.headers['x-spd-csrf'] !== '1' || (origin && origin !== config.origin))) throw new UserError('csrf', 'request refused', 403);
    }
    const chunk = isUploadChunk(req.method, req.url) && (hasBearer(req) || !!req.headers.cookie);
    const limit = (key: string, max: number) => { const wait = chunkBudget.take(key, max); if (wait) throw new UserError('rate_limited', 'too many requests, slow down', 429, { retryAfterS: wait }); };
    try { req.session = await loadSession(req, reply); } catch (e) { if (chunk) limit(`ip:${req.ip}`, UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN); throw e; } // a bearer that is not a session is refused here
    if (chunk) { if (req.session) limit(`u:${req.session.user.id}`, UPLOAD_CHUNKS_PER_MIN); else limit(`ip:${req.ip}`, UPLOAD_CHUNKS_BAD_CREDENTIAL_PER_MIN); }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown; code?: string }, req, reply) => {
    if (err instanceof UserError) return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'invalid_request', message: 'invalid request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    // text PostgreSQL cannot store (NUL bytes, broken encodings) is the caller's mistake, not ours
    if (err.code === '22021' || err.code === '22P05') return reply.code(400).send({ error: 'invalid_request', message: 'invalid characters in request' });
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error({ err: { message: err.message, stack: err.stack, code: err.code } }, 'unhandled error');
    return reply.code(status).send({ error: status === 500 ? 'internal' : status === 413 ? 'too_large' : 'bad_request', message: status === 500 ? 'internal error' : err.message });
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !config.webDir || req.method !== 'GET') return reply.code(404).send({ error: 'not_found', message: 'not found' });
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html'); // single-page app: every other path is a client route
  });

  // Passkeys in the native applications: Apple devices fetch this file to check that an app may use this site's credentials.
  app.get('/.well-known/apple-app-site-association', async (_req, reply) =>
    reply.type('application/json').header('Cache-Control', 'public, max-age=3600').send({ webcredentials: { apps: config.appleAppIds } }));

  app.get('/api/v1/health/live', async () => ({ ok: true }));
  const readiness = async () => {
    const db = await sql`select 1`.then(() => true, () => false);
    const storage = await statfs(config.blobDir).then((s) => ({ ok: true, freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }), () => ({ ok: false, freeBytes: 0, totalBytes: 0 }));
    const antivirus = await clamdPing();
    const [q] = db ? await sql<{ lag: number | null; failed: number }[]>`select extract(epoch from now() - min(run_at) filter (where status = 'queued' and run_at <= now()))::int as lag, count(*) filter (where status = 'failed')::int as failed from jobs` : [{ lag: null, failed: 0 }];
    return { db, storage, antivirus, queueLagS: q!.lag ?? 0, failedJobs: q!.failed };
  };
  app.get('/api/v1/health/ready', async (_req, reply) => {
    const r = await readiness();
    const ok = r.db && r.storage.ok && (r.antivirus || config.avMode === 'optional');
    return reply.code(ok ? 200 : 503).send({ ok, db: r.db, storage: r.storage.ok, antivirus: r.antivirus });
  });
  app.get('/api/v1/admin/system', { preHandler: [requireUser, async (req) => requireAdmin(req)] }, async () => {
    const r = await readiness();
    const [c] = await sql<{ users: number; files: number; objects: number; bytes: string; shares: number; requests: number; quarantined: number }[]>`select (select count(*)::int from users) as users,
      (select count(*)::int from files where trashed_at is null) as files, (select count(*)::int from storage_objects) as objects, (select coalesce(sum(size), 0)::text from storage_objects) as bytes,
      (select count(*)::int from shares where revoked_at is null) as shares, (select count(*)::int from upload_requests where revoked_at is null) as requests,
      (select count(*)::int from upload_items where status = 'quarantined') as quarantined`;
    // --- 2.0 additions: what an administrator needs to see to trust the machine room ---
    const [jobs, failures, state, index, sem] = await Promise.all([
      sql<{ kind: string; status: string; n: number; oldest: Date | null }[]>`select kind, status, count(*)::int as n, min(created_at) as oldest from jobs where status <> 'done' or finished_at > now() - interval '24 hours' group by kind, status order by kind, status`,
      sql<{ kind: string; n: number; error: string | null }[]>`select kind, count(*)::int as n, (array_agg(error order by updated_at desc))[1] as error from previews where status = 'failed' group by kind order by kind`,
      sql<{ key: string; value: Record<string, any>; updated_at: Date }[]>`select key, value, updated_at from system_state`,
      sql<{ status: string; n: number }[]>`select status, count(*)::int as n from object_text group by status`,
      semanticBackend(),
    ]);
    const worker = state.find((s) => s.key === 'worker');
    const ageS = (d: Date | string | null | undefined) => (d ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000)) : null);
    const backupFile = async (name: string) => readFile(join(config.backupDir, name), 'utf8').then((s) => JSON.parse(s) as Record<string, unknown>, () => null);
    const [backup, restoreTest, verify, offNode] = await Promise.all([backupFile('status.json'), backupFile('restore-test.json'), backupFile('verify.json'), backupFile('offnode.json')]);
    const at = (o: Record<string, unknown> | null) => (o && typeof o.at === 'string' ? o.at : null);
    return {
      ...r, avMode: config.avMode, commit: config.commit, counts: { ...c!, bytes: Number(c!.bytes) },
      version: config.version, features: await features(),
      worker: worker ? { alive: ageS(worker.updated_at)! < 180, heartbeatAgeS: ageS(worker.updated_at), pid: worker.value.pid ?? null } : { alive: false, heartbeatAgeS: null, pid: null },
      jobs: jobs.map((j) => ({ kind: j.kind, status: j.status, count: j.n, oldestAgeS: j.status === 'queued' || j.status === 'running' ? ageS(j.oldest) : null })),
      previewFailures: failures.map((f) => ({ kind: f.kind, count: f.n, lastError: f.error })),
      converter: worker?.value.converter ?? { available: null, path: config.soffice },
      textkit: worker?.value.textkit ?? { available: null },
      antivirusSignatures: worker?.value.antivirus ? { ...worker.value.antivirus, ageS: ageS(worker.value.antivirus.signaturesAt) } : null,
      index: { enabled: config.indexContent, ocr: config.ocr, byStatus: Object.fromEntries(index.map((i) => [i.status, i.n])), semantic: sem },
      events: eventStats(),
      backup: {
        dir: config.backupDir,
        last: backup ? { ...backup, ageS: ageS(at(backup)) } : null,
        restoreTest: restoreTest ? { ...restoreTest, ageS: ageS(at(restoreTest)) } : null,
        verify: verify ? { ...verify, ageS: ageS(at(verify)) } : null,
        offNode: offNode ? { ...offNode, ageS: ageS(at(offNode)) } : null,
      },
    };
  });

  authRoutes(app); fileRoutes(app); uploadRoutes(app); shareRoutes(app); requestRoutes(app); syncRoutes(app);
  // 2.0 (all additive): capability discovery, sync events, content index, intelligence, collections, activity/storage, private sharing
  metaRoutes(app); eventRoutes(app); textRoutes(app); aiRoutes(app); collectionRoutes(app); insightRoutes(app); collabRoutes(app);

  if (config.webDir) {
    await app.register(fastifyStatic, { root: config.webDir, wildcard: false, maxAge: 0,
      setHeaders: (res, path) => { res.header('Cache-Control', /\/assets\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache'); } });
  }
  return app;
}
