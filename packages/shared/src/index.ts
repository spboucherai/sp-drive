// Rules shared by the API, the worker and the web app. No I/O here.

export const MAX_NAME_BYTES = 255;
export const CHUNK_BYTES = 8 * 1024 * 1024; // upload chunk the web client sends
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024; // largest chunk the API accepts

const RESERVED = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9']);
// control characters, path separators, characters refused by common file systems, bidi overrides and zero-width marks
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f/\\:*?"<>|‪-‮⁦-⁩​-‏﻿]/g;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;
function truncateUtf8(s: string, max: number): string {
  let out = '';
  let n = 0;
  for (const ch of s) { const l = utf8Length(ch); if (n + l > max) break; out += ch; n += l; }
  return out;
}

/** Split "archive.tar.gz" into ["archive", ".tar.gz"]; a leading dot is part of the stem. */
export function splitExt(name: string): [string, string] {
  const m = /^(.+?)((?:\.tar)?\.[A-Za-z0-9]{1,10})$/.exec(name);
  return m ? [m[1]!, m[2]!] : [name, ''];
}
/** Lower-case extension without the dot ("" when none). */
export const extOf = (name: string): string => { const e = splitExt(name)[1]; return e ? e.slice(e.lastIndexOf('.') + 1).toLowerCase() : ''; };

/**
 * Turn any client-supplied name into one safe to store, to show, to put in a ZIP and to write on a file system.
 * Never returns a path: separators are replaced, "." and ".." cannot survive, the result is never empty.
 */
export function sanitizeName(raw: string, fallback = 'sans-nom'): string {
  let s = String(raw ?? '').normalize('NFC').replace(BAD_CHARS, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, '').trim(); // no hidden/relative names, no trailing dot or space
  if (!s) s = fallback;
  const [stem, ext] = splitExt(s);
  if (RESERVED.has(stem.toLowerCase())) s = `_${s}`;
  if (utf8Length(s) > MAX_NAME_BYTES) {
    const [st, ex] = splitExt(s);
    const keepExt = utf8Length(ex) <= 20 ? ex : '';
    s = truncateUtf8(st, MAX_NAME_BYTES - utf8Length(keepExt)) + keepExt;
  }
  return s || fallback;
}
/** Key used for uniqueness inside a folder: case- and normalisation-insensitive. */
export const nameKey = (name: string): string => name.normalize('NFC').toLowerCase();

/** "rapport.pdf" → "rapport (2).pdf" → "rapport (3).pdf" … */
export function nextFreeName(name: string, taken: (key: string) => boolean): string {
  if (!taken(nameKey(name))) return name;
  const [stem0, ext] = splitExt(name);
  const m = /^(.*) \((\d+)\)$/.exec(stem0);
  const stem = m ? m[1]! : stem0;
  for (let i = m ? Number(m[2]) + 1 : 2; i < 100000; i++) {
    const candidate = sanitizeName(`${truncateUtf8(stem, MAX_NAME_BYTES - utf8Length(ext) - 12)} (${i})${ext}`);
    if (!taken(nameKey(candidate))) return candidate;
  }
  throw new Error('no free name');
}

/** Split a client relative path ("Dossier/sous/fichier.txt") into safe segments; rejects traversal by construction. */
export function safePathSegments(rel: string): string[] {
  return String(rel ?? '').split(/[/\\]+/).filter((p) => p && p !== '.' && p !== '..').map((p) => sanitizeName(p));
}

export type PreviewKind = 'pdf' | 'image' | 'heic' | 'svg' | 'video' | 'audio' | 'text' | 'markdown' | 'csv' | 'json' | 'office' | 'sheet' | 'archive' | 'none';

const TEXT_EXT = new Set(['txt', 'log', 'ini', 'conf', 'cfg', 'env', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'zsh', 'bash', 'sql', 'r', 'tex', 'bib', 'do', 'm', 'jl', 'lua', 'pl', 'gitignore', 'dockerfile', 'makefile', 'tsv', 'srt', 'vtt', 'rtf']);
const BY_EXT: Record<string, PreviewKind> = {
  pdf: 'pdf', jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', heic: 'heic', heif: 'heic', svg: 'svg',
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', flac: 'audio',
  md: 'markdown', markdown: 'markdown', csv: 'csv', json: 'json', geojson: 'json',
  docx: 'office', doc: 'office', odt: 'office', pptx: 'office', ppt: 'office', odp: 'office', xlsx: 'sheet',
  zip: 'archive', tar: 'archive', tgz: 'archive', gz: 'archive',
};
/** How a file is previewed, decided from its (sanitised) name. The server decides independently what it may serve inline. */
export function previewKind(name: string): PreviewKind {
  const ext = extOf(name);
  if (ext === 'gz') return /\.tar\.gz$/i.test(name) ? 'archive' : 'none';
  return BY_EXT[ext] ?? (TEXT_EXT.has(ext) ? 'text' : 'none');
}

/** Content types the API may answer with for inline display of user content; everything else is an attachment. */
export const INLINE_MIME: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac',
};

export const formatBytes = (n: number, locale = 'fr'): string => {
  const units = locale === 'fr' ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`;
};

/** Portal form field policy. */
export type FieldMode = 'off' | 'optional' | 'required';
export interface CustomField { key: string; label: string; required: boolean }
export interface RequestFields { name: FieldMode; email: FieldMode; reference: FieldMode; custom: CustomField[] }
export const DEFAULT_FIELDS: RequestFields = { name: 'optional', email: 'optional', reference: 'off', custom: [] };

/** Extensions a deposit portal never accepts, whatever its allow-list says (executables, scripts, active content). */
export const BLOCKED_EXT: ReadonlySet<string> = new Set(['exe', 'dll', 'msi', 'scr', 'com', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'jse', 'wsf', 'hta', 'jar', 'app', 'dmg', 'pkg', 'sh', 'command', 'lnk', 'apk', 'deb', 'rpm', 'iso', 'html', 'htm', 'svg', 'php']);
