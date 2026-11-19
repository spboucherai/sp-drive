// 2.0: the administration view (worker heartbeat, job queue, failures, converter, signatures, backup status) and
// the backup scripts' status files.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.ts';
import { sql } from '../src/db.ts';
import { heartbeat } from '../src/worker.ts';
import { closeAll, signup, work } from './harness.ts';

afterAll(closeAll);
const ROOT = process.env.SPD_TEST_ROOT ?? '/tmp/sp-drive-test';

describe('administration view', () => {
  it('is for administrators only and reports the machine room', async () => {
    const admin = await signup({ role: 'admin' }), user = await signup();
    expect((await user.client.get('/api/v1/admin/system')).status).toBe(404);
    config.backupDir = join(ROOT, 'no-backups-here');
    await sql`delete from system_state`;
    let s = (await admin.client.get('/api/v1/admin/system')).body;
    // the 1.0 fields are still there
    expect(s).toMatchObject({ db: true, antivirus: true, avMode: 'required', counts: { users: expect.any(Number) } });
    expect(s).toMatchObject({ version: '2.0.0', worker: { alive: false, heartbeatAgeS: null }, backup: { last: null, restoreTest: null, verify: null, offNode: null } });
    expect(s.features).toContain('events');
    // a worker publishes what it can do
    await heartbeat();
    const [waiting] = await sql<{ n: number }[]>`select count(*)::int as n from jobs where kind = 'scan_object' and status = 'queued'`; // other suites may have left some
    await admin.client.upload(admin.rootId, 'cassé.pdf', Buffer.from('%PDF-1.4 not a pdf'));
    await admin.client.upload(admin.rootId, 'bon.txt', Buffer.from('bonjour'));
    await sql`insert into jobs (kind, payload, status, attempts, last_error, finished_at) values ('preview', '{}', 'failed', 3, 'boom', now())`;
    s = (await admin.client.get('/api/v1/admin/system')).body;
    expect(s.worker).toMatchObject({ alive: true, pid: process.pid }); expect(s.worker.heartbeatAgeS).toBeLessThan(10);
    expect(s.converter).toMatchObject({ available: expect.any(Boolean), path: config.soffice });
    expect(s.textkit).toMatchObject({ available: true });
    expect(s.antivirusSignatures).toMatchObject({ engine: expect.stringMatching(/^\d+\.\d+/), signatures: expect.any(Number), signaturesAt: expect.any(String), ageS: expect.any(Number) });
    expect(s.jobs).toContainEqual({ kind: 'preview', status: 'failed', count: expect.any(Number), oldestAgeS: null });
    const queued = s.jobs.find((j: any) => j.kind === 'scan_object' && j.status === 'queued');
    expect(queued).toMatchObject({ count: waiting!.n + 2 }); expect(queued.oldestAgeS).toBeGreaterThanOrEqual(0);
    await work();
    s = (await admin.client.get('/api/v1/admin/system')).body;
    expect(s.jobs.find((j: any) => j.status === 'queued')).toBeUndefined();
    expect(s.previewFailures).toContainEqual({ kind: 'thumb', count: expect.any(Number), lastError: expect.any(String) });
    expect(s.index).toMatchObject({ enabled: true, ocr: true, semantic: { available: expect.any(Boolean) } }); expect(s.index.byStatus.ready).toBeGreaterThan(0);
    expect(s.events).toEqual({ owners: expect.any(Number), streams: expect.any(Number), timers: expect.any(Number) });
    // a heartbeat that stops is noticed
    await sql`update system_state set updated_at = now() - interval '10 minutes' where key = 'worker'`;
    expect((await admin.client.get('/api/v1/admin/system')).body.worker).toMatchObject({ alive: false, heartbeatAgeS: expect.any(Number) });
    expect(JSON.stringify(s)).not.toMatch(/master\.key|token/i);
  });

  it('backup.sh writes a status and a manifest; backup-verify.sh checks the set; the API reports both', async () => {
    const admin = await signup({ role: 'admin' });
    await admin.client.upload(admin.rootId, 'à sauvegarder.txt', Buffer.from('contenu précieux'));
    const out = join(ROOT, 'backup-out');
    const env = { ...process.env, SPD_BACKUP_DIR: out, DATABASE_URL: config.databaseUrl, SPD_DATA_DIR: config.dataDir, SPD_MASTER_KEY_FILE: config.masterKeyFile };
    execFileSync('/bin/zsh', ['scripts/backup.sh'], { env, stdio: 'pipe' });
    const status = JSON.parse(readFileSync(join(out, 'status.json'), 'utf8'));
    expect(status).toMatchObject({ ok: true, dump: expect.stringMatching(/^sp-drive-\d{8}-\d{4}\.dump\.enc$/), remote: null });
    expect(status.dumpBytes).toBeGreaterThan(1000); expect(status.dumpSha256).toMatch(/^[0-9a-f]{64}$/); expect(status.blobs).toBeGreaterThan(0);
    const manifest = readFileSync(join(out, 'manifest.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
    expect(manifest).toHaveLength(status.blobs);
    expect(manifest.every(([p, size, h]) => /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f-]{36}$/.test(p!) && Number(size) > 0 && /^[0-9a-f]{64}$/.test(h!))).toBe(true);
    expect(readFileSync(join(out, 'db', status.dump)).includes(Buffer.from('PGDMP'))).toBe(false); // the dump is sealed
    expect(readdirSync(out).some((n) => /key/i.test(n))).toBe(false); // the master key is never in the set
    // a second run only hashes what is new
    await admin.client.upload(admin.rootId, 'autre.txt', Buffer.from('autre contenu'));
    execFileSync('/bin/zsh', ['scripts/backup.sh'], { env, stdio: 'pipe' });
    expect(readFileSync(join(out, 'manifest.tsv'), 'utf8').trim().split('\n')).toHaveLength(status.blobs + 1);
    const verify = (args: string[] = []) => { try { return { code: 0, out: execFileSync('/bin/zsh', ['scripts/backup-verify.sh', out, ...args], { env, stdio: 'pipe' }).toString() }; } catch (e: any) { return { code: e.status as number, out: String(e.stdout) }; } };
    let v = verify(['--sample', '10']);
    expect(v.code, v.out).toBe(0); expect(v.out).toContain('BACKUP VERIFY OK');
    expect(JSON.parse(readFileSync(join(out, 'verify.json'), 'utf8'))).toMatchObject({ ok: true, dumpChecked: true, dumpDecrypted: true, mismatched: 0, missing: 0, errors: [] });
    // an off-node copy has no key: the same script, told so, writes offnode.json
    v = verify(['--no-key', '--write', 'offnode.json', '--label', 'M4M64c']);
    expect(v.code, v.out).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'offnode.json'), 'utf8'))).toMatchObject({ ok: true, host: 'M4M64c', dumpDecrypted: false });
    config.backupDir = out;
    const b = (await admin.client.get('/api/v1/admin/system')).body.backup;
    expect(b.last).toMatchObject({ ok: true, dump: expect.any(String), ageS: expect.any(Number) }); expect(b.last.ageS).toBeLessThan(120);
    expect(b.verify).toMatchObject({ ok: true }); expect(b.offNode).toMatchObject({ ok: true, host: 'M4M64c' }); expect(b.restoreTest).toBeNull();
    // damage is detected: a corrupted object, then a corrupted dump
    const victim = join(out, 'blobs', manifest[0]![0]!);
    const raw = readFileSync(victim); raw[0] = raw[0]! ^ 0xff; writeFileSync(victim, raw);
    v = verify(['--sample', '500']);
    expect(v.code).toBe(1); expect(v.out).toContain('do not match the manifest');
    expect((await admin.client.get('/api/v1/admin/system')).body.backup.verify).toMatchObject({ ok: false, mismatched: 1 });
    raw[0] = raw[0]! ^ 0xff; writeFileSync(victim, raw);
    const dump = join(out, 'db', JSON.parse(readFileSync(join(out, 'status.json'), 'utf8')).dump);
    writeFileSync(dump, Buffer.concat([readFileSync(dump).subarray(0, 200), Buffer.from('garbage')]));
    v = verify();
    expect(v.code).toBe(1); expect(v.out).toMatch(/does not hash to what the backup recorded/);
    expect(existsSync(join(out, 'db'))).toBe(true); mkdirSync(join(ROOT, 'x'), { recursive: true });
  });
});
