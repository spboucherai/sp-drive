// Images (and the JPEG rendition of HEIC, and SVG) in an <img>: an SVG shown this way cannot run scripts, and the
// markup is never inlined into the application document. Zoom with the wheel, a pinch or a double click; drag to pan.
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n.ts';
import type { PreviewSource } from '../types.ts';
import { cx, IconButton } from '../ui.tsx';
import { Busy, explain, Failure, Panel, DownloadLink, Tools, ToolText, ViewerCtx } from './shared.tsx';

interface View { s: number; x: number; y: number }
const FIT: View = { s: 1, x: 0, y: 0 };
const MAX = 12;

export function ImageView({ src, source, vector }: { src: string; source: PreviewSource; vector?: boolean }) {
  const t = useT();
  const { setSwipeLocked } = useContext(ViewerCtx);
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [natural, setNatural] = useState<{ w: number; fit: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const viewRef = useRef(view); viewRef.current = view;

  useEffect(() => { setSwipeLocked(view.s > 1.01); return () => setSwipeLocked(false); }, [view.s > 1.01, setSwipeLocked]);

  /** Keep the picture over the frame: no panning into the void. */
  const clamp = useCallback((v: View): View => {
    const b = box.current, i = img.current;
    if (!b || !i || v.s <= 1) return FIT;
    const mx = Math.max(0, (i.offsetWidth * v.s - b.clientWidth) / 2), my = Math.max(0, (i.offsetHeight * v.s - b.clientHeight) / 2);
    return { s: v.s, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  }, []);
  /** Zoom by `factor` keeping the point (px, py) — relative to the centre of the frame — under the finger. */
  const zoomAt = useCallback((factor: number, px = 0, py = 0) => {
    setView((v) => { const s = Math.max(1, Math.min(MAX, v.s * factor)); const k = s / v.s; return clamp({ s, x: px - (px - v.x) * k, y: py - (py - v.y) * k }); });
  }, [clamp]);
  const rel = (cx_: number, cy_: number) => { const r = box.current!.getBoundingClientRect(); return { x: cx_ - r.left - r.width / 2, y: cy_ - r.top - r.height / 2 }; };

  useEffect(() => {
    const el = box.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const p = rel(e.clientX, e.clientY); zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, status]);

  // pointers: one drags (when zoomed), two pinch; two quick taps toggle the zoom
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef({ at: 0, x: 0, y: 0 });
  const moved = useRef(0);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved.current = 0;
    if (viewRef.current.s > 1 || pts.current.size > 1) { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDragging(true); }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pts.current.get(e.pointerId); if (!prev) return;
    const all = pts.current;
    if (all.size === 2) {
      const [a, b] = [...all.entries()].map(([id, p]) => (id === e.pointerId ? { x: e.clientX, y: e.clientY } : p)) as [{ x: number; y: number }, { x: number; y: number }];
      const [pa, pb] = [...all.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const d0 = Math.hypot(pa.x - pb.x, pa.y - pb.y), d1 = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (d0 > 0) zoomAt(d1 / d0, mid.x, mid.y);
    } else if (all.size === 1 && viewRef.current.s > 1) {
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      setView((v) => clamp({ s: v.s, x: v.x + dx, y: v.y + dy }));
    }
    moved.current += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
    all.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    if (pts.current.size === 0) setDragging(false);
    if (moved.current > 12 || pts.current.size) return;
    const now = Date.now(), l = lastTap.current;
    if (now - l.at < 320 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 40) {
      lastTap.current = { at: 0, x: 0, y: 0 };
      const p = rel(e.clientX, e.clientY);
      if (viewRef.current.s > 1.01) setView(FIT); else zoomAt(2.5, p.x, p.y);
    } else lastTap.current = { at: now, x: e.clientX, y: e.clientY };
  };

  if (status === 'error') {
    return error
      ? <Failure error={error} source={source} onRetry={() => { setStatus('loading'); setError(null); setAttempt((n) => n + 1); }} />
      : <Panel icon="image" tone="warn" title={t('preview.imageUnreadable')} text={t('preview.imageUnreadableText')} testId="preview-error"><DownloadLink source={source} primary /></Panel>;
  }
  const pct = natural ? Math.round(natural.fit * view.s * 100) : null;
  return (
    <>
      <Tools>
        <IconButton icon="zoomOut" label={t('preview.zoomOut')} disabled={view.s <= 1} onClick={() => zoomAt(1 / 1.4)} />
        <ToolText data-testid="image-zoom">{pct !== null ? `${pct} %` : '—'}</ToolText>
        <IconButton icon="zoomIn" label={t('preview.zoomIn')} disabled={view.s >= MAX} onClick={() => zoomAt(1.4)} />
        <IconButton icon="fitPage" label={t('preview.fit')} disabled={view.s === 1} onClick={() => setView(FIT)} />
      </Tools>
      <div ref={box} data-testid="image-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        className={cx('relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden p-3 sm:p-6', view.s > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in')}>
        {status === 'loading' ? <div className="absolute inset-0"><Busy label={t('common.loading')} /></div> : null}
        <img ref={img} key={attempt} src={src} alt={source.name} draggable={false} decoding="async" data-testid="image"
          onLoad={(e) => { const i = e.currentTarget; setNatural(i.naturalWidth ? { w: i.naturalWidth, fit: i.offsetWidth / i.naturalWidth } : null); setStatus('ready'); }}
          onError={() => { void explain(src).then((err) => { setError(err); setStatus('error'); }); }}
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`, transition: dragging ? 'none' : 'transform 90ms ease-out' }}
          className={cx('max-h-full max-w-full rounded-sm object-contain', vector && 'h-full w-full', status !== 'ready' && 'opacity-0')} />
      </div>
    </>
  );
}
