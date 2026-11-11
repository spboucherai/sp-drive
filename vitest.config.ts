import { defineConfig } from 'vitest/config';

// The integration suites run against a real PostgreSQL database, a real data directory and (when its signature
// database is present) a real clamd — see services/api/test/global-setup.ts. One file at a time: they share them.
const ROOT = '/tmp/sp-drive-test';
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts'], testTimeout: 120000, hookTimeout: 180000, fileParallelism: false,
    globalSetup: ['services/api/test/global-setup.ts'],
    env: {
      DATABASE_URL: 'postgres://127.0.0.1/sp_drive_test', SPD_ORIGIN: 'http://localhost:8661', SPD_RP_ID: 'localhost', SPD_DATA_DIR: `${ROOT}/data`, SPD_MASTER_KEY_FILE: `${ROOT}/master.key`,
      SPD_CLAMD_SOCKET: `${ROOT}/clamd.sock`, SPD_AV_MODE: 'required', SPD_DEFAULT_QUOTA_GB: '1', SPD_APP_DIR: process.cwd(), SPD_CONVERT_TIMEOUT_S: '120',
    },
  },
});
