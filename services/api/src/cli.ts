// Operator commands, run on the node: node dist/cli.mjs <command>
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInvite } from './auth.ts';
import { driver, masterKey } from './blob.ts';
import { config } from './config.ts';
import { unwrapKey, wrapKey } from './crypto.ts';
import { migrate, migrateDown, MIGRATIONS, sql } from './db.ts';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const commands: Record<string, () => Promise<void>> = {
  /** Create the master key file if it does not exist. Back it up: without it stored files cannot be read. */
  async 'init-key'() {
    if (existsSync(config.masterKeyFile)) { console.log(`master key already present: ${config.masterKeyFile}`); return; }
    mkdirSync(dirname(config.masterKeyFile), { recursive: true, mode: 0o700 });
    writeFileSync(config.masterKeyFile, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    console.log(`master key created: ${config.masterKeyFile} — copy it to a safe place now`);
  },
  async migrate() { const a = await migrate(); console.log(a.length ? `applied: ${a.join(', ')}` : 'schema up to date'); },
  async 'migrate-status'() { const rows = await sql<{ id: string }[]>`select id from schema_migrations order by id`.catch(() => []); console.log(`applied: ${rows.map((r) => r.id).join(', ') || 'none'} / known: ${MIGRATIONS.map((m) => m.id).join(', ')}`); },
  /** Reverts the latest migration and DROPS its tables. Requires --yes-drop-data. */
  async 'migrate-down'() {
    if (!args.includes('--yes-drop-data')) { console.error('refused: this drops the tables of the latest migration; add --yes-drop-data after taking a backup'); process.exitCode = 2; return; }
    console.log(`reverted: ${(await migrateDown()) ?? 'nothing'}`);
  },
  /** One-time invitation link (first administrator, or a locked-out owner). */
  async invite() {
    const email = flag('email');
    if (!email) { console.error('usage: invite --email <address> [--admin] [--quota-gb <n>]'); process.exitCode = 2; return; }
    await migrate();
    const [taken] = await sql`select 1 from users where email = ${email}`;
    if (taken) { console.error('an account already uses this address'); process.exitCode = 1; return; }
    const q = flag('quota-gb');
    const inv = await createInvite(sql, { email, role: args.includes('--admin') ? 'admin' : 'user', quotaBytes: q ? Number(q) * 1024 ** 3 : undefined });
    console.log(`${config.origin}/invite/${inv.token}`);
  },
  /** Emergency: new recovery path for an existing account whose passkeys and codes are all lost. Revokes its sessions. */
  async 'reset-access'() {
    const email = flag('email');
    const [u] = await sql<{ id: string }[]>`select id from users where email = ${email ?? ''}`;
    if (!u) { console.error('unknown account'); process.exitCode = 1; return; }
    const code = `${randomBytes(10).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')}`;
    const { sha256hex } = await import('./crypto.ts');
    await sql.begin(async (t) => {
      await t`update sessions set revoked_at = now() where user_id = ${u.id} and revoked_at is null`;
      await t`delete from recovery_codes where user_id = ${u.id}`;
      await t`update users set totp_secret = null, totp_enabled_at = null, totp_last_step = null where id = ${u.id}`;
      await t`insert into recovery_codes (user_id, code_hash) values (${u.id}, ${sha256hex(`spd-recovery-v1:${code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`)})`;
      await t`insert into audit_events (actor_kind, owner_id, action) values ('system', ${u.id}, 'account.access_reset')`;
    });
    console.log(`one recovery code for ${email}: ${code}`);
  },
  /** Re-wrap every data key under a new master key (files are not rewritten). The new key file replaces the old one after success. */
  async 'rotate-master-key'() {
    const next = randomBytes(32), old = masterKey();
    const nextFile = `${config.masterKeyFile}.next`;
    writeFileSync(nextFile, `${next.toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    let n = 0;
    await sql.begin(async (t) => {
      for (const table of ['storage_objects', 'previews'] as const) {
        const rows = table === 'storage_objects' ? await t<{ k: string; wrapped_key: Buffer }[]>`select id::text as k, wrapped_key from storage_objects for update`
          : await t<{ k: string; wrapped_key: Buffer }[]>`select object_id::text || '|' || kind as k, wrapped_key from previews where wrapped_key is not null for update`;
        for (const r of rows) {
          const w = wrapKey(next, unwrapKey(old, Buffer.from(r.wrapped_key)));
          if (table === 'storage_objects') await t`update storage_objects set wrapped_key = ${w} where id = ${r.k}`;
          else { const [id, kind] = r.k.split('|'); await t`update previews set wrapped_key = ${w} where object_id = ${id!} and kind = ${kind!}`; }
          n++;
        }
      }
      const totp = await t<{ id: string; totp_secret: Buffer }[]>`select id, totp_secret from users where totp_secret is not null for update`;
      const { seal, unseal } = await import('./crypto.ts');
      for (const u of totp) await t`update users set totp_secret = ${seal(next, unseal(old, Buffer.from(u.totp_secret), `totp:${u.id}`), `totp:${u.id}`)} where id = ${u.id}`;
    });
    const { renameSync, copyFileSync } = await import('node:fs');
    copyFileSync(config.masterKeyFile, `${config.masterKeyFile}.previous`); renameSync(nextFile, config.masterKeyFile);
    console.log(`${n} keys re-wrapped. New key: ${config.masterKeyFile} (previous kept as .previous). Restart sp-drive and sp-drive-worker, back up the new key, sessions for open share links are reset.`);
  },
  /** Check that every object's blob exists and decrypts (first block). --deep reads everything and re-hashes. */
  async verify() {
    const { readSealed } = await import('./blob.ts');
    const { createHash } = await import('node:crypto');
    const rows = await sql<{ id: string; storage_key: string; wrapped_key: Buffer; size: string; sha256: string }[]>`select id, storage_key, wrapped_key, size::text, sha256 from storage_objects order by created_at`;
    let bad = 0;
    for (const o of rows) {
      try {
        if (!(await driver.exists(o.storage_key))) throw new Error('missing blob');
        const size = Number(o.size);
        const h = createHash('sha256');
        for await (const c of readSealed({ ...o, size }, 0, args.includes('--deep') ? size - 1 : Math.min(size, 65536) - 1)) h.update(c as Buffer);
        if (args.includes('--deep') && h.digest('hex') !== o.sha256) throw new Error('content hash mismatch');
      } catch (e) { bad++; console.error(`${o.id}: ${(e as Error).message}`); }
    }
    console.log(`${rows.length} objects checked, ${bad} damaged`);
    if (bad) process.exitCode = 1;
  },
};
const run = commands[cmd ?? ''];
if (!run) { console.error(`commands: ${Object.keys(commands).join(', ')}`); process.exit(2); }
await run();
await sql.end({ timeout: 5 });
