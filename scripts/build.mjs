// Bundle the services into single ESM files (no node_modules needed at runtime). The web app is built by Vite.
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

let commit = process.env.SPD_COMMIT ?? '';
if (!commit) { try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ } }
const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
for (const [entry, out] of [['services/api/src/main.ts', 'dist/api.mjs'], ['services/api/src/worker-main.ts', 'dist/worker.mjs'], ['services/api/src/cli.ts', 'dist/cli.mjs'], ['services/api/src/sheet-child.ts', 'dist/sheet-child.mjs']])
  await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', target: 'node24', format: 'esm', banner, legalComments: 'none', logLevel: 'info',
    define: { 'process.env.SPD_BUILD_COMMIT': JSON.stringify(commit) } });
