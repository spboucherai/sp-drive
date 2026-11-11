// Serving stored bytes: originals (with Range), derived previews and ZIP exports. Authorisation happens in the
// callers; this module only knows how to answer safely once access is granted.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { extOf, INLINE_MIME, previewKind } from '@spd/shared';
import yazl from 'yazl';
import { readSealed, type Sealed } from './blob.ts';
import { notFound, UserError } from './config.ts';
import type { Db } from './db.ts';

export interface ContentRow extends Sealed { object_id: string; name: string; sha256: string; scan_status: string }
/** The stored object behind a file (current version, or a given version of that file). */
export async function contentOf(t: Db, fileId: string, versionId?: string): Promise<ContentRow> {
  const [r] = await t<ContentRow[]>`select o.id as object_id, o.storage_key, o.wrapped_key, o.size::text as size, o.sha256, o.scan_status, f.name
    from files f join file_versions v on v.file_id = f.id and v.id = ${versionId ?? t`f.current_version_id`} join storage_objects o on o.id = v.object_id where f.id = ${fileId}`;
  if (!r) throw notFound('file not found');
  return { ...r, size: Number(r.size) };
}

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback. */
export function disposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
/** Headers that make user content inert in the browser, whatever its type. */
export function inertHeaders(reply: FastifyReply): void {
  reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // multi-range or other units: answer with the whole body
  let start: number, end: number;
  if (m[1] === '') { const n = Number(m[2]); if (n === 0) return 'invalid'; start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  return start > end || start >= size ? 'invalid' : { start, end };
}

export interface SendOptions { name: string; etag: string; mode: 'download' | 'inline' | 'text'; contentType?: string; cache?: string }
/** Stream a sealed object, honouring Range and conditional requests. */
export function sendSealed(req: FastifyRequest, reply: FastifyReply, o: Sealed, opt: SendOptions): FastifyReply {
  const size = Number(o.size);
  const etag = `"${opt.etag}"`;
  inertHeaders(reply);
  reply.header('ETag', etag).header('Accept-Ranges', 'bytes').header('Cache-Control', opt.cache ?? 'private, no-cache');
  if (req.headers['if-none-match'] === etag) return reply.code(304).send();
  const inlineType = INLINE_MIME[extOf(opt.name)];
  if (opt.contentType) reply.type(opt.contentType).header('Content-Disposition', disposition('inline', opt.name));
  else if (opt.mode === 'text') reply.type('text/plain; charset=utf-8').header('Content-Disposition', disposition('inline', opt.name));
  else if (opt.mode === 'inline' && inlineType) reply.type(inlineType).header('Content-Disposition', disposition('inline', opt.name));
  else reply.type('application/octet-stream').header('Content-Disposition', disposition('attachment', opt.name));
  const ifRange = req.headers['if-range'];
  const range = ifRange && ifRange !== etag ? null : parseRange(req.headers.range, size);
  if (range === 'invalid') return reply.code(416).header('Content-Range', `bytes */${size}`).send();
  if (req.method === 'HEAD') return reply.header('Content-Length', size).send();
  if (range) {
    reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`).header('Content-Length', range.end - range.start + 1);
    return reply.send(readSealed(o, range.start, range.end));
  }
  return reply.header('Content-Length', size).send(readSealed(o));
}

/** Answer a derived preview (thumbnail, PDF rendition, JSON inventory…) of an object. */
const PREVIEW_TYPE: Record<string, string> = { thumb: 'image/jpeg', image: 'image/jpeg', pdf: 'application/pdf', sheet: 'application/json; charset=utf-8', archive: 'application/json; charset=utf-8' };
export async function sendPreview(t: Db, req: FastifyRequest, reply: FastifyReply, objectId: string, kind: string, name: string): Promise<FastifyReply> {
  if (!(kind in PREVIEW_TYPE)) throw notFound('unknown preview');
  const [p] = await t<{ status: string; storage_key: string | null; wrapped_key: Buffer | null; size: string | null; error: string | null }[]>`
    select status, storage_key, wrapped_key, size::text, error from previews where object_id = ${objectId} and kind = ${kind}`;
  if (!p || p.status === 'pending') return reply.code(202).send({ status: 'pending' });
  if (p.status === 'unsupported') throw new UserError('preview_unsupported', 'no preview for this format', 404);
  if (p.status === 'failed' || !p.storage_key || !p.wrapped_key) throw new UserError('preview_failed', p.error ?? 'the preview could not be produced', 422);
  return sendSealed(req, reply, { storage_key: p.storage_key, wrapped_key: p.wrapped_key, size: Number(p.size) },
    { name: `${name}.${kind}`, etag: `${objectId}-${kind}`, mode: 'inline', contentType: PREVIEW_TYPE[kind], cache: 'private, max-age=3600' });
}
/** Which derived previews the client should ask for, by file kind. */
export const previewPlan = (name: string): string[] => {
  switch (previewKind(name)) {
    case 'image': return ['thumb'];
    case 'heic': return ['thumb', 'image'];
    case 'pdf': return ['thumb'];
    case 'office': return ['pdf'];
    case 'sheet': return ['sheet'];
    case 'archive': return ['archive'];
    default: return [];
  }
};

export interface ZipEntry { path: string; content: Sealed }
const ZIP_MAX_FILES = 20000;
/** Stream a ZIP of the given entries (stored, not compressed: most documents are already compressed). */
export function sendZip(reply: FastifyReply, name: string, entries: ZipEntry[]): FastifyReply {
  if (entries.length > ZIP_MAX_FILES) throw new UserError('too_many_items', 'too many files for one archive', 413);
  const zip = new yazl.ZipFile();
  const seen = new Set<string>();
  for (const e of entries) {
    let path = e.path.replace(/^\/+/, '');
    for (let i = 2; seen.has(path.toLowerCase()); i++) path = e.path.replace(/(\.[^./]*)?$/, ` (${i})$1`);
    seen.add(path.toLowerCase());
    zip.addReadStreamLazy(path, { compress: false, size: Number(e.content.size) }, (cb) => cb(null, readSealed(e.content)));
  }
  zip.end();
  inertHeaders(reply);
  reply.type('application/zip').header('Content-Disposition', disposition('attachment', name)).header('Cache-Control', 'private, no-store');
  return reply.send(zip.outputStream);
}
