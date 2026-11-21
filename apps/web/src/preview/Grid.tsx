/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/preview/Grid.tsx
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

// A read-only grid for CSV files and workbook sheets: sticky header and row numbers, fixed row height so that only
// the rows on screen exist in the DOM, and the full content of the selected cell underneath.
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n.ts';
import { cx } from '../ui.tsx';
import { useWindow } from './shared.tsx';

const ROW = 32;
/** A, B … Z, AA, AB … */
export const columnLetter = (i: number): string => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function Grid({ header, rows, columns, firstRowNumber = 1, label }: { header: string[]; rows: string[][]; columns: number; firstRowNumber?: number; label: string }) {
  const t = useT();
  const { ref, start, end, before, after } = useWindow(rows.length, ROW);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  useEffect(() => { setSel(null); if (ref.current) { ref.current.scrollTop = 0; ref.current.scrollLeft = 0; } }, [rows, ref]);
  // widths from a sample of the content, so that the layout does not move while scrolling
  const widths = useMemo(() => {
    const w: number[] = [];
    for (let c = 0; c < columns; c++) {
      let max = (header[c] ?? '').length;
      for (let r = 0; r < rows.length && r < 300; r++) { const n = rows[r]![c]?.length ?? 0; if (n > max) max = n; }
      w.push(Math.max(72, Math.min(320, Math.round(max * 7.6 + 22))));
    }
    return w;
  }, [header, rows, columns]);
  const gutter = Math.max(44, String(firstRowNumber + rows.length).length * 9 + 20);
  const total = gutter + widths.reduce((a, b) => a + b, 0);
  const selected = sel ? rows[sel.r]?.[sel.c] ?? '' : null;
  const head = 'sticky top-0 z-10 h-8 border-b border-r border-line bg-hover px-2 text-left text-xs font-semibold text-ink-2';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={ref} tabIndex={0} role="region" aria-label={label} data-testid="grid" className="min-h-0 flex-1 overflow-auto bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <table className="table-fixed border-separate border-spacing-0 text-sm" style={{ width: total }}>
          <colgroup><col style={{ width: gutter }} />{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead>
            <tr>
              <th className={cx(head, 'left-0 z-20 text-center')} aria-label={t('preview.rowNumber')} />
              {widths.map((_, c) => <th key={c} scope="col" title={header[c]} className={cx(head, 'truncate')}>{header[c] ?? ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {before ? <tr aria-hidden="true" style={{ height: before }}><td colSpan={columns + 1} /></tr> : null}
            {rows.slice(start, end).map((row, i) => {
              const r = start + i;
              return (
                <tr key={r} style={{ height: ROW }}>
                  <th scope="row" className="sticky left-0 z-[5] border-b border-r border-line bg-hover px-2 text-center text-xs font-normal tabular-nums text-ink-3">{firstRowNumber + r}</th>
                  {widths.map((_, c) => {
                    const v = row[c] ?? '';
                    const on = sel?.r === r && sel.c === c;
                    return <td key={c} onClick={() => setSel(on ? null : { r, c })} aria-selected={on || undefined}
                      className={cx('cursor-default truncate border-b border-r border-line px-2 text-ink', on && 'bg-accent-soft outline outline-2 -outline-offset-2 outline-accent')}>{v}</td>;
                  })}
                </tr>
              );
            })}
            {after ? <tr aria-hidden="true" style={{ height: after }}><td colSpan={columns + 1} /></tr> : null}
          </tbody>
        </table>
      </div>
      {sel && selected !== null ? (
        <div className="flex max-h-28 shrink-0 gap-3 overflow-y-auto border-t border-line bg-raised px-4 py-2 text-sm" data-testid="grid-cell">
          <span className="shrink-0 font-mono text-xs leading-6 text-ink-3">{columnLetter(sel.c)}{firstRowNumber + sel.r}</span>
          <span className="min-w-0 whitespace-pre-wrap break-words text-ink">{selected === '' ? <span className="text-ink-3">{t('preview.emptyCell')}</span> : selected}</span>
        </div>
      ) : null}
    </div>
  );
}
