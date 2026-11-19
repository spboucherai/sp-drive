// Storage command centre: the quota, what takes the room (by kind, by folder with drill-down), the largest files,
// ninety days of growth and a summary of duplicates. Every figure comes from GET /storage/overview and
// GET /storage/folder/:id; the drawings are plain SVG and CSS (no chart library).
import { formatBytes } from '@spd/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { get } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { fmtDate, getLocale, useT } from '../i18n.ts';
import { Thumb } from '../preview/Thumb.tsx';
import { ownerSource } from '../sources.ts';
import { cx, ErrorState, Loading } from '../ui.tsx';
import type { StorageFolder, StorageOverview } from './types.ts';

// Categorical colours of the kinds: a fixed slot per kind (the colour follows the kind, never its rank), from the
// --spd-viz-* palette of styles.css — validated for colour-vision deficiencies on both surfaces; three light-mode slots
// are under 3:1 against white, so every swatch always comes with its name and its value. "Other" is neutral.
const KIND_COLOR: Record<string, string> = { image: 'var(--spd-viz-1)', pdf: 'var(--spd-viz-2)', document: 'var(--spd-viz-3)', sheet: 'var(--spd-viz-4)', video: 'var(--spd-viz-5)', audio: 'var(--spd-viz-6)', archive: 'var(--spd-viz-7)', text: 'var(--spd-viz-8)', other: 'var(--spd-color-text-tertiary)' };
const fmt = (n: number) => formatBytes(n, getLocale());

function Figure({ label, value, detail, testId }: { label: string; value: string; detail?: string; testId?: string }) {
  return <div className="min-w-0" data-testid={testId}><dt className="spd-eyebrow">{label}</dt><dd className="spd-figure mt-1 truncate text-[22px] text-ink">{value}</dd>{detail ? <dd className="mt-0.5 truncate text-xs text-ink-3">{detail}</dd> : null}</div>;
}

/** The quota as one segmented bar: live files, old versions, trash, uploads in flight, free. */
function QuotaBar({ o }: { o: StorageOverview }) {
  const t = useT();
  const limit = o.quota.limit || Math.max(1, o.quota.used);
  const live = Math.max(0, o.quota.used - o.trashBytes - o.oldVersionBytes);
  const parts = [
    { key: 'live', bytes: live, cls: 'bg-accent' }, { key: 'versions', bytes: o.oldVersionBytes, cls: 'bg-(--spd-viz-1)' },
    { key: 'trash', bytes: o.trashBytes, cls: 'bg-warn' }, { key: 'uploading', bytes: o.quota.uploading, cls: 'bg-ink-3' },
  ];
  const ratio = o.quota.limit ? o.quota.used / o.quota.limit : 0;
  return (
    <section aria-label={t('next.st.quota')} data-testid="storage-quota">
      <div className="flex flex-wrap items-baseline gap-x-3"><p className="spd-figure text-[40px] leading-none text-ink">{fmt(o.quota.used)}</p><p className="text-[15px] text-ink-2">{o.quota.limit ? t('account.quota.of', { limit: fmt(o.quota.limit) }) : t('next.st.noLimit')}{o.quota.limit ? ` · ${Math.round(ratio * 1000) / 10} %` : ''}</p></div>
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-well" role="img" aria-label={t('next.st.barLabel', { used: fmt(o.quota.used), limit: fmt(limit) })}>
        {parts.map((p, i) => (p.bytes > 0 ? <span key={p.key} className={cx('anim-grow-x h-full', p.cls, i > 0 && 'ml-0.5')} style={{ width: `${Math.max(0.4, (p.bytes / limit) * 100)}%`, animationDelay: `${i * 60}ms` }} /> : null))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-2">
        {parts.map((p) => <li key={p.key} className="flex items-center gap-1.5"><span className={cx('h-2 w-2 rounded-full', p.cls)} />{t(`next.st.part.${p.key}`)} <span className="text-ink tabular-nums">{fmt(p.bytes)}</span></li>)}
        {o.quota.limit ? <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-well ring-1 ring-line-strong" />{t('next.st.part.free')} <span className="text-ink tabular-nums">{fmt(Math.max(0, o.quota.limit - o.quota.used - o.quota.uploading))}</span></li> : null}
      </ul>
      {ratio >= 0.9 ? <p role="status" className="mt-3 flex items-center gap-2 rounded-[10px] bg-warn-soft px-3 py-2 text-[13px] text-warn"><Glyph name="warning" size={15} />{t('next.st.almostFull')}</p> : null}
    </section>
  );
}

/** By kind: a horizontal stacked bar and its legend (direct labels, no hover needed). */
function ByKind({ o }: { o: StorageOverview }) {
  const t = useT();
  const total = o.byKind.reduce((n, k) => n + k.bytes, 0) || 1;
  const [hot, setHot] = useState<string | null>(null);
  return (
    <section aria-label={t('next.st.byKind')} data-testid="storage-kinds">
      <h2 className="spd-eyebrow mb-2">{t('next.st.byKind')}</h2>
      <div className="flex h-7 w-full overflow-hidden rounded-[6px] bg-well">
        {o.byKind.map((k, i) => <span key={k.kind} onMouseEnter={() => setHot(k.kind)} onMouseLeave={() => setHot(null)} className={cx('anim-grow-x h-full transition-opacity', i > 0 && 'ml-0.5', hot && hot !== k.kind && 'opacity-40')} style={{ width: `${Math.max(0.6, (k.bytes / total) * 100)}%`, background: KIND_COLOR[k.kind] ?? KIND_COLOR.other, animationDelay: `${i * 40}ms` }} title={`${t(`next.st.kind.${k.kind}`)} — ${fmt(k.bytes)}`} />)}
      </div>
      <ul className="mt-3 flex flex-col">
        {o.byKind.map((k) => (
          <li key={k.kind} onMouseEnter={() => setHot(k.kind)} onMouseLeave={() => setHot(null)} className={cx('flex items-center gap-2 rounded-md px-1 py-1 text-[13px] transition-opacity', hot && hot !== k.kind && 'opacity-50')} data-kind={k.kind}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: KIND_COLOR[k.kind] ?? KIND_COLOR.other }} />
            <span className="min-w-0 flex-1 truncate text-ink">{t(`next.st.kind.${k.kind}`)}</span>
            <span className="text-xs text-ink-3 tabular-nums">{t('next.st.files', { n: k.files })}</span>
            <span className="w-20 text-right text-ink tabular-nums">{fmt(k.bytes)}</span>
          </li>
        ))}
        {!o.byKind.length ? <li className="text-[13px] text-ink-3">{t('next.st.nothing')}</li> : null}
      </ul>
    </section>
  );
}

// --- treemap of a folder: squarified, each cell a sub-folder (click = drill down) or "files directly here" ---
interface Cell { id: string; name: string; bytes: number; files: number; folder: boolean; x: number; y: number; w: number; h: number }
function squarify(items: { id: string; name: string; bytes: number; files: number; folder: boolean }[], W: number, H: number): Cell[] {
  const total = items.reduce((n, i) => n + i.bytes, 0);
  if (!total) return [];
  const nodes = items.filter((i) => i.bytes > 0).sort((a, b) => b.bytes - a.bytes).map((i) => ({ ...i, area: (i.bytes / total) * W * H }));
  const out: Cell[] = [];
  let x = 0, y = 0, w = W, h = H, row: typeof nodes = [];
  const worst = (r: typeof nodes, side: number) => { const s = r.reduce((n, i) => n + i.area, 0), mx = Math.max(...r.map((i) => i.area)), mn = Math.min(...r.map((i) => i.area)); return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)); };
  const flush = () => {
    const s = row.reduce((n, i) => n + i.area, 0), horizontal = w >= h, side = horizontal ? h : w, thick = s / side;
    let o = 0;
    for (const i of row) { const len = i.area / thick; out.push(horizontal ? { ...i, x, y: y + o, w: thick, h: len } : { ...i, x: x + o, y, w: len, h: thick }); o += len; }
    if (horizontal) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    row = [];
  };
  for (const n of nodes) {
    const side = Math.min(w, h);
    if (row.length && worst([...row, n], side) > worst(row, side)) flush();
    row.push(n);
  }
  if (row.length) flush();
  return out;
}
function Treemap({ data, onOpen }: { data: StorageFolder; onOpen: (id: string) => void }) {
  const t = useT();
  const W = 1000, H = 420;
  const cells = useMemo(() => squarify([
    ...data.children.map((c) => ({ id: c.folder.id, name: c.folder.name, bytes: c.bytes, files: c.files, folder: true })),
    ...(data.direct.bytes > 0 ? [{ id: 'direct', name: t('next.st.direct'), bytes: data.direct.bytes, files: data.direct.files, folder: false }] : []),
  ], W, H), [data, t]);
  const [hot, setHot] = useState<Cell | null>(null);
  if (!cells.length) return <p className="rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-[13px] text-ink-3" data-testid="treemap-empty">{t('next.st.emptyFolder')}</p>;
  const max = cells[0]!.bytes;
  return (
    <div className="relative" data-testid="treemap">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-hidden rounded-[10px]" role="group" aria-label={t('next.st.treemapLabel')} preserveAspectRatio="none" style={{ aspectRatio: `${W} / ${H}` }}>
        {cells.map((c, i) => {
          const big = c.w > 120 && c.h > 46, shade = 0.16 + 0.5 * Math.sqrt(c.bytes / max);
          return (
            <g key={c.id} className="anim-cell" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} data-testid="treemap-cell" data-id={c.id}
              role={c.folder ? 'button' : 'img'} tabIndex={c.folder ? 0 : -1} aria-label={`${c.name} — ${fmt(c.bytes)}, ${t('next.st.files', { n: c.files })}`}
              onClick={() => c.folder && onOpen(c.id)} onKeyDown={(e) => { if (c.folder && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(c.id); } }}
              onMouseEnter={() => setHot(c)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(c)} onBlur={() => setHot(null)}>
              <rect x={c.x + 1} y={c.y + 1} width={Math.max(0, c.w - 2)} height={Math.max(0, c.h - 2)} rx="5" fill={c.folder ? 'var(--spd-color-brand)' : 'var(--spd-color-text-tertiary)'} fillOpacity={hot?.id === c.id ? Math.min(1, shade + 0.18) : shade}
                className={cx('transition-[fill-opacity]', c.folder && 'cursor-pointer')} />
              {big ? <text x={c.x + 12} y={c.y + 24} className="pointer-events-none fill-(--spd-color-text-primary) text-[15px] font-medium">{c.name.length > c.w / 9.5 ? `${c.name.slice(0, Math.max(3, Math.floor(c.w / 9.5) - 1))}…` : c.name}</text> : null}
              {big ? <text x={c.x + 12} y={c.y + 42} className="pointer-events-none fill-(--spd-color-text-secondary) text-[12px]">{fmt(c.bytes)}</text> : null}
            </g>
          );
        })}
      </svg>
      <p className="mt-2 h-5 truncate text-xs text-ink-2" aria-live="polite" data-testid="treemap-hint">{hot ? `${hot.name} — ${fmt(hot.bytes)} · ${t('next.st.files', { n: hot.files })}${hot.folder ? ` · ${t('next.st.clickToOpen')}` : ''}` : t('next.st.treemapHint')}</p>
    </div>
  );
}
function ByFolder() {
  const t = useT();
  const [id, setId] = useState('root');
  const q = useQuery({ queryKey: ['next', 'storage', 'folder', id], queryFn: () => get<StorageFolder>(`/storage/folder/${id}`), placeholderData: (p) => p });
  return (
    <section aria-label={t('next.st.byFolder')} data-testid="storage-folders">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="spd-eyebrow">{t('next.st.byFolder')}</h2>
        {q.data ? (
          <nav aria-label={t('explorer.breadcrumbs')} className="flex min-w-0 flex-wrap items-center gap-0.5 text-[13px]" data-testid="storage-crumbs">
            {q.data.breadcrumbs.map((c, i, all) => <span key={c.id} className="flex items-center gap-0.5">{i > 0 ? <Glyph name="chevronRight" size={12} className="text-ink-3" /> : null}
              {i === all.length - 1 ? <span className="px-1 font-medium text-ink">{i === 0 ? t('explorer.root') : c.name}</span> : <button type="button" onClick={() => setId(i === 0 ? 'root' : c.id)} className="rounded px-1 text-accent hover:bg-accent-soft">{i === 0 ? t('explorer.root') : c.name}</button>}</span>)}
            <span className="ml-2 text-xs text-ink-3 tabular-nums">{fmt(q.data.total.bytes)} · {t('next.st.files', { n: q.data.total.files })}</span>
          </nav>
        ) : null}
      </div>
      {q.isLoading ? <Loading /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          <Treemap key={q.data.folder.id} data={q.data} onOpen={setId} />
          {q.data.files.length ? (
            <details className="mt-1 text-[13px]">
              <summary className="cursor-pointer text-ink-2 hover:text-ink">{t('next.st.filesHere', { n: q.data.files.length })}</summary>
              <ul className="mt-2 divide-y divide-line overflow-hidden rounded-[10px] shadow-(--spd-elevation-e0)">{q.data.files.slice(0, 12).map((f) => <li key={f.id}><Link href={`/folder/${f.folderId}?file=${f.id}`} className="flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-hover"><span className="truncate text-ink">{f.name}</span><span className="shrink-0 text-ink-2 tabular-nums">{fmt(f.size)}</span></Link></li>)}</ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Ninety days of growth: one bar per day that had uploads, on a continuous time axis. */
function Growth({ o }: { o: StorageOverview }) {
  const t = useT();
  const [hot, setHot] = useState<number | null>(null);
  const days = useMemo(() => {
    const by = new Map(o.growth.map((g) => [g.date, g]));
    const out: { date: string; bytes: number; versions: number }[] = [];
    const end = new Date(); end.setUTCHours(0, 0, 0, 0);
    for (let i = 89; i >= 0; i--) { const d = new Date(end.getTime() - i * 86400_000).toISOString().slice(0, 10); out.push(by.get(d) ?? { date: d, bytes: 0, versions: 0 }); }
    return out;
  }, [o.growth]);
  const max = Math.max(1, ...days.map((d) => d.bytes)), total = days.reduce((n, d) => n + d.bytes, 0);
  const W = 900, H = 150, bw = W / days.length;
  const h = hot !== null ? days[hot]! : null;
  return (
    <section aria-label={t('next.st.growth')} data-testid="storage-growth">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 className="spd-eyebrow">{t('next.st.growth')}</h2><p className="text-xs text-ink-2 tabular-nums" aria-live="polite">{h ? `${fmtDate(h.date, { dateStyle: 'medium', timeZone: 'UTC' })} — ${fmt(h.bytes)} · ${t('next.st.versions', { n: h.versions })}` : t('next.st.growthTotal', { size: fmt(total) })}</p></div>
      <p className="text-[11px] text-ink-3 tabular-nums" aria-hidden="true">{fmt(max)}</p>
      <svg viewBox={`0 0 ${W} ${H + 2}`} className="block h-auto w-full" role="img" aria-label={t('next.st.growthLabel', { size: fmt(total) })} onMouseLeave={() => setHot(null)}>
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--spd-color-hairline)" />
        {days.map((d, i) => {
          const bh = d.bytes ? Math.max(2, (d.bytes / max) * (H - 18)) : 0;
          return (
            <g key={d.date} onMouseEnter={() => setHot(i)}>
              <rect x={i * bw} y="0" width={bw} height={H} fill="transparent" />
              {bh ? <rect className="anim-grow-y" x={i * bw + 1.5} y={H - bh} width={Math.max(1, bw - 3)} height={bh} rx="2" fill="var(--spd-color-brand)" fillOpacity={hot === null || hot === i ? 1 : 0.4} style={{ animationDelay: `${i * 4}ms` }} /> : null}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 flex justify-between text-[11px] text-ink-3" aria-hidden="true">{[0, 30, 60, 89].map((i) => <span key={i}>{fmtDate(days[i]!.date, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>)}</p>
      {!total ? <p className="mt-1 text-xs text-ink-3">{t('next.st.growthNone')}</p> : null}
    </section>
  );
}

export function StorageScreen() {
  const t = useT();
  const q = useQuery({ queryKey: ['next', 'storage', 'overview'], queryFn: () => get<StorageOverview>('/storage/overview'), refetchOnMount: 'always' });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;
  return (
    <div className="pb-dock mx-auto w-full max-w-5xl px-4 pt-3 sm:px-8 sm:pt-6" data-testid="storage-screen">
      <header className="mb-6"><h1 className="text-[30px] leading-[1.1] sm:text-[32px]">{t('next.st.title')}</h1><p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-ink-2">{t('next.st.intro')}</p></header>
      <QuotaBar o={o} />
      <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-5 sm:grid-cols-4">
        <Figure label={t('next.st.fFiles')} value={new Intl.NumberFormat(getLocale()).format(o.counts.files)} detail={t('next.st.fFolders', { n: o.counts.folders })} testId="fig-files" />
        <Figure label={t('next.st.fLive')} value={fmt(o.liveBytes)} detail={t('next.st.fLiveDetail')} />
        <Figure label={t('next.st.fVersions')} value={fmt(o.oldVersionBytes)} detail={t('next.st.versions', { n: o.counts.versions })} />
        <Figure label={t('next.st.fTrash')} value={fmt(o.trashBytes)} detail={t('next.st.files', { n: o.counts.trashedFiles })} />
      </dl>
      <div className="mt-7 grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <ByKind o={o} />
        <Growth o={o} />
      </div>
      <div className="mt-8"><ByFolder /></div>
      <div className="mt-8 grid gap-x-10 gap-y-8 lg:grid-cols-[3fr_2fr]">
        <section aria-label={t('next.st.largest')} data-testid="storage-largest">
          <h2 className="spd-eyebrow mb-2">{t('next.st.largest')}</h2>
          {o.largest.length ? (
            <ol className="divide-y divide-line overflow-hidden rounded-[12px] shadow-(--spd-elevation-e0)">
              {o.largest.slice(0, 10).map((f) => (
                <li key={f.id}><Link href={`/folder/${f.folderId}?file=${f.id}`} className="relative flex items-center gap-3 px-3 py-2 transition-colors hover:bg-hover">
                  <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${(f.size / (o.largest[0]!.size || 1)) * 100}%`, opacity: 0.5 }} />
                  <Thumb name={f.name} kind={f.kind} className="relative h-8 w-8 shrink-0 overflow-hidden rounded-[6px]!" src={f.thumb && f.scan !== 'infected' ? ownerSource(f).previewUrl('thumb') : undefined} />
                  <span className="relative min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{f.name}</span><span className="relative shrink-0 text-[13px] text-ink tabular-nums">{fmt(f.size)}</span>
                </Link></li>
              ))}
            </ol>
          ) : <p className="text-[13px] text-ink-3">{t('next.st.nothing')}</p>}
        </section>
        <section aria-label={t('next.st.dups')} data-testid="storage-dups">
          <h2 className="spd-eyebrow mb-2">{t('next.st.dups')}</h2>
          <div className="rounded-[12px] px-4 py-4 shadow-(--spd-elevation-e0)">
            <p className="spd-figure text-[22px] text-ink">{t('next.st.dupGroups', { n: o.duplicates.groups })}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{o.duplicates.groups ? t('next.st.dupText', { size: fmt(o.duplicates.duplicateBytes) }) : t('next.st.dupNone')}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">{t('next.st.dupNote')}</p>
            <Link href="/duplicates" className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium text-accent ring-1 ring-line-strong ring-inset hover:bg-hover">{t('next.st.dupOpen')}<Glyph name="arrowRight" size={14} /></Link>
          </div>
        </section>
      </div>
    </div>
  );
}
