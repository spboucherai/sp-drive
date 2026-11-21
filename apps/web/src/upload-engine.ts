/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/upload-engine.ts
 * Module           : web
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

// Chunked, resumable transfer of one File to an upload session that already exists on the server. Used by the
// explorer (owner uploads) and by the public deposit page (portal uploads): only the URLs and headers differ.
import { CHUNK_BYTES } from '@spd/shared';
import { ApiError, sha256Hex } from './api.ts';

export interface Transfer {
  file: Blob;
  /** PATCH target for a chunk starting at `offset` (path below /api/v1). */
  chunkPath(offset: number): string;
  /** GET that answers `{ received }` — where the server wants the next byte. */
  statusPath: string;
  headers?: Record<string, string>;
  chunkBytes?: number;
  /** Bytes the server already holds (resuming an earlier session). */
  startAt?: number;
  onProgress?(sent: number, total: number): void;
  signal?: AbortSignal;
}
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); }, { once: true });
});
async function call<T>(method: string, path: string, body: BodyInit | undefined, headers: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { method, body, signal, credentials: 'same-origin', headers: { 'X-SPD-CSRF': '1', ...headers } });
  const json = (res.headers.get('content-type') ?? '').includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? 'http_error', json?.message ?? `HTTP ${res.status}`, json ?? {});
  return json as T;
}
/**
 * Send every remaining byte. Each chunk carries its SHA-256; the server refuses a damaged chunk and it is sent again.
 * Network failures and 5xx answers are retried with back-off, re-asking the server for its offset first, so a
 * connection lost in the middle of a chunk never corrupts or duplicates data. Rejects with AbortError when cancelled
 * (pause = abort, then call again with `startAt` from the status endpoint) and with ApiError for refusals (4xx).
 */
export async function transfer(t: Transfer): Promise<void> {
  const total = t.file.size, step = t.chunkBytes ?? CHUNK_BYTES, headers = t.headers ?? {};
  let offset = t.startAt ?? 0, failures = 0;
  t.onProgress?.(offset, total);
  while (offset < total) {
    if (t.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const chunk = t.file.slice(offset, Math.min(total, offset + step));
    try {
      const buf = await chunk.arrayBuffer();
      const r = await call<{ received: number }>('PATCH', t.chunkPath(offset), buf, { ...headers, 'Content-Type': 'application/octet-stream', 'X-Chunk-SHA256': await sha256Hex(buf) }, t.signal);
      offset = r.received; failures = 0;
      t.onProgress?.(offset, total);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      if (e instanceof ApiError && (e.code === 'offset_mismatch' || e.code === 'chunk_corrupt') && typeof e.data.received === 'number') { offset = e.data.received; if (++failures > 8) throw e; continue; }
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) throw e; // refused: quota, closed, expired…
      if (++failures > 8) throw e;
      await sleep(Math.min(30_000, 500 * 2 ** failures), t.signal);
      // the chunk may or may not have landed: ask before sending anything else
      try { offset = (await call<{ received: number }>('GET', t.statusPath, undefined, headers, t.signal)).received; } catch (s) { if ((s as Error).name === 'AbortError' || (s instanceof ApiError && s.status >= 400 && s.status < 500)) throw s; }
      t.onProgress?.(offset, total);
    }
  }
}
/** SHA-256 of a whole file, when it is small enough to hash in memory in the browser; undefined otherwise (the server still verifies every chunk). */
export async function wholeFileSha(file: Blob, limit = 256 * 1024 * 1024): Promise<string | undefined> {
  if (file.size > limit) return undefined;
  try { return await sha256Hex(await file.arrayBuffer()); } catch { return undefined; }
}
