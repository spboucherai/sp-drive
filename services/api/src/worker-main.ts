/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/worker-main.ts
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
