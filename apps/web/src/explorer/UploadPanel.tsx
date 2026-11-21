/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/explorer/UploadPanel.tsx
 * Module           : explorer
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
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

// The transfer centre: every upload of this page (real progress, speed, remaining bytes, pause, resume, retry, cancel),
// the sessions interrupted by a reload, the account's upload history from the server, and the name-collision question.
// Mounted once by the shell, so it is reachable from every screen and transfers survive navigation.
import { formatBytes } from '@spd/shared';
import { useQuery } from '@tanstack/react-query';
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'wouter';
import { get } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { errorText, fmtRelative, getLocale, useT } from '../i18n.ts';
import { useExplorerContext } from '../next/context.ts';
import { useFeature } from '../next/meta.ts';
import type { UploadRecord } from '../next/types.ts';
import { Button, cx, Dialog, IconButton, ProgressBar, Spinner } from '../ui.tsx';
import { pickedFromInput } from './lib.ts';
import { type Decision, type Pending, type UploadItem, uploads, useUploads } from './uploads.ts';

function eta(seconds: number, t: ReturnType<typeof useT>): string {
  if (!Number.isFinite(seconds) || seconds < 1) return t('explorer.up.etaSoon');
  if (seconds < 60) return t('explorer.up.etaS', { n: Math.round(seconds) });
  if (seconds < 3600) return t('explorer.up.etaM', { n: Math.round(seconds / 60) });
  return t('explorer.up.etaH', { n: Math.round(seconds / 360) / 10 });
}

const Row = memo(function Row({ it }: { it: UploadItem }) {
  const t = useT();
  const loc = getLocale();
  const pct = it.size ? it.sent / it.size : it.state === 'done' ? 1 : 0;
  const resumed = it.resumedFrom > 0 ? ` · ${t('explorer.up.resumedAt', { pct: Math.round((it.resumedFrom / Math.max(1, it.size)) * 100) })}` : '';
  let line: string;
  if (it.state === 'queued') line = t('explorer.up.queued');
  else if (it.state === 'uploading') line = `${t('explorer.up.progress', { sent: formatBytes(it.sent, loc), total: formatBytes(it.size, loc) })}${it.speed > 0 ? ` · ${formatBytes(it.speed, loc)}/s · ${eta((it.size - it.sent) / it.speed, t)}` : ''}${resumed}`;
  else if (it.state === 'paused') line = `${t('explorer.up.paused')} · ${t('explorer.up.progress', { sent: formatBytes(it.sent, loc), total: formatBytes(it.size, loc) })}`;
  else if (it.state === 'finishing') line = t('explorer.up.finishing');
  else if (it.state === 'conflict') line = t('explorer.up.conflictWaiting');
  else if (it.state === 'skipped') line = t('explorer.up.skipped');
  else if (it.state === 'done') line = `${it.created === false ? t('explorer.up.doneVersion') : it.result && it.result.name !== it.name ? t('explorer.up.doneAs', { name: it.result.name }) : t('explorer.up.done')} · ${formatBytes(it.size, loc)}${resumed}`;
  else line = errorText(it.error);
  return (
    <li className="flex items-center gap-3 py-2.5 pr-2 pl-4" data-upload-state={it.state}>
      <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] transition-colors duration-300', it.state === 'done' ? 'bg-ok-soft text-ok' : it.state === 'error' ? 'bg-danger-soft text-danger' : it.state === 'uploading' || it.state === 'finishing' ? 'bg-accent-soft text-accent' : 'bg-hover text-ink-2')}>
        {it.state === 'finishing' ? <Spinner size={16} /> : <Glyph size={18} name={it.state === 'done' ? 'check' : it.state === 'error' ? 'warning' : it.state === 'paused' ? 'pause' : it.state === 'skipped' ? 'x' : 'upload'} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-ink sm:text-sm" title={it.relativePath ?? it.name}>{it.name}</p>
        <p className={cx('truncate text-xs tabular-nums', it.state === 'error' ? 'text-danger' : 'text-ink-3')} role={it.state === 'error' ? 'alert' : undefined}>{line}</p>
        {it.state === 'uploading' || it.state === 'paused' ? <div className="mt-1.5"><ProgressBar value={pct} label={it.name} /></div> : null}
      </div>
      {it.state === 'uploading' || it.state === 'queued' ? <IconButton icon="pause" label={t('explorer.up.pause')} size={18} onClick={() => uploads.pause(it.key)} /> : null}
      {it.state === 'paused' ? <IconButton icon="play" label={t('explorer.up.resume')} size={18} onClick={() => uploads.resume(it.key)} /> : null}
      {it.state === 'error' ? <IconButton icon="refresh" label={t('common.retry')} size={18} onClick={() => uploads.resume(it.key)} /> : null}
      {it.state !== 'finishing' ? <IconButton icon="x" label={it.state === 'done' || it.state === 'skipped' ? t('explorer.up.remove') : t('explorer.up.cancel')} size={18} onClick={() => uploads.cancel(it.key)} /> : null}
    </li>
  );
});

function PendingRow({ p }: { p: Pending }) {
  const t = useT();
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-warn-soft text-warn"><Glyph name="history" size={18} /></span>
      <div className="min-w-0 flex-1"><p className="truncate text-sm text-ink">{p.name}</p><p className="text-xs text-ink-3">{formatBytes(p.size, getLocale())}</p></div>
      <Button size="sm" variant="ghost" onClick={() => uploads.forget(p.uploadId)}>{t('explorer.up.forget')}</Button>
    </li>
  );
}

function ConflictDialog({ it, many }: { it: UploadItem; many: boolean }) {
  const t = useT();
  const [all, setAll] = useState(many);
  const pick = (d: Decision) => uploads.resolve(it.key, d, all);
  return (
    <Dialog title={t('explorer.conflict.title')} onClose={() => pick('skip')} dismissable={false}>
      <p className="text-sm leading-relaxed text-ink-2">{t('explorer.conflict.text', { name: it.name })}</p>
      <div className="mt-4 flex flex-col gap-2">
        <Button variant="primary" icon="history" onClick={() => pick('version')} data-autofocus>{t('explorer.conflict.version')}</Button>
        <Button icon="duplicate" onClick={() => pick('rename')}>{t('explorer.conflict.keepBoth')}</Button>
        <Button variant="ghost" onClick={() => pick('skip')}>{t('explorer.conflict.skip')}</Button>
      </div>
      {many ? (
        <label className="mt-4 flex min-h-10 cursor-pointer items-center gap-3 text-sm text-ink">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={all} onChange={(e) => setAll(e.target.checked)} />
          {t('explorer.conflict.applyAll')}
        </label>
      ) : null}
    </Dialog>
  );
}

/** Overall progress as a ring. */
function Ring({ value, size = 36, label }: { value: number; size?: number; label?: boolean }) {
  const v = Math.max(0, Math.min(1, value)), r = 15, c = 2 * Math.PI * r;
  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 36 36" className="-rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--spd-color-sunken)" strokeWidth="3.5" />
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--spd-color-brand)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset var(--spd-motion-progress)' }} />
      </svg>
      {label ? <span className="absolute text-[10px] font-semibold text-ink tabular-nums">{Math.round(v * 100)}</span> : null}
    </span>
  );
}

// --- open / closed: one store, so the header button and the palette can open the centre from anywhere ---
let centreOpen = false, listOpen = true;
const openListeners = new Set<() => void>();
export const transferCentre = {
  open(): void { centreOpen = true; listOpen = true; openListeners.forEach((f) => f()); },
  close(): void { centreOpen = false; openListeners.forEach((f) => f()); },
  toggle(): void { if (centreOpen) this.close(); else this.open(); },
};
const useCentreOpen = (): boolean => useSyncExternalStore((cb) => { openListeners.add(cb); return () => openListeners.delete(cb); }, () => centreOpen);
/** True while the panel takes room at the bottom of the screen (the listing adds padding on phones). */
export function useUploadPanelVisible(): boolean { const s = useUploads(); const o = useCentreOpen(); return o || s.items.length > 0 || s.pending.length > 0; }

function totals(items: UploadItem[]) {
  const live = items.filter((i) => i.state !== 'skipped');
  const total = live.reduce((n, i) => n + i.size, 0), sent = live.reduce((n, i) => n + (i.state === 'done' ? i.size : i.sent), 0);
  const speed = items.reduce((n, i) => n + (i.state === 'uploading' ? i.speed : 0), 0);
  return { total, sent, speed, left: Math.max(0, total - sent) };
}

/** The button of the top bar: a ring while something travels, a count of what failed. */
export function TransferButton() {
  const t = useT();
  const { items } = useUploads();
  const open = useCentreOpen();
  const active = items.filter((i) => uploads.isActive(i) || i.state === 'paused'), failed = items.filter((i) => i.state === 'error').length;
  const { total, sent } = totals(items);
  const label = active.length ? t('next.tc.buttonActive', { n: active.length }) : t('next.tc.button');
  return (
    <button type="button" aria-label={label} title={label} aria-expanded={open} data-testid="transfer-button" onClick={() => transferCentre.toggle()}
      className={cx('press relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-hover hover:text-ink', open && 'bg-accent-soft text-accent')}>
      {active.length ? <Ring value={total ? sent / total : 0} size={26} /> : <Glyph name="swap" size={20} />}
      {active.length ? <Glyph name="arrowUp" size={11} strokeWidth={2.6} className="absolute text-accent" /> : null}
      {failed ? <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-bg"><span className="sr-only">{t('explorer.up.titleFailed', { n: failed })}</span></span> : null}
    </button>
  );
}

function HistoryRow({ u }: { u: UploadRecord }) {
  const t = useT();
  const loc = getLocale();
  const state = u.status === 'done' ? (u.fileExists ? t('next.tc.hDone') : t('next.tc.hGone')) : u.status === 'aborted' ? t('next.tc.hAborted') : t('next.tc.hActive', { pct: Math.round((u.received / Math.max(1, u.size)) * 100) });
  const href = u.status === 'done' && u.fileExists ? (u.grantId ? `/shared/${u.grantId}` : u.folderId && u.fileId ? `/folder/${u.folderId}?file=${u.fileId}` : null) : null;
  const body = (
    <>
      <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', u.status === 'done' ? 'bg-ok-soft text-ok' : u.status === 'aborted' ? 'bg-hover text-ink-3' : 'bg-accent-soft text-accent')}><Glyph size={15} strokeWidth={2} name={u.status === 'done' ? 'check' : u.status === 'aborted' ? 'x' : 'upload'} /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{u.name}</span><span className="block truncate text-xs text-ink-3">{formatBytes(u.size, loc)} · {state} · {fmtRelative(u.updatedAt)}{u.grantId ? ` · ${t('next.tc.hShared')}` : ''}</span></span>
      {href ? <Glyph name="chevronRight" size={14} className="shrink-0 text-ink-3" /> : null}
    </>
  );
  const cls = 'flex items-center gap-3 px-4 py-2';
  return <li data-status={u.status}>{href ? <Link href={href} className={cx(cls, 'transition-colors hover:bg-hover')} onClick={() => { if (window.matchMedia('(max-width: 639px)').matches) transferCentre.close(); }}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}
function History() {
  const t = useT();
  const q = useQuery({ queryKey: ['next', 'uploads', 'recent'], queryFn: () => get<{ uploads: UploadRecord[] }>('/uploads?state=recent&limit=100'), refetchOnMount: 'always' });
  if (q.isLoading) return <div className="flex justify-center py-8 text-accent"><Spinner /></div>;
  if (q.error) return <p role="alert" className="px-4 py-6 text-center text-sm text-danger">{errorText(q.error)}</p>;
  const list = q.data?.uploads ?? [];
  if (!list.length) return <p className="px-6 py-8 text-center text-sm text-ink-3">{t('next.tc.hEmpty')}</p>;
  return <><ul className="divide-y divide-line" data-testid="upload-history">{list.map((u) => <HistoryRow key={u.id} u={u} />)}</ul><p className="border-t border-line px-4 py-2 text-xs text-ink-3">{t('next.tc.hNote')}</p></>;
}

export function TransferCentre() {
  const t = useT();
  const loc = getLocale();
  const { items, pending, batchSizes } = useUploads();
  const asked = useCentreOpen();
  const ctx = useExplorerContext();
  const hasHistory = useFeature('upload-history');
  const [open, setOpenState] = useState(listOpen);
  const setOpen = (v: boolean) => { listOpen = v; setOpenState(v); };
  useEffect(() => { if (asked) setOpenState(true); }, [asked]);
  const [tab, setTab] = useState<'now' | 'history'>('now');
  const [hidePending, setHidePending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const conflict = items.find((i) => i.state === 'conflict');
  const showPending = pending.length > 0 && !hidePending;
  const dialog = conflict ? <ConflictDialog key={conflict.key} it={conflict} many={(batchSizes[conflict.batch] ?? 1) > 1} /> : null;
  if (!asked && !items.length && !showPending) return dialog;
  const active = items.filter(uploads.isActive), paused = items.filter((i) => i.state === 'paused'), failed = items.filter((i) => i.state === 'error');
  const finished = items.filter((i) => i.state === 'done' || i.state === 'skipped');
  const { total, sent, speed, left } = totals(items);
  const busy = active.length > 0 || paused.length > 0;
  const title = active.length ? t('explorer.up.titleActive', { n: active.length })
    : failed.length ? t('explorer.up.titleFailed', { n: failed.length })
    : paused.length ? t('explorer.up.titlePaused', { n: paused.length })
    : items.length ? t('explorer.up.titleDone', { n: finished.filter((i) => i.state === 'done').length })
    : pending.length && showPending ? t('explorer.up.titlePending', { n: pending.length })
    : t('next.tc.title');
  const now = tab === 'now' || !hasHistory;
  const dest = ctx.folder;
  return (
    <>
      <section aria-label={t('explorer.up.label')} data-testid="upload-panel" style={{ bottom: 'calc(var(--dock) + 10px)' }}
        className="anim-pop absolute inset-x-3 z-40 flex max-h-[62%] flex-col overflow-hidden rounded-[14px] bg-raised shadow-pop sm:inset-x-auto sm:right-4 sm:max-h-[72%] sm:w-[25rem]">
        <header className="flex items-center gap-1 py-1.5 pr-1.5 pl-3.5">
          {busy ? <Ring value={total ? sent / total : 0} label /> : <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', failed.length ? 'bg-danger-soft text-danger' : items.length ? 'bg-ok-soft text-ok' : 'bg-hover text-ink-2')}><Glyph name={failed.length ? 'warning' : items.length ? 'check' : pending.length && showPending ? 'history' : 'swap'} size={18} strokeWidth={2} /></span>}
          <div className="min-w-0 flex-1 pl-2">
            <h2 className="truncate text-sm font-semibold text-ink" aria-live="polite">{title}</h2>
            {busy ? <p className="truncate text-xs text-ink-3 tabular-nums" data-testid="transfer-summary">{t('next.tc.left', { left: formatBytes(left, loc) })}{speed > 0 ? ` · ${formatBytes(speed, loc)}/s · ${eta(left / speed, t)}` : ''}</p> : null}
          </div>
          {finished.length ? <Button size="sm" variant="ghost" onClick={() => uploads.clearFinished()}>{t('explorer.up.clear')}</Button> : null}
          <IconButton icon={open ? 'chevronDown' : 'arrowUp'} label={open ? t('explorer.up.collapse') : t('explorer.up.expand')} size={18} aria-expanded={open} onClick={() => setOpen(!open)} />
          {asked ? <IconButton icon="x" label={t('common.close')} size={18} onClick={() => transferCentre.close()} /> : null}
        </header>
        {busy ? <div className="px-3.5 pb-2.5"><ProgressBar value={total ? sent / total : 0} label={t('explorer.up.overall')} /></div> : null}
        {open ? (
          <div className="flex min-h-0 flex-1 flex-col border-t border-line">
            {hasHistory && (asked || tab === 'history') ? (
              <div role="tablist" aria-label={t('next.tc.title')} className="flex shrink-0 gap-1 border-b border-line px-2.5 py-1.5">
                {(['now', 'history'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('h-8 rounded-lg px-3 text-[13px] transition-colors', tab === k ? 'bg-selection font-medium text-ink' : 'text-ink-2 hover:bg-hover')}>{t(k === 'now' ? 'next.tc.tabNow' : 'next.tc.tabHistory')}</button>)}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {now ? (
                <>
                  {items.length ? <ul className="divide-y divide-line">{items.map((it) => <Row key={it.key} it={it} />)}</ul> : null}
                  {showPending ? (
                    <div className={cx(items.length > 0 && 'border-t border-line')}>
                      <div className="flex items-start gap-2 px-4 pt-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="spd-eyebrow">{t('explorer.up.pendingTitle', { n: pending.length })}</h3>
                          <p className="mt-1 text-xs leading-relaxed text-ink-3">{t('explorer.up.pendingText')}</p>
                        </div>
                        <IconButton icon="x" label={t('explorer.up.pendingHide')} size={16} className="-mt-1.5 -mr-2" onClick={() => setHidePending(true)} />
                      </div>
                      <ul className="pb-1">{pending.map((p) => <PendingRow key={p.uploadId} p={p} />)}</ul>
                    </div>
                  ) : null}
                  {!items.length && !showPending ? (
                    <div className="flex flex-col items-center gap-3 px-6 py-7 text-center">
                      <p className="spd-title text-[17px] text-ink">{t('next.tc.idle')}</p>
                      <p className="max-w-xs text-[13px] leading-relaxed text-ink-2">{t('next.tc.idleText')}</p>
                      <input ref={input} type="file" multiple hidden data-testid="transfer-input" onChange={(e) => { const list = pickedFromInput(e.target.files); e.target.value = ''; if (list.length) uploads.enqueue(list, dest?.id ?? 'root'); }} />
                      <Button variant="primary" icon="upload" onClick={() => input.current?.click()}>{dest ? t('next.tc.uploadTo', { name: dest.name }) : t('next.tc.uploadRoot')}</Button>
                    </div>
                  ) : <p className="border-t border-line px-4 py-2 text-xs leading-relaxed text-ink-3">{t('explorer.up.note')}</p>}
                </>
              ) : <History />}
            </div>
          </div>
        ) : null}
      </section>
      {dialog}
    </>
  );
}
