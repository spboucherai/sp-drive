/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/textindex.ts
 * Module           : services
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-19
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

// Content index: text extracted from stored objects (worker job `extract_text`), cut into passages kept in PostgreSQL
// for full-text search, snippets, semantic search and document questions. Everything runs on the node: text families
// are read directly, zip-based office formats are read from their XML, PDF and images go through the sandboxed local
// helper (PDFKit text layer, Apple Vision OCR). SPD_INDEX_CONTENT=off turns the whole thing off.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { extOf, previewKind } from '@spd/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, userOf } from './auth.ts';
import { materialize, type ObjectRow } from './blob.ts';
import { config, UserError } from './config.ts';
import { type Db, sql, tx } from './db.ts';
import { enqueue, type Handler } from './jobs.ts';
import { type NodeExtract, ZIP_XML } from './textextract.ts';
import { assertNotBomb, nodeExtract, textkitEmbed, textkitExtract, textkitInfo, textutilToText, ToolError, withWorkDir } from './tools.ts';
import { type FileRow, fileJoin, fileJson, fileSelect, getFile } from './tree.ts';

export type TextStatus = 'pending' | 'ready' | 'empty' | 'unsupported' | 'failed';
export interface Passage { page: number | null; text: string }
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'tif', 'tiff', 'bmp']);
const TEXTUTIL = new Set(['doc', 'rtf']);

/** What kind of extraction a name calls for (decided from the sanitised name, like previews). */
export function textFamily(name: string): 'text' | 'html' | 'zipxml' | 'textutil' | 'pdf' | 'image' | 'legacy-office' | null {
  const ext = extOf(name), kind = previewKind(name);
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (ext in ZIP_XML) return 'zipxml';
  if (TEXTUTIL.has(ext)) return 'textutil';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'ppt' || ext === 'xls') return 'legacy-office';
  if (kind === 'text' || kind === 'markdown' || kind === 'csv' || kind === 'json' || ext === 'svg') return 'text';
  return null;
}

export { decodeText, xmlToText } from './textextract.ts';
const clean = (s: string) => s.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const PASSAGE = 900, MAX_PASSAGES = 4000, MAX_TEXT_CHARS = 4_000_000;
/** Cut text into passages of about PASSAGE characters, at paragraph or sentence ends when there is one. */
export function passagesOf(text: string, page: number | null = null): Passage[] {
  const out: Passage[] = [];
  let rest = clean(text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text);
  while (rest.length && out.length < MAX_PASSAGES) {
    if (rest.length <= PASSAGE) { out.push({ page, text: rest }); break; }
    const window = rest.slice(0, PASSAGE);
    let cut = window.lastIndexOf('\n\n');
    if (cut < PASSAGE * 0.4) cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'), window.lastIndexOf('? '), window.lastIndexOf('! ')) + 1;
    if (cut < PASSAGE * 0.4) cut = window.lastIndexOf('\n');
    if (cut < PASSAGE * 0.4) cut = window.lastIndexOf(' ');
    if (cut < PASSAGE * 0.4) cut = PASSAGE;
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push({ page, text: piece });
    rest = rest.slice(cut).trim();
  }
  return out;
}

interface Extracted { status: TextStatus; source: string; pages: number; passages: Passage[]; error?: string }
const unsupported = (error?: string): Extracted => ({ status: 'unsupported', source: '', pages: 0, passages: [], error });
/** Extract the text of one decrypted file. Never throws for "nothing to read": that is a status. */
async function extract(work: string, input: string, name: string, size: number, pdfPreview?: () => Promise<string | null>): Promise<Extracted> {
  const family = textFamily(name), ext = extOf(name);
  const fromPages = (source: string, pages: { page: number | null; text: string }[], count: number): Extracted => {
    const passages = pages.flatMap((p) => passagesOf(p.text, p.page)).slice(0, MAX_PASSAGES);
    return { status: passages.length ? 'ready' : 'empty', source, pages: count, passages };
  };
  const kit = async (file: string, label?: string): Promise<Extracted> => {
    if (!(await textkitInfo())) return unsupported('the local text helper is not installed on this server');
    const r = await textkitExtract(work, file, { ocr: config.ocr });
    if (r.locked) return unsupported('this PDF is protected by a password');
    return fromPages(label ?? r.source ?? (r.kind === 'image' ? 'ocr' : 'pdf-text'), r.pages.map((p) => ({ page: r.kind === 'pdf' ? p.page : null, text: p.text })), r.pageCount);
  };
  if (!family) return unsupported();
  if (size === 0) return { status: 'empty', source: '', pages: 0, passages: [] };
  if (size > config.extractMaxBytes) return unsupported(`file too large to index (limit ${Math.round(config.extractMaxBytes / 1024 ** 2)} MB)`);
  switch (family) {
    case 'text': case 'html': case 'zipxml': {
      if (family !== 'zipxml' && size > config.textMaxBytes) return unsupported(`text too large to index (limit ${Math.round(config.textMaxBytes / 1024 ** 2)} MB)`);
      if (family === 'zipxml') await assertNotBomb(input); // central directory only
      // parsing happens in a sandboxed child with a kill timer: a hostile file cannot hold the worker's event loop
      const r: NodeExtract = await nodeExtract(work, family, ext, input, config.extractMaxChars);
      if (!r.ok) return unsupported('not a text file');
      return fromPages(r.source, r.pages, r.pageCount);
    }
    case 'textutil': {
      if (size > config.textutilMaxBytes) return unsupported(`document too large to index (limit ${Math.round(config.textutilMaxBytes / 1024 ** 2)} MB)`);
      return fromPages('textutil', [{ page: null, text: await textutilToText(work, input, config.extractMaxChars) }], 0);
    }
    case 'pdf': case 'image': return kit(input);
    case 'legacy-office': {
      // old binary formats: only through the PDF rendition the preview pipeline already produced, when there is one
      const pdf = await pdfPreview?.();
      return pdf ? kit(pdf, 'office-pdf') : unsupported('no converter for this format on this server');
    }
  }
}

/** Is a local embedding model usable here? (the feature `semantic` of GET /api/v1/meta) */
export async function semanticBackend(): Promise<{ available: boolean; model: string | null; dim: number }> {
  if (config.semantic === 'off' || !config.indexContent) return { available: false, model: null, dim: 0 };
  const info = await textkitInfo();
  return info?.contextual?.assets && info.contextual.dimension > 0 ? { available: true, model: 'apple-nl-contextual', dim: info.contextual.dimension } : { available: false, model: null, dim: 0 };
}
const EMBED_MAX_PASSAGES = 600, EMBED_BATCH = 48;
async function embedPassages(objectId: string): Promise<void> {
  if (!(await semanticBackend()).available) return;
  const rows = await sql<{ seq: number; text: string }[]>`select seq, text from object_passages where object_id = ${objectId} and embedding is null order by seq limit ${EMBED_MAX_PASSAGES}`;
  if (!rows.length) return;
  await withWorkDir(async (work) => {
    for (let i = 0; i < rows.length; i += EMBED_BATCH) {
      const batch = rows.slice(i, i + EMBED_BATCH);
      const r = await textkitEmbed(work, batch.map((b) => ({ text: b.text })));
      for (let k = 0; k < batch.length; k++) { const v = r.vectors[k]?.vector; if (v?.length) await sql`update object_passages set embedding = ${v} where object_id = ${objectId} and seq = ${batch[k]!.seq}`; }
    }
  });
}
const queryVectors = new Map<string, { at: number; v: Promise<number[] | null> }>();
/**
 * Vector of a search query (same model as the passages), or null when the backend is not available. The same query
 * asked again within ten minutes, or by several requests at once, starts the helper once. Throws ToolError('busy')
 * when the helper's queue is full.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  if (!(await semanticBackend()).available) return null;
  const key = text.slice(0, 2000);
  const hit = queryVectors.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) { queryVectors.delete(key); queryVectors.set(key, hit); return hit.v; }
  const v = withWorkDir(async (work) => (await textkitEmbed(work, [{ text: key }])).vectors[0]?.vector ?? null);
  const entry = { at: Date.now(), v };
  queryVectors.set(key, entry);
  if (queryVectors.size > 300) queryVectors.delete(queryVectors.keys().next().value!);
  try { return await v; } catch (e) { if (queryVectors.get(key) === entry) queryVectors.delete(key); if (e instanceof ToolError && e.code === 'busy') throw e; return null; }
}

const setStatus = (objectId: string, e: { status: TextStatus; source?: string; pages?: number; chars?: number; error?: string | null }) =>
  sql`insert into object_text (object_id, status, source, pages, chars, error) values (${objectId}, ${e.status}, ${e.source ?? ''}, ${e.pages ?? 0}, ${e.chars ?? 0}, ${e.error ?? null})
    on conflict (object_id) do update set status = excluded.status, source = excluded.source, pages = excluded.pages, chars = excluded.chars, error = excluded.error, updated_at = now()`.catch(() => {}); // object deleted meanwhile

/** May this object's content be indexed? Clean scans only (a development server without antivirus indexes unscanned content). */
const indexable = (o: { scan_status: string }) => o.scan_status === 'clean' || (config.avMode === 'optional' && o.scan_status === 'error');
/** Queue the extraction of an object's text (no-op when indexing is off). */
export async function enqueueExtract(t: Db, objectId: string, force = false): Promise<void> {
  if (!config.indexContent) return;
  await enqueue(t, 'extract_text', { objectId, ...(force ? { force: true } : {}) }, { dedupeKey: `text:${objectId}`, maxAttempts: 2 });
}

export const extractText: Handler = async (p) => {
  if (!config.indexContent) return;
  const objectId = String(p.objectId);
  const [row] = await sql<(ObjectRow & { names: string[] | null; status: string | null })[]>`select o.*, o.size::text,
    -- every name this content goes by, the files showing it as their current version first: one content can be a
    -- version of several files, and a name that cannot be indexed (data.bin) must not hide one that can (notes.txt)
    (select array_agg(n.name) from (select f.name from files f join file_versions v on v.file_id = f.id where v.object_id = o.id
       order by (f.current_version_id = v.id) desc, (f.trashed_at is null) desc, v.created_at desc limit 40) n) as names,
    (select status from object_text x where x.object_id = o.id) as status from storage_objects o where o.id = ${objectId}`;
  if (!row?.names?.length || !indexable(row)) return;
  const name = row.names.find((n) => textFamily(n)) ?? row.names[0]!;
  const o = { ...row, name };
  // done already — unless it was set aside as unsupported under a name that said nothing and a better name exists now
  if (o.status && o.status !== 'pending' && o.status !== 'failed' && !p.force && !(o.status === 'unsupported' && textFamily(name))) { if (o.status === 'ready') await embedPassages(objectId); return; }
  const size = Number(o.size), ext = extOf(o.name);
  if (!textFamily(o.name)) { await setStatus(objectId, { status: 'unsupported' }); return; }
  await setStatus(objectId, { status: 'pending' });
  let result: Extracted;
  try {
    result = await withWorkDir(async (work) => {
      const input = join(work, `input.${ext || 'bin'}`);
      if (size <= config.extractMaxBytes) await materialize(o, input);
      return extract(work, input, o.name!, size, async () => {
        const [pv] = await sql<{ storage_key: string; wrapped_key: Buffer; size: string }[]>`select storage_key, wrapped_key, size::text from previews where object_id = ${objectId} and kind = 'pdf' and status = 'ready'`;
        if (!pv) return null;
        const pdf = join(work, 'rendition.pdf'); await materialize({ storage_key: pv.storage_key, wrapped_key: pv.wrapped_key, size: Number(pv.size) }, pdf);
        return (await stat(pdf)).size > 0 ? pdf : null;
      });
    });
  } catch (e) {
    // a tool that refuses the document is a final answer; anything else (crash, time-out of the machine) is retried once by the queue
    await setStatus(objectId, { status: 'failed', error: e instanceof ToolError ? e.message : 'the text could not be extracted' });
    if (e instanceof ToolError) return;
    throw e;
  }
  const chars = result.passages.reduce((n, x) => n + x.text.length, 0);
  await tx(async (t) => {
    const [still] = await t`select 1 from storage_objects where id = ${objectId} for share`;
    if (!still) return;
    await t`delete from object_passages where object_id = ${objectId}`;
    for (let i = 0; i < result.passages.length; i += 200) {
      const rows = result.passages.slice(i, i + 200).map((x, k) => ({ object_id: objectId, seq: i + k, page: x.page, text: x.text }));
      await t`insert into object_passages (object_id, seq, page, text, tsv)
        select r.object_id::uuid, r.seq::int, r.page::int, r.text, to_tsvector('spd_fr', r.text) || to_tsvector('spd_en', r.text) || to_tsvector('spd_plain', r.text)
        from jsonb_to_recordset(${t.json(rows as never)}) as r(object_id text, seq int, page int, text text)`;
    }
    await t`insert into object_text (object_id, status, source, pages, chars, error) values (${objectId}, ${result.status}, ${result.source}, ${result.pages}, ${chars}, ${result.error ?? null})
      on conflict (object_id) do update set status = excluded.status, source = excluded.source, pages = excluded.pages, chars = excluded.chars, error = excluded.error, updated_at = now()`;
  });
  if (result.status === 'ready') await embedPassages(objectId).catch((e) => console.error(JSON.stringify({ level: 'error', msg: 'embedding failed', object: objectId, error: String((e as Error).message) })));
};

/** Queue every indexable object that has no text yet (`all`: every one again). Returns how many were queued. */
export async function reindex(o: { all?: boolean; failed?: boolean } = {}): Promise<number> {
  if (!config.indexContent) return 0;
  const rows = await sql<{ id: string }[]>`select o.id from storage_objects o left join object_text x on x.object_id = o.id
    where exists (select 1 from file_versions v where v.object_id = o.id)
      and (o.scan_status = 'clean' ${config.avMode === 'optional' ? sql`or o.scan_status = 'error'` : sql``})
      and (${!!o.all} or x.object_id is null or x.status = 'pending' ${o.failed ? sql`or x.status = 'failed'` : sql``}) order by o.size`;
  for (const r of rows) await enqueueExtract(sql, r.id, true);
  return rows.length;
}

// --- queries used by search, the AI layer and the routes ----------------------------------------------------
/** The three text-search configurations at once: a French, English or exact-form match all count. */
export const tsQuery = (t: Db, q: string) => t`(websearch_to_tsquery('spd_fr', ${q}) || websearch_to_tsquery('spd_en', ${q}) || websearch_to_tsquery('spd_plain', ${q}))`;
/** Same, but any word of the question may match (retrieval for questions in natural language). */
export const tsQueryAny = (t: Db, q: string) => t`(replace(plainto_tsquery('spd_fr', ${q})::text, '&', '|')::tsquery || replace(plainto_tsquery('spd_en', ${q})::text, '&', '|')::tsquery)`;
const HEADLINE = 'StartSel=⟦, StopSel=⟧, MaxWords=26, MinWords=10, MaxFragments=1';
/** Snippet of a passage with the matched words between ⟦ ⟧ (French analysis first, English when it marks nothing). */
export type Frag = ReturnType<typeof sql>;
export const snippet = (t: Db, text: Frag, query: Frag) => t`(select case when position('⟦' in h.fr) > 0 then h.fr else ts_headline('spd_en', ${text}, ${query}, ${HEADLINE}) end
  from (select ts_headline('spd_fr', ${text}, ${query}, ${HEADLINE}) as fr) h)`;
export const tidySnippet = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 400);

export interface ScoredPassage { fileId: string; name: string; objectId: string; seq: number; page: number | null; text: string; score: number }
/** Live current-version passages of an owner, optionally limited to files or to a folder subtree. */
const scopeSql = (t: Db, ownerId: string, scope: { fileIds?: string[]; folderIds?: string[] }) => t`f.owner_id = ${ownerId} and f.trashed_at is null
  ${scope.fileIds ? t`and f.id = any(${scope.fileIds})` : t``} ${scope.folderIds ? t`and f.folder_id = any(${scope.folderIds})` : t``}`;
export async function lexicalPassages(ownerId: string, question: string, scope: { fileIds?: string[]; folderIds?: string[] }, limit: number): Promise<ScoredPassage[]> {
  const rows = await sql<(Omit<ScoredPassage, 'score'> & { score: number })[]>`
    with q as (select ${tsQueryAny(sql, question)} as query)
    select f.id as "fileId", f.name, p.object_id as "objectId", p.seq, p.page, p.text, ts_rank_cd(p.tsv, q.query, 32)::float8 as score
    from q, files f join file_versions v on v.id = f.current_version_id join object_passages p on p.object_id = v.object_id
    where ${scopeSql(sql, ownerId, scope)} and numnode(q.query) > 0 and p.tsv @@ q.query order by score desc, f.id, p.seq limit ${limit}`.catch((e: { code?: string }) => { if (e.code === '42601' || e.code === '22023') return []; throw e; });
  return rows as ScoredPassage[];
}
/** The opening passages of given files (a question such as "summarise this" shares no word with the text). */
export async function leadPassages(ownerId: string, fileIds: string[], perFile: number, limit: number): Promise<ScoredPassage[]> {
  const rows = await sql<ScoredPassage[]>`select f.id as "fileId", f.name, p.object_id as "objectId", p.seq, p.page, p.text, 0::float8 as score
    from files f join file_versions v on v.id = f.current_version_id join object_passages p on p.object_id = v.object_id
    where f.owner_id = ${ownerId} and f.trashed_at is null and f.id = any(${fileIds}) and p.seq < ${perFile} order by p.seq, f.id limit ${limit}`;
  return rows;
}
// Passage vectors of an account, kept as ONE Float32Array (rows × dimension) plus a small record per passage. The
// cache is bounded in bytes over all accounts (least recently used first out) and in passages per account.
interface VectorSet { sig: string; dim: number; bytes: number; vectors: Float32Array; rows: { fileId: string; name: string; objectId: string; seq: number; page: number | null }[] }
const vectorCache = new Map<string, VectorSet>();
let vectorCacheBytes = 0;
export const vectorCacheStats = () => ({ accounts: vectorCache.size, bytes: vectorCacheBytes });
export const SEMANTIC_MAX_PASSAGES = 30000;
const ROW_OVERHEAD = 320;
async function vectorsOf(ownerId: string, dim: number): Promise<VectorSet> {
  const [s] = await sql<{ sig: string }[]>`select count(*)::text || ':' || coalesce(max(greatest(x.updated_at, f.updated_at))::text, '') || ':' || coalesce(max(f.rev)::text, '') as sig
    from files f join file_versions v on v.id = f.current_version_id join object_text x on x.object_id = v.object_id where f.owner_id = ${ownerId} and f.trashed_at is null and x.status = 'ready'`;
  const sig = `${dim}:${s!.sig}`;
  const hit = vectorCache.get(ownerId);
  if (hit && hit.sig === sig) { vectorCache.delete(ownerId); vectorCache.set(ownerId, hit); return hit; }
  const [n] = await sql<{ n: number }[]>`select least(count(*), ${SEMANTIC_MAX_PASSAGES})::int as n from files f join file_versions v on v.id = f.current_version_id join object_passages p on p.object_id = v.object_id
    where f.owner_id = ${ownerId} and f.trashed_at is null and p.embedding is not null and array_length(p.embedding, 1) = ${dim}`;
  const vectors = new Float32Array(n!.n * dim), rows: VectorSet['rows'] = [];
  // array_send gives the vector as bytes (20-byte header, then per element a 4-byte length and a big-endian float):
  // read in small batches straight into the typed array, no intermediate array of numbers
  const cursor = sql<{ fileId: string; name: string; objectId: string; seq: number; page: number | null; raw: Buffer }[]>`
    select f.id as "fileId", f.name, p.object_id as "objectId", p.seq, p.page, array_send(p.embedding) as raw from files f join file_versions v on v.id = f.current_version_id join object_passages p on p.object_id = v.object_id
    where f.owner_id = ${ownerId} and f.trashed_at is null and p.embedding is not null and array_length(p.embedding, 1) = ${dim} limit ${n!.n}`.cursor(400);
  for await (const batch of cursor) for (const r of batch) {
    if (rows.length >= n!.n || r.raw.length !== 20 + dim * 8) continue;
    const base = rows.length * dim;
    for (let k = 0; k < dim; k++) vectors[base + k] = r.raw.readFloatBE(24 + k * 8);
    rows.push({ fileId: r.fileId, name: r.name, objectId: r.objectId, seq: r.seq, page: r.page });
  }
  const set: VectorSet = { sig, dim, bytes: vectors.byteLength + rows.length * ROW_OVERHEAD, vectors, rows };
  if (hit) vectorCacheBytes -= hit.bytes;
  vectorCache.delete(ownerId); vectorCache.set(ownerId, set); vectorCacheBytes += set.bytes;
  while (vectorCacheBytes > config.semanticCacheBytes && vectorCache.size > 1) { const [oldest, v] = vectorCache.entries().next().value!; vectorCache.delete(oldest); vectorCacheBytes -= v.bytes; }
  return set;
}
/** Passages nearest to a query vector (cosine; vectors are unit length). Scored in this process: fine up to tens of thousands. */
export async function semanticPassages(ownerId: string, query: number[], scope: { fileIds?: string[]; folderIds?: string[] }, limit: number): Promise<ScoredPassage[]> {
  const c = await vectorsOf(ownerId, query.length);
  const q = Float32Array.from(query);
  const files = scope.fileIds ? new Set(scope.fileIds) : null;
  let inFolders: Set<string> | null = null;
  if (scope.folderIds) inFolders = new Set((await sql<{ id: string }[]>`select id from files where owner_id = ${ownerId} and trashed_at is null and folder_id = any(${scope.folderIds})`).map((r) => r.id));
  const scored: { i: number; score: number }[] = [];
  const dim = c.dim, vs = c.vectors;
  for (let i = 0; i < c.rows.length; i++) {
    const r = c.rows[i]!;
    if ((files && !files.has(r.fileId)) || (inFolders && !inFolders.has(r.fileId))) continue;
    let dot = 0; const base = i * dim; for (let k = 0; k < dim; k++) dot += vs[base + k]! * q[k]!;
    scored.push({ i, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  if (!top.length) return [];
  const texts = await sql<{ object_id: string; seq: number; text: string }[]>`select object_id, seq, text from object_passages
    where object_id = any(${[...new Set(top.map((x) => c.rows[x.i]!.objectId))]}) and seq = any(${[...new Set(top.map((x) => c.rows[x.i]!.seq))]})`;
  const byKey = new Map(texts.map((x) => [`${x.object_id}:${x.seq}`, x.text]));
  return top.map((x) => { const r = c.rows[x.i]!; return { fileId: r.fileId, name: r.name, objectId: r.objectId, seq: r.seq, page: r.page, text: byKey.get(`${r.objectId}:${r.seq}`) ?? '', score: Math.round(x.score * 10000) / 10000 }; }).filter((x) => x.text);
}
/** Ids of a live folder and of every live folder below it. */
export async function subtreeFolderIds(t: Db, ownerId: string, folderId: string): Promise<string[]> {
  return (await t<{ id: string }[]>`with recursive sub as (select id, 0 as depth from folders where id = ${folderId} and owner_id = ${ownerId} and trashed_at is null
    union all select c.id, sub.depth + 1 from folders c join sub on c.parent_id = sub.id where c.trashed_at is null and sub.depth < 100) select id from sub`).map((r) => r.id);
}

export async function indexStatus(ownerId: string) {
  const [c] = await sql<{ ready: number; pending: number; failed: number; unsupported: number; empty: number; embedded: number }[]>`
    with mine as (select distinct v.object_id, o.scan_status from files f join file_versions v on v.id = f.current_version_id join storage_objects o on o.id = v.object_id where f.owner_id = ${ownerId} and f.trashed_at is null)
    select count(*) filter (where x.status = 'ready')::int as ready,
      count(*) filter (where x.status = 'pending' or (x.object_id is null and ${config.indexContent} and m.scan_status in ('pending', 'clean')))::int as pending,
      count(*) filter (where x.status = 'failed')::int as failed, count(*) filter (where x.status = 'unsupported')::int as unsupported, count(*) filter (where x.status = 'empty')::int as empty,
      (select count(*)::int from object_passages p join mine m2 on m2.object_id = p.object_id where p.embedding is not null) as embedded
    from mine m left join object_text x on x.object_id = m.object_id`;
  const sem = await semanticBackend();
  return { content: { enabled: config.indexContent, ready: c!.ready, pending: c!.pending, failed: c!.failed, unsupported: c!.unsupported, empty: c!.empty }, semantic: { available: sem.available, model: sem.model, embedded: c!.embedded } };
}

export function textRoutes(app: FastifyInstance): void {
  const authed = { preHandler: requireUser };
  const Id = z.uuid();

  app.get('/api/v1/files/:id/text', authed, async (req) => {
    const { id } = z.object({ id: Id }).parse(req.params);
    const f = await getFile(sql, userOf(req).id, id, { trashed: true });
    const [x] = await sql<{ status: TextStatus; source: string; pages: number; chars: number; error: string | null }[]>`select status, source, pages, chars, error from object_text where object_id = ${f.object_id!}`;
    if (!x) {
      // Where the antivirus is optional and absent, the scan ends as "error / scanner_unavailable" and the extraction is
      // queued right after: that file is waiting too, not "unsupported" (a client stops polling on that answer).
      const [o] = f.scan_status === 'error' && config.avMode === 'optional' ? await sql<{ scan_detail: string | null }[]>`select scan_detail from storage_objects where id = ${f.object_id!}` : [];
      const waiting = config.indexContent && !!textFamily(f.name) && (f.scan_status === 'pending' || f.scan_status === 'clean' || o?.scan_detail === 'scanner_unavailable');
      return { status: (waiting ? 'pending' : 'unsupported') as TextStatus, source: null, pages: 0, chars: 0, excerpt: '', error: null };
    }
    const first = x.status === 'ready' ? await sql<{ text: string }[]>`select text from object_passages where object_id = ${f.object_id!} order by seq limit 2` : [];
    return { status: x.status, source: x.source || null, pages: x.pages, chars: x.chars, excerpt: first.map((p) => p.text).join('\n').slice(0, 800), error: x.status === 'failed' || x.status === 'unsupported' ? x.error : null };
  });

  app.get('/api/v1/index/status', authed, async (req) => indexStatus(userOf(req).id));

  app.get('/api/v1/search/semantic', { ...authed, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const q = z.object({ q: z.string().trim().min(1).max(500), limit: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.query);
    const u = userOf(req);
    const vector = await embedQuery(q.q).catch((e) => { throw e instanceof ToolError && e.code === 'busy' ? new UserError('busy', 'search is busy, try again in a moment', 503, { retryAfterS: 2 }) : e; });
    if (!vector) return { available: false, hits: [] };
    // several passages of one file may be near: the best one speaks for the file
    const near = await semanticPassages(u.id, vector, {}, q.limit * 4);
    const best = new Map<string, ScoredPassage>();
    for (const p of near) if (!best.has(p.fileId)) best.set(p.fileId, p);
    const top = [...best.values()].slice(0, q.limit);
    if (!top.length) return { available: true, hits: [] };
    const files = await sql<FileRow[]>`select ${fileSelect(sql)} from files f ${fileJoin(sql)} where f.owner_id = ${u.id} and f.trashed_at is null and f.id = any(${top.map((x) => x.fileId)})`;
    const byId = new Map(files.map((f) => [f.id, f]));
    return { available: true, hits: top.filter((x) => byId.has(x.fileId)).map((x) => ({ file: fileJson(byId.get(x.fileId)!), score: x.score, passage: { text: x.text.slice(0, 600), page: x.page } })) };
  });
}
