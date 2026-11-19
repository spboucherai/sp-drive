import { config } from './config.ts';
import { migrate, sql } from './db.ts';
import { startWorkerLoop } from './jobs.ts';
import { buildServer } from './server.ts';
import { handlers, heartbeat } from './worker.ts';

const applied = await migrate();
if (applied.length) console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', applied }));
const app = await buildServer();
const stopWorker = config.inlineWorker ? startWorkerLoop(handlers, 500) : null;
if (config.inlineWorker) { const beat = () => { heartbeat().catch(() => {}); }; beat(); setInterval(beat, 60_000).unref(); }
await app.listen({ port: config.port, host: config.host });
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => {
  if (stopping) return; // a second signal changes nothing: the shutdown below is already on its way
  stopping = true;
  // whatever a clean shutdown is still waiting for after 10 s, the process leaves (the supervisor would kill it anyway)
  setTimeout(() => process.exit(0), 10_000).unref();
  void (async () => { await app.close(); await stopWorker?.(); await sql.end({ timeout: 5 }); process.exit(0); })().catch(() => process.exit(1));
});
