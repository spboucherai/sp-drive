import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, loadMasterKey } from './config.ts';
import { type BlockSource, decryptRange, encryptFile, fileSource, unwrapKey, wrapKey } from './crypto.ts';
import type { Db } from './db.ts';

/** Where sealed objects live. Keys are opaque; nothing above this interface knows about paths. */
export interface BlobDriver {
  /** Move a sealed local file into the store under `key`. */
  ingest(key: string, sealedPath: string): Promise<void>;
  open(key: string): Promise<BlockSource>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
class FsDriver implements BlobDriver {
  constructor(private root: string) {}
  private path(key: string) { if (!/^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f-]{36}$/.test(key)) throw new Error('bad blob key'); return join(this.root, key); }
  async ingest(key: string, sealedPath: string) { const p = this.path(key); await mkdir(dirname(p), { recursive: true, mode: 0o700 }); await rename(sealedPath, p); }
  open(key: string) { return fileSource(this.path(key)); }
  async remove(key: string) { await rm(this.path(key), { force: true }); }
  async exists(key: string) { return stat(this.path(key)).then(() => true, () => false); }
}
export const driver: BlobDriver = new FsDriver(config.blobDir);

let master: Buffer | undefined;
export const masterKey = () => (master ??= loadMasterKey());
export interface Sealed { storage_key: string; wrapped_key: Buffer; size: number | bigint }

/** Encrypt a plaintext file under a fresh data key and store it. The caller records the returned row. */
export async function sealFile(plainPath: string, size: number): Promise<{ storage_key: string; wrapped_key: Buffer }> {
  const id = randomUUID();
  const storage_key = `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}`;
  const dataKey = randomBytes(32);
  const tmp = join(config.tmpDir, `seal-${id}`);
  try {
    await encryptFile(dataKey, plainPath, tmp, size);
    await driver.ingest(storage_key, tmp);
  } catch (e) { await rm(tmp, { force: true }); throw e; }
  return { storage_key, wrapped_key: wrapKey(masterKey(), dataKey) };
}
/** Plaintext stream of an object, optionally a byte range (inclusive). */
export function readSealed(o: Sealed, start?: number, end?: number): Readable {
  const key = unwrapKey(masterKey(), Buffer.from(o.wrapped_key));
  return decryptRange(key, () => driver.open(o.storage_key), Number(o.size), start, end);
}
/** Decrypt a whole object into a private work file (worker only). The caller deletes it. */
export async function materialize(o: Sealed, dest: string): Promise<void> {
  await pipeline(readSealed(o), createWriteStream(dest, { mode: 0o600, flags: 'wx' }));
}

export interface ObjectRow extends Sealed { id: string; owner_id: string; sha256: string; scan_status: string }
/**
 * Store content for an owner, reusing the owner's identical object when it exists. Deduplication never crosses
 * owners: another account holding the same bytes changes nothing observable (time, quota or result).
 * Must run under lockOwner. Returns [row, created].
 */
export async function ensureObject(t: Db, ownerId: string, plainPath: string, size: number, sha256: string): Promise<[ObjectRow, boolean]> {
  const [existing] = await t<ObjectRow[]>`select * from storage_objects where owner_id = ${ownerId} and sha256 = ${sha256} and size = ${size}`;
  if (existing && await driver.exists(existing.storage_key)) return [existing, false];
  const sealed = await sealFile(plainPath, size);
  try {
    if (existing) { // the row survived but its blob is gone: repair in place
      const [row] = await t<ObjectRow[]>`update storage_objects set storage_key = ${sealed.storage_key}, wrapped_key = ${sealed.wrapped_key} where id = ${existing.id} returning *`;
      return [row!, false];
    }
    const [row] = await t<ObjectRow[]>`insert into storage_objects (owner_id, sha256, size, storage_key, wrapped_key)
      values (${ownerId}, ${sha256}, ${size}, ${sealed.storage_key}, ${sealed.wrapped_key}) returning *`;
    return [row!, true];
  } catch (e) { await driver.remove(sealed.storage_key); throw e; }
}
/** Bytes an owner stores (distinct objects). */
export async function usedBytes(t: Db, ownerId: string): Promise<number> {
  const [r] = await t<{ n: string }[]>`select coalesce(sum(size), 0)::text as n from storage_objects where owner_id = ${ownerId}`;
  return Number(r!.n);
}
