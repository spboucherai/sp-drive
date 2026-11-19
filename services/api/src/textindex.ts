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
import { config } from './config.ts';
import { type Db, sql, tx } from './db.ts';
import { enqueue, type Handler } from './jobs.ts';
import { assertNotBomb, textkitEmbed, textkitExtract, textkitInfo, textutilToText, ToolError, withWorkDir, zipXmlText } from './tools.ts';
import { type FileRow, fileJoin, fileJson, fileSelect, getFile } from './tree.ts';

export type TextStatus = 'pending' | 'ready' | 'empty' | 'unsupported' | 'failed';
export interface Passage { page: number | null; text: string }
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'tif', 'tiff', 'bmp']);
const ZIP_XML: Record<string, (n: string) => boolean> = {
  docx: (n) => n === 'word/document.xml' || /^word\/(footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(n),
  pptx: (n) => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(n),
  xlsx: (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml',
  odt: (n) => n === 'content.xml', odp: (n) => n === 'content.xml', ods: (n) => n === 'content.xml',
};
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

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unescapeXml = (s: string) => s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]{2,6});/g, (m, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ' '; }
  return ENTITIES[e] ?? m;
});
/** Text of an XML or HTML fragment: block-level ends become line breaks, tags disappear. */
export function xmlToText(xml: string): string {
  return unescapeXml(xml.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(w:p|a:p|text:p|text:h|p|div|h[1-6]|li|tr|si|table:table-row)>|<(br|w:br|text:line-break)\b[^>]*\/?>/g, '\n').replace(/<\/(w:tc|table:table-cell|td|th|a:tc)>|<w:tab\/>/g, '\t').replace(/<[^>]{0,2000}>/g, ''));
}
const clean = (s: string) => s.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
/** Bytes → text: UTF-8 (with or without BOM), UTF-16 with BOM, otherwise Windows-1252. Binary content gives null. */
export function decodeText(buf: Buffer): string | null {
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) return new TextDecoder(buf[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(buf.subarray(2));
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
  const sample = text.slice(0, 4000);
  let odd = 0; for (let i = 0; i < sample.length; i++) { const c = sample.charCodeAt(i); if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12)) odd++; }
  return odd > sample.length * 0.02 ? null : text;
}

const PASSAGE = 900, MAX_PASSAGES = 4000;
/** Cut text into passages of about PASSAGE characters, at paragraph or sentence ends when there is one. */
export function passagesOf(text: string, page: number | null = null): Passage[] {
  const out: Passage[] = [];
  let rest = clean(text);
  while (rest.length) {
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
    case 'text': case 'html': {
      if (size > config.textMaxBytes) return unsupported(`text too large to index (limit ${Math.round(config.textMaxBytes / 1024 ** 2)} MB)`);
      const text = decodeText(await readFile(input));
      if (text === null) return unsupported('not a text file');
      return fromPages('text', [{ page: null, text: (family === 'html' || ext === 'svg' ? xmlToText(text) : text).slice(0, config.extractMaxChars) }], 0);
    }
    case 'zipxml': {
      await assertNotBomb(input);
      const parts = await zipXmlText(input, ZIP_XML[ext]!, 64 * 1024 * 1024);
      if (ext === 'pptx') {
        const n = (s: string) => Number(/(\d+)\.xml$/.exec(s)?.[1] ?? 0);
        const slides = parts.filter((p) => p.name.startsWith('ppt/slides/')).sort((a, b) => n(a.name) - n(b.name));
        const notes = new Map(parts.filter((p) => p.name.startsWith('ppt/notesSlides/')).map((p) => [n(p.name), xmlToText(p.xml)]));
        return fromPages('office-xml', slides.map((s) => ({ page: n(s.name), text: `${xmlToText(s.xml)}\n${notes.get(n(s.name)) ?? ''}` })), slides.length);
      }
      const main = parts.filter((p) => p.name !== 'xl/workbook.xml');
      const names = ext === 'xlsx' ? [...(parts.find((p) => p.name === 'xl/workbook.xml')?.xml ?? '').matchAll(/<sheet\b[^>]*\bname="([^"]{1,200})"/g)].map((m) => unescapeXml(m[1]!)).join('\n') : '';
      return fromPages('office-xml', [{ page: null, text: `${names}\n${main.map((p) => xmlToText(p.xml)).join('\n')}`.slice(0, config.extractMaxChars) }], 0);
    }
    case 'textutil': return fromPages('textutil', [{ page: null, text: (await textutilToText(work, input)).slice(0, config.extractMaxChars) }], 0);
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
/** Vector of a search query (same model as the passages), or null when the backend is not available. */
export async function embedQuery(text: string): Promise<number[] | null> {
  if (!(await semanticBackend()).available) return null;
  return withWorkDir(async (work) => (await textkitEmbed(work, [{ text: text.slice(0, 2000) }])).vectors[0]?.vector ?? null).catch(() => null);
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
  const [o] = await sql<(ObjectRow & { name: string | null; status: string | null })[]>`select o.*, o.size::text,
    (select f.name from files f join file_versions v on v.file_id = f.id where v.object_id = o.id order by v.created_at limit 1) as name,
    (select status from object_text x where x.object_id = o.id) as status from storage_objects o where o.id = ${objectId}`;
  if (!o?.name || !indexable(o)) return;
  if (o.status && o.status !== 'pending' && o.status !== 'failed' && !p.force) { if (o.status === 'ready') await embedPassages(objectId); return; }
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
const vectorCache = new Map<string, { sig: string; at: number; rows: { fileId: string; name: string; objectId: string; seq: number; page: number | null; v: Float32Array }[] }>();
const SEMANTIC_MAX_PASSAGES = 60000;
/** Passages nearest to a query vector (cosine; vectors are unit length). Scored in this process: fine up to tens of thousands. */
export async function semanticPassages(ownerId: string, query: number[], scope: { fileIds?: string[]; folderIds?: string[] }, limit: number): Promise<ScoredPassage[]> {
  const [s] = await sql<{ sig: string }[]>`select count(*)::text || ':' || coalesce(max(greatest(x.updated_at, f.updated_at))::text, '') || ':' || coalesce(max(f.rev)::text, '') as sig
    from files f join file_versions v on v.id = f.current_version_id join object_text x on x.object_id = v.object_id where f.owner_id = ${ownerId} and f.trashed_at is null and x.status = 'ready'`;
  let c = vectorCache.get(ownerId);
  if (!c || c.sig !== s!.sig) {
    const rows = await sql<{ fileId: string; name: string; objectId: string; seq: number; page: number | null; embedding: number[] }[]>`
      select f.id as "fileId", f.name, p.object_id as "objectId", p.seq, p.page, p.embedding from files f join file_versions v on v.id = f.current_version_id join object_passages p on p.object_id = v.object_id
      where f.owner_id = ${ownerId} and f.trashed_at is null and p.embedding is not null and array_length(p.embedding, 1) = ${query.length} limit ${SEMANTIC_MAX_PASSAGES}`;
    c = { sig: s!.sig, at: Date.now(), rows: rows.map((r) => ({ fileId: r.fileId, name: r.name, objectId: r.objectId, seq: r.seq, page: r.page, v: Float32Array.from(r.embedding) })) };
    vectorCache.set(ownerId, c);
    if (vectorCache.size > 20) vectorCache.delete(vectorCache.keys().next().value!);
  }
  const q = Float32Array.from(query);
  const files = scope.fileIds ? new Set(scope.fileIds) : null;
  let inFolders: Set<string> | null = null;
  if (scope.folderIds) inFolders = new Set((await sql<{ id: string }[]>`select id from files where owner_id = ${ownerId} and trashed_at is null and folder_id = any(${scope.folderIds})`).map((r) => r.id));
  const scored: { i: number; score: number }[] = [];
  for (let i = 0; i < c.rows.length; i++) {
    const r = c.rows[i]!;
    if ((files && !files.has(r.fileId)) || (inFolders && !inFolders.has(r.fileId))) continue;
    let dot = 0; const v = r.v; for (let k = 0; k < v.length; k++) dot += v[k]! * q[k]!;
    scored.push({ i, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  if (!top.length) return [];
  const texts = await sql<{ object_id: string; seq: number; text: string }[]>`select object_id, seq, text from object_passages
    where object_id = any(${[...new Set(top.map((x) => c!.rows[x.i]!.objectId))]}) and seq = any(${[...new Set(top.map((x) => c!.rows[x.i]!.seq))]})`;
  const byKey = new Map(texts.map((x) => [`${x.object_id}:${x.seq}`, x.text]));
  return top.map((x) => { const r = c!.rows[x.i]!; return { fileId: r.fileId, name: r.name, objectId: r.objectId, seq: r.seq, page: r.page, text: byKey.get(`${r.objectId}:${r.seq}`) ?? '', score: Math.round(x.score * 10000) / 10000 }; }).filter((x) => x.text);
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
    const vector = await embedQuery(q.q);
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
