import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const env = (k: string, d?: string) => { const v = process.env[k] ?? d; if (v === undefined || v === '') throw new Error(`missing env ${k}`); return v; };
const num = (k: string, d: number) => { const v = Number(process.env[k] ?? d); if (!Number.isFinite(v)) throw new Error(`bad env ${k}`); return v; };
const GIB = 1024 ** 3, MIB = 1024 ** 2;

const dataDir = env('SPD_DATA_DIR', join(homedir(), 'sp-drive-data'));
export const config = {
  origin: env('SPD_ORIGIN'),
  rpId: env('SPD_RP_ID'),
  port: num('PORT', 8660),
  host: env('HOST', '127.0.0.1'),
  databaseUrl: env('DATABASE_URL'),
  trustProxy: (process.env.SPD_TRUST_PROXY ?? '127.0.0.1').split(',').map((x) => x.trim()),
  webDir: process.env.SPD_WEB_DIR ?? '',
  dataDir,
  blobDir: join(dataDir, 'blobs'),
  tmpDir: join(dataDir, 'tmp'),
  quarantineDir: join(dataDir, 'quarantine'),
  workDir: join(dataDir, 'work'),
  /** where the code lives (readable by sandboxed helpers; holds no secret) */
  appDir: env('SPD_APP_DIR', process.cwd()),
  masterKeyFile: env('SPD_MASTER_KEY_FILE', join(homedir(), '.config/sp-drive/master.key')),
  /** default quota of a new account */
  defaultQuotaBytes: num('SPD_DEFAULT_QUOTA_GB', 100) * GIB,
  maxFileBytes: num('SPD_MAX_FILE_GB', 50) * GIB,
  /** clamd Unix socket; empty = no antivirus available */
  clamdSocket: process.env.SPD_CLAMD_SOCKET ?? '',
  /** 'required': portal deposits stay in quarantine when the scanner is unavailable; 'optional': dev/test only */
  avMode: env('SPD_AV_MODE', 'required') as 'required' | 'optional',
  soffice: process.env.SPD_SOFFICE ?? '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  /** preview limits */
  officeMaxBytes: num('SPD_OFFICE_MAX_MB', 100) * MIB,
  sheetMaxBytes: num('SPD_SHEET_MAX_MB', 30) * MIB,
  convertTimeoutMs: num('SPD_CONVERT_TIMEOUT_S', 90) * 1000,
  /** test hook: run the job loop inside the API process */
  inlineWorker: process.env.SPD_INLINE_WORKER === 'on',
  commit: process.env.SPD_COMMIT ?? '',
};
export const secureCookies = config.origin.startsWith('https://');
for (const d of [config.blobDir, config.tmpDir, config.quarantineDir, config.workDir]) mkdirSync(d, { recursive: true, mode: 0o700 });

/** 32-byte master key, hex or base64 in a file outside the repository. */
export function loadMasterKey(): Buffer {
  const raw = readFileSync(config.masterKeyFile, 'utf8').trim();
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('master key must be 32 bytes');
  return key;
}

/** An error whose message is safe to show to the caller. `code` is stable and drives the UI translation. */
export class UserError extends Error {
  constructor(public code: string, message: string, public status = 400, public extra: Record<string, unknown> = {}) { super(message); }
}
export const notFound = (what = 'not found') => new UserError('not_found', what, 404);
