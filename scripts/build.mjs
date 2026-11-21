/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : scripts/build.mjs
 * Module           : scripts
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

// Bundle the services into single ESM files (no node_modules needed at runtime). The web app is built by Vite.
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

let commit = process.env.SPD_COMMIT ?? '';
if (!commit) { try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ } }
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
for (const [entry, out] of [['services/api/src/main.ts', 'dist/api.mjs'], ['services/api/src/worker-main.ts', 'dist/worker.mjs'], ['services/api/src/cli.ts', 'dist/cli.mjs'], ['services/api/src/sheet-child.ts', 'dist/sheet-child.mjs'], ['services/api/src/extract-child.ts', 'dist/extract-child.mjs']])
  await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', target: 'node24', format: 'esm', banner, legalComments: 'none', logLevel: 'info',
    define: { 'process.env.SPD_BUILD_COMMIT': JSON.stringify(commit) } });
