/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/next/TimeMachine.tsx
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

// Versions "time machine": the history of one file as a timeline, a comparison of any two versions, and restore.
// The comparison is computed here from the real bytes of each version: a line diff for text, Markdown, JSON and CSV;
// side by side for images and for PDF pages. Any other binary format cannot be compared, and the screen says so.
import { formatBytes } from '@spd/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { get, post } from '../api.ts';
import { triggerDownload } from '../explorer/lib.ts';
import { Glyph } from '../glyphs.tsx';
import { errorText, fmtDate, fmtRelative, getLocale, useT } from '../i18n.ts';
import type { FileItem } from '../types.ts';
import { Badge, Button, cx, Dialog, ErrorState, Loading, Spinner, useToast } from '../ui.tsx';
import { diffLines, diffStats, type Run } from './diff.ts';
import type { VersionInfo, VersionList } from './types.ts';

const TEXT_KINDS = new Set(['text', 'markdown', 'json', 'csv']);
const TEXT_CAP = 2 * 1024 * 1024;
const contentUrl = (fileId: string, versionId: string, download = false) => `/api/v1/files/${fileId}/versions/${versionId}/content${download ? '?download=1' : ''}`;
type Mode = 'text' | 'image' | 'pdf' | 'none';
const modeOf = (f: FileItem): Mode => (TEXT_KINDS.has(f.kind) ? 'text' : f.kind === 'image' || f.kind === 'svg' ? 'image' : f.kind === 'pdf' ? 'pdf' : 'none');

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin', signal, headers: { Range: `bytes=0-${TEXT_CAP - 1}` } });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  return new TextDecoder('utf-8', { fatal: false }).decode(await res.arrayBuffer()).replace(/\r\n/g, '\n');
}

function TextDiff({ fileId, a, b }: { fileId: string; a: VersionInfo; b: VersionInfo }) {
  const t = useT();
  const tooBig = a.size > TEXT_CAP || b.size > TEXT_CAP;
  const q = useQuery({
    queryKey: ['next', 'diff', fileId, a.id, b.id], enabled: !tooBig, staleTime: Infinity,
    queryFn: async ({ signal }) => { const [x, y] = await Promise.all([fetchText(contentUrl(fileId, a.id), signal), fetchText(contentUrl(fileId, b.id), signal)]); return diffLines(x, y); },
  });
  const [all, setAll] = useState(false);
  if (tooBig) return <Plain icon="info" text={t('next.tm.tooLarge')} />;
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const runs = q.data;
  if (!runs) return <Plain icon="info" text={t('next.tm.tooDifferent')} />;
  const { added, removed } = diffStats(runs);
  if (!added && !removed) return <Plain icon="check" text={t('next.tm.identical')} />;
  const CONTEXT = 3;
  const rows: React.ReactNode[] = [];
  runs.forEach((r: Run, ri) => {
    if (r.op === 'eq' && !all && r.lines.length > CONTEXT * 2 + 1) {
      const head = ri === 0 ? [] : r.lines.slice(0, CONTEXT), tail = ri === runs.length - 1 ? [] : r.lines.slice(-CONTEXT);
      head.forEach((l, i) => rows.push(<Line key={`${ri}h${i}`} op="eq" a={r.a + i} b={r.b + i} text={l} />));
      rows.push(<div key={`${ri}gap`} className="border-y border-line bg-hover px-3 py-1 text-center text-[11px] text-ink-3">{t('next.tm.unchanged', { n: r.lines.length - head.length - tail.length })}</div>);
      const o = r.lines.length - tail.length;
      tail.forEach((l, i) => rows.push(<Line key={`${ri}t${i}`} op="eq" a={r.a + o + i} b={r.b + o + i} text={l} />));
    } else r.lines.forEach((l, i) => rows.push(<Line key={`${ri}:${i}`} op={r.op} a={r.op === 'add' ? null : r.a + i} b={r.op === 'del' ? null : r.b + i} text={l} />));
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="tm-diff">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-xs">
        <span className="font-medium text-ok" data-testid="tm-added">+{added} {t('next.tm.added', { n: added })}</span>
        <span className="font-medium text-danger" data-testid="tm-removed">−{removed} {t('next.tm.removed', { n: removed })}</span>
        <button type="button" className="ml-auto font-medium text-accent hover:underline" onClick={() => setAll(!all)}>{all ? t('next.tm.onlyChanges') : t('next.tm.wholeFile')}</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[1.55]">{rows}</div>
    </div>
  );
}
function Line({ op, a, b, text }: { op: Run['op']; a: number | null; b: number | null; text: string }) {
  return (
    <div data-op={op} className={cx('flex min-w-max', op === 'add' ? 'bg-ok-soft' : op === 'del' ? 'bg-danger-soft' : '')}>
      <span className="w-10 shrink-0 px-1 text-right text-ink-3 select-none">{a ?? ''}</span><span className="w-10 shrink-0 px-1 text-right text-ink-3 select-none">{b ?? ''}</span>
      <span className={cx('w-5 shrink-0 text-center select-none', op === 'add' ? 'text-ok' : op === 'del' ? 'text-danger' : 'text-ink-3')} aria-hidden="true">{op === 'add' ? '+' : op === 'del' ? '−' : ''}</span>
      <span className="pr-4 whitespace-pre text-ink">{text || ' '}</span>
    </div>
  );
}
const Plain = ({ icon, text }: { icon: string; text: string }) => <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center" data-testid="tm-plain"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-hover text-ink-3"><Glyph name={icon} size={20} /></span><p className="max-w-sm text-[13px] leading-relaxed text-ink-2">{text}</p></div>;

function Pane({ v, children }: { v: VersionInfo; children: React.ReactNode }) {
  const t = useT();
  return (
    <figure className="flex min-h-0 min-w-0 flex-1 flex-col">
      <figcaption className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs text-ink-2"><span className="font-medium text-ink">{t('explorer.ver.n', { n: v.seq })}</span><span className="truncate">{fmtDate(v.createdAt)}</span></figcaption>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-well p-3">{children}</div>
    </figure>
  );
}
function ImagePair({ fileId, a, b }: { fileId: string; a: VersionInfo; b: VersionInfo }) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 max-sm:flex-col sm:divide-x sm:divide-line" data-testid="tm-images">
      {[a, b].map((v) => <Pane key={v.id} v={v}><img src={contentUrl(fileId, v.id)} alt={t('next.tm.imageAlt', { n: v.seq })} className="max-h-full max-w-full object-contain" /></Pane>)}
    </div>
  );
}
/** One page of a PDF version, drawn with the bundled pdf.js (loaded on demand with the viewer's chunk). */
function PdfPage({ url, page, onPages }: { url: string; page: number; onPages: (n: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'absent'>('loading');
  useEffect(() => {
    let dead = false, task: { destroy(): void } | null = null;
    setState('loading');
    void (async () => {
      try {
        const { openPdf } = await import('../preview/PdfView.tsx');
        const t = openPdf(url); task = t;
        const doc = await t.promise;
        if (dead) return;
        onPages(doc.numPages);
        if (page > doc.numPages) { setState('absent'); return; }
        const p = await doc.getPage(page), vp = p.getViewport({ scale: 1 });
        const scale = Math.min(2, 900 / vp.width) * Math.min(2, window.devicePixelRatio || 1);
        const view = p.getViewport({ scale }), c = canvas.current;
        if (!c || dead) return;
        c.width = Math.floor(view.width); c.height = Math.floor(view.height);
        await p.render({ canvas: c, viewport: view }).promise;
        if (!dead) setState('ready');
      } catch { if (!dead) setState('error'); }
    })();
    return () => { dead = true; try { task?.destroy(); } catch { /* already gone */ } };
  }, [url, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = useT();
  return (
    <>
      {state === 'loading' ? <span className="text-ink-3"><Spinner /></span> : null}
      {state === 'error' ? <p className="text-xs text-danger">{t('next.tm.pdfError')}</p> : null}
      {state === 'absent' ? <p className="text-xs text-ink-3">{t('next.tm.pdfNoPage', { n: page })}</p> : null}
      <canvas ref={canvas} className={cx('max-h-full max-w-full bg-white shadow-(--shadow-card)', state !== 'ready' && 'hidden')} data-testid="tm-pdf-canvas" />
    </>
  );
}
function PdfPair({ fileId, a, b }: { fileId: string; a: VersionInfo; b: VersionInfo }) {
  const t = useT();
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<Record<string, number>>({});
  const max = Math.max(1, ...Object.values(pages));
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="tm-pdf">
      <div className="flex shrink-0 items-center justify-center gap-2 border-b border-line px-3 py-1.5 text-xs text-ink-2">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label={t('next.tm.prevPage')} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-hover disabled:opacity-40"><Glyph name="chevronLeft" size={16} /></button>
        <span className="tabular-nums">{t('next.tm.pageOf', { n: page, total: max })}</span>
        <button type="button" disabled={page >= max} onClick={() => setPage(page + 1)} aria-label={t('next.tm.nextPage')} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-hover disabled:opacity-40"><Glyph name="chevronRight" size={16} /></button>
      </div>
      <div className="flex min-h-0 flex-1 max-sm:flex-col sm:divide-x sm:divide-line">
        {[a, b].map((v) => <Pane key={v.id} v={v}><PdfPage url={contentUrl(fileId, v.id)} page={page} onPages={(n) => setPages((p) => (p[v.id] === n ? p : { ...p, [v.id]: n }))} /></Pane>)}
      </div>
    </div>
  );
}

export function TimeMachine({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const loc = getLocale();
  const q = useQuery({ queryKey: ['next', 'versions', file.id], queryFn: () => get<VersionList>(`/files/${file.id}/versions`), refetchOnMount: 'always' });
  const versions = q.data?.versions ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const [against, setAgainst] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = versions.find((v) => v.current) ?? versions[0];
  const selected = versions.find((v) => v.id === pick) ?? versions.find((v) => !v.current) ?? current;
  const other = versions.find((v) => v.id === against) ?? (selected && !selected.current ? current : versions.find((v) => v.id !== selected?.id));
  const mode = modeOf(file);
  const pair = useMemo(() => (selected && other && selected.id !== other.id ? (selected.seq < other.seq ? [selected, other] : [other, selected]) as [VersionInfo, VersionInfo] : null), [selected, other]);
  const restore = async (v: VersionInfo) => {
    setBusy(true);
    try { await post(`/files/${file.id}/versions/${v.id}/restore`); await Promise.all([qc.invalidateQueries({ queryKey: ['explorer'] }), qc.invalidateQueries({ queryKey: ['next'] })]); setPick(null); setAgainst(null); toast(t('explorer.ver.restored', { n: v.seq }), { tone: 'ok' }); }
    catch (e) { toast(errorText(e), { tone: 'error' }); } finally { setBusy(false); }
  };
  const note = (v: VersionInfo) => { const m = /^restored from version (\d+)$/.exec(v.note); return m ? t('explorer.ver.restoredFrom', { n: Number(m[1]) }) : v.note; };
  return (
    <Dialog title={t('next.tm.title', { name: file.name })} onClose={onClose} wide="xl" testId="time-machine">
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="-mx-5 -mb-5 flex min-h-[60dvh] flex-col border-t border-line lg:h-[68dvh] lg:flex-row">
          <ol aria-label={t('next.tm.timeline')} className="relative max-h-56 shrink-0 overflow-y-auto border-b border-line py-2 lg:max-h-none lg:w-72 lg:border-r lg:border-b-0" data-testid="tm-timeline">
            {versions.map((v, i) => {
              const on = v.id === selected?.id, cmp = v.id === other?.id && !!pair;
              return (
                <li key={v.id} className="relative">
                  {i < versions.length - 1 ? <span aria-hidden="true" className="absolute top-7 bottom-[-12px] left-[27px] w-px bg-line" /> : null}
                  <button type="button" aria-pressed={on} onClick={() => { setPick(v.id); if (against === v.id) setAgainst(null); }} data-testid="tm-version" data-seq={v.seq}
                    className={cx('relative flex w-full items-start gap-3 px-4 py-2 text-left transition-colors', on ? 'bg-selection' : 'hover:bg-hover')}>
                    <span className={cx('relative z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums', on ? 'bg-accent text-on-brand' : v.current ? 'bg-accent-soft text-accent' : 'bg-well text-ink-2')}>{v.seq}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">{fmtDate(v.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}{v.current ? <Badge tone="accent">{t('explorer.ver.current')}</Badge> : null}</span>
                      <span className="block truncate text-xs text-ink-3">{formatBytes(v.size, loc)} · {v.createdBy ? (v.createdBy.me ? t('next.act.you') : v.createdBy.displayName) : t('next.tm.viaPortal')} · {fmtRelative(v.createdAt)}</span>
                      {v.note ? <span className="block truncate text-xs text-ink-2">{note(v)}</span> : null}
                      {cmp ? <span className="mt-0.5 inline-block text-[11px] font-medium text-accent">{t('next.tm.comparedWith')}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {selected ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <p className="mr-auto min-w-0 text-[13px] text-ink"><span className="font-medium">{t('explorer.ver.n', { n: selected.seq })}</span>{versions.length > 1 && other ? <> <span className="text-ink-3">{t('next.tm.vs')}</span>{' '}
                  <select aria-label={t('next.tm.compareWith')} value={other.id} onChange={(e) => setAgainst(e.target.value)} className="h-8 rounded-md border border-line-strong bg-surface px-1.5 text-[13px] text-ink">{versions.filter((v) => v.id !== selected.id).map((v) => <option key={v.id} value={v.id}>{t('explorer.ver.n', { n: v.seq })}{v.current ? ` (${t('explorer.ver.current')})` : ''}</option>)}</select></> : null}
                </p>
                <Button size="sm" icon="download" onClick={() => triggerDownload(contentUrl(file.id, selected.id, true))}>{t('common.download')}</Button>
                {!selected.current && !file.trashedAt ? <Button size="sm" variant="primary" icon="restore" busy={busy} onClick={() => void restore(selected)} data-testid="tm-restore">{t('next.tm.restore', { n: selected.seq })}</Button> : null}
              </div>
            ) : null}
            {selected && !selected.current ? <p className="shrink-0 border-b border-line bg-hover px-3 py-1.5 text-xs leading-snug text-ink-2" data-testid="tm-restore-note">{t('next.tm.restoreNote', { n: selected.seq, next: Math.max(...versions.map((v) => v.seq)) + 1 })}</p> : null}
            {!pair ? <Plain icon="history" text={t('next.tm.single')} />
              : mode === 'text' ? <TextDiff fileId={file.id} a={pair[0]} b={pair[1]} />
              : mode === 'image' ? <ImagePair fileId={file.id} a={pair[0]} b={pair[1]} />
              : mode === 'pdf' ? <PdfPair fileId={file.id} a={pair[0]} b={pair[1]} />
              : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center" data-testid="tm-binary">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-hover text-ink-3"><Glyph name="compare" size={20} /></span>
                  <p className="max-w-md text-[13px] leading-relaxed text-ink-2">{t('next.tm.binary')}</p>
                  <dl className="grid w-full max-w-md gap-1 text-left text-xs text-ink-2">{pair.map((v) => <div key={v.id} className="rounded-lg bg-hover px-3 py-2"><dt className="font-medium text-ink">{t('explorer.ver.n', { n: v.seq })} · {formatBytes(v.size, loc)}</dt><dd className="spd-mono break-all text-ink-3">{v.sha256}</dd></div>)}</dl>
                  <p className="text-xs text-ink-3">{pair[0].sha256 === pair[1].sha256 ? t('next.tm.sameBytes') : t('next.tm.differentBytes')}</p>
                </div>
              )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
