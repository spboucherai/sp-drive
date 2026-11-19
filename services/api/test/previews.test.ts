import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { config } from '../src/config.ts';
import { migrate, migrateDown, sql } from '../src/db.ts';
import { runSandboxed, withWorkDir } from '../src/tools.ts';
import { closeAll, signup, work } from './harness.ts';

afterAll(closeAll);
const FX = `${(process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test')}/fixtures`;
let a: Awaited<ReturnType<typeof signup>>;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
beforeAll(async () => {
  a = await signup();
  mkdirSync(FX, { recursive: true });
  writeFileSync(join(FX, 'px.png'), PNG_1PX);
  execFileSync('/usr/bin/sips', ['-z', '300', '400', join(FX, 'px.png'), '--out', join(FX, 'image.png')], { stdio: 'pipe' });
  execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', join(FX, 'image.png'), '--out', join(FX, 'photo.heic')], { stdio: 'pipe' });
  writeFileSync(join(FX, 'lettre.txt'), 'Bonjour SP Drive\nCeci est une lettre.\n');
  execFileSync(config.soffice, ['--headless', `-env:UserInstallation=file://${FX}/lo`, '--convert-to', 'docx:MS Word 2007 XML', '--outdir', FX, join(FX, 'lettre.txt')], { stdio: 'pipe', timeout: 120000 });
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Budget'); s1.addRow(['Poste', 'Montant']); s1.addRow(['Loyer', 1200]); s1.addRow(['Total', { formula: 'B2', result: 1200 }]);
  wb.addWorksheet('Notes').addRow(['Deuxième feuille']);
  await wb.xlsx.writeFile(join(FX, 'budget.xlsx'));
  mkdirSync(join(FX, 'arch/sous'), { recursive: true }); writeFileSync(join(FX, 'arch/sous/a.txt'), 'a'); writeFileSync(join(FX, 'arch/b.txt'), 'bb');
  execFileSync('/usr/bin/tar', ['czf', join(FX, 'arch.tar.gz'), '-C', FX, 'arch']);
  execFileSync('/usr/bin/zip', ['-qr', join(FX, 'arch.zip'), 'arch'], { cwd: FX });
  // a zip-based "document" declaring 400 MB of zeros in a few hundred kilobytes
  const z = new yazl.ZipFile();
  z.addReadStream(Readable.from((function* () { const block = Buffer.alloc(1 << 20); for (let i = 0; i < 400; i++) yield block; })()), 'word/document.xml');
  z.end(); await pipeline(z.outputStream, createWriteStream(join(FX, 'bombe.docx')));
});
const up = async (name: string, data?: Buffer) => (await a.client.upload(a.rootId, name, data ?? readFileSync(join(FX, name)))).body.file;
const preview = (id: string, kind: string) => a.client.get(`/api/v1/files/${id}/preview/${kind}`);

describe('previews and scanning', () => {
  it('answers "pending" until the worker has run, then serves thumbnails and HEIC renditions', async () => {
    const png = await up('image.png'), heic = await up('photo.heic');
    expect((await preview(png.id, 'thumb')).status).toBe(202);
    await work();
    const t = await preview(png.id, 'thumb');
    expect(t.status).toBe(200); expect(t.headers['content-type']).toBe('image/jpeg'); expect(t.raw.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    const full = await preview(heic.id, 'image');
    expect(full.status).toBe(200); expect(full.raw.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect((await a.client.get(`/api/v1/folders/${a.rootId}`)).body.files.find((f: any) => f.id === png.id)).toMatchObject({ thumb: true, scan: 'clean' });
    expect((await preview(png.id, 'nope')).status).toBe(404);
    // derived previews are encrypted at rest like originals
    const [p] = await sql<{ storage_key: string }[]>`select p.storage_key from previews p join file_versions v on v.object_id = p.object_id where v.file_id = ${png.id} and p.kind = 'thumb'`;
    expect(readFileSync(join(config.blobDir, p!.storage_key)).subarray(0, 3).toString('hex')).not.toBe('ffd8ff');
  });
  it('converts office documents to PDF in the sandbox and keeps the original untouched', async () => {
    const original = readFileSync(join(FX, 'lettre.docx'));
    const f = await up('lettre.docx');
    await work();
    const pdf = await preview(f.id, 'pdf');
    expect(pdf.status, JSON.stringify(pdf.body)).toBe(200);
    expect(pdf.raw.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await preview(f.id, 'thumb')).status).toBe(200);
    expect((await a.client.get(`/api/v1/files/${f.id}/content?download=1`)).raw.equals(original)).toBe(true);
    expect((await a.client.get(`/api/v1/files/${f.id}`)).body.previews).toEqual({ pdf: 'ready' });
  });
  it('reports a failed conversion instead of pretending, and refuses archive bombs before opening them', async () => {
    const broken = await up('cassé.docx', randomBytes(5000));
    const bomb = await up('bombe.docx');
    await work();
    const r = await preview(broken.id, 'pdf');
    expect(r.status).toBe(422); expect(r.body.error).toBe('preview_failed'); expect(r.body.message).toBeTruthy();
    const b = await preview(bomb.id, 'pdf');
    expect(b.status).toBe(422); expect(b.body.message).toMatch(/unreasonable size/);
    expect((await a.client.get(`/api/v1/files/${broken.id}/content?download=1`)).status).toBe(200); // the file itself stays available
  });
  it('reads workbooks sheet by sheet in a separate process', async () => {
    const f = await up('budget.xlsx');
    await work();
    const r = await preview(f.id, 'sheet');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.sheets.map((s: any) => s.name)).toEqual(['Budget', 'Notes']);
    expect(r.body.sheets[0].rows).toEqual([['Poste', 'Montant'], ['Loyer', '1200'], ['Total', '1200']]);
  });
  it('inventories ZIP and TAR archives without extracting them', async () => {
    const zip = await up('arch.zip'), tgz = await up('arch.tar.gz');
    await work();
    const z = (await preview(zip.id, 'archive')).body, t = (await preview(tgz.id, 'archive')).body;
    expect(z.entries.filter((e: any) => !e.dir).map((e: any) => `${e.path}:${e.size}`).sort()).toEqual(['arch/b.txt:2', 'arch/sous/a.txt:1']);
    expect(t.entries.filter((e: any) => !e.dir).map((e: any) => `${e.path}:${e.size}`).sort()).toEqual(['arch/b.txt:2', 'arch/sous/a.txt:1']);
    expect(z.suspicious).toBe(false);
    // hostile entry names are displayed inert
    const evil = new yazl.ZipFile(); evil.addBuffer(Buffer.from('x'), 'ok/../../../../etc/passwd'.replace(/\.\.\//g, 'up/')); evil.end();
    const chunks: Buffer[] = []; for await (const c of evil.outputStream) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks); const patched = Buffer.from(raw.toString('latin1').replace(/up\//g, '../'), 'latin1'); // "../" written straight into the archive
    const e = await up('evil.zip', patched);
    await work();
    const l = await preview(e.id, 'archive');
    if (l.status === 200) for (const en of l.body.entries) expect(en.path).not.toMatch(/\.\./); else expect(l.status).toBe(422); // listed safely or refused, never trusted
  });
  it('flags infected uploads of the owner, blocks previews and warns', async () => {
    const f = await up('eicar.txt', Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'));
    await work();
    expect((await a.client.get(`/api/v1/files/${f.id}`)).body.file.scan).toBe('infected');
    expect((await a.client.get(`/api/v1/files/${f.id}/content`)).status).toBe(451);
    expect((await a.client.get(`/api/v1/zip?files=${f.id}`)).status).toBe(400); // left out of archives
    const n = (await a.client.get('/api/v1/notifications')).body.find((x: any) => x.kind === 'scan.infected');
    expect(n.data.signature).toMatch(/eicar/i);
  });
  it('runs converters without network, without the home directory and with a time limit', async () => {
    await withWorkDir(async (work) => {
      const net = await runSandboxed(work, '/usr/bin/curl', ['-s', '-m', '5', '-o', '/dev/null', '-w', '%{http_code}', 'http://127.0.0.1:5432'], { timeoutMs: 15000 });
      expect(net.code).not.toBe(0);
      const key = await runSandboxed(work, '/bin/cat', [config.masterKeyFile], { timeoutMs: 5000 });
      expect(key.code).not.toBe(0); expect(key.stdout).toBe('');
      const home = await runSandboxed(work, '/bin/ls', [`${process.env.HOME}/.ssh`], { timeoutMs: 5000 });
      expect(home.code).not.toBe(0);
      const blobs = await runSandboxed(work, '/bin/ls', [config.blobDir], { timeoutMs: 5000 });
      expect(blobs.code).not.toBe(0);
      const pg = await runSandboxed(work, '/opt/homebrew/opt/postgresql@17/bin/psql', ['-h', '/tmp', '-l'], { timeoutMs: 8000 });
      expect(pg.code).not.toBe(0); // the database's local socket is out of reach too
      const outside = await runSandboxed(work, '/usr/bin/touch', [`${(process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test')}/data/blobs/escape`], { timeoutMs: 5000 });
      expect(outside.code).not.toBe(0);
      expect((await runSandboxed(work, '/usr/bin/touch', [join(work, 'ok')], { timeoutMs: 5000 })).code).toBe(0);
      await expect(runSandboxed(work, '/bin/sleep', ['30'], { timeoutMs: 1000 })).rejects.toThrow(/exceeded/);
    });
  });
});

describe('migrations', () => {
  it('revert and re-apply cleanly', async () => {
    // 002 leaves the first schema intact (the web application alone keeps working on it)
    expect(await migrateDown()).toBe('002_native_clients');
    expect(await sql`select 1 from information_schema.columns where table_name = 'files' and column_name = 'rev'`).toHaveLength(0);
    expect(await sql`select 1 from information_schema.tables where table_name in ('sync_tombstones', 'device_links')`).toHaveLength(0);
    expect(await sql`select 1 from information_schema.tables where table_name = 'files'`).toHaveLength(1);
    expect(await migrateDown()).toBe('001_init');
    expect(await sql`select 1 from information_schema.tables where table_name = 'files'`).toHaveLength(0);
    expect(await migrate()).toEqual(['001_init', '002_native_clients']);
    expect(await sql`select 1 from information_schema.tables where table_name = 'files'`).toHaveLength(1);
    expect(await sql`select 1 from information_schema.columns where table_name = 'files' and column_name = 'rev'`).toHaveLength(1);
  });
});
