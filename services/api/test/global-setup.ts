import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test';
const DB = process.env.SPD_TEST_DB ?? 'sp_drive_test';
const CLAM_DB = process.env.SPD_TEST_CLAMAV_DB ?? join(homedir(), '.cache/sp-drive-clamav');
let clamd: ChildProcess | undefined;

export async function setup(): Promise<void> {
  if (!/^[a-z0-9_]+_test$/.test(DB) || !/^\/tmp\/[a-z0-9-]+$/.test(ROOT)) throw new Error(`refusing to reset database "${DB}" / directory "${ROOT}"`);
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(ROOT, 'data'), { recursive: true });
  writeFileSync(join(ROOT, 'master.key'), `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  const pg = (bin: string, ...args: string[]) => execFileSync(existsSync(`/opt/homebrew/opt/postgresql@17/bin/${bin}`) ? `/opt/homebrew/opt/postgresql@17/bin/${bin}` : bin, ['-h', '127.0.0.1', ...args], { stdio: 'pipe' });
  pg('dropdb', '--if-exists', DB);
  pg('createdb', DB);
  // the local text helper (PDF text, OCR, perceptual hash, sentence vectors): compiled once, then only when its source changes
  try { execFileSync('/bin/zsh', ['scripts/textkit-build.sh'], { stdio: 'pipe', timeout: 240_000 }); } catch { /* the suites that need it fail loudly */ }
  // a real antivirus daemon when its signatures are available (brew install clamav + freshclam); otherwise the AV tests fail loudly
  if (existsSync(join(CLAM_DB, 'main.cvd')) || existsSync(join(CLAM_DB, 'main.cld'))) {
    const conf = join(ROOT, 'clamd.conf');
    writeFileSync(conf, `LocalSocket ${ROOT}/clamd.sock\nDatabaseDirectory ${CLAM_DB}\nForeground yes\nStreamMaxLength 4000M\nMaxFileSize 2000M\nMaxScanSize 4000M\nLogFile ${ROOT}/clamd.log\n`);
    clamd = spawn('/opt/homebrew/sbin/clamd', ['-c', conf], { stdio: 'ignore' });
    const t0 = Date.now();
    while (!existsSync(`${ROOT}/clamd.sock`)) { if (Date.now() - t0 > 150_000) throw new Error('clamd did not start'); await new Promise((r) => setTimeout(r, 500)); }
  }
}
export async function teardown(): Promise<void> { clamd?.kill('SIGTERM'); }
