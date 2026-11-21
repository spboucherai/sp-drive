/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/textextract.ts
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

// Node-side text extraction (text files, HTML, zip-based office documents). Pure: no configuration, no database.
// It only ever runs inside the sandboxed child process started by textindex.ts (extract-child.ts): hostile input can
// burn that child's CPU until its kill timer, never the worker's event loop. Every step is linear in its input and
// stops at a cap on the characters it reads and on the characters it produces.
import { readFile, writeFile } from 'node:fs/promises';
import yauzl from 'yauzl';

/** Characters of one XML / HTML part that are looked at; the rest of a larger part is ignored. */
export const MAX_SCAN_CHARS = 12_000_000;
/** Decompressed bytes read from one zip-based document. */
export const MAX_ZIP_XML_BYTES = 24 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const unescapeXml = (s: string) => s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]{2,6});/g, (m, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ' '; }
  return ENTITIES[e] ?? m;
});
const BLOCK_END = new Set(['w:p', 'a:p', 'text:p', 'text:h', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'si', 'table:table-row']);
const CELL_END = new Set(['w:tc', 'table:table-cell', 'td', 'th', 'a:tc']);
const BREAK = new Set(['br', 'w:br', 'text:line-break']);
const MAX_TAG = 2000;
/**
 * Text of an XML or HTML fragment: block-level ends become line breaks, cell ends become tabs, tags and the content
 * of <script> / <style> disappear. One forward pass: every position of the input is visited a bounded number of
 * times whatever it contains (a million unclosed "<" or "<script>" cost the same as a million letters).
 */
export function xmlToText(input: string, maxOut = Number.MAX_SAFE_INTEGER): string {
  const xml = input.length > MAX_SCAN_CHARS ? input.slice(0, MAX_SCAN_CHARS) : input;
  const n = xml.length;
  const out: string[] = [];
  let produced = 0, i = 0, textStart = 0;
  // position of the next ">" at or after the cursor, searched again only once the cursor has passed it
  let gt = -2;
  const nextGt = (from: number) => { if (gt !== -1 && gt < from) gt = xml.indexOf('>', from); return gt; };
  const push = (s: string) => { if (s) { out.push(s); produced += s.length; } };
  let lower: string | undefined; // lower-cased copy, made only if a <script> or <style> shows up
  while (i < n && produced < maxOut) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    // a tag starts with a letter, "/", "!" or "?": any other "<" is text ("1 < 2")
    const c0 = xml.charCodeAt(lt + 1);
    if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 47 || c0 === 33 || c0 === 63)) { i = lt + 1; continue; }
    const close = nextGt(lt + 1);
    if (close === -1) break; // no ">" anywhere after: the rest is text
    if (close - lt > MAX_TAG) { i = lt + 1; continue; } // not a tag: a literal "<"
    push(xml.slice(textStart, lt));
    // tag name: optional "/", then up to the first space, "/" or ">"
    let p = lt + 1;
    const closing = xml.charCodeAt(p) === 47; if (closing) p++;
    let e = p; while (e < close) { const c = xml.charCodeAt(e); if (c === 32 || c === 47 || c === 9 || c === 10 || c === 13) break; e++; }
    const name = xml.slice(p, e).toLowerCase();
    i = textStart = close + 1;
    if (closing) { if (BLOCK_END.has(name)) push('\n'); else if (CELL_END.has(name)) push('\t'); continue; }
    if (BREAK.has(name)) { push('\n'); continue; }
    if (name === 'w:tab') { push('\t'); continue; }
    if ((name === 'script' || name === 'style') && xml.charCodeAt(close - 1) !== 47) {
      lower ??= xml.toLowerCase();
      const end = lower.indexOf(`</${name}`, i);
      if (end === -1) { textStart = n; break; } // never closed: everything after it is script, not text
      push(' ');
      const endGt = nextGt(end);
      if (endGt === -1) { textStart = n; break; }
      i = textStart = endGt + 1;
    }
  }
  if (produced < maxOut && textStart < n) push(xml.slice(textStart));
  const text = out.join('');
  return unescapeXml(text.length > maxOut ? text.slice(0, maxOut) : text);
}
/** Bytes → text: UTF-8 (with or without BOM), UTF-16 with BOM, otherwise Windows-1252. Binary content gives null. */
export function decodeText(buf: Buffer): string | null {
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) return new TextDecoder(buf[0] === 0xff ? 'utf-16le' : 'utf-16be').decode(buf.subarray(2));
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('windows-1252').decode(buf); }
  const sample = text.slice(0, 4000);
  let odd = 0; for (let i = 0; i < sample.length; i++) { const c = sample.charCodeAt(i); if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12)) odd++; }
  return odd > sample.length * 0.02 ? null : text;
}

export const ZIP_XML: Record<string, (n: string) => boolean> = {
  docx: (n) => n === 'word/document.xml' || /^word\/(footnotes|endnotes|header\d{0,4}|footer\d{0,4})\.xml$/.test(n),
  pptx: (n) => /^ppt\/(slides|notesSlides)\/[^/]{1,80}\.xml$/.test(n),
  xlsx: (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml',
  odt: (n) => n === 'content.xml', odp: (n) => n === 'content.xml', ods: (n) => n === 'content.xml',
};
/** The XML parts of a zip-based document that hold its text, read with hard caps; nothing is written. */
export function zipXmlParts(path: string, wanted: (name: string) => boolean, maxBytes = MAX_ZIP_XML_BYTES): Promise<{ name: string; xml: string }[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(new Error(`unreadable document: ${err?.message ?? 'unknown'}`));
      const parts: { name: string; xml: string }[] = [];
      let total = 0, seen = 0, settled = false;
      const done = () => { if (settled) return; settled = true; try { zip.close(); } catch { /* closed */ } resolve(parts); };
      zip.on('entry', (e: yauzl.Entry) => {
        if (++seen > 20000 || total >= maxBytes || parts.length >= 2000) return done();
        if (!wanted(e.fileName) || e.uncompressedSize > maxBytes) return zip.readEntry();
        zip.openReadStream(e, (er, stream) => {
          if (er || !stream) return zip.readEntry();
          const chunks: Buffer[] = []; let n = 0;
          stream.on('data', (c: Buffer) => { n += c.length; total += c.length; if (total > maxBytes) { stream.destroy(); done(); } else chunks.push(c); });
          stream.on('end', () => { parts.push({ name: e.fileName, xml: Buffer.concat(chunks, n).toString('utf8') }); zip.readEntry(); });
          stream.on('error', () => zip.readEntry());
        });
      });
      zip.on('end', done);
      zip.on('error', (e) => { if (!settled) { settled = true; reject(new Error(`unreadable document: ${e.message}`)); } });
      zip.readEntry();
    });
  });
}

export interface NodeExtract { ok: boolean; reason?: 'binary'; source: 'text' | 'office-xml'; pageCount: number; pages: { page: number | null; text: string }[] }
/** Text of one file of the `text`, `html` or `zipxml` family, at most `maxChars` characters in all. */
export async function extractNode(family: 'text' | 'html' | 'zipxml', ext: string, input: string, maxChars: number): Promise<NodeExtract> {
  if (family !== 'zipxml') {
    const text = decodeText(await readFile(input));
    if (text === null) return { ok: false, reason: 'binary', source: 'text', pageCount: 0, pages: [] };
    return { ok: true, source: 'text', pageCount: 0, pages: [{ page: null, text: family === 'html' || ext === 'svg' ? xmlToText(text, maxChars) : text.slice(0, maxChars) }] };
  }
  const parts = await zipXmlParts(input, ZIP_XML[ext]!);
  let left = maxChars;
  const take = (xml: string) => { const t = left > 0 ? xmlToText(xml, left) : ''; left -= t.length; return t; };
  if (ext === 'pptx') {
    const n = (s: string) => Number(/(\d{1,6})\.xml$/.exec(s)?.[1] ?? 0);
    const slides = parts.filter((p) => p.name.startsWith('ppt/slides/')).sort((a, b) => n(a.name) - n(b.name));
    const notes = new Map(parts.filter((p) => p.name.startsWith('ppt/notesSlides/')).map((p) => [n(p.name), p.xml]));
    return { ok: true, source: 'office-xml', pageCount: slides.length, pages: slides.map((s) => ({ page: n(s.name), text: `${take(s.xml)}\n${take(notes.get(n(s.name)) ?? '')}` })) };
  }
  let names = '';
  if (ext === 'xlsx') {
    // sheet names: attribute scan with indexOf, no backtracking pattern
    const wb = (parts.find((p) => p.name === 'xl/workbook.xml')?.xml ?? '').slice(0, 2_000_000), found: string[] = [];
    for (let i = wb.indexOf('<sheet '); i !== -1 && found.length < 500; i = wb.indexOf('<sheet ', i + 7)) {
      const end = wb.indexOf('>', i); if (end === -1) break;
      const tag = wb.slice(i, Math.min(end, i + MAX_TAG)), a = tag.indexOf(' name="');
      if (a !== -1) { const q = tag.indexOf('"', a + 7); if (q !== -1) found.push(unescapeXml(tag.slice(a + 7, Math.min(q, a + 207)))); }
    }
    names = found.join('\n');
  }
  left -= names.length;
  return { ok: true, source: 'office-xml', pageCount: 0, pages: [{ page: null, text: `${names}\n${parts.filter((p) => p.name !== 'xl/workbook.xml').map((p) => take(p.xml)).join('\n')}` }] };
}
/** Body of the child process (extract-child.ts): <family> <ext> <input> <output.json> <maxChars>. */
export async function extractChild(argv: string[]): Promise<void> {
  const [family, ext, input, output, max] = argv;
  if (!['text', 'html', 'zipxml'].includes(family ?? '') || !input || !output) { console.error('usage: extract-child <text|html|zipxml> <ext> <input> <output.json> <maxChars>'); process.exit(2); }
  const r = await extractNode(family as 'text', ext ?? '', input, Math.max(1, Math.min(Number(max) || 2_000_000, 20_000_000)));
  await writeFile(output, JSON.stringify(r));
}
