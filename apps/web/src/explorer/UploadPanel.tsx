// Floating list of transfers (bottom-right on desktop, bottom sheet on phones) and the name-collision question.
// Positioned inside the listing column of the explorer: above the phone navigation bar, beside the details panel.
import { formatBytes } from '@spd/shared';
import { memo, useState } from 'react';
import { Glyph } from '../glyphs.tsx';
import { errorText, getLocale, useT } from '../i18n.ts';
import { Button, cx, Dialog, IconButton, ProgressBar, Spinner } from '../ui.tsx';
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
    <li className="flex items-center gap-3 px-4 py-2.5" data-upload-state={it.state}>
      <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', it.state === 'done' ? 'bg-ok-soft text-ok' : it.state === 'error' ? 'bg-danger-soft text-danger' : 'bg-hover text-ink-2')}>
        {it.state === 'finishing' ? <Spinner size={16} /> : <Glyph size={18} name={it.state === 'done' ? 'check' : it.state === 'error' ? 'warning' : it.state === 'paused' ? 'pause' : it.state === 'skipped' ? 'x' : 'upload'} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink" title={it.relativePath ?? it.name}>{it.name}</p>
        <p className={cx('truncate text-xs', it.state === 'error' ? 'text-danger' : 'text-ink-3')} role={it.state === 'error' ? 'alert' : undefined}>{line}</p>
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
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn"><Glyph name="history" size={18} /></span>
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

let panelOpen = true; // survives the remount of the explorer between folders
/** True while the panel takes room at the bottom of the screen (the listing adds padding on phones). */
export function useUploadPanelVisible(): boolean { const s = useUploads(); return s.items.length > 0 || s.pending.length > 0; }

export function UploadPanel() {
  const t = useT();
  const { items, pending, batchSizes } = useUploads();
  const [open, setOpenState] = useState(panelOpen);
  const setOpen = (v: boolean) => { panelOpen = v; setOpenState(v); };
  const [hidePending, setHidePending] = useState(false);
  const conflict = items.find((i) => i.state === 'conflict');
  const showPending = pending.length > 0 && !hidePending;
  if (!items.length && !showPending) return null;
  const active = items.filter(uploads.isActive), paused = items.filter((i) => i.state === 'paused'), failed = items.filter((i) => i.state === 'error');
  const finished = items.filter((i) => i.state === 'done' || i.state === 'skipped');
  const total = items.reduce((n, i) => n + i.size, 0), sent = items.reduce((n, i) => n + (i.state === 'done' || i.state === 'skipped' ? i.size : i.sent), 0);
  const title = active.length ? t('explorer.up.titleActive', { n: active.length })
    : failed.length ? t('explorer.up.titleFailed', { n: failed.length })
    : paused.length ? t('explorer.up.titlePaused', { n: paused.length })
    : items.length ? t('explorer.up.titleDone', { n: finished.filter((i) => i.state === 'done').length })
    : t('explorer.up.titlePending', { n: pending.length });
  return (
    <>
      <section aria-label={t('explorer.up.label')} data-testid="upload-panel"
        className="absolute inset-x-0 bottom-0 z-40 flex max-h-[55%] sm:max-h-[70%] flex-col rounded-t-2xl border border-line bg-raised shadow-pop sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[26rem] sm:rounded-2xl">
        <header className="flex items-center gap-1 py-1.5 pr-2 pl-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" aria-live="polite">{title}</h2>
          {finished.length ? <Button size="sm" variant="ghost" onClick={() => uploads.clearFinished()}>{t('explorer.up.clear')}</Button> : null}
          <IconButton icon={open ? 'chevronDown' : 'arrowUp'} label={open ? t('explorer.up.collapse') : t('explorer.up.expand')} size={18} aria-expanded={open} onClick={() => setOpen(!open)} />
        </header>
        {active.length || paused.length ? <div className="px-4 pb-2"><ProgressBar value={total ? sent / total : 0} label={t('explorer.up.overall')} /></div> : null}
        {open ? (
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
            {items.length ? <ul className="divide-y divide-line">{items.map((it) => <Row key={it.key} it={it} />)}</ul> : null}
            {showPending ? (
              <div className={cx(items.length > 0 && 'border-t border-line')}>
                <div className="flex items-start gap-2 px-4 pt-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">{t('explorer.up.pendingTitle', { n: pending.length })}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-ink-3">{t('explorer.up.pendingText')}</p>
                  </div>
                  <IconButton icon="x" label={t('explorer.up.pendingHide')} size={16} className="-mt-1.5 -mr-2" onClick={() => setHidePending(true)} />
                </div>
                <ul className="pb-1">{pending.map((p) => <PendingRow key={p.uploadId} p={p} />)}</ul>
              </div>
            ) : null}
            <p className="border-t border-line px-4 py-2 text-xs leading-relaxed text-ink-3">{t('explorer.up.note')}</p>
          </div>
        ) : null}
      </section>
      {conflict ? <ConflictDialog key={conflict.key} it={conflict} many={(batchSizes[conflict.batch] ?? 1) > 1} /> : null}
    </>
  );
}
