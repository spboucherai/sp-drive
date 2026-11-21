/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/jobs.ts
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

import { type Db, sql } from './db.ts';

export interface Job { id: string; kind: string; payload: Record<string, unknown>; attempts: number; max_attempts: number }
export async function enqueue(t: Db, kind: string, payload: Record<string, unknown>, o: { dedupeKey?: string; delayS?: number; maxAttempts?: number } = {}): Promise<void> {
  await t`insert into jobs (kind, payload, dedupe_key, run_at, max_attempts)
    values (${kind}, ${t.json(payload as never)}, ${o.dedupeKey ?? null}, now() + ${`${o.delayS ?? 0} seconds`}::interval, ${o.maxAttempts ?? 3})
    on conflict (dedupe_key) where status in ('queued', 'running') and dedupe_key is not null do nothing`;
}
async function claim(): Promise<Job | undefined> {
  const [j] = await sql<Job[]>`update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id = (select id from jobs where status = 'queued' and run_at <= now() order by run_at, id for update skip locked limit 1)
    returning id::text, kind, payload, attempts, max_attempts`;
  return j;
}
export type Handler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

/** Run queued jobs until none is ready. Returns how many ran. */
export async function drain(handlers: Record<string, Handler>): Promise<number> {
  let n = 0;
  for (let j = await claim(); j; j = await claim()) {
    n++;
    try {
      const h = handlers[j.kind];
      if (!h) throw new Error(`no handler for job kind ${j.kind}`);
      await h(j.payload, j);
      await sql`update jobs set status = 'done', finished_at = now(), last_error = null where id = ${j.id}`;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 500);
      const retry = j.attempts < j.max_attempts;
      await sql`update jobs set status = ${retry ? 'queued' : 'failed'}, last_error = ${msg}, locked_at = null,
        run_at = now() + ${`${Math.min(600, 15 * 2 ** j.attempts)} seconds`}::interval, finished_at = ${retry ? null : new Date()} where id = ${j.id}`;
      console.error(JSON.stringify({ level: 'error', msg: 'job failed', job: j.id, kind: j.kind, attempt: j.attempts, error: msg }));
    }
  }
  return n;
}
/** Jobs whose worker died mid-run go back to the queue. */
export const requeueStuck = () => sql`update jobs set status = case when attempts >= max_attempts then 'failed' else 'queued' end, locked_at = null,
  last_error = coalesce(last_error, 'worker stopped while running this job') where status = 'running' and locked_at < now() - interval '20 minutes'`;

export function startWorkerLoop(handlers: Record<string, Handler>, everyMs = 1500): () => Promise<void> {
  let stop = false, busy: Promise<unknown> = Promise.resolve();
  const tick = async () => { if (stop) return; busy = drain(handlers).catch((e) => console.error('worker loop', e)); await busy; if (!stop) setTimeout(tick, everyMs); };
  void tick();
  return async () => { stop = true; await busy; };
}
