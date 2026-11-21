/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/next/diff.ts
 * Module           : next
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

// Line diff (Myers, O(ND)) for the version comparison. Pure, no dependency. Returns the edit script as runs of
// equal / removed / added lines; gives up (null) beyond a cost that would freeze the page.
export interface Run { op: 'eq' | 'del' | 'add'; lines: string[]; a: number; b: number }
export const MAX_LINES = 20_000, MAX_D = 4_000;

export function diffLines(aText: string, bText: string): Run[] | null {
  const a = aText.split('\n'), b = bText.split('\n');
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null;
  // common prefix and suffix cost nothing
  let pre = 0; while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0; while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  const n = A.length, m = B.length, max = Math.min(n + m, MAX_D), off = max;
  const trace: Int32Array[] = [];
  let v = new Int32Array(2 * max + 2), found = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break outer; }
    }
  }
  if (found < 0) return null;
  // walk back
  const ops: { op: 'eq' | 'del' | 'add'; line: string }[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d]!, k = x - y;
    const pk = k === -d || (k !== d && pv[off + k - 1]! < pv[off + k + 1]!) ? k + 1 : k - 1;
    const px = pv[off + pk]!, py = px - pk;
    while (x > px && y > py) { ops.push({ op: 'eq', line: A[x - 1]! }); x--; y--; }
    if (x === px) { ops.push({ op: 'add', line: B[y - 1]! }); y--; } else { ops.push({ op: 'del', line: A[x - 1]! }); x--; }
  }
  while (x > 0 && y > 0) { ops.push({ op: 'eq', line: A[x - 1]! }); x--; y--; }
  ops.reverse();
  const all = [...a.slice(0, pre).map((line) => ({ op: 'eq' as const, line })), ...ops, ...a.slice(a.length - suf).map((line) => ({ op: 'eq' as const, line }))];
  const runs: Run[] = [];
  let ai = 1, bi = 1;
  for (const o of all) {
    const last = runs[runs.length - 1];
    if (last && last.op === o.op) last.lines.push(o.line); else runs.push({ op: o.op, lines: [o.line], a: ai, b: bi });
    if (o.op !== 'add') ai++;
    if (o.op !== 'del') bi++;
  }
  return runs;
}
export const diffStats = (runs: Run[]) => ({ added: runs.filter((r) => r.op === 'add').reduce((n, r) => n + r.lines.length, 0), removed: runs.filter((r) => r.op === 'del').reduce((n, r) => n + r.lines.length, 0) });
