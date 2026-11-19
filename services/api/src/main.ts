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
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void (async () => { await app.close(); await stopWorker?.(); await sql.end({ timeout: 5 }); process.exit(0); })(); });
