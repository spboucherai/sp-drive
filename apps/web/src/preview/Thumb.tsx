import './preview.css';
import type { PreviewKind } from '@spd/shared';
import { useEffect, useRef, useState } from 'react';
import { Glyph } from '../glyphs.tsx';
import { cx } from '../ui.tsx';

type Family = 'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'sheet' | 'archive' | 'text' | 'other';
const FAMILY: Record<PreviewKind | 'folder', Family> = {
  folder: 'folder', image: 'image', heic: 'image', svg: 'image', video: 'video', audio: 'audio', pdf: 'pdf', office: 'document', sheet: 'sheet', csv: 'sheet',
  archive: 'archive', text: 'text', markdown: 'text', json: 'text', none: 'other',
};
const ICON: Record<Family, string> = { folder: 'folder', image: 'image', video: 'video', audio: 'audio', pdf: 'pdf', document: 'doc', sheet: 'sheet', archive: 'archive', text: 'text', other: 'file' };
const RETRY_MS = [2000, 5000, 12000];

/** The picture over the tile. Its state belongs to one URL: the parent gives it a key, so nothing is reset after the fact. */
function Picture({ src, onShown, page }: { src: string; onShown: (shown: boolean) => void; page: boolean }) {
  const [state, setState] = useState<'idle' | 'loaded' | 'waiting' | 'off'>('idle');
  const [round, setRound] = useState(0);
  const tries = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);
  const onError = () => {
    onShown(false);
    if (tries.current >= RETRY_MS.length) return setState('off');
    setState('waiting');
    timer.current = setTimeout(() => {
      // only come back with an <img> when the API really has the picture now (202 = the worker has not made it yet)
      fetch(src, { credentials: 'same-origin' }).then((r) => {
        void r.body?.cancel().catch(() => {});
        if (!alive.current) return;
        if (r.status === 200) { setState('idle'); setRound((n) => n + 1); } else if (r.status === 202) onError(); else setState('off');
      }, () => { if (alive.current) setState('off'); });
    }, RETRY_MS[tries.current++]);
  };
  if (state !== 'idle' && state !== 'loaded') return null;
  return (
    <img key={round} src={src} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => { setState('loaded'); onShown(true); }} onError={onError}
      className={cx('absolute object-cover transition-opacity duration-200', state === 'loaded' ? 'opacity-100' : 'opacity-0',
        // the first page of a document is a sheet of paper laid on the coloured tile: a blank page still reads as a document, in both themes
        page ? 'spd-sheet inset-x-[17%] top-[13%] h-[87%] w-[66%] rounded-t-[8%] object-top' : 'inset-0 h-full w-full')} />
  );
}

/**
 * Thumbnail when `src` is given and loads, otherwise an icon tile for the kind. The tile is always there underneath,
 * so there is no layout shift and never a broken-image icon. A thumbnail the worker has not produced yet (the API
 * answers 202) is checked again a few times, then the icon stays.
 */
export function Thumb({ src, name, kind, className }: { src?: string; name: string; kind: PreviewKind | 'folder'; className?: string }) {
  const family = FAMILY[kind] ?? 'other';
  const page = family === 'pdf' || family === 'document' || family === 'sheet';
  const [shown, setShown] = useState<string | null>(null); // the URL whose picture is on screen
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toUpperCase();
  return (
    <span data-testid="thumb" data-family={family} data-state={src && shown === src ? 'image' : 'icon'} role="img" aria-label={name}
      className={cx('spd-thumb @container relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-[18%]', className ?? 'h-10 w-10')}>
      <span className="flex h-full w-full flex-col items-center justify-center gap-[6%]" aria-hidden="true">
        <Glyph name={ICON[family]} className="h-[46%] max-h-14 w-[46%] max-w-14" strokeWidth={1.6} />
        {ext && kind !== 'folder' ? <span className="hidden max-w-[80%] truncate text-[10px] font-semibold tracking-wide opacity-80 @[88px]:block @[140px]:text-xs">{ext}</span> : null}
      </span>
      {src ? <Picture key={src} src={src} page={page} onShown={(ok) => setShown(ok ? src : null)} /> : null}
      {page && ext && src && shown === src ? <span className="spd-badge pointer-events-none absolute bottom-[7%] left-1/2 hidden -translate-x-1/2 rounded-full px-2 py-0.5 text-[10px] leading-tight font-bold tracking-wide @[88px]:block" aria-hidden="true">{ext}</span> : null}
      {src && shown === src ? <span className="pointer-events-none absolute inset-0 rounded-[inherit] border border-line" aria-hidden="true" /> : null}
    </span>
  );
}
