import { defineConfig } from 'vitest/config';

// The integration suites run against a real PostgreSQL database, a real data directory and (when its signature
// database is present) a real clamd — see services/api/test/global-setup.ts. One file at a time: they share them.
// SPD_TEST_DB / SPD_TEST_ROOT let two checkouts on one machine run their suites at the same time; the name must end in _test.
const ROOT = process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test';
const DB = process.env.SPD_TEST_DB ?? 'sp_drive_test';
if (!/^[a-z0-9_]+_test$/.test(DB)) throw new Error(`refusing to run the tests against database "${DB}": its name must end in _test`);
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts'], testTimeout: 120000, hookTimeout: 180000, fileParallelism: false,
    globalSetup: ['services/api/test/global-setup.ts'],
    env: {
      DATABASE_URL: `postgres://127.0.0.1/${DB}`, SPD_ORIGIN: 'http://localhost:8661', SPD_RP_ID: 'localhost', SPD_DATA_DIR: `${ROOT}/data`, SPD_MASTER_KEY_FILE: `${ROOT}/master.key`,
      SPD_CLAMD_SOCKET: `${ROOT}/clamd.sock`, SPD_AV_MODE: 'required', SPD_DEFAULT_QUOTA_GB: '1', SPD_APP_DIR: process.cwd(), SPD_CONVERT_TIMEOUT_S: '120',
    },
  },
});
