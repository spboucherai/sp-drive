/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/preview/SheetView.tsx
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

// Workbook preview: the worker read the values of each sheet (never formulas' code, never macros) into JSON.
import { useMemo, useState } from 'react';
import { useT } from '../i18n.ts';
import type { PreviewSource } from '../types.ts';
import { cx } from '../ui.tsx';
import { columnLetter, Grid } from './Grid.tsx';
import { DerivedGate, Note, useDerived } from './shared.tsx';

/** Same shape as SheetPreview in services/api/src/tools-sheet.ts. */
export interface SheetPreview { sheets: { name: string; rows: string[][]; totalRows: number; totalColumns: number; truncated: boolean }[]; truncatedSheets: boolean }
const LIMIT = { rows: 1000, columns: 60, sheets: 30 };

function Workbook({ data }: { data: SheetPreview }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const sheet = data.sheets[Math.min(index, data.sheets.length - 1)];
  const columns = useMemo(() => (sheet ? sheet.rows.reduce((m, r) => Math.max(m, r.length), 0) : 0), [sheet]);
  const header = useMemo(() => Array.from({ length: columns }, (_, i) => columnLetter(i)), [columns]);
  if (!sheet) return <Note testId="empty-note">{t('preview.sheetNone')}</Note>;
  return (
    <>
      {sheet.truncated ? <Note tone="warn" testId="sheet-truncated">{t('preview.sheetTruncated', { rows: LIMIT.rows, cols: LIMIT.columns, totalRows: sheet.totalRows, totalCols: sheet.totalColumns })}</Note> : null}
      {data.truncatedSheets ? <Note tone="warn" testId="sheets-truncated">{t('preview.sheetsTruncated', { n: LIMIT.sheets })}</Note> : null}
      {sheet.rows.length === 0 || columns === 0
        ? <div className="flex min-h-0 flex-1 items-center justify-center bg-surface p-6 text-sm text-ink-3" data-testid="sheet-empty">{t('preview.sheetEmpty')}</div>
        : <Grid header={header} rows={sheet.rows} columns={columns} label={sheet.name} />}
      <div role="tablist" aria-label={t('preview.sheets')} className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-t border-line bg-surface px-2 py-1" data-noswipe>
        {data.sheets.map((s, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === index} onClick={() => setIndex(i)} data-testid="sheet-tab"
            className={cx('h-10 max-w-48 shrink-0 truncate rounded-xl px-3 text-sm font-medium transition', i === index ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink')}>{s.name}</button>
        ))}
      </div>
    </>
  );
}
export function SheetView({ source }: { source: PreviewSource }) {
  const [state, retry] = useDerived<SheetPreview>(source.previewUrl('sheet'), 'json');
  return <DerivedGate state={state} retry={retry} source={source}>{(data) => <Workbook data={data} />}</DerivedGate>;
}
