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
  /** Apple application identifiers (TEAMID.bundle.id) allowed to use this site's passkeys: served in the apple-app-site-association file */
  /** API contract level and product version announced by GET /api/v1/meta */
  version: '2.0.0',
  /** content index (extracted text in PostgreSQL): on unless SPD_INDEX_CONTENT=off */
  indexContent: process.env.SPD_INDEX_CONTENT !== 'off',
  /** OCR of images and of PDF pages without a text layer (Apple Vision, local): on unless SPD_OCR=off */
  ocr: process.env.SPD_OCR !== 'off',
  /** semantic search (local sentence vectors): 'auto' = on when the helper's model answers its probe */
  semantic: (process.env.SPD_SEMANTIC ?? 'auto') as 'auto' | 'off',
  /** the local text helper (scripts/textkit-build.sh); absent = no PDF text, no OCR, no perceptual hash */
  textkit: process.env.SPD_TEXTKIT ?? join(process.env.SPD_APP_DIR ?? process.cwd(), 'dist/spd-textkit'),
  /** content index limits */
  textMaxBytes: num('SPD_TEXT_MAX_MB', 20) * MIB,
  extractMaxBytes: num('SPD_EXTRACT_MAX_MB', 300) * MIB,
  extractMaxPages: num('SPD_EXTRACT_MAX_PAGES', 500),
  ocrMaxPages: num('SPD_OCR_MAX_PAGES', 60),
  extractMaxChars: num('SPD_EXTRACT_MAX_CHARS', 2_000_000),
  /** an image larger than this many pixels is never decoded (OCR, perceptual hash): a few kilobytes can declare a gigapixel picture */
  imageMaxPixels: num('SPD_IMAGE_MAX_MEGAPIXELS', 120) * 1_000_000,
  /** memory the API process may spend on cached passage vectors (semantic search), all accounts together */
  semanticCacheBytes: num('SPD_SEMANTIC_CACHE_MB', 192) * MIB,
  /** event streams (SSE) the process accepts in all */
  eventsMaxStreams: num('SPD_EVENTS_MAX_STREAMS', 1000),
  /** bytes a member may hold in unfinished uploads on one shared folder (they are reserved on the owner's quota) */
  grantPendingMaxBytes: num('SPD_GRANT_PENDING_GB', 20) * GIB,
  /** doc / rtf read by textutil: smaller cap than PDF, the tool loads the whole document */
  textutilMaxBytes: num('SPD_TEXTUTIL_MAX_MB', 50) * MIB,
  /** wall-clock limit of the Node-side extraction child (text, HTML, office XML) */
  nodeExtractTimeoutMs: num('SPD_NODE_EXTRACT_TIMEOUT_S', 60) * 1000,
  extractTimeoutMs: num('SPD_EXTRACT_TIMEOUT_S', 240) * 1000,
  /** document intelligence: external providers stay off unless SPD_AI_EXTERNAL=on (and the account agrees) */
  aiExternal: process.env.SPD_AI_EXTERNAL === 'on',
  aiEnvFile: process.env.SPD_AI_ENV_FILE ?? join(homedir(), '.config/sp-drive/ai.env'),
  /** where scripts/backup.sh writes its status files (read by the administration view) */
  backupDir: process.env.SPD_BACKUP_DIR ?? join(homedir(), 'backups/sp-drive'),
  /** seconds between two ": ping" comments on the events stream */
  eventsPingMs: num('SPD_EVENTS_PING_S', 25) * 1000,
  appleAppIds: (process.env.SPD_APPLE_APP_IDS ?? '').split(',').map((x) => x.trim()).filter((x) => /^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,155}$/.test(x)),
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
