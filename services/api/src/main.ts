/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/main.ts
 * Module           : services
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
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
