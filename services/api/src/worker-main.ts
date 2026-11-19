import { migrate, sql } from './db.ts';
import { startWorkerLoop } from './jobs.ts';
import { handlers, heartbeat, housekeeping } from './worker.ts';

await migrate();
const stop = startWorkerLoop(handlers);
const keep = async () => { try { await housekeeping(); } catch (e) { console.error(JSON.stringify({ level: 'error', msg: 'housekeeping failed', error: String((e as Error).message) })); } };
void keep();
const timer = setInterval(keep, 10 * 60_000);
const beat = () => { heartbeat().catch(() => {}); };
beat();
const beatTimer = setInterval(beat, 60_000);
console.log(JSON.stringify({ level: 'info', msg: 'worker started', pid: process.pid }));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void (async () => { clearInterval(timer); clearInterval(beatTimer); await stop(); await sql.end({ timeout: 5 }); process.exit(0); })(); });
