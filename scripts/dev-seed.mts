// Development only: two accounts with bearer tokens and a little content, for the web and native teams.
//   alice (administrator) owns a small tree; bob is a viewer of one of her folders and an uploader of another.
// Refuses to run against anything that looks like production (relying-party id other than localhost, database sp_drive).
// Usage (through scripts/next-dev.sh seed): tsx scripts/dev-seed.mts <base-url> <tokens.json>
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { config } from '../services/api/src/config.ts';
import { newToken, tokenHash } from '../services/api/src/crypto.ts';
import { migrate, sql } from '../services/api/src/db.ts';
import { pdfWithText } from '../services/api/test/harness-pdf.ts';

const [base, out] = process.argv.slice(2);
if (!base || !out) { console.error('usage: dev-seed.mts <base-url> <tokens.json>'); process.exit(2); }
if (config.rpId !== 'localhost' || /\/sp_drive(\?|$)/.test(config.databaseUrl)) { console.error('refused: this is not a development environment'); process.exit(2); }
await migrate();

async function account(email: string, name: string, role: 'admin' | 'user'): Promise<{ id: string; token: string }> {
  let [u] = await sql<{ id: string }[]>`select id from users where email = ${email}`;
  if (!u) {
    [u] = await sql<{ id: string }[]>`insert into users (email, display_name, role, webauthn_handle) values (${email}, ${name}, ${role}, ${randomBytes(32)}) returning id`;
    await sql`insert into quotas (user_id, limit_bytes) values (${u!.id}, ${5 * 1024 ** 3})`;
    await sql`insert into folders (owner_id, parent_id, name, name_key) values (${u!.id}, null, '', '')`;
  }
  const token = newToken();
  await sql`insert into sessions (user_id, token_hash, method, kind, device_name, expires_at, reauth_at, ip, user_agent, client_platform, client_version, client_os)
    values (${u!.id}, ${tokenHash(token)}, 'passkey', 'device', 'Jeton de développement', now() + interval '400 days', now(), '127.0.0.1', 'dev-seed', 'macos', '2.0.0-dev', 'dev')`;
  return { id: u!.id, token };
}
const call = async (token: string, method: string, path: string, body?: unknown) => {
  const raw = Buffer.isBuffer(body);
  const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'x-spd-client': 'macos/2.0.0-dev (dev)', ...(raw ? { 'content-type': 'application/octet-stream' } : body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: raw ? (body as Buffer) : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
async function upload(token: string, folderId: string, name: string, data: Buffer) {
  const u = await call(token, 'POST', '/api/v1/uploads', { folderId, name, size: data.length, onConflict: 'version' });
  await call(token, 'PATCH', `/api/v1/uploads/${u.id}?offset=0`, data);
  return (await call(token, 'POST', `/api/v1/uploads/${u.id}/complete`, { sha256: sha(data) })).file;
}

const alice = await account('alice@example.test', 'Alice Tremblay', 'admin'), bob = await account('bob@example.test', 'Bob Gagnon', 'user');
const folder = async (parentId: string, name: string) => (await call(alice.token, 'POST', '/api/v1/folders', { parentId, name, onConflict: 'rename' }));
const root = (await call(alice.token, 'GET', '/api/v1/sync/cursor')).rootId;
const existing = (await call(alice.token, 'GET', '/api/v1/folders/root')).folders as { id: string; name: string }[];
if (!existing.some((f) => f.name === 'Projets')) {
  const projets = await folder(root, 'Projets'), equipe = await folder(root, 'Équipe'), depot = await folder(root, 'Dépôts');
  await upload(alice.token, projets.id, 'Notes de réunion.txt', Buffer.from('Ordre du jour\n\nLe budget de la coopérative Hirondelle est adopté.\nProchaine assemblée en février.\n'));
  await upload(alice.token, projets.id, 'Rapport trimestriel.pdf', pdfWithText(['Rapport trimestriel', 'La societe Borealis a livre 42 turbines.', 'The maintenance schedule was approved by the board.']));
  await upload(alice.token, projets.id, 'Contrat chalet.md', Buffer.from('# Contrat de location\n\nLe locataire verse un dépôt de 500 dollars avant le 1er juin.\n'));
  await upload(alice.token, equipe.id, 'Charte.txt', Buffer.from("Charte de l'équipe : respect, rigueur, entraide.\n"));
  await upload(alice.token, root, 'Budget.csv', Buffer.from('poste;montant\nloyer;1200\nassurance;110\n'));
  await upload(alice.token, root, 'Copie du budget.csv', Buffer.from('poste;montant\nloyer;1200\nassurance;110\n'));
  await call(alice.token, 'POST', `/api/v1/folders/${equipe.id}/members`, { userId: bob.id, role: 'viewer', workspaceName: 'Équipe Projet' });
  await call(alice.token, 'POST', `/api/v1/folders/${depot.id}/members`, { userId: bob.id, role: 'uploader' });
  await call(alice.token, 'POST', '/api/v1/collections', { name: 'Documents récents', color: 'blue', rule: { match: 'all', conditions: [{ field: 'modified', op: 'within', value: 30 }, { field: 'kind', op: 'isNot', value: 'video' }], sort: { by: 'updated', dir: 'desc' } } }).catch(() => {});
}
writeFileSync(out, `${JSON.stringify({ base, createdAt: new Date().toISOString(), alice: { email: 'alice@example.test', role: 'admin', userId: alice.id, token: alice.token }, bob: { email: 'bob@example.test', role: 'user', userId: bob.id, token: bob.token } }, null, 1)}\n`, { mode: 0o600 });
console.log(`seeded: alice (admin) and bob; tokens written to ${out}`);
await sql.end({ timeout: 5 });
