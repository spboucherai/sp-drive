/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/uploads.ts
 * Module           : services
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-19
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

// Resumable uploads. A session is created with its final size; the client then appends chunks at the offset the
// server reports, each optionally carrying its own SHA-256, and finally asks for completion with the whole-file hash.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { MAX_CHUNK_BYTES, safePathSegments, sanitizeName } from '@spd/shared';
import { z } from 'zod';
import { actorOf, requireUser, userOf } from './auth.ts';
import { ensureObject, usedBytes } from './blob.ts';
import { config, notFound, UserError } from './config.ts';
import { sha256File } from './crypto.ts';
import { audit, type Db, lockOwner, sql, tx } from './db.ts';
import { addFile, addVersion, ensurePath, type FileRow, fileJson, getFile, getFolder } from './tree.ts';

export interface UploadRow { id: string; owner_id: string; actor_user_id: string | null; item_id: string | null; folder_id: string | null; name: string; size: string; received: string; on_conflict: 'fail' | 'rename' | 'version'; status: string; file_id: string | null; expires_at: Date; base_version_id?: string | null; grant_id?: string | null }
export const uploadPath = (u: Pick<UploadRow, 'id' | 'item_id'>) => join(u.item_id ? config.quarantineDir : config.tmpDir, `up-${u.id}`);
export const uploadJson = (u: UploadRow) => ({ id: u.id, name: u.name, size: Number(u.size), received: Number(u.received), status: u.status, fileId: u.file_id });

/** Quota check under lockOwner: stored bytes + bytes promised to uploads in flight + this one. */
export async function assertQuota(t: Db, ownerId: string, extra: number, exceptUploadId?: string): Promise<void> {
  const [q] = await t<{ limit_bytes: string }[]>`select limit_bytes::text from quotas where user_id = ${ownerId}`;
  const [p] = await t<{ n: string }[]>`select coalesce(sum(size), 0)::text as n from uploads where owner_id = ${ownerId} and status in ('active', 'completing') and id is distinct from ${exceptUploadId ?? null}`;
  const used = await usedBytes(t, ownerId);
  if (used + Number(p!.n) + extra > Number(q?.limit_bytes ?? 0)) throw new UserError('quota_exceeded', 'storage quota exceeded', 413, { used, limit: Number(q?.limit_bytes ?? 0) });
}

/**
 * Append one chunk. The row lock makes concurrent writers of the same upload take turns; a chunk whose offset is not
 * the current end is refused with the current end, so a client can always resynchronise. `guard` re-checks whatever
 * policy applies (portal still open, not expired…) on every chunk.
 */
export async function appendChunk(id: string, offset: number, body: Readable, chunkSha: string | undefined, guard: (t: Db, u: UploadRow) => Promise<void>): Promise<UploadRow> {
  try {
    return await tx(async (t) => {
      const [u] = await t<UploadRow[]>`select *, size::text, received::text from uploads where id = ${id} for update`;
      if (!u) throw notFound('upload not found');
      await guard(t, u);
      if (u.status !== 'active' || u.expires_at < new Date()) throw new UserError('upload_closed', 'this upload is no longer active', 410);
      const received = Number(u.received), size = Number(u.size);
      if (offset !== received) throw new UserError('offset_mismatch', 'chunk does not start at the current offset', 409, { received });
      const room = Math.min(size - received, MAX_CHUNK_BYTES);
      const path = uploadPath(u);
      const fh = await open(path, received === 0 ? 'w' : 'r+', 0o600);
      let written = 0;
      const hash = createHash('sha256');
      try {
        await fh.truncate(received); // drop bytes of an earlier interrupted chunk
        const out = createWriteStream(path, { fd: fh.fd, start: received, autoClose: false });
        await new Promise<void>((resolve, reject) => {
          body.on('data', (c: Buffer) => {
            written += c.length;
            if (written > room) { body.destroy(); reject(new UserError('chunk_too_large', 'chunk exceeds the declared size or the chunk limit', 413)); return; }
            hash.update(c);
            if (!out.write(c)) { body.pause(); out.once('drain', () => body.resume()); }
          });
          body.on('end', () => out.end(() => resolve()));
          body.on('error', reject); body.on('aborted', () => reject(new Error('aborted'))); out.on('error', reject);
        });
        if (chunkSha && hash.digest('hex') !== chunkSha.toLowerCase()) throw new UserError('chunk_corrupt', 'chunk checksum mismatch, send it again', 422, { received });
        await fh.sync();
      } catch (e) { await fh.truncate(received).catch(() => {}); throw e; } finally { await fh.close(); }
      if (written === 0 && size > 0) throw new UserError('empty_chunk', 'empty chunk', 400);
      const [r] = await t<UploadRow[]>`update uploads set received = received + ${written}, updated_at = now() where id = ${id} returning *, size::text, received::text`;
      return r!;
    });
  } finally { body.resume?.(); }
}

/** Check the temp file is complete and return its SHA-256 (compared with the client's when given). */
export async function sealCheck(u: UploadRow, clientSha?: string): Promise<string> {
  const size = Number(u.size);
  if (Number(u.received) !== size) throw new UserError('upload_incomplete', 'not all bytes were received', 409, { received: Number(u.received) });
  const path = uploadPath(u);
  if (size === 0) await (await open(path, 'a', 0o600)).close();
  if ((await stat(path)).size !== size) throw new UserError('upload_incomplete', 'stored bytes do not match', 409);
  const sha = await sha256File(path);
  if (clientSha && clientSha.toLowerCase() !== sha) throw new UserError('checksum_mismatch', 'the file received differs from the file sent', 422, { sha256: sha });
  return sha;
}

const Sha = z.string().regex(/^[0-9a-fA-F]{64}$/);
/** The file changed on the server since the client last saw it: the client decides (conflict copy), nothing is overwritten. */
const versionConflict = (f: FileRow) => new UserError('version_conflict', 'the file changed on the server', 409, { currentVersionId: f.current_version_id, sha256: f.sha256, rev: Number(f.rev ?? 0) });
export function uploadRoutes(app: FastifyInstance): void {
  const authed = { preHandler: requireUser };
  const mine = async (t: Db, userId: string, id: string) => {
    const [u] = await t<UploadRow[]>`select *, size::text, received::text from uploads where id = ${id} and actor_user_id = ${userId} and grant_id is null`; // uploads made through a grant live under /shared
    if (!u) throw notFound('upload not found');
    return u;
  };

  app.post('/api/v1/uploads', authed, async (req) => {
    const b = z.object({
      folderId: z.string(), name: z.string().min(1).max(1000), size: z.number().int().min(0), relativePath: z.string().max(4000).optional(),
      onConflict: z.enum(['fail', 'rename', 'version']).default('rename'), fileId: z.uuid().optional(), baseVersionId: z.uuid().optional(),
    }).parse(req.body);
    if (b.baseVersionId && !b.fileId) throw new UserError('invalid_request', 'baseVersionId needs fileId', 400);
    const u = userOf(req);
    if (b.size > config.maxFileBytes) throw new UserError('file_too_large', 'file exceeds the maximum size', 413, { max: config.maxFileBytes });
    const row = await tx(async (t) => {
      await lockOwner(t, u.id);
      await assertQuota(t, u.id, b.size);
      let folderId: string, name = sanitizeName(b.name), onConflict = b.onConflict;
      if (b.fileId) { // new version of a known file
        const f = await getFile(t, u.id, b.fileId);
        if (b.baseVersionId && f.current_version_id !== b.baseVersionId) throw versionConflict(f);
        folderId = f.folder_id; name = f.name; onConflict = 'version';
      } else {
        folderId = (await getFolder(t, u.id, b.folderId)).id;
        const segs = b.relativePath ? safePathSegments(b.relativePath).slice(0, -1) : [];
        if (segs.length) folderId = await ensurePath(t, u.id, folderId, segs);
      }
      const [r] = await t<UploadRow[]>`insert into uploads (owner_id, actor_user_id, folder_id, name, size, on_conflict, file_id, base_version_id, expires_at)
        values (${u.id}, ${u.id}, ${folderId}, ${name}, ${b.size}, ${onConflict}, ${b.fileId ?? null}, ${b.baseVersionId ?? null}, now() + interval '7 days') returning *, size::text, received::text`;
      return r!;
    });
    return uploadJson(row);
  });
  app.get('/api/v1/uploads/:id', authed, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return uploadJson(await mine(sql, userOf(req).id, id));
  });
  app.patch('/api/v1/uploads/:id', { ...authed, bodyLimit: MAX_CHUNK_BYTES + 4096 }, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const q = z.object({ offset: z.coerce.number().int().min(0) }).parse(req.query);
    const sha = req.headers['x-chunk-sha256'];
    const userId = userOf(req).id;
    const u = await appendChunk(id, q.offset, req.body as Readable, typeof sha === 'string' ? Sha.parse(sha) : undefined,
      async (_t, row) => { if (row.actor_user_id !== userId || row.grant_id) throw notFound('upload not found'); });
    return uploadJson(u);
  });
  app.post('/api/v1/uploads/:id/complete', authed, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const b = z.object({ sha256: Sha.optional() }).parse(req.body ?? {});
    const user = userOf(req);
    const [claimed] = await sql<UploadRow[]>`update uploads set status = 'completing', updated_at = now() where id = ${id} and actor_user_id = ${user.id} and grant_id is null and status = 'active' returning *, size::text, received::text`;
    if (!claimed) { // unknown, foreign, already done (idempotent answer) or being completed
      const u = await mine(sql, user.id, id);
      if (u.status === 'done' && u.file_id) return { ...uploadJson(u), file: fileJson(await getFile(sql, user.id, u.file_id, { trashed: true })) };
      throw new UserError('upload_closed', 'this upload is no longer active', 409);
    }
    try {
      const sha = await sealCheck(claimed, b.sha256);
      const result = await tx(async (t) => {
        await lockOwner(t, user.id);
        await assertQuota(t, user.id, Number(claimed.size), id);
        const [object] = await ensureObject(t, user.id, uploadPath(claimed), Number(claimed.size), sha);
        let file, created = false;
        if (claimed.file_id) {
          // optimistic concurrency: the version this content was derived from must still be the current one
          if (claimed.base_version_id) { const cur = await getFile(t, user.id, claimed.file_id); if (cur.current_version_id !== claimed.base_version_id && cur.sha256 !== sha) throw versionConflict(cur); }
          file = await addVersion(t, user.id, claimed.file_id, object, user.id);
        }
        else {
          const folder = await getFolder(t, user.id, claimed.folder_id ?? 'root').catch(() => getFolder(t, user.id, 'root')); // target trashed meanwhile → root
          ({ file, created } = await addFile(t, { ownerId: user.id, folderId: folder.id, name: claimed.name, object, onConflict: claimed.on_conflict, actorId: user.id }));
        }
        const [done] = await t<UploadRow[]>`update uploads set status = 'done', file_id = ${file.id}, updated_at = now() where id = ${id} returning *, size::text, received::text`;
        await audit(t, actorOf(req), created ? 'file.uploaded' : 'file.version_added', { targetType: 'file', targetId: file.id, meta: { size: Number(claimed.size) } });
        return { ...uploadJson(done!), file: fileJson(file), created };
      });
      await rm(uploadPath(claimed), { force: true });
      return result;
    } catch (e) {
      // a refused completion (conflict, quota, checksum) leaves the bytes in place so the client can decide again
      await sql`update uploads set status = 'active' where id = ${id} and status = 'completing'`;
      throw e;
    }
  });
  app.patch('/api/v1/uploads/:id/options', authed, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const b = z.object({ onConflict: z.enum(['fail', 'rename', 'version']).optional(), asNewFile: z.object({ name: z.string().min(1).max(1000) }).optional() })
      .refine((x) => !!x.onConflict !== !!x.asNewFile, 'give onConflict or asNewFile').parse(req.body);
    const userId = userOf(req).id;
    // A refused new version (version_conflict) keeps its bytes: the client can turn it into a separate file next to the
    // original (a conflict copy) without sending the content again.
    const [r] = b.asNewFile
      ? await sql`update uploads set file_id = null, base_version_id = null, name = ${sanitizeName(b.asNewFile.name)}, on_conflict = 'rename' where id = ${id} and actor_user_id = ${userId} and grant_id is null and status = 'active' and file_id is not null returning id`
      : await sql`update uploads set on_conflict = ${b.onConflict!} where id = ${id} and actor_user_id = ${userId} and grant_id is null and status = 'active' and file_id is null returning id`;
    if (!r) throw notFound('upload not found');
    return { ok: true };
  });
  app.delete('/api/v1/uploads/:id', authed, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [u] = await sql<UploadRow[]>`update uploads set status = 'aborted', updated_at = now() where id = ${id} and actor_user_id = ${userOf(req).id} and grant_id is null and status = 'active' returning *, size::text, received::text`;
    if (!u) throw notFound('upload not found');
    await rm(uploadPath(u), { force: true });
    return { ok: true };
  });
}
