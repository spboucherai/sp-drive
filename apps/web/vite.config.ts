/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/vite.config.ts
 * Module           : web
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

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

// The service worker (src/sw.ts) is bundled on its own into one classic script at the site root, /sw.js: no hash in
// its name (the browser re-checks that URL), scope "/".
const sw = async (minify: boolean, version: string): Promise<string> =>
  (await esbuild({ entryPoints: ['src/sw.ts'], bundle: true, write: false, format: 'iife', target: 'es2020', minify, legalComments: 'none', define: { __SW_VERSION__: JSON.stringify(version) } })).outputFiles[0]!.text;
const serviceWorker = (): Plugin => ({
  name: 'spd-service-worker',
  async generateBundle() { this.emitFile({ type: 'asset', fileName: 'sw.js', source: await sw(true, String(Date.now())) }); },
  configureServer(server) {
    server.middlewares.use('/sw.js', (_req, res) => { void sw(false, 'dev').then((code) => { res.setHeader('content-type', 'text/javascript'); res.setHeader('cache-control', 'no-cache'); res.end(code); }, (e: Error) => { res.statusCode = 500; res.end(e.message); }); });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0, modulePreload: { polyfill: false }, target: 'es2022' },
  server: { port: 5183, proxy: { '/api': 'http://127.0.0.1:8661' } },
});
