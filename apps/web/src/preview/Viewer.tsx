// Full-screen preview of one file. The viewer only talks to the URLs its PreviewSource gives it, so it serves the
// signed-in owner and the anonymous visitor of a share link alike. File content is hostile: nothing here ever lets a
// document run as HTML or script in the application origin (see the per-kind views).
import './preview.css';
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Glyph } from '../glyphs.tsx';
import { useT } from '../i18n.ts';
import type { PreviewSource } from '../types.ts';
import { cx, IconButton } from '../ui.tsx';
import { ArchiveView } from './ArchiveView.tsx';
import { ImageView } from './ImageView.tsx';
import { MediaView } from './MediaView.tsx';
import { Busy, DerivedGate, extLabel, fmtSize, Guard, NoPreview, Note, useDerived, ViewerCtx } from './shared.tsx';
import { SheetView } from './SheetView.tsx';
import { CsvView, JsonView, TextFileView } from './TextViews.tsx';

// pdf.js and the Markdown pipeline are only downloaded when a document needs them
const PdfView = lazy(() => import('./PdfView.tsx').then((m) => ({ default: m.PdfView })));
const MarkdownView = lazy(() => import('./MarkdownView.tsx').then((m) => ({ default: m.MarkdownView })));

/** Pictures, films and pages are shown on black, whatever the theme: the content is the only light on screen. */
const IMMERSIVE = new Set(['image', 'svg', 'heic', 'video', 'audio', 'pdf', 'office']);
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),video[controls],audio[controls],[tabindex]:not([tabindex="-1"])';

function OfficeView({ source }: { source: PreviewSource }) {
  const t = useT();
  const url = source.previewUrl('pdf');
  const [state, retry] = useDerived<undefined>(url, 'probe');
  return (
    <DerivedGate state={state} retry={retry} source={source}>
      {() => <><Note testId="converted-note">{t('preview.convertedNote')}</Note><div className="min-h-0 flex-1"><PdfView url={url} source={source} /></div></>}
    </DerivedGate>
  );
}
function HeicView({ source }: { source: PreviewSource }) {
  const url = source.previewUrl('image');
  const [state, retry] = useDerived<undefined>(url, 'probe');
  return <DerivedGate state={state} retry={retry} source={source}>{() => <ImageView src={url} source={source} />}</DerivedGate>;
}

function Body({ source }: { source: PreviewSource }) {
  switch (source.kind) {
    case 'pdf': return <PdfView url={source.contentUrl()} source={source} />;
    case 'office': return <OfficeView source={source} />;
    case 'image': return <ImageView src={source.contentUrl()} source={source} />;
    case 'svg': return <ImageView src={source.contentUrl()} source={source} vector />;
    case 'heic': return <HeicView source={source} />;
    case 'video': case 'audio': return <MediaView source={source} />;
    case 'text': return <TextFileView source={source} />;
    case 'markdown': return <MarkdownView source={source} />;
    case 'csv': return <CsvView source={source} />;
    case 'json': return <JsonView source={source} />;
    case 'sheet': return <SheetView source={source} />;
    case 'archive': return <ArchiveView source={source} />;
    default: return <NoPreview source={source} />;
  }
}

/** Is the touch inside something that scrolls sideways (a wide table, a zoomed page)? Then a swipe belongs to it. */
function scrollsSideways(target: EventTarget | null, stop: HTMLElement): boolean {
  for (let el = target as HTMLElement | null; el && el !== stop; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 2) { const o = getComputedStyle(el).overflowX; if (o === 'auto' || o === 'scroll') return true; }
  }
  return false;
}

/** Full-screen preview of one file. `actions` are extra buttons for the toolbar (share, details…). */
export function Viewer({ source, onClose, onPrev, onNext, actions }: { source: PreviewSource; onClose: () => void; onPrev?: () => void; onNext?: () => void; actions?: ReactNode }) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [toolsEl, setToolsEl] = useState<HTMLElement | null>(null);
  const swipeLocked = useRef(false);
  const ctx = useMemo(() => ({ toolsEl, setSwipeLocked: (v: boolean) => { swipeLocked.current = v; } }), [toolsEl]);
  const live = useRef({ onClose, onPrev, onNext });
  live.current = { onClose, onPrev, onNext };

  // focus goes in, stays in, and returns where it was; the page behind does not scroll
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    rootRef.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; prev?.focus?.({ preventScroll: true }); };
  }, []);
  useEffect(() => { swipeLocked.current = false; }, [source.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current; if (!root) return;
      const target = e.target as HTMLElement | null;
      // keys typed in a dialog or menu opened on top of the viewer (from `actions`) are not ours
      if (target && target !== document.body && !root.contains(target)) return;
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); live.current.onClose(); return; }
      if (e.key === 'Tab') {
        const f = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!f.length) { e.preventDefault(); root.focus(); return; }
        const first = f[0]!, last = f[f.length - 1]!, active = document.activeElement;
        if (!root.contains(active) || active === root) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
        else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (target && (/^(INPUT|TEXTAREA|SELECT|VIDEO|AUDIO)$/.test(target.tagName) || target.isContentEditable)) return;
        if (target && scrollsSideways(target, root)) return; // the arrows scroll that element
        const go = e.key === 'ArrowLeft' ? live.current.onPrev : live.current.onNext;
        if (go) { e.preventDefault(); go(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // horizontal swipe between files on touch screens, unless the content is zoomed or scrolls sideways itself
  const touch = useRef<{ x: number; y: number; at: number; ok: boolean } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const p = e.touches[0]!;
    touch.current = { x: p.clientX, y: p.clientY, at: Date.now(), ok: e.touches.length === 1 && !swipeLocked.current && !scrollsSideways(e.target, e.currentTarget as HTMLElement) && !(e.target as HTMLElement).closest('video,audio,input,[data-noswipe]') };
  }, []);
  const onTouchMove = useCallback((e: React.TouchEvent) => { if (e.touches.length > 1 && touch.current) touch.current.ok = false; }, []);
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const s = touch.current; touch.current = null;
    if (!s?.ok || swipeLocked.current) return;
    const p = e.changedTouches[0]!;
    const dx = p.clientX - s.x, dy = p.clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < 2.2 * Math.abs(dy) || Date.now() - s.at > 700) return;
    (dx > 0 ? live.current.onPrev : live.current.onNext)?.();
  }, []);

  const ext = extLabel(source.name);
  const navBtn = 'press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-hover hover:text-ink';
  return createPortal(
    <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid="viewer" data-kind={source.kind}
      className={cx('anim-fade fixed inset-0 z-50 flex flex-col bg-bg text-ink outline-none', IMMERSIVE.has(source.kind) && 'dark')}>
      <header className="safe-t z-10 shrink-0 bg-surface/80 shadow-[0_1px_0_var(--line)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-x-1 px-2 sm:flex-nowrap sm:gap-x-2 sm:px-3" style={{ paddingLeft: 'max(env(safe-area-inset-left), 0.5rem)', paddingRight: 'max(env(safe-area-inset-right), 0.5rem)' }}>
          <div className="order-1 min-w-0 flex-1 py-2 pl-2 sm:max-w-[38%] sm:flex-initial sm:basis-auto">
            <h2 id={titleId} className="truncate text-[15px] font-bold leading-tight tracking-tight" title={source.name} data-testid="viewer-name">{source.name}</h2>
            <p className="truncate text-xs text-ink-3" data-testid="viewer-meta">{[fmtSize(source.size), ext].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="order-3 flex w-full min-w-0 items-center gap-1 sm:order-2 sm:w-auto sm:flex-1">
            {onPrev ? <button type="button" className={cx(navBtn, 'sm:hidden')} aria-label={t('preview.previous')} title={t('preview.previous')} onClick={onPrev} data-testid="viewer-prev"><Glyph name="chevronLeft" size={22} /></button> : onNext ? <span className="w-10 shrink-0 sm:hidden" /> : null}
            <div ref={setToolsEl} role="toolbar" aria-label={t('preview.tools')} data-testid="viewer-tools" className="flex min-w-0 flex-1 items-center justify-start gap-0.5 overflow-x-auto empty:hidden sm:justify-center [scrollbar-width:none]" />
            {onNext ? <button type="button" className={cx(navBtn, 'ml-auto sm:hidden')} aria-label={t('preview.next')} title={t('preview.next')} onClick={onNext} data-testid="viewer-next"><Glyph name="chevronRight" size={22} /></button> : null}
          </div>
          <div className="order-2 flex shrink-0 items-center gap-0.5 sm:order-3">
            {actions}
            {source.canDownload ? (
              <a href={source.contentUrl({ download: true })} download={source.name} aria-label={t('common.download')} title={t('common.download')} data-testid="viewer-download"
                className="press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-hover hover:text-ink"><Glyph name="download" size={20} /></a>
            ) : null}
            <IconButton icon="x" label={t('common.close')} onClick={onClose} data-testid="viewer-close" />
          </div>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={() => { touch.current = null; }}
        style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
        <ViewerCtx.Provider value={ctx}>
          <Suspense fallback={<Busy label={t('common.loading')} />}>
            <div key={source.id} className="safe-b flex min-h-0 flex-1 flex-col" data-testid="viewer-body"><Guard source={source}><Body source={source} /></Guard></div>
          </Suspense>
        </ViewerCtx.Provider>
        {onPrev ? <button type="button" onClick={onPrev} aria-label={t('preview.previous')} title={t('preview.previous')} data-testid="viewer-prev"
          className="absolute left-3 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full glass press text-ink shadow-pop sm:flex"><Glyph name="chevronLeft" size={22} /></button> : null}
        {onNext ? <button type="button" onClick={onNext} aria-label={t('preview.next')} title={t('preview.next')} data-testid="viewer-next"
          className="absolute right-3 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full glass press text-ink shadow-pop sm:flex"><Glyph name="chevronRight" size={22} /></button> : null}
      </div>
    </div>, document.body);
}
