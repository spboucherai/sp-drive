// External helpers the worker relies on: the antivirus daemon, sandboxed converters, archive inspection.
import { spawn } from 'node:child_process';
import { createReadStream, realpathSync } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import yauzl from 'yauzl';
import { config } from './config.ts';

// --- antivirus (clamd INSTREAM over its Unix socket) -------------------------------------------------------
export type ScanResult = { status: 'clean' } | { status: 'infected'; signature: string } | { status: 'error'; detail: string };
export class ScannerUnavailable extends Error {}
/** Largest stream clamd is configured to accept (StreamMaxLength in infra/clamd.conf). */
export const SCAN_MAX_BYTES = 4000 * 1024 * 1024;

export function clamdPing(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!config.clamdSocket) return resolve(false);
    const s = connect(config.clamdSocket);
    let out = '';
    s.setTimeout(3000, () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false)).on('data', (d) => (out += d)).on('close', () => resolve(out.includes('PONG')));
    s.write('zPING\0');
  });
}
/** Scan a byte stream. Throws ScannerUnavailable when the daemon cannot be reached (callers decide whether that is fatal). */
export function clamdScan(src: Readable, size: number): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    if (!config.clamdSocket) return reject(new ScannerUnavailable('no antivirus configured'));
    if (size > SCAN_MAX_BYTES) return resolve({ status: 'error', detail: 'too_large' });
    const s = connect(config.clamdSocket);
    let out = '', settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; src.destroy(); s.destroy(); fn(); } };
    s.setTimeout(15 * 60_000, () => finish(() => reject(new ScannerUnavailable('antivirus timeout'))));
    s.on('error', (e) => finish(() => reject(new ScannerUnavailable(`antivirus unreachable: ${e.message}`))));
    s.on('data', (d) => (out += d));
    s.on('close', () => finish(() => {
      const reply = out.replace(/\0/g, '').trim();
      const m = /^stream: (.+) FOUND$/.exec(reply);
      if (m) resolve({ status: 'infected', signature: m[1]! });
      else if (reply === 'stream: OK') resolve({ status: 'clean' });
      else if (/size limit exceeded/i.test(reply)) resolve({ status: 'error', detail: 'too_large' });
      else reject(new ScannerUnavailable(`unexpected antivirus reply: ${reply.slice(0, 120)}`));
    }));
    s.on('connect', () => {
      s.write('zINSTREAM\0');
      src.on('data', (chunk: Buffer) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
        if (!s.write(Buffer.concat([len, chunk]))) { src.pause(); s.once('drain', () => src.resume()); }
      });
      src.on('end', () => s.write(Buffer.alloc(4)));
      src.on('error', (e) => finish(() => reject(e)));
    });
  });
}

// --- sandboxed processes -----------------------------------------------------------------------------------
// macOS seatbelt profile: no network, no access to the home directory (keys, database socket, other users' data), writes
// only inside the job's own work directory. The tool sees one decrypted input file and nothing else of the drive.
const sbString = (s: string) => `"${s.replace(/["\\]/g, '\\$&')}"`;
/** Seatbelt matches resolved paths (/tmp is /private/tmp): every path in the profile is made real first. */
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
const profile = (work: string) => {
  const home = sbString(real(homedir())), data = sbString(real(config.dataDir)), w = sbString(real(work)), app = sbString(real(config.appDir));
  const keyDir = sbString(real(dirname(config.masterKeyFile))), key = sbString(real(config.masterKeyFile));
  // no network at all, except LibreOffice's own instance pipe (a Unix socket named OSL_PIPE_*): the database and antivirus sockets stay out of reach
  return `(version 1)(allow default)(deny network*)
(allow network* (local unix-socket (regex #"^/private/tmp/OSL_PIPE_")))(allow network* (remote unix-socket (regex #"^/private/tmp/OSL_PIPE_")))
(deny file-read* file-write* (subpath ${home}) (subpath ${data}) (literal ${key}))
(deny file-write*)(allow file-write* (subpath ${w}) (subpath "/dev") (subpath "/private/var/folders") (subpath "/private/tmp"))
(deny file-write* (subpath ${data}) (subpath ${keyDir}))
(allow file-read* file-write* (subpath ${w}))
(allow file-read* (subpath ${app}))
(allow file-read-metadata (subpath ${home}) (subpath ${data}))
(deny file-read* file-write* (literal ${key}))`;
};

export class ToolError extends Error { constructor(public code: string, message: string) { super(message); } }
export interface RunResult { code: number | null; stdout: string; stderr: string }
/** Run a tool under the sandbox with wall-clock and CPU limits; the whole process group is killed on timeout. */
export function runSandboxed(work: string, cmd: string, args: string[], o: { timeoutMs?: number; cpuS?: number; env?: Record<string, string> } = {}): Promise<RunResult> {
  const timeoutMs = o.timeoutMs ?? config.convertTimeoutMs;
  const sh = `ulimit -t ${o.cpuS ?? Math.ceil(timeoutMs / 1000) * 2}; ulimit -c 0; exec "$@"`;
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile(work), '/bin/sh', '-c', sh, 'sh', cmd, ...args], {
      cwd: work, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin', HOME: work, TMPDIR: work, LANG: 'en_US.UTF-8', ...o.env },
    });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', (d) => { if (stdout.length < 65536) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 65536) stderr += d; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* no stragglers */ }
      if (timedOut) reject(new ToolError('timeout', `conversion exceeded ${Math.round(timeoutMs / 1000)} s`)); else resolve({ code, stdout, stderr });
    });
  });
}
export async function withWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = join(config.workDir, `job-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const exists = (p: string) => stat(p).then((s) => s.size > 0, () => false);

/** JPEG rendition of an image or of a PDF's first page, longest side `max` pixels (macOS sips). */
export async function sipsJpeg(work: string, input: string, output: string, max: number): Promise<void> {
  const r = await runSandboxed(work, '/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', String(max), input, '--out', output], { timeoutMs: 60_000 });
  if (r.code !== 0 || !(await exists(output))) throw new ToolError('convert_failed', `image conversion failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
}
/** Office document → PDF with LibreOffice: throw-away profile inside the work directory, macros never run headless. */
export async function officeToPdf(work: string, input: string): Promise<string> {
  if (!(await exists(config.soffice))) throw new ToolError('converter_missing', 'the document converter is not installed');
  const r = await runSandboxed(work, config.soffice, [`-env:UserInstallation=file://${join(work, 'lo-profile')}`, '--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard',
    '--convert-to', 'pdf', '--outdir', join(work, 'out'), input]);
  const out = join(work, 'out', `${input.split('/').pop()!.replace(/\.[^.]*$/, '')}.pdf`);
  if (!(await exists(out))) throw new ToolError('convert_failed', `document conversion failed: ${(r.stderr || r.stdout).trim().slice(0, 200) || `exit ${r.code}`}`);
  return out;
}
/** One video frame as JPEG (ffmpeg, when installed). */
export async function videoFrame(work: string, input: string, output: string): Promise<boolean> {
  const ffmpeg = '/opt/homebrew/bin/ffmpeg';
  if (!(await exists(ffmpeg))) return false;
  const r = await runSandboxed(work, ffmpeg, ['-nostdin', '-loglevel', 'error', '-ss', '1', '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-y', output], { timeoutMs: 60_000 });
  return r.code === 0 && exists(output);
}

// --- archives: inventory only, never extraction ------------------------------------------------------------
export interface ArchiveEntry { path: string; size: number; dir: boolean }
export interface ArchiveListing { format: 'zip' | 'tar'; entries: ArchiveEntry[]; totalEntries: number; totalBytes: number; truncated: boolean; suspicious: boolean }
const MAX_LIST = 5000;
/** Display form of an entry name: no control characters, no absolute or parent-relative paths. */
const cleanPath = (p: string) => p.replace(/[\u0000-\u001f\u007f]/g, '?').split(/[/\\]+/).filter((s) => s && s !== '.' && s !== '..').join('/').slice(0, 500);

/** Read a ZIP central directory. Sizes are the declared uncompressed sizes; nothing is inflated. */
export function listZip(path: string): Promise<ArchiveListing & { compressedBytes: number }> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: false, decodeStrings: true }, (err, zip) => {
      if (err || !zip) return reject(new ToolError('bad_archive', `unreadable archive: ${err?.message ?? 'unknown'}`));
      const out = { format: 'zip' as const, entries: [] as ArchiveEntry[], totalEntries: 0, totalBytes: 0, compressedBytes: 0, truncated: false, suspicious: false };
      zip.on('entry', (e: yauzl.Entry) => {
        out.totalEntries++; out.totalBytes += e.uncompressedSize; out.compressedBytes += e.compressedSize;
        if (out.entries.length < MAX_LIST) out.entries.push({ path: cleanPath(e.fileName), size: e.uncompressedSize, dir: /\/$/.test(e.fileName) }); else out.truncated = true;
        if (out.totalEntries > 200_000) { zip.close(); out.truncated = true; out.suspicious = true; return resolve(out); }
        zip.readEntry();
      });
      zip.on('end', () => { out.suspicious ||= isBomb(out.totalBytes, out.compressedBytes, out.totalEntries); resolve(out); });
      zip.on('error', (e) => reject(new ToolError('bad_archive', `unreadable archive: ${e.message}`)));
      zip.readEntry();
    });
  });
}
/** Declared expansion that no honest document needs. */
export const isBomb = (totalBytes: number, compressedBytes: number, entries: number) =>
  totalBytes > 2 * 1024 ** 3 || entries > 20000 || (totalBytes > 100 * 1024 ** 2 && totalBytes / Math.max(1, compressedBytes) > 150);
/** Zip-based documents (docx, xlsx, pptx…) are refused before any parser touches them when they look like a bomb. */
export async function assertNotBomb(path: string): Promise<void> {
  const z = await listZip(path);
  if (z.suspicious) throw new ToolError('archive_bomb', 'this document expands to an unreasonable size and was not opened');
}
/** Read TAR headers (optionally through gzip), stopping at hard caps on entries, inflated bytes and time. */
export function listTar(path: string, gzip: boolean): Promise<ArchiveListing> {
  return new Promise((resolve, reject) => {
    const out: ArchiveListing = { format: 'tar', entries: [], totalEntries: 0, totalBytes: 0, truncated: false, suspicious: false };
    const src = createReadStream(path), gz = gzip ? createGunzip() : null, ex = tar.extract();
    let inflated = 0, done = false;
    const stop = (truncated: boolean, err?: Error) => {
      if (done) return; done = true; clearTimeout(timer);
      src.destroy(); gz?.destroy(); ex.destroy();
      if (err && !out.entries.length) reject(new ToolError('bad_archive', `unreadable archive: ${err.message}`)); else { out.truncated ||= truncated || !!err; resolve(out); }
    };
    const timer = setTimeout(() => stop(true), 20_000);
    gz?.on('data', (d: Buffer) => { inflated += d.length; if (inflated > 1024 ** 3) { out.suspicious = true; stop(true); } });
    ex.on('entry', (h, stream, next) => {
      out.totalEntries++; out.totalBytes += h.size ?? 0;
      if (out.entries.length < MAX_LIST) out.entries.push({ path: cleanPath(h.name), size: h.size ?? 0, dir: h.type === 'directory' });
      else return stop(true);
      stream.on('end', next); stream.resume();
    });
    ex.on('finish', () => stop(false)); ex.on('error', (e) => stop(false, e)); src.on('error', (e) => stop(false, e)); gz?.on('error', (e) => stop(false, e));
    (gz ? src.pipe(gz) : src).pipe(ex);
  });
}

// --- spreadsheets ------------------------------------------------------------------------------------------
import type { SheetPreview } from './tools-sheet.ts';
export type { SheetPreview };
/**
 * XLSX → values per sheet, capped. Runs in a child Node process with a bounded heap so a hostile workbook can only
 * kill that child. Formulas are shown by their cached result; nothing is evaluated.
 */
export async function sheetPreview(work: string, input: string): Promise<SheetPreview> {
  await assertNotBomb(input);
  const out = join(work, 'sheet.json');
  // production: the bundled child next to the worker bundle; development and tests: the TypeScript source through tsx
  const self = fileURLToPath(import.meta.url);
  const child = self.endsWith('.ts') ? ['--import', import.meta.resolve('tsx'), join(dirname(self), 'sheet-child.ts')] : [join(dirname(self), 'sheet-child.mjs')];
  const r = await runSandboxed(work, process.execPath, ['--max-old-space-size=768', ...child, input, out], { timeoutMs: 60_000 });
  if (r.code !== 0 || !(await exists(out))) throw new ToolError('convert_failed', `the workbook could not be read: ${r.stderr.trim().split('\n').pop()?.slice(0, 200) ?? `exit ${r.code}`}`);
  return JSON.parse(await readFile(out, 'utf8')) as SheetPreview;
}
