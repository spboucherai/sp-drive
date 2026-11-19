// Background jobs: antivirus scans, previews, portal submissions (quarantine → inspection → atomic placement),
// garbage collection and housekeeping.
import { createReadStream } from 'node:fs';
import { open, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extOf, previewKind } from '@spd/shared';
import { fileTypeFromFile } from 'file-type';
import { driver, ensureObject, materialize, type ObjectRow, readSealed, sealFile } from './blob.ts';
import { config } from './config.ts';
import { audit, type Db, lockOwner, notify, sql, SYSTEM, tx } from './db.ts';
import { enqueue, type Handler, requeueStuck } from './jobs.ts';
import { BLOCKED_EXT, type RequestRow } from './requests.ts';
import { enqueueExtract, extractText } from './textindex.ts';
import { clamdScan, clamdVersion, listTar, listZip, officeAvailable, officeToPdf, assertNotBomb, ScannerUnavailable, sheetPreview, sipsJpeg, textkitDhash, textkitInfo, ToolError, videoFrame, withWorkDir } from './tools.ts';
import { addFile, createFolder } from './tree.ts';
import { assertQuota } from './uploads.ts';

// --- antivirus for content already in the drive (the owner's own uploads) ----------------------------------
const scanObject: Handler = async (p) => {
  const [o] = await sql<ObjectRow[]>`select *, size::text from storage_objects where id = ${String(p.objectId)}`;
  if (!o || o.scan_status !== 'pending') return;
  let r;
  try { r = await clamdScan(readSealed(o), Number(o.size)); } catch (e) {
    if (e instanceof ScannerUnavailable && config.avMode === 'optional') { await sql`update storage_objects set scan_status = 'error', scan_detail = 'scanner_unavailable', scanned_at = now() where id = ${o.id}`; await enqueueExtract(sql, o.id); return; }
    throw e; // retried with back-off; the object stays "pending"
  }
  await tx(async (t) => {
    await t`update storage_objects set scan_status = ${r.status}, scan_detail = ${r.status === 'infected' ? r.signature : r.status === 'error' ? r.detail : null}, scanned_at = now() where id = ${o.id}`;
    if (r.status === 'infected') {
      const files = await t<{ id: string; name: string }[]>`select distinct f.id, f.name from files f join file_versions v on v.file_id = f.id where v.object_id = ${o.id} limit 20`;
      await audit(t, SYSTEM, 'scan.infected', { ownerId: o.owner_id, targetType: 'object', targetId: o.id, meta: { signature: r.signature, files: files.map((f) => f.id) } });
      await notify(t, o.owner_id, 'scan.infected', { signature: r.signature, files });
      // whatever was indexed under an earlier verdict goes away with it
      await t`delete from object_passages where object_id = ${o.id}`; await t`delete from object_text where object_id = ${o.id}`;
    }
    if (r.status === 'clean') await enqueueExtract(t, o.id); // text is only ever read from content the antivirus cleared
  });
};

// --- previews ----------------------------------------------------------------------------------------------
type Kind = 'thumb' | 'image' | 'pdf' | 'sheet' | 'archive';
async function savePreview(objectId: string, kind: Kind, path: string): Promise<void> {
  const size = (await stat(path)).size;
  const sealed = await sealFile(path, size);
  const old = await sql<{ storage_key: string | null }[]>`select storage_key from previews where object_id = ${objectId} and kind = ${kind}`;
  try {
    await sql`insert into previews (object_id, kind, status, storage_key, wrapped_key, size) values (${objectId}, ${kind}, 'ready', ${sealed.storage_key}, ${sealed.wrapped_key}, ${size})
      on conflict (object_id, kind) do update set status = 'ready', storage_key = excluded.storage_key, wrapped_key = excluded.wrapped_key, size = excluded.size, error = null, updated_at = now()`;
  } catch (e) { await driver.remove(sealed.storage_key); throw e; } // the object was deleted meanwhile
  if (old[0]?.storage_key) await driver.remove(old[0].storage_key);
  if (kind === 'thumb') await enqueue(sql, 'phash', { objectId }, { dedupeKey: `phash:${objectId}`, maxAttempts: 2 });
  // an old binary office file has no text of its own: its PDF rendition is what gets indexed
  if (kind === 'pdf' && config.indexContent) { const [x] = await sql`select 1 from object_text where object_id = ${objectId} and status = 'unsupported'`; if (x) await enqueueExtract(sql, objectId, true); }
}
const markPreview = (objectId: string, kind: Kind, status: 'failed' | 'unsupported' | 'pending', error?: string) =>
  sql`insert into previews (object_id, kind, status, error) values (${objectId}, ${kind}, ${status}, ${error ?? null})
    on conflict (object_id, kind) do update set status = excluded.status, error = excluded.error, updated_at = now() where previews.status <> 'ready'`.catch(() => {});

/** Messages safe to show to users for a failed preview. */
const reason = (e: unknown) => (e instanceof ToolError ? e.message : 'the preview could not be produced');
const preview: Handler = async (p) => {
  const objectId = String(p.objectId);
  const [o] = await sql<(ObjectRow & { name: string | null })[]>`select o.*, o.size::text, (select f.name from files f join file_versions v on v.file_id = f.id where v.object_id = o.id order by v.created_at limit 1) as name
    from storage_objects o where o.id = ${objectId}`;
  if (!o?.name) return;
  const kind = previewKind(o.name), size = Number(o.size), ext = extOf(o.name);
  const plan: Kind[] = kind === 'image' || kind === 'pdf' || kind === 'video' ? ['thumb'] : kind === 'heic' ? ['thumb', 'image'] : kind === 'office' ? ['pdf', 'thumb'] : kind === 'sheet' ? ['sheet'] : kind === 'archive' ? ['archive'] : [];
  if (!plan.length || size === 0) return;
  for (const k of plan) await markPreview(objectId, k, 'pending');
  const tooBig = (limit: number) => { for (const k of plan) void markPreview(objectId, k, 'failed', `file too large for a preview (limit ${Math.round(limit / 1024 ** 2)} MB)`); };
  if ((kind === 'office' && size > config.officeMaxBytes) || (kind === 'sheet' && size > config.sheetMaxBytes) || ((kind === 'image' || kind === 'heic') && size > 200 * 1024 ** 2)) return tooBig(kind === 'office' ? config.officeMaxBytes : kind === 'sheet' ? config.sheetMaxBytes : 200 * 1024 ** 2);
  await withWorkDir(async (work) => {
    const input = join(work, `input.${ext || 'bin'}`);
    await materialize(o, input);
    const each = async (k: Kind, fn: () => Promise<void>) => { try { await fn(); } catch (e) { if (!(e instanceof ToolError)) console.error(JSON.stringify({ level: 'error', msg: 'preview failed', object: objectId, kind: k, error: String((e as Error).message) })); await markPreview(objectId, k, 'failed', reason(e)); } };
    if (kind === 'image' || kind === 'heic' || kind === 'pdf') await each('thumb', async () => { const out = join(work, 'thumb.jpg'); await sipsJpeg(work, input, out, 480); await savePreview(objectId, 'thumb', out); });
    if (kind === 'heic') await each('image', async () => { const out = join(work, 'full.jpg'); await sipsJpeg(work, input, out, 2560); await savePreview(objectId, 'image', out); });
    if (kind === 'video') await each('thumb', async () => { const out = join(work, 'thumb.jpg'); if (await videoFrame(work, input, out)) await savePreview(objectId, 'thumb', out); else await markPreview(objectId, 'thumb', 'unsupported'); });
    if (kind === 'office') {
      let pdf: string | undefined;
      await each('pdf', async () => { if (['docx', 'pptx', 'odt', 'odp'].includes(ext)) await assertNotBomb(input); pdf = await officeToPdf(work, input); await savePreview(objectId, 'pdf', pdf); });
      if (pdf) await each('thumb', async () => { const out = join(work, 'thumb.jpg'); await sipsJpeg(work, pdf!, out, 480); await savePreview(objectId, 'thumb', out); });
      else await markPreview(objectId, 'thumb', 'unsupported');
    }
    if (kind === 'sheet') await each('sheet', async () => { const out = join(work, 'sheet-out.json'); await writeFile(out, JSON.stringify(await sheetPreview(work, input))); await savePreview(objectId, 'sheet', out); });
    if (kind === 'archive') await each('archive', async () => {
      const listing = ext === 'zip' ? await listZip(input) : await listTar(input, ext !== 'tar');
      const out = join(work, 'archive.json'); await writeFile(out, JSON.stringify(listing)); await savePreview(objectId, 'archive', out);
    });
  });
};

// --- portal submissions ------------------------------------------------------------------------------------
const EXECUTABLE = new Set(['application/x-msdownload', 'application/x-mach-binary', 'application/x-elf', 'application/vnd.microsoft.portable-executable', 'application/x-apple-diskimage', 'application/java-archive', 'application/x-sh',
  'application/vnd.android.package-archive', 'application/x-msi', 'application/x-deb', 'application/x-rpm']);
/** Extensions that legitimately share one signature family. */
const FAMILY: Record<string, string> = { jpeg: 'jpg', jpe: 'jpg', tif: 'tiff', heif: 'heic', htm: 'html', mpg: 'mpeg', m4v: 'mp4', mov: 'mp4', m4a: 'mp4', qt: 'mp4', '3gp': 'mp4', oga: 'ogg', ogv: 'ogg', tgz: 'gz', docm: 'docx', xlsm: 'xlsx', pptm: 'pptx', cfb: 'doc', xls: 'doc', ppt: 'doc', msg: 'doc', zip: 'zip', jar: 'zip', epub: 'zip', odt: 'zip', ods: 'zip', odp: 'zip', docx: 'zip', xlsx: 'zip', pptx: 'zip', key: 'zip', pages: 'zip', numbers: 'zip' };
const fam = (e: string) => FAMILY[e] ?? e;
/** Does the content's signature agree with the name it was given? Returns a reject code, or null when acceptable. */
export async function inspectSignature(path: string, name: string): Promise<{ mime: string; reject: string | null }> {
  const ext = extOf(name);
  const head = Buffer.alloc(4);
  const fh = await open(path, 'r'); try { await fh.read(head, 0, 4, 0); } finally { await fh.close(); }
  if (head.subarray(0, 2).toString('latin1') === 'MZ' || head.subarray(0, 2).toString('latin1') === '#!' || head.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(head.readUInt32BE(0))) return { mime: 'application/x-executable', reject: 'executable' };
  const t = await fileTypeFromFile(path).catch(() => undefined);
  if (!t) return { mime: 'application/octet-stream', reject: null }; // no known signature (text, CSV, unknown): the extension policy already applied
  if (EXECUTABLE.has(t.mime)) return { mime: t.mime, reject: 'executable' };
  // a recognised signature must belong to the family the extension announces (a .pdf that is really a ZIP is refused)
  const ok = fam(t.ext) === fam(ext) || (fam(ext) === 'zip' && fam(t.ext) === 'zip') || (t.mime.startsWith('text/') || t.mime === 'application/xml');
  return { mime: t.mime, reject: ok ? null : 'type_mismatch' };
}

interface ItemRow { id: string; safe_name: string; size: string; sha256: string; quarantine_path: string; status: string; detected_mime: string | null; reject_code: string | null }
interface SubRow { id: string; request_id: string; public_ref: string; status: string; submitter_name: string; reference: string; created_at: Date }
const processSubmission: Handler = async (p) => {
  const subId = String(p.submissionId);
  const [sub] = await sql<SubRow[]>`select * from upload_submissions where id = ${subId}`;
  if (!sub || sub.status !== 'processing') return;
  const [portal] = await sql<RequestRow[]>`select * from upload_requests where id = ${sub.request_id}`;
  if (!portal) return;
  const items = await sql<ItemRow[]>`select *, size::text from upload_items where submission_id = ${subId} and status = 'quarantined' order by position, id`;
  const reject = async (i: ItemRow, code: string, meta: Record<string, unknown> = {}) => {
    await rm(i.quarantine_path, { force: true });
    await sql`update upload_items set status = 'rejected', reject_code = ${code}, quarantine_path = null, updated_at = now() where id = ${i.id}`;
    await audit(sql, SYSTEM, 'submission.item_rejected', { ownerId: portal.owner_id, targetType: 'submission', targetId: subId, meta: { item: i.id, name: i.safe_name, code, ...meta } });
    i.status = 'rejected';
  };
  // 1. inspection, file by file; nothing has touched the target folder yet
  for (const i of items) {
    const ext = extOf(i.safe_name);
    if (BLOCKED_EXT.has(ext) || (portal.allowed_extensions.length && !portal.allowed_extensions.includes(ext))) { await reject(i, 'type_not_allowed'); continue; }
    if (!(await stat(i.quarantine_path).then((s) => s.size === Number(i.size), () => false))) { await reject(i, 'incomplete'); continue; }
    const sig = await inspectSignature(i.quarantine_path, i.safe_name);
    await sql`update upload_items set detected_mime = ${sig.mime} where id = ${i.id}`;
    if (sig.reject) { await reject(i, sig.reject, { mime: sig.mime }); continue; }
    let scan;
    try { scan = await clamdScan(createReadStream(i.quarantine_path), Number(i.size)); } catch (e) {
      if (!(e instanceof ScannerUnavailable) || config.avMode === 'required') throw e; // stays in quarantine; the job is retried
      scan = { status: 'error' as const, detail: 'scanner_unavailable' };
    }
    if (scan.status === 'infected') { await reject(i, 'infected', { signature: scan.signature }); continue; }
    if (scan.status === 'error' && config.avMode === 'required') { await reject(i, 'unscannable', { detail: scan.detail }); continue; }
    (i as ItemRow & { scan?: string }).reject_code = null;
    (i as ItemRow & { clean?: boolean }).clean = scan.status === 'clean';
  }
  // 2. placement of everything that passed, in one transaction: the folder sees all accepted files or none
  const accepted = items.filter((i) => i.status === 'quarantined');
  const createdBlobs: string[] = [];
  try {
    await tx(async (t) => {
      await lockOwner(t, portal.owner_id);
      const [target] = await t<{ id: string }[]>`select id from folders where id = ${portal.folder_id} and trashed_at is null`;
      let outcome: 'completed' | 'rejected' = accepted.length ? 'completed' : 'rejected';
      let folderId: string | null = null, placedBytes = 0, failCode: string | null = null;
      if (accepted.length && !target) failCode = 'target_unavailable';
      if (accepted.length && target) {
        const total = accepted.reduce((n, i) => n + Number(i.size), 0);
        await assertQuota(t, portal.owner_id, total).catch(() => { failCode = 'quota_exceeded'; });
      }
      if (failCode) outcome = 'rejected';
      else if (accepted.length) {
        folderId = target!.id;
        if (portal.subfolder_per_submission) {
          const label = [sub.created_at.toISOString().slice(0, 10), sub.submitter_name || sub.reference, sub.public_ref].filter(Boolean).join(' ');
          folderId = (await createFolder(t, portal.owner_id, target!.id, label, 'rename')).id;
        }
        for (const i of accepted) {
          const [object, created] = await ensureObject(t, portal.owner_id, i.quarantine_path, Number(i.size), i.sha256);
          if (created) createdBlobs.push(object.storage_key);
          if ((i as ItemRow & { clean?: boolean }).clean && object.scan_status !== 'clean') { await t`update storage_objects set scan_status = 'clean', scanned_at = now() where id = ${object.id}`; object.scan_status = 'clean'; }
          const { file } = await addFile(t, { ownerId: portal.owner_id, folderId, name: i.safe_name, object, onConflict: 'rename', origin: 'request', actorId: null });
          await t`update upload_items set status = 'placed', file_id = ${file.id}, quarantine_path = null, updated_at = now() where id = ${i.id}`;
          placedBytes += Number(i.size);
        }
        await t`update upload_requests set bytes_received = bytes_received + ${placedBytes}, updated_at = now() where id = ${portal.id}`;
      }
      if (failCode) for (const i of accepted) await t`update upload_items set status = 'rejected', reject_code = ${failCode}, quarantine_path = null, updated_at = now() where id = ${i.id}`;
      await t`update upload_submissions set status = ${outcome}, completed_at = now(), folder_id = ${folderId} where id = ${subId}`;
      const rejected = items.length - (failCode ? 0 : accepted.length);
      await audit(t, SYSTEM, `submission.${outcome}`, { ownerId: portal.owner_id, targetType: 'submission', targetId: subId, meta: { placed: failCode ? 0 : accepted.length, rejected: failCode ? items.length : rejected, bytes: placedBytes, reason: failCode } });
      if (portal.notify_owner) await notify(t, portal.owner_id, 'request.submission', { requestId: portal.id, title: portal.title, submissionId: subId, ref: sub.public_ref, name: sub.submitter_name, placed: failCode ? 0 : accepted.length, rejected: failCode ? items.length : rejected, folderId, reason: failCode });
    });
  } catch (e) { for (const k of createdBlobs) await driver.remove(k); throw e; }
  for (const i of accepted) await rm(i.quarantine_path, { force: true });
};

// --- garbage collection and housekeeping -------------------------------------------------------------------
/** Remove an owner's objects no version references any more, with their previews. */
const gcObjects: Handler = async (p) => {
  const ownerId = String(p.ownerId);
  const keys = await tx(async (t) => {
    await lockOwner(t, ownerId);
    const dead = await t<{ id: string; storage_key: string }[]>`select o.id, o.storage_key from storage_objects o where o.owner_id = ${ownerId} and not exists (select 1 from file_versions v where v.object_id = o.id)`;
    if (!dead.length) return [];
    const ids = dead.map((d) => d.id);
    const prev = await t<{ storage_key: string }[]>`select storage_key from previews where object_id = any(${ids}) and storage_key is not null`;
    await t`delete from storage_objects where id = any(${ids})`;
    return [...dead.map((d) => d.storage_key), ...prev.map((x) => x.storage_key)];
  });
  for (const k of keys) await driver.remove(k);
};

/** Periodic clean-up: abandoned uploads, expired submissions, old sessions and challenges, stray temp files. */
export async function housekeeping(): Promise<void> {
  await requeueStuck();
  const stale = await sql<{ id: string; item_id: string | null }[]>`update uploads set status = 'aborted', updated_at = now() where status in ('active', 'completing') and (expires_at < now() or (status = 'completing' and updated_at < now() - interval '1 hour')) returning id, item_id`;
  for (const u of stale) await rm(join(u.item_id ? config.quarantineDir : config.tmpDir, `up-${u.id}`), { force: true });
  // submissions never finalised: their items are dropped, their reserved bytes released
  const dead = await sql<{ id: string }[]>`update upload_submissions set status = 'expired', completed_at = now() where status = 'open' and created_at < now() - interval '24 hours' returning id`;
  for (const s of dead) {
    const ups = await sql<{ id: string }[]>`select u.id from uploads u join upload_items i on i.id = u.item_id where i.submission_id = ${s.id}`;
    for (const u of ups) await rm(join(config.quarantineDir, `up-${u.id}`), { force: true });
    await sql`update upload_items set status = 'rejected', reject_code = 'expired', quarantine_path = null where submission_id = ${s.id} and status in ('uploading', 'quarantined')`;
    await sql`update uploads set status = 'aborted' where item_id in (select id from upload_items where submission_id = ${s.id}) and status <> 'done'`;
  }
  await sql`delete from uploads where status in ('done', 'aborted') and updated_at < now() - interval '7 days'`;
  await sql`delete from sessions where expires_at < now() - interval '30 days' or revoked_at < now() - interval '30 days'`;
  await sql`delete from auth_challenges where expires_at < now()`;
  await sql`delete from jobs where status = 'done' and finished_at < now() - interval '7 days'`;
  await sql`delete from invites where expires_at < now() - interval '30 days'`;
  // files in the temp areas that no live upload accounts for (crash leftovers)
  for (const dir of [config.tmpDir, config.quarantineDir, config.workDir]) {
    for (const name of await readdir(dir).catch(() => [])) {
      const path = join(dir, name);
      const st = await stat(path).catch(() => null);
      if (!st || Date.now() - st.mtimeMs < 48 * 3600_000) continue;
      const m = /^up-([0-9a-f-]{36})$/.exec(name);
      if (m) { const [live] = await sql`select 1 from uploads where id = ${m[1]!} and status in ('active', 'completing')`; const [q] = await sql`select 1 from upload_items where quarantine_path = ${path} and status = 'quarantined'`; if (live || q) continue; }
      await rm(path, { recursive: true, force: true });
    }
  }
  // submissions waiting for inspection whose job gave up (antivirus down for hours): try again
  const waiting = await sql<{ id: string }[]>`select id from upload_submissions where status = 'processing' and finalized_at < now() - interval '10 minutes'`;
  for (const s of waiting) await enqueue(sql, 'process_submission', { submissionId: s.id }, { dedupeKey: `submission:${s.id}`, maxAttempts: 30 });
  const owners = await sql<{ owner_id: string }[]>`select distinct owner_id from storage_objects o where not exists (select 1 from file_versions v where v.object_id = o.id)`;
  for (const o of owners) await enqueue(sql, 'gc_objects', { ownerId: o.owner_id }, { dedupeKey: `gc:${o.owner_id}` });
}

// --- perceptual hash of images (similar-image detection) ---------------------------------------------------
const PHASH_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'tif', 'tiff', 'bmp']);
/** dHash of an image, computed on its existing thumbnail (already decoded, already small). */
const phash: Handler = async (p) => {
  const objectId = String(p.objectId);
  const [o] = await sql<{ name: string | null; storage_key: string | null; wrapped_key: Buffer | null; size: string | null }[]>`
    select (select f.name from files f join file_versions v on v.file_id = f.id where v.object_id = o.id order by v.created_at limit 1) as name, pv.storage_key, pv.wrapped_key, pv.size::text
    from storage_objects o left join previews pv on pv.object_id = o.id and pv.kind = 'thumb' and pv.status = 'ready' where o.id = ${objectId}`;
  if (!o?.name || !PHASH_EXT.has(extOf(o.name)) || !o.storage_key || !o.wrapped_key || !(await textkitInfo())) return;
  const dhash = await withWorkDir(async (work) => {
    const thumb = join(work, 'thumb.jpg');
    await materialize({ storage_key: o.storage_key!, wrapped_key: o.wrapped_key!, size: Number(o.size) }, thumb);
    return textkitDhash(work, thumb);
  }).catch((e) => { if (e instanceof ToolError) return null; throw e; });
  if (dhash) await sql`insert into object_phash (object_id, dhash) values (${objectId}, ${dhash}) on conflict (object_id) do update set dhash = excluded.dhash`.catch(() => {});
};
/** Queue the hash of every image that has a thumbnail and no hash yet (backfill, `cli reindex`). */
export async function rehashImages(): Promise<number> {
  const rows = await sql<{ object_id: string }[]>`select pv.object_id from previews pv where pv.kind = 'thumb' and pv.status = 'ready' and not exists (select 1 from object_phash h where h.object_id = pv.object_id)`;
  for (const r of rows) await enqueue(sql, 'phash', { objectId: r.object_id }, { dedupeKey: `phash:${r.object_id}`, maxAttempts: 2 });
  return rows.length;
}

/** What this worker can do right now, published for the administration view (the API process cannot see it otherwise). */
export async function heartbeat(): Promise<void> {
  const [converter, kit, av] = await Promise.all([officeAvailable().catch(() => false), textkitInfo().catch(() => null), clamdVersion().catch(() => null)]);
  const value = { pid: process.pid, at: new Date().toISOString(), converter: { available: converter, path: config.soffice }, textkit: { available: !!kit, contextual: !!kit?.contextual?.assets }, antivirus: av };
  await sql`insert into system_state (key, value) values ('worker', ${sql.json(value as never)}) on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

export const handlers: Record<string, Handler> = { scan_object: scanObject, preview, process_submission: processSubmission, gc_objects: gcObjects, extract_text: extractText, phash };
export type { Db };
