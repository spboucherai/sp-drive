// Sync events (Server-Sent Events). PostgreSQL tells this process that an owner's tree changed (pg_notify from the
// triggers of migration 003); each connected client of that owner then receives `change { head }`, at most once a
// second. An event carries no item: it is a hint, the client still reads GET /sync/changes. One LISTEN connection
// serves the whole process.
import type { FastifyInstance } from 'fastify';
import { requireUser, userOf } from './auth.ts';
import { config, UserError } from './config.ts';
import { sql } from './db.ts';
import { openSse, type SseStream } from './sse.ts';
import { headRev } from './sync.ts';

interface Client { stream: SseStream; sessionId: string }
const byOwner = new Map<string, Set<Client>>();
const pending = new Map<string, NodeJS.Timeout>();
const lastSent = new Map<string, number>();
const MAX_STREAMS_PER_USER = 16, MIN_GAP_MS = 1000;
let listening: Promise<{ unlisten: () => Promise<void> }[]> | undefined;

/** Numbers for tests and the administration view. */
export const eventStats = () => ({ owners: byOwner.size, streams: [...byOwner.values()].reduce((n, s) => n + s.size, 0), timers: pending.size });

function onChange(ownerId: string): void {
  if (!byOwner.has(ownerId) || pending.has(ownerId)) return;
  // a burst of changes becomes one event; two events to one owner are at least a second apart
  const wait = Math.max(40, (lastSent.get(ownerId) ?? 0) + MIN_GAP_MS - Date.now());
  pending.set(ownerId, setTimeout(() => {
    pending.delete(ownerId);
    const clients = byOwner.get(ownerId);
    if (!clients?.size) return;
    lastSent.set(ownerId, Date.now());
    headRev(sql, ownerId).then((head) => { for (const c of clients) c.stream.send('change', { head }); }, () => { /* database briefly away: the clients poll */ });
  }, wait));
}
function onNotification(payload: string): void {
  const i = payload.indexOf(':');
  const clients = byOwner.get(payload.slice(0, i));
  if (clients) for (const c of clients) c.stream.send('notify', { kind: payload.slice(i + 1) });
}
const listen = () => (listening ??= Promise.all([sql.listen('spd_change', onChange), sql.listen('spd_notify', onNotification)])
  .catch((e) => { listening = undefined; throw e; }));

export function eventRoutes(app: FastifyInstance): void {
  app.get('/api/v1/sync/events', { preHandler: requireUser }, async (req, reply) => {
    const u = userOf(req), sessionId = req.session!.id;
    if ((byOwner.get(u.id)?.size ?? 0) >= MAX_STREAMS_PER_USER) throw new UserError('too_many_streams', 'too many event streams for this account', 429);
    await listen();
    const head = await headRev(sql, u.id);
    const stream = openSse(req, reply);
    const client: Client = { stream, sessionId };
    let set = byOwner.get(u.id);
    if (!set) byOwner.set(u.id, (set = new Set()));
    set.add(client);
    stream.send('hello', { head });
    const ping = setInterval(() => {
      stream.comment('ping');
      // a session revoked or expired meanwhile loses its stream at the next ping
      sql`select 1 from sessions s join users x on x.id = s.user_id where s.id = ${sessionId} and s.revoked_at is null and s.expires_at > now() and x.disabled_at is null`
        .then((r) => { if (!r.length) stream.end(); }, () => {});
    }, config.eventsPingMs);
    stream.onClose(() => {
      clearInterval(ping);
      const s = byOwner.get(u.id);
      s?.delete(client);
      if (s && !s.size) { byOwner.delete(u.id); lastSent.delete(u.id); const t = pending.get(u.id); if (t) { clearTimeout(t); pending.delete(u.id); } }
    });
  });
  app.addHook('onClose', async () => {
    for (const set of byOwner.values()) for (const c of [...set]) c.stream.end();
    for (const t of pending.values()) clearTimeout(t);
    pending.clear();
    const l = listening; listening = undefined;
    if (l) await l.then((subs) => Promise.all(subs.map((s) => s.unlisten())), () => {}).catch(() => {});
  });
}
