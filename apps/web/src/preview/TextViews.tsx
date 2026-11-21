/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/preview/TextViews.tsx
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

// Text, CSV and JSON. The file's characters only ever become text nodes: nothing here builds HTML from content.
import { memo, type ReactNode, useMemo, useState } from 'react';
import { Glyph } from '../glyphs.tsx';
import { useT } from '../i18n.ts';
import type { PreviewSource } from '../types.ts';
import { IconButton } from '../ui.tsx';
import { parseCsv } from './csv.ts';
import { Grid } from './Grid.tsx';
import { Busy, Failure, fmtSize, Note, type TextState, TEXT_CAP, Tools, ToolToggle, useText } from './shared.tsx';

const CHUNK = 200;
const Chunk = memo(function Chunk({ lines, from }: { lines: string[]; from: number }) {
  return <div className="spd-chunk">{lines.map((l, i) => <div key={i} className="spd-line" data-n={from + i + 1}>{l}</div>)}</div>;
});
/** Monospace text with line numbers. Lines are grouped so the browser skips the layout of what is off screen. */
export function TextBlock({ text, wrap }: { text: string; wrap: boolean }) {
  const chunks = useMemo(() => {
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const out: string[][] = [];
    for (let i = 0; i < lines.length; i += CHUNK) out.push(lines.slice(i, i + CHUNK));
    return { out, count: lines.length };
  }, [text]);
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface" tabIndex={0} data-testid="text-scroll">
      <div className="spd-code py-3" data-wrap={wrap ? '1' : '0'} data-testid="text-block" style={{ ['--gutter' as string]: `${String(chunks.count).length}ch`, minWidth: wrap ? undefined : 'max-content' }}>
        {chunks.out.map((c, i) => <Chunk key={i} lines={c} from={i * CHUNK} />)}
      </div>
    </div>
  );
}
export function TruncatedNote({ state }: { state: Extract<TextState, { status: 'ready' }> }) {
  const t = useT();
  return state.truncated ? <Note tone="warn" testId="truncated-note">{t('preview.textTruncated', { shown: fmtSize(TEXT_CAP), total: fmtSize(state.total) })}</Note> : null;
}
function WrapToggle({ wrap, setWrap }: { wrap: boolean; setWrap: (v: boolean) => void }) {
  const t = useT();
  return <IconButton icon="wrap" label={t('preview.wrap')} active={wrap} onClick={() => setWrap(!wrap)} data-testid="wrap-toggle" />;
}
/** Loading and error states common to the text-based views. */
export function TextGate({ source, children }: { source: PreviewSource; children: (s: Extract<TextState, { status: 'ready' }>) => ReactNode }) {
  const t = useT();
  const [state, retry] = useText(source);
  if (state.status === 'loading') return <Busy label={t('common.loading')} />;
  if (state.status === 'error') return <Failure error={state.error} source={source} onRetry={retry} />;
  return <>{children(state)}</>;
}

export function TextFileView({ source }: { source: PreviewSource }) {
  const t = useT();
  const [wrap, setWrap] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  return (
    <TextGate source={source}>
      {(s) => (
        <>
          <Tools><WrapToggle wrap={wrap} setWrap={setWrap} /></Tools>
          <TruncatedNote state={s} />
          {s.text === '' ? <Note testId="empty-note">{t('preview.emptyFile')}</Note> : null}
          <TextBlock text={s.text} wrap={wrap} />
        </>
      )}
    </TextGate>
  );
}

// --- CSV ---
const CSV_ROWS = 2000, CSV_COLS = 200;
function CsvBody({ s }: { s: Extract<TextState, { status: 'ready' }> }) {
  const t = useT();
  const [raw, setRaw] = useState(false);
  const [wrap, setWrap] = useState(false);
  const table = useMemo(() => parseCsv(s.text, CSV_ROWS + 1), [s.text]);
  const [header, ...rows] = table.rows;
  const columns = Math.min(table.columns, CSV_COLS);
  const sep = table.delimiter === '\t' ? t('preview.sepTab') : table.delimiter === ';' ? t('preview.sepSemicolon') : t('preview.sepComma');
  return (
    <>
      <Tools>
        <ToolToggle active={!raw} onClick={() => setRaw(false)} testId="csv-table">{t('preview.table')}</ToolToggle>
        <ToolToggle active={raw} onClick={() => setRaw(true)} testId="csv-raw">{t('preview.source')}</ToolToggle>
        {raw ? <WrapToggle wrap={wrap} setWrap={setWrap} /> : null}
      </Tools>
      <TruncatedNote state={s} />
      {!raw && table.more ? <Note tone="warn" testId="rows-note">{t('preview.csvRowCap', { n: CSV_ROWS })}</Note> : null}
      {!raw && table.columns > CSV_COLS ? <Note tone="warn">{t('preview.csvColCap', { n: CSV_COLS, total: table.columns })}</Note> : null}
      {raw ? <TextBlock text={s.text} wrap={wrap} /> : !header ? <Note testId="empty-note">{t('preview.emptyFile')}</Note> : (
        <>
          <Grid header={header} rows={rows} columns={columns} firstRowNumber={2} label={t('preview.table')} />
          <p className="shrink-0 border-t border-line bg-surface px-4 py-1.5 text-xs text-ink-3" data-testid="csv-summary">{t('preview.csvSummary', { n: rows.length, cols: table.columns, sep })}</p>
        </>
      )}
    </>
  );
}
export function CsvView({ source }: { source: PreviewSource }) { return <TextGate source={source}>{(s) => <CsvBody s={s} />}</TextGate>; }

// --- JSON ---
const PAGE = 100;
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
function Scalar({ v }: { v: Exclude<Json, Json[] | { [k: string]: Json }> }) {
  if (typeof v === 'string') return <span className="whitespace-pre-wrap break-words text-ok">"{v}"</span>;
  if (typeof v === 'number') return <span className="text-accent">{String(v)}</span>;
  return <span className="text-warn">{String(v)}</span>;
}
function JsonNode({ name, value, depth, open: openAll }: { name?: string; value: Json; depth: number; open: number }) {
  const t = useT();
  const branch = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < openAll);
  const [shown, setShown] = useState(PAGE);
  const label = name !== undefined ? <span className="text-ink">{name}<span className="text-ink-3">: </span></span> : null;
  if (!branch) return <div className="flex min-h-7 items-start gap-1 py-0.5 pl-6 leading-6"><span className="min-w-0">{label}<Scalar v={value} /></span></div>;
  const isArray = Array.isArray(value);
  const entries: [string, Json][] = isArray ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  const summary = isArray ? t('preview.jsonItems', { n: entries.length }) : t('preview.jsonKeys', { n: entries.length });
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-7 w-full items-center gap-1 rounded py-0.5 text-left leading-6 hover:bg-hover" data-testid="json-branch">
        <Glyph name={open ? 'chevronDown' : 'chevronRight'} size={16} className="w-5 shrink-0 text-ink-3" />
        <span className="min-w-0 truncate">{label}<span className="text-ink-3">{isArray ? '[' : '{'}{open ? '' : ` … ${isArray ? ']' : '}'}`} <span className="font-sans text-xs">{summary}</span></span></span>
      </button>
      {open ? (
        <div className="ml-2.5 border-l border-line pl-2">
          {entries.slice(0, shown).map(([k, v]) => <JsonNode key={k} name={isArray ? undefined : k} value={v} depth={depth + 1} open={openAll} />)}
          {entries.length > shown ? <button type="button" onClick={() => setShown(shown + PAGE * 5)} className="ml-6 min-h-10 rounded px-2 font-sans text-xs font-medium text-accent hover:bg-hover">{t('preview.jsonMore', { n: entries.length - shown })}</button> : null}
          <div className="pl-6 leading-6 text-ink-3">{isArray ? ']' : '}'}</div>
        </div>
      ) : null}
    </div>
  );
}
function JsonBody({ s }: { s: Extract<TextState, { status: 'ready' }> }) {
  const t = useT();
  const parsed = useMemo((): { ok: true; value: Json } | { ok: false } => { try { return { ok: true, value: JSON.parse(s.text) as Json }; } catch { return { ok: false }; } }, [s.text]);
  const [raw, setRaw] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [fold, setFold] = useState({ depth: 2, gen: 0 });
  const asText = raw || !parsed.ok;
  return (
    <>
      <Tools>
        {parsed.ok ? <>
          <ToolToggle active={!raw} onClick={() => setRaw(false)} testId="json-tree-toggle">{t('preview.tree')}</ToolToggle>
          <ToolToggle active={raw} onClick={() => setRaw(true)} testId="json-raw">{t('preview.source')}</ToolToggle>
          {!raw ? <><IconButton icon="expandAll" label={t('preview.expandAll')} onClick={() => setFold((f) => ({ depth: 6, gen: f.gen + 1 }))} /><IconButton icon="collapseAll" label={t('preview.collapseAll')} onClick={() => setFold((f) => ({ depth: 1, gen: f.gen + 1 }))} /></> : null}
        </> : null}
        {asText ? <WrapToggle wrap={wrap} setWrap={setWrap} /> : null}
      </Tools>
      <TruncatedNote state={s} />
      {!parsed.ok ? <Note tone="warn" testId="json-invalid">{s.truncated ? t('preview.jsonTruncated') : t('preview.jsonInvalid')}</Note> : null}
      {asText ? <TextBlock text={s.text} wrap={wrap} /> : (
        <div className="min-h-0 flex-1 overflow-auto bg-surface p-3 font-mono text-[13px] sm:p-5" data-testid="json-tree" tabIndex={0}>
          <JsonNode key={fold.gen} value={(parsed as { value: Json }).value} depth={0} open={fold.depth} />
        </div>
      )}
    </>
  );
}
export function JsonView({ source }: { source: PreviewSource }) { return <TextGate source={source}>{(s) => <JsonBody s={s} />}</TextGate>; }
