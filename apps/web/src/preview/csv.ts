/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/preview/csv.ts
 * Module           : preview
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

// A real CSV reader: quoted fields, doubled quotes, separators and line breaks inside quotes, CR/LF/CRLF.

/** The separator that splits the first lines most consistently (commas, semicolons or tabs outside quotes). */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const candidates = [',', ';', '\t'] as const;
  const perLine: Record<string, number[]> = { ',': [], ';': [], '\t': [] };
  let quoted = false, lines = 0;
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  const flush = () => { for (const c of candidates) perLine[c]!.push(counts[c]!); counts[','] = counts[';'] = counts['\t'] = 0; lines++; };
  for (let i = 0; i < text.length && lines < 20 && i < 200_000; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) { if (ch === '\r' && text[i + 1] === '\n') i++; flush(); }
    else if (!quoted && ch in counts) counts[ch]!++;
  }
  if (counts[','] || counts[';'] || counts['\t'] || lines === 0) flush();
  let best: ',' | ';' | '\t' = ',', bestScore = 0;
  for (const c of candidates) {
    const xs = perLine[c]!.filter((n, i, a) => n > 0 || i < a.length - 1);
    const total = xs.reduce((a, b) => a + b, 0);
    if (!total) continue;
    const same = xs.filter((n) => n === xs[0]).length / xs.length; // a real separator appears the same number of times on each line
    const score = total * (0.25 + same);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

export interface CsvTable { rows: string[][]; delimiter: string; more: boolean; columns: number }
/** Parse up to `maxRows` records; `more` tells that the text held further ones. */
export function parseCsv(text: string, maxRows: number, delimiter: string = detectDelimiter(text)): CsvTable {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, i = text.charCodeAt(0) === 0xfeff ? 1 : 0, columns = 0, more = false, started = false;
  const endRow = () => { row.push(field); field = ''; if (row.length > 1 || row[0] !== '' ) { rows.push(row); columns = Math.max(columns, row.length); } row = []; started = false; };
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; started = true; }
    else if (ch === delimiter) { row.push(field); field = ''; started = true; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      if (rows.length >= maxRows) { more = /\S/.test(text.slice(i + 1, i + 4096)); break; }
    } else { field += ch; started = true; }
  }
  if (!more && (started || field !== '' || row.length)) endRow();
  return { rows, delimiter, more, columns };
}
