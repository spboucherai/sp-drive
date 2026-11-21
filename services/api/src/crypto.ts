/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/crypto.ts
 * Module           : services
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-11
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// --- tokens and password hashing ---------------------------------------------------------------------------
export const sha256hex = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
/** 256-bit URL-safe token; only its hash is ever stored. */
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (t: string) => sha256hex(`spd-token-v1:${t}`);
export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const scryptAsync = (pw: string, salt: Buffer) => new Promise<Buffer>((res, rej) => scrypt(pw.normalize('NFKC'), salt, 32, SCRYPT, (e, k) => (e ? rej(e) : res(k))));
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$15$${salt.toString('base64url')}$${(await scryptAsync(pw, salt)).toString('base64url')}`;
}
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, , salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = await scryptAsync(pw, Buffer.from(salt, 'base64url'));
  return want.length === got.length && timingSafeEqual(want, got);
}
export const hmacHex = (key: Buffer, msg: string) => createHmac('sha256', key).update(msg).digest('hex');
export const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(path, { highWaterMark: 1 << 20 }), h);
  return h.digest('hex');
}

// --- key wrapping ------------------------------------------------------------------------------------------
// wrapped = version(1) | nonce(12) | ciphertext(32) | tag(16)
const WRAP_V1 = 1;
export function wrapKey(master: Buffer, dataKey: Buffer): Buffer {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', master, nonce);
  c.setAAD(Buffer.from('spd-wrap-v1'));
  const ct = Buffer.concat([c.update(dataKey), c.final()]);
  return Buffer.concat([Buffer.from([WRAP_V1]), nonce, ct, c.getAuthTag()]);
}
export function unwrapKey(master: Buffer, wrapped: Buffer): Buffer {
  if (wrapped[0] !== WRAP_V1 || wrapped.length !== 61) throw new Error('unknown key wrapping');
  const d = createDecipheriv('aes-256-gcm', master, wrapped.subarray(1, 13));
  d.setAAD(Buffer.from('spd-wrap-v1'));
  d.setAuthTag(wrapped.subarray(45));
  return Buffer.concat([d.update(wrapped.subarray(13, 45)), d.final()]);
}
/** Small secrets (TOTP seeds) sealed with the master key. */
export function seal(master: Buffer, plain: Buffer, context: string): Buffer {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', master, nonce);
  c.setAAD(Buffer.from(`spd-seal-v1:${context}`));
  return Buffer.concat([nonce, c.update(plain), c.final(), c.getAuthTag()]);
}
export function unseal(master: Buffer, sealed: Buffer, context: string): Buffer {
  const d = createDecipheriv('aes-256-gcm', master, sealed.subarray(0, 12));
  d.setAAD(Buffer.from(`spd-seal-v1:${context}`));
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(sealed.subarray(12, sealed.length - 16)), d.final()]);
}

// --- chunked content encryption ----------------------------------------------------------------------------
// Plaintext is cut in 64 KiB blocks; block i is AES-256-GCM(key, nonce = i, aad = size | i | last?) → ciphertext | tag(16).
// The key is unique per object, so a counter nonce never repeats. The AAD binds every block to its position, to the
// total size and to being last or not: truncation, reordering and splicing all fail authentication.
export const BLOCK = 64 * 1024;
const TAG = 16;
export const sealedSize = (size: number) => size + Math.max(1, Math.ceil(size / BLOCK)) * TAG;
const blockCount = (size: number) => Math.max(1, Math.ceil(size / BLOCK));
function nonceFor(i: number): Buffer { const n = Buffer.alloc(12); n.writeBigUInt64BE(BigInt(i), 4); return n; }
function aadFor(size: number, i: number): Buffer {
  const a = Buffer.alloc(17);
  a.writeBigUInt64BE(BigInt(size), 0); a.writeBigUInt64BE(BigInt(i), 8); a[16] = i === blockCount(size) - 1 ? 1 : 0;
  return a;
}
function sealBlock(key: Buffer, size: number, i: number, plain: Buffer): Buffer {
  const c = createCipheriv('aes-256-gcm', key, nonceFor(i));
  c.setAAD(aadFor(size, i));
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}
function openBlock(key: Buffer, size: number, i: number, sealed: Buffer): Buffer {
  const d = createDecipheriv('aes-256-gcm', key, nonceFor(i));
  d.setAAD(aadFor(size, i));
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  return Buffer.concat([d.update(sealed.subarray(0, sealed.length - TAG)), d.final()]);
}

/** Encrypt a plaintext file of known size into `dest`. */
export async function encryptFile(key: Buffer, src: string, dest: string, size: number): Promise<void> {
  let i = 0, pending: Buffer = Buffer.alloc(0), seen = 0;
  const enc = new Transform({
    transform(chunk: Buffer, _e, cb) {
      seen += chunk.length;
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      try {
        while (pending.length > BLOCK) { this.push(sealBlock(key, size, i++, pending.subarray(0, BLOCK))); pending = pending.subarray(BLOCK); }
        cb();
      } catch (e) { cb(e as Error); }
    },
    flush(cb) {
      if (seen !== size) return cb(new Error(`size changed during encryption (${seen} != ${size})`));
      try { if (pending.length || i === 0) this.push(sealBlock(key, size, i++, pending)); cb(); } catch (e) { cb(e as Error); }
    },
  });
  await pipeline(createReadStream(src, { highWaterMark: 1 << 20 }), enc, createWriteStream(dest, { mode: 0o600, flags: 'wx' }));
}

/** Random-access reader over a sealed object (a local file today, a ranged GET for an object store). */
export interface BlockSource { read(position: number, length: number): Promise<Buffer>; close(): Promise<void> }
export async function fileSource(path: string): Promise<BlockSource> {
  const fh = await open(path, 'r');
  return {
    async read(position, length) { const buf = Buffer.alloc(length); const { bytesRead } = await fh.read(buf, 0, length, position); return bytesRead === length ? buf : buf.subarray(0, bytesRead); },
    close: () => fh.close(),
  };
}
/** Decrypt the plaintext byte range [start, end] (inclusive) of a sealed object; only the needed blocks are read. */
export function decryptRange(key: Buffer, open_: () => Promise<BlockSource>, size: number, start = 0, end = size - 1): Readable {
  if (size === 0) return Readable.from([]);
  async function* gen() {
    const src = await open_();
    try {
      const first = Math.floor(start / BLOCK), last = Math.floor(end / BLOCK);
      for (let i = first; i <= last; i++) {
        const plainLen = Math.min(BLOCK, size - i * BLOCK);
        const buf = await src.read(i * (BLOCK + TAG), plainLen + TAG);
        if (buf.length !== plainLen + TAG) throw new Error('stored object is truncated');
        const plain = openBlock(key, size, i, buf);
        const from = i === first ? start - i * BLOCK : 0;
        const to = i === last ? end - i * BLOCK + 1 : plainLen;
        yield from === 0 && to === plainLen ? plain : plain.subarray(from, to);
      }
    } finally { await src.close(); }
  }
  return Readable.from(gen(), { objectMode: false, highWaterMark: 4 * BLOCK });
}

// --- RFC 6238 TOTP (SHA-1, 6 digits, 30 s) -----------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer): string {
  let bits = 0, v = 0, out = '';
  for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(v << (5 - bits)) & 31];
  return out;
}
export function totpAt(secret: Buffer, t: number): string {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(t / 30)));
  const h = createHmac('sha1', secret).update(c).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
/** Accepts the current step and one step either side. Returns the matched step so a code cannot be replayed. */
export function totpVerify(secret: Buffer, code: string, now = Date.now() / 1000): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  for (const d of [0, -1, 1]) { const t = now + d * 30; if (safeEqual(totpAt(secret, t), code)) return Math.floor(t / 30); }
  return null;
}
