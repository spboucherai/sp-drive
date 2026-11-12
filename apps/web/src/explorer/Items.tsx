// One entry of the listing, as a table-like row (list) or a card (grid). Memoised: a selection change re-renders
// only the rows whose state changed, which keeps folders with thousands of entries responsive.
import { formatBytes } from '@spd/shared';
import { memo, type MouseEvent, type DragEvent, useRef, useState } from 'react';
import { Glyph } from '../glyphs.tsx';
import { fmtDate, fmtRelative, getLocale, useT } from '../i18n.ts';
import { Thumb } from '../preview/Thumb.tsx';
import { ownerSource } from '../sources.ts';
import type { Item, Tag } from '../types.ts';
import { Badge, cx } from '../ui.tsx';
import { tagStyle } from './lib.ts';

/** Callbacks from the explorer. The object is stable for the life of the explorer so rows never re-render for it. */
export interface RowApi {
  click(e: MouseEvent, id: string, touch: boolean): void;
  open(id: string): void;
  menu(id: string, at: { x: number; y: number } | DOMRect): void;
  longPress(id: string): void;
  focus(id: string): void;
  dragStart(e: DragEvent, id: string): void;
  dragEnd(): void;
  canDrop(id: string): boolean;
  drop(id: string): void;
}
export type ViewMode = 'grid' | 'list';

// Which kind of pointer started the current gesture: a tap opens, a mouse click selects.
let pointer = 'mouse';
let swallowClickUntil = 0;

export function TagChip({ tag, small }: { tag: Tag; small?: boolean }) {
  return <span className={cx('inline-flex max-w-32 shrink-0 items-center truncate rounded-full font-medium', small ? 'px-1.5 py-px text-[11px]' : 'px-2 py-0.5 text-xs', tagStyle(tag.color).chip)}>{tag.name}</span>;
}

interface Props { item: Item; mode: ViewMode; selected: boolean; tabbable: boolean; tags: Map<string, Tag>; api: RowApi; index: number }
export const ItemRow = memo(function ItemRow({ item, mode, selected, tabbable, tags, api, index }: Props) {
  const t = useT();
  const [over, setOver] = useState(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const file = item.type === 'file' ? item : null;
  const infected = file?.scan === 'infected';
  const endPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  const longPress = () => { endPress(); swallowClickUntil = Date.now() + 700; navigator.vibrate?.(10); api.longPress(item.id); };

  const row = {
    role: 'row', 'aria-selected': selected, 'aria-rowindex': index + 1, 'data-id': item.id, 'data-type': item.type, tabIndex: tabbable ? 0 : -1,
    draggable: true,
    onFocus: (e: React.FocusEvent) => { if (e.target === e.currentTarget) api.focus(item.id); },
    onPointerDown: (e: React.PointerEvent) => {
      pointer = e.pointerType;
      if (e.pointerType !== 'touch') return;
      endPress();
      press.current = { x: e.clientX, y: e.clientY, timer: setTimeout(longPress, 480) };
    },
    onPointerMove: (e: React.PointerEvent) => { if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) endPress(); },
    onPointerUp: endPress, onPointerCancel: endPress,
    onClick: (e: MouseEvent) => { if (Date.now() < swallowClickUntil) { swallowClickUntil = 0; return; } api.click(e, item.id, pointer === 'touch'); },
    onDoubleClick: () => { if (pointer !== 'touch') api.open(item.id); },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      if (pointer === 'touch') { if (press.current) longPress(); return; } // Android fires contextmenu on a long press
      api.menu(item.id, { x: e.clientX, y: e.clientY });
    },
    onDragStart: (e: DragEvent) => { if (pointer === 'touch') { e.preventDefault(); return; } api.dragStart(e, item.id); },
    onDragEnd: () => api.dragEnd(),
    ...(item.type === 'folder' ? {
      onDragOver: (e: DragEvent) => { if (!api.canDrop(item.id)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; if (!over) setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => { if (!api.canDrop(item.id)) return; e.preventDefault(); e.stopPropagation(); setOver(false); api.drop(item.id); },
    } : {}),
  };
  const state = cx('group relative cursor-default select-none outline-none [-webkit-touch-callout:none] [&_img]:pointer-events-none focus-visible:ring-2 focus-visible:ring-accent',
    over ? 'bg-accent-soft! ring-2 ring-accent' : selected ? 'bg-accent-soft!' : '[@media(hover:hover)]:hover:bg-hover active:bg-hover');

  const thumb = (cls: string) => (
    <Thumb name={item.name} kind={file ? file.kind : 'folder'} className={cls}
      src={file && file.thumb && !infected ? ownerSource(file).previewUrl('thumb') : undefined} />
  );
  const fileTags = file ? file.tagIds.map((id) => tags.get(id)).filter((x): x is Tag => !!x) : [];
  const marks = (
    <>
      {item.starred ? <span className="shrink-0 text-amber-500" title={t('explorer.starred')}><Glyph name="star" size={14} fill="currentColor" /><span className="sr-only">{t('explorer.starred')}</span></span> : null}
      {infected ? <Badge tone="danger"><Glyph name="warning" size={12} />{t('explorer.infected')}</Badge> : null}
      {file && file.versions > 1 ? <span className="shrink-0 rounded-full bg-hover px-1.5 py-px text-[11px] font-medium text-ink-2" title={t('explorer.versionsN', { n: file.versions })}>v{file.versions}</span> : null}
      {file?.origin === 'request' ? <span className="shrink-0 text-ink-3" title={t('explorer.viaPortal')}><Glyph name="inbox" size={14} /><span className="sr-only">{t('explorer.viaPortal')}</span></span> : null}
    </>
  );
  const more = (
    <button type="button" tabIndex={-1} aria-label={t('explorer.actionsFor', { name: item.name })} aria-haspopup="menu" data-more
      onClick={(e) => { e.stopPropagation(); api.menu(item.id, e.currentTarget.getBoundingClientRect()); }} onDoubleClick={(e) => e.stopPropagation()} onPointerDown={(e) => { pointer = e.pointerType; e.stopPropagation(); }}
      className="inline-flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-ink-3 transition hover:bg-line hover:text-ink focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus:opacity-100 [@media(hover:hover)]:group-aria-selected:opacity-100">
      <Glyph name="dots" size={22} strokeWidth={2.8} />
    </button>
  );
  const when = item.trashedAt ?? item.updatedAt;
  const size = file ? formatBytes(file.size, getLocale()) : null;

  if (mode === 'list') return (
    <div {...row} className={cx(state, 'grid min-h-[68px] grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-x-3 pr-1.5 pl-3 transition-colors after:absolute after:right-0 after:bottom-0 after:left-[4.5rem] after:h-px after:bg-line last:after:hidden sm:min-h-[58px] sm:grid-cols-[minmax(0,1fr)_9.5rem_5.5rem_2.5rem] sm:pr-3 sm:pl-4 sm:after:left-[4.75rem] [contain-intrinsic-size:auto_4.25rem] [content-visibility:auto]')}>
      <div role="gridcell" className="flex min-w-0 items-center gap-3.5">
        {thumb('h-11 w-11 shrink-0 overflow-hidden rounded-[13px]! sm:h-10 sm:w-10')}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[16px] font-medium tracking-[-0.01em] text-ink sm:text-sm sm:tracking-normal" data-name>{item.name}</span>
            {marks}
            <span className="hidden min-w-0 items-center gap-1 lg:flex">{fileTags.slice(0, 3).map((g) => <TagChip key={g.id} tag={g} small />)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-ink-3 sm:hidden">
            <span className="truncate">{size ? `${size} · ` : ''}{fmtRelative(when)}</span>
            {fileTags.slice(0, 4).map((g) => <span key={g.id} title={g.name} className={cx('h-2 w-2 shrink-0 rounded-full', tagStyle(g.color).dot)} />)}
          </div>
        </div>
      </div>
      <div role="gridcell" className="hidden truncate text-sm text-ink-2 sm:block" title={fmtDate(when)}>{fmtRelative(when)}</div>
      <div role="gridcell" className="hidden text-right text-sm text-ink-2 tabular-nums sm:block">{size ?? '—'}</div>
      <div role="gridcell" className="flex justify-end">{more}</div>
    </div>
  );
  if (!file) return (
    <div {...row} className={cx(state, 'press rounded-card bg-surface shadow-(--shadow-card)', selected && 'ring-2 ring-accent')}>
      <div role="gridcell" className="flex h-full min-h-[112px] flex-col justify-between pt-3 pb-3 pl-3.5">
        <div className="flex items-start justify-between">
          {thumb('h-11 w-11 shrink-0 rounded-[13px]!')}
          <div className="-mt-1.5 flex items-center gap-1 pr-0.5">{marks}{more}</div>
        </div>
        <span className="line-clamp-2 pr-3 text-[15px] leading-snug font-semibold tracking-[-0.01em] break-words text-ink" data-name>{item.name}</span>
      </div>
    </div>
  );
  return (
    <div {...row} className={cx(state, 'press overflow-hidden rounded-card bg-surface shadow-(--shadow-card)', selected && 'ring-2 ring-accent')}>
      <div role="gridcell" className="flex h-full flex-col">
        {thumb('aspect-[4/3] w-full overflow-hidden rounded-none!')}
        <div className="flex items-center gap-0.5 py-2 pr-0.5 pl-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5"><span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink sm:text-sm" data-name>{item.name}</span>{marks}</div>
            <div className="flex items-center gap-1.5 text-[13px] text-ink-3 sm:text-xs">
              <span className="truncate">{size}<span className="max-sm:hidden"> · {fmtRelative(when)}</span></span>
              {fileTags.slice(0, 4).map((g) => <span key={g.id} title={g.name} className={cx('h-2 w-2 shrink-0 rounded-full', tagStyle(g.color).dot)} />)}
            </div>
          </div>
          {more}
        </div>
      </div>
    </div>
  );
});

export function ListHeader({ sort, dir, onSort }: { sort?: string; dir?: string; onSort?: (key: 'name' | 'updated' | 'size') => void }) {
  const t = useT();
  const col = (key: 'name' | 'updated' | 'size', label: string, cls: string) => (
    <div role="columnheader" aria-sort={onSort && sort === key ? (dir === 'desc' ? 'descending' : 'ascending') : undefined} className={cls}>
      {onSort ? (
        <button type="button" onClick={() => onSort(key)} className="inline-flex h-8 items-center gap-1 rounded-lg px-1 tracking-wide uppercase hover:text-ink">
          {label}{sort === key ? <Glyph name={dir === 'desc' ? 'arrowDown' : 'arrowUp'} size={12} /> : null}
        </button>
      ) : <span className="px-1">{label}</span>}
    </div>
  );
  return (
    <div role="row" className="hidden h-11 grid-cols-[minmax(0,1fr)_9.5rem_5.5rem_2.5rem] items-center gap-x-3 border-b border-line pr-3 pl-4 text-xs font-semibold tracking-wide text-ink-3 uppercase sm:grid">
      {col('name', t('explorer.col.name'), '')}
      {col('updated', t('explorer.col.updated'), '-ml-1')}
      {col('size', t('explorer.col.size'), 'text-right')}
      <div role="columnheader"><span className="sr-only">{t('common.more')}</span></div>
    </div>
  );
}

export function Skeleton({ mode }: { mode: ViewMode }) {
  const t = useT();
  return (
    <div role="status" aria-label={t('common.loading')} className={cx(mode === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] sm:gap-4' : 'card flex flex-col overflow-hidden')}>
      {Array.from({ length: mode === 'grid' ? 8 : 9 }, (_, i) => mode === 'grid'
        ? <div key={i} className="overflow-hidden rounded-card bg-surface shadow-(--shadow-card)"><div className="skeleton aspect-[4/3]" /><div className="skeleton mx-3.5 mt-3 h-3.5 w-2/3 rounded-full" /><div className="skeleton mx-3.5 mt-2 mb-3.5 h-3 w-1/3 rounded-full" /></div>
        : <div key={i} className="flex h-[68px] items-center gap-3.5 px-3 sm:h-[58px] sm:px-4"><div className="skeleton h-11 w-11 shrink-0 rounded-[13px] sm:h-10 sm:w-10" /><div className="flex-1"><div className="skeleton h-3.5 rounded-full" style={{ width: `${30 + ((i * 17) % 40)}%` }} /><div className="skeleton mt-2 h-3 w-24 rounded-full" /></div></div>)}
    </div>
  );
}
