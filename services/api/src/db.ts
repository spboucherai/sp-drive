import postgres from 'postgres';
import { config } from './config.ts';
import * as m001 from './migrations/001_init.ts';

export const sql = postgres(config.databaseUrl, { max: 12, idle_timeout: 30, onnotice: () => {}, types: { bigint: postgres.BigInt } });
export type Sql = typeof sql;
/** A transaction handle or the pool: every query helper takes one so it can join the caller's transaction. */
export type Db = postgres.Sql | postgres.TransactionSql;
export const tx = <T>(fn: (t: postgres.TransactionSql) => Promise<T>): Promise<T> => sql.begin(fn) as Promise<T>;

export const MIGRATIONS = [m001];

export async function migrate(target?: string): Promise<string[]> {
  await sql`create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())`;
  const done: string[] = [];
  // one migrator at a time (API and worker may start together)
  await sql.begin(async (t) => {
    await t`select pg_advisory_xact_lock(7420660001)`;
    const applied = new Set((await t<{ id: string }[]>`select id from schema_migrations`).map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      await t.unsafe(m.up);
      await t`insert into schema_migrations (id) values (${m.id})`;
      done.push(m.id);
      if (m.id === target) break;
    }
  });
  return done;
}
/** Revert the most recent migration (data in its tables is lost: only on explicit operator request). */
export async function migrateDown(): Promise<string | null> {
  return sql.begin(async (t) => {
    await t`select pg_advisory_xact_lock(7420660001)`;
    const [last] = await t<{ id: string }[]>`select id from schema_migrations order by id desc limit 1`;
    const m = MIGRATIONS.find((x) => x.id === last?.id);
    if (!m) return null;
    await t.unsafe(m.down);
    await t`delete from schema_migrations where id = ${m.id}`;
    return m.id;
  }) as Promise<string | null>;
}

/** Serialises every change to one owner's tree (names, moves, quota) inside the caller's transaction. */
export const lockOwner = (t: Db, ownerId: string) => t`select pg_advisory_xact_lock(hashtextextended(${'spd-tree:' + ownerId}, 0))`;

export interface Actor { kind: 'user' | 'anonymous' | 'system'; userId?: string | null; ip?: string; userAgent?: string }
export const SYSTEM: Actor = { kind: 'system' };
/** Structured audit trail. Never pass document content, tokens or passwords in `meta`. */
export async function audit(t: Db, actor: Actor, action: string, o: { ownerId?: string | null; targetType?: string; targetId?: string; meta?: Record<string, unknown> } = {}): Promise<void> {
  await t`insert into audit_events (actor_kind, actor_user_id, owner_id, action, target_type, target_id, ip, user_agent, meta)
    values (${actor.kind}, ${actor.userId ?? null}, ${o.ownerId ?? actor.userId ?? null}, ${action}, ${o.targetType ?? ''}, ${o.targetId ?? ''},
      ${actor.ip ?? ''}, ${(actor.userAgent ?? '').slice(0, 300)}, ${t.json((o.meta ?? {}) as never)})`;
}
export async function notify(t: Db, userId: string, kind: string, data: Record<string, unknown>): Promise<void> {
  await t`insert into notifications (user_id, kind, data) values (${userId}, ${kind}, ${t.json(data as never)})`;
}
export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
