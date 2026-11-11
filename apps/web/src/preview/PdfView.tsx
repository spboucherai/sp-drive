// PDF viewer on pdf.js: continuous scroll with only the pages near the viewport rendered, HiDPI canvases, a text
// layer for selection, zoom, page jump and search across the whole document. Everything pdf.js needs (worker, fonts,
// character maps, image decoders) comes from the application bundle: no CDN, no eval, no inline script.
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n.ts';
import type { PreviewSource } from '../types.ts';
import { cx, IconButton } from '../ui.tsx';
import { Busy, DownloadLink, explain, Failure, Panel, Tools, ToolText } from './shared.tsx';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Binary resources pdf.js asks for by file name, mapped to their hashed URLs in the bundle (fetched only when a
// document needs them: non-embedded standard fonts, CJK character maps, JPEG 2000 / JBIG2 / colour decoders).
const urls = (g: Record<string, unknown>) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k.slice(k.lastIndexOf('/') + 1), v as string]));
const BUNDLED: Record<string, Record<string, string>> = {
  standardFontDataUrl: urls(import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?url', import: 'default', eager: true })),
  cMapUrl: urls(import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', { query: '?url', import: 'default', eager: true })),
  wasmUrl: urls(import.meta.glob('/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms_bg}.wasm', { query: '?url', import: 'default', eager: true })),
};
class BundledData {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = BUNDLED[kind]?.[filename.slice(filename.lastIndexOf('/') + 1)];
    if (!url) throw new Error(`pdf resource not bundled: ${filename}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`pdf resource unavailable: ${filename}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

const PAD = 12, GAP = 12, MIN_SCALE = 0.2, MAX_SCALE = 6, STEP = 1.2;
const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
type Mode = 'auto' | 'width' | 'page' | 'custom';
interface Size { w: number; h: number }
/** Searchable text of one page: the folded text, where each folded character comes from, and where each item starts. */
interface PageIndex { norm: string; map: Uint32Array; starts: number[]; lens: number[]; tops: Float32Array }
interface Match { page: number; s: number; e: number }
interface Hit { s: number; e: number; current: boolean }

/** Case- and accent-insensitive form used on both sides of a search; whitespace runs count as one space. */
function fold(text: string): { norm: string; map: Uint32Array } {
  const map = new Uint32Array(text.length * 2 + 2);
  let out = '', n = 0, lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let f: string;
    if (code <= 32 || code === 0xa0) { if (lastSpace) continue; f = ' '; lastSpace = true; }
    else { lastSpace = false; f = code < 128 ? text[i]!.toLowerCase() : text[i]!.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[‘’]/g, "'"); }
    for (let k = 0; k < f.length && n < map.length; k++) map[n++] = i;
    out += f;
  }
  return { norm: out, map: map.subarray(0, out.length) };
}

interface PageProps {
  doc: PDFDocumentProxy; n: number; w: number; h: number; top: number; left: number; scale: number; renderScale: number; hits: Hit[] | undefined;
  indexOf: (n: number) => PageIndex | undefined; label: string;
}
const MAX_CANVAS_PIXELS = 14_000_000; // stays under the canvas limits of mobile browsers
const PdfPage = memo(function PdfPage({ doc, n, w, h, top, left, scale, renderScale, hits, indexOf, label }: PageProps) {
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const layer = useRef<pdfjs.TextLayer | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [rendered, setRendered] = useState(false);
  const [textReady, setTextReady] = useState(0);
  const [rects, setRects] = useState<{ l: number; t: number; w: number; h: number; current: boolean }[]>([]);
  const scaleNow = useRef(renderScale); scaleNow.current = renderScale;

  useEffect(() => {
    let dead = false;
    doc.getPage(n).then((p) => { if (!dead) setPage(p); }, () => {});
    return () => { dead = true; };
  }, [doc, n]);

  // canvas: drawn off-document, swapped in when complete, so a zoom never shows a blank page
  useEffect(() => {
    if (!page) return;
    const viewport = page.getViewport({ scale: renderScale });
    let os = window.devicePixelRatio || 1;
    if (viewport.width * viewport.height * os * os > MAX_CANVAS_PIXELS) os = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width * os)); canvas.height = Math.max(1, Math.floor(viewport.height * os));
    canvas.setAttribute('aria-hidden', 'true');
    const task = page.render({ canvas, viewport, transform: os !== 1 ? [os, 0, 0, os, 0, 0] : undefined });
    let done = false;
    task.promise.then(() => {
      done = true;
      const el = host.current; if (!el) return;
      for (const old of el.querySelectorAll('canvas')) { old.width = 0; old.height = 0; }
      el.replaceChildren(canvas); setRendered(true);
    }, () => {});
    return () => { if (!done) { task.cancel(); canvas.width = 0; canvas.height = 0; } };
  }, [page, renderScale]);
  useEffect(() => () => { for (const c of host.current?.querySelectorAll('canvas') ?? []) { c.width = 0; c.height = 0; } }, []);
  useEffect(() => () => { try { page?.cleanup(); } catch { /* a render was still winding down */ } }, [page]);

  // text layer: transparent, selectable text placed over the canvas; it follows the zoom through a CSS variable
  useEffect(() => {
    const container = text.current;
    if (!page || !container) return;
    let dead = false, tl: pdfjs.TextLayer | undefined;
    container.replaceChildren();
    page.getTextContent().then((content) => {
      if (dead) return;
      tl = new pdfjs.TextLayer({ textContentSource: content, container, viewport: page.getViewport({ scale: scaleNow.current }) });
      return tl.render().then(() => { if (!dead) { layer.current = tl!; setTextReady((x) => x + 1); } });
    }).catch(() => {});
    return () => { dead = true; tl?.cancel(); layer.current = null; };
  }, [page]);

  // search matches: boxes measured from the text layer, stored as percentages of the page so they follow the zoom
  useLayoutEffect(() => {
    const tl = layer.current, el = root.current, index = indexOf(n);
    if (!tl || !el || !index || !hits?.length) { setRects((r) => (r.length ? [] : r)); return; }
    const box = el.getBoundingClientRect();
    const divs = tl.textDivs, out: typeof rects = [];
    const range = document.createRange();
    for (const hit of hits) {
      let i = 0;
      { let lo = 0, hi = index.starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (index.starts[mid]! <= hit.s) lo = mid; else hi = mid - 1; } i = lo; }
      for (; i < index.starts.length && index.starts[i]! < hit.e; i++) {
        const node = divs[i]?.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE || !divs[i]!.isConnected) continue;
        const len = Math.min(index.lens[i]!, (node as Text).length);
        const from = Math.max(0, hit.s - index.starts[i]!), to = Math.min(len, hit.e - index.starts[i]!);
        if (to <= from) continue;
        range.setStart(node, from); range.setEnd(node, to);
        for (const r of range.getClientRects()) {
          if (r.width < 0.5 || r.height < 0.5) continue;
          out.push({ l: ((r.left - box.left) / box.width) * 100, t: ((r.top - box.top) / box.height) * 100, w: (r.width / box.width) * 100, h: (r.height / box.height) * 100, current: hit.current });
        }
      }
    }
    setRects(out);
  }, [hits, textReady, indexOf, n]);

  return (
    <div ref={root} className="spd-pdf-page absolute" data-testid="pdf-page" data-page-number={n} data-rendered={rendered ? '1' : '0'} data-text={textReady ? '1' : '0'} role="group" aria-label={label}
      style={{ top, left, width: w, height: h, ['--total-scale-factor' as string]: scale }}>
      <div ref={host} className="absolute inset-0" />
      <div ref={text} className="textLayer" />
      {rects.map((r, i) => <div key={i} className="spd-pdf-hit" data-testid="pdf-hit" data-current={r.current ? '1' : '0'} style={{ left: `${r.l}%`, top: `${r.t}%`, width: `${r.w}%`, height: `${r.h}%`, zIndex: 2 }} />)}
    </div>
  );
});

type LoadError = { kind: 'password' } | { kind: 'damaged' } | { kind: 'api'; error: unknown };

export function PdfView({ url, source }: { url: string; source: PreviewSource }) {
  const t = useT();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<LoadError | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sizes, setSizes] = useState<Size[]>([]);

  useEffect(() => {
    let dead = false;
    setDoc(null); setError(null); setProgress(null); setSizes([]);
    const task = pdfjs.getDocument({
      url, withCredentials: true, disableRange: false, disableStream: false, rangeChunkSize: 262144, enableXfa: false,
      cMapUrl: 'cmaps/', cMapPacked: true, standardFontDataUrl: 'standard_fonts/', wasmUrl: 'wasm/', useWorkerFetch: false, BinaryDataFactory: BundledData,
    });
    task.onProgress = (p: { loaded: number; total: number }) => { if (!dead && p.total > 0) setProgress(Math.min(1, p.loaded / p.total)); };
    task.promise.then(async (d) => {
      const first = (await d.getPage(1)).getViewport({ scale: 1 });
      if (dead) return;
      setSizes(Array.from({ length: d.numPages }, () => ({ w: first.width, h: first.height })));
      setDoc(d);
      // the other pages may have another format: correct the layout as their sizes become known
      let changed: Map<number, Size> = new Map();
      const flush = () => { if (!changed.size || dead) return; const c = changed; changed = new Map(); setSizes((prev) => prev.map((s, i) => c.get(i) ?? s)); };
      for (let i = 2; i <= d.numPages && !dead; i++) {
        const v = (await d.getPage(i)).getViewport({ scale: 1 });
        if (Math.abs(v.width - first.width) > 0.5 || Math.abs(v.height - first.height) > 0.5) changed.set(i - 1, { w: v.width, h: v.height });
        if (i % 50 === 0) flush();
      }
      flush();
    }).catch(async (e: Error) => {
      if (dead) return;
      if (e?.name === 'PasswordException') return setError({ kind: 'password' });
      const api = await explain(url); // the API's own answer (expired session, removed file, antivirus…) when there is one
      if (!dead) setError(api ? { kind: 'api', error: api } : { kind: 'damaged' });
    });
    return () => { dead = true; void task.destroy().catch(() => {}); };
  }, [url, attempt]);

  if (error) {
    if (error.kind === 'api') return <Failure error={error.error} source={source} onRetry={() => setAttempt((n) => n + 1)} />;
    return (
      <Panel icon={error.kind === 'password' ? 'lock' : 'warning'} tone="warn" testId={error.kind === 'password' ? 'pdf-password' : 'pdf-damaged'}
        title={t(error.kind === 'password' ? 'preview.pdfPasswordTitle' : 'preview.pdfDamagedTitle')} text={t(error.kind === 'password' ? 'preview.pdfPasswordText' : 'preview.pdfDamagedText')}>
        <DownloadLink source={source} primary />
      </Panel>
    );
  }
  if (!doc || !sizes.length) return <Busy label={t('common.loading')} text={progress !== null && progress < 1 ? `${Math.round(progress * 100)} %` : undefined} />;
  return <Pages doc={doc} sizes={sizes} />;
}

function Pages({ doc, sizes }: { doc: PDFDocumentProxy; sizes: Size[] }) {
  const t = useT();
  const count = doc.numPages;
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<Mode>('auto');
  const [custom, setCustom] = useState(1);
  const [range, setRange] = useState({ first: 0, last: 0 });
  const [current, setCurrent] = useState(1);
  const [pageText, setPageText] = useState('1');
  const pinned = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = scroller.current!;
    const read = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const widest = useMemo(() => sizes.reduce((m, s) => Math.max(m, s.w), 1), [sizes]);
  const fitWidth = box.w ? clampScale((box.w - 2 * PAD) / widest) : 1;
  const tallest = useMemo(() => sizes.reduce((m, x) => Math.max(m, x.h), 1), [sizes]);
  const fitPage = box.w ? clampScale(Math.min(fitWidth, (box.h - 2 * PAD) / tallest)) : 1;
  const scale = mode === 'width' ? fitWidth : mode === 'page' ? fitPage : mode === 'auto' ? Math.min(fitWidth, 1.4) : custom;
  // canvases follow the zoom after a short pause, so a pinch or a held key does not render every intermediate size
  const [renderScale, setRenderScale] = useState(scale);
  useEffect(() => { if (!box.w) return; const id = setTimeout(() => setRenderScale(scale), 140); return () => clearTimeout(id); }, [scale, box.w]);

  const layout = useMemo(() => {
    const tops = new Float64Array(count), w = new Float64Array(count), h = new Float64Array(count);
    let y = PAD, maxW = 0;
    for (let i = 0; i < count; i++) { w[i] = Math.floor(sizes[i]!.w * scale); h[i] = Math.floor(sizes[i]!.h * scale); tops[i] = y; y += h[i]! + GAP; if (w[i]! > maxW) maxW = w[i]!; }
    return { tops, w, h, total: y - GAP + PAD, inner: Math.max(box.w, maxW + 2 * PAD) };
  }, [sizes, scale, count, box.w]);
  const live = useRef({ layout, scale, box }); live.current = { layout, scale, box };

  /** Index of the page at document offset y. */
  const pageAt = useCallback((y: number) => {
    const { tops } = live.current.layout;
    let lo = 0, hi = count - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid]! <= y) lo = mid; else hi = mid - 1; }
    return lo;
  }, [count]);

  // what must stay still when the layout changes: a point of a page (fx, fy) at a point of the viewport (vx, vy)
  const anchor = useRef({ page: 0, fx: 0.5, fy: 0, vx: 0, vy: 0, held: false, fresh: true });
  const readAnchor = useCallback((vx?: number, vy?: number) => {
    const el = scroller.current; if (!el) return;
    const { layout: L } = live.current;
    const ax = vx ?? el.clientWidth / 2, ay = vy ?? 0;
    const i = pageAt(el.scrollTop + ay);
    const left = (L.inner - L.w[i]!) / 2;
    anchor.current = { page: i, fx: (el.scrollLeft + ax - left) / Math.max(1, L.w[i]!), fy: (el.scrollTop + ay - L.tops[i]!) / Math.max(1, L.h[i]!), vx: ax, vy: ay, held: vx !== undefined, fresh: false };
  }, [pageAt]);

  const update = useCallback(() => {
    const el = scroller.current; if (!el) return;
    const { layout: L } = live.current;
    const top = el.scrollTop, bottom = top + el.clientHeight;
    const first = pageAt(top), last = pageAt(bottom);
    setRange((r) => (r.first === first && r.last === last ? r : { first, last }));
    let best = first, bestArea = -1;
    for (let i = first; i <= last; i++) { const vis = Math.min(bottom, L.tops[i]! + L.h[i]!) - Math.max(top, L.tops[i]!); if (vis > bestArea + 1) { best = i; bestArea = vis; } }
    const pin = pinned.current;
    const page = pin !== null && pin - 1 >= first && pin - 1 <= last ? pin : best + 1;
    setCurrent(page); setPageText(String(page));
  }, [pageAt]);

  useLayoutEffect(() => { // a new layout (zoom, page sizes, viewport): put the anchored point back where it was
    const el = scroller.current; if (!el || !box.w) return;
    const a = anchor.current, i = Math.min(a.page, count - 1);
    if (a.fresh) { el.scrollTop = 0; el.scrollLeft = (layout.inner - box.w) / 2; }
    else { el.scrollTop = layout.tops[i]! + a.fy * layout.h[i]! - a.vy; el.scrollLeft = (layout.inner - layout.w[i]!) / 2 + a.fx * layout.w[i]! - a.vx; }
    a.held = false;
    update();
  }, [layout, box.w, box.h, count, update]);

  useEffect(() => {
    const el = scroller.current!;
    let raf = 0;
    const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (!anchor.current.held) readAnchor(); update(); }); };
    const release = () => { pinned.current = null; anchor.current.held = false; };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', release, { passive: true }); el.addEventListener('touchstart', release, { passive: true }); el.addEventListener('pointerdown', release, { passive: true }); el.addEventListener('keydown', release);
    return () => { cancelAnimationFrame(raf); el.removeEventListener('scroll', onScroll); el.removeEventListener('wheel', release); el.removeEventListener('touchstart', release); el.removeEventListener('pointerdown', release); el.removeEventListener('keydown', release); };
  }, [readAnchor, update]);

  const zoomTo = useCallback((next: number | ((s: number) => number), at?: { x: number; y: number }) => {
    const el = scroller.current;
    if (el) { if (at) readAnchor(at.x, at.y); else readAnchor(el.clientWidth / 2, el.clientHeight / 2); }
    setCustom(clampScale(typeof next === 'function' ? next(live.current.scale) : next)); setMode('custom');
  }, [readAnchor]);
  const fitTo = useCallback((m: Mode) => { readAnchor(); setMode(m); }, [readAnchor]);
  const goTo = useCallback((page: number, fy = 0, centre = false) => {
    const el = scroller.current; if (!el) return;
    const p = Math.max(1, Math.min(count, Math.round(page)));
    const { layout: L } = live.current;
    pinned.current = p; anchor.current.held = false;
    el.scrollTop = Math.max(0, L.tops[p - 1]! + fy * L.h[p - 1]! - (centre ? el.clientHeight / 2 : fy === 0 ? PAD / 2 : 0));
    readAnchor(); update();
  }, [count, readAnchor, update]);

  // --- search ---
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const indexes = useRef(new Map<number, PageIndex>());
  const pending = useRef(new Map<number, Promise<PageIndex>>());
  useEffect(() => { indexes.current = new Map(); pending.current = new Map(); }, [doc]);
  const indexOf = useCallback((n: number) => indexes.current.get(n), []);
  /** Text of a page, extracted on first need and kept. */
  const loadIndex = useCallback((n: number): Promise<PageIndex> => {
    const hit = pending.current.get(n); if (hit) return hit;
    const p = (async () => {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const [, y0 = 0, , y1 = 1] = page.view;
      const starts: number[] = [], lens: number[] = [], tops: number[] = [];
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        starts.push(text.length); lens.push(item.str.length); tops.push(1 - ((item.transform[5] as number) + item.height - y0) / Math.max(1, y1 - y0));
        text += item.str; if (item.hasEOL) text += '\n';
      }
      const index: PageIndex = { ...fold(text), starts, lens, tops: Float32Array.from(tops) };
      indexes.current.set(n, index);
      return index;
    })();
    pending.current.set(n, p);
    return p;
  }, [doc]);

  const reveal = useCallback((m: Match | undefined) => {
    if (!m) return;
    const index = indexes.current.get(m.page);
    let fy = 0;
    if (index) { let lo = 0, hi = index.starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (index.starts[mid]! <= m.s) lo = mid; else hi = mid - 1; } fy = Math.max(0, Math.min(1, index.tops[lo] ?? 0)); }
    goTo(m.page, fy, true);
  }, [goTo]);

  const needle = useMemo(() => fold(query.trim()).norm.trim(), [query]);
  const currentRef = useRef(current); currentRef.current = current;
  useEffect(() => {
    setMatches([]); setCursor(-1);
    if (!searchOpen || !needle) { setSearching(false); return; }
    let dead = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found: Match[] = [];
      const from = currentRef.current;
      let chosen = false, lastFlush = performance.now();
      const flush = (final: boolean) => {
        if (dead) return;
        setMatches(found.slice());
        if (!chosen) {
          const at = found.findIndex((m) => m.page >= from);
          if (at >= 0 || (final && found.length)) { chosen = true; const i = Math.max(0, at); setCursor(i); reveal(found[i]); }
        }
        lastFlush = performance.now();
      };
      for (let n = 1; n <= count && !dead; n++) {
        const index = await loadIndex(n).catch(() => null);
        if (dead || !index) continue;
        for (let at = index.norm.indexOf(needle); at >= 0; at = index.norm.indexOf(needle, at + needle.length)) {
          found.push({ page: n, s: index.map[at]!, e: index.map[at + needle.length - 1]! + 1 });
        }
        if (performance.now() - lastFlush > 250) flush(false);
      }
      flush(true);
      if (!dead) setSearching(false);
    }, 220);
    return () => { dead = true; clearTimeout(timer); };
  }, [needle, searchOpen, count, loadIndex, reveal]);

  const step = useCallback((d: number) => {
    if (!matches.length) return;
    const i = (cursor + d + matches.length) % matches.length;
    setCursor(i); reveal(matches[i]);
  }, [matches, cursor, reveal]);
  const hitsByPage = useMemo(() => {
    const map = new Map<number, Hit[]>();
    matches.forEach((m, i) => { let l = map.get(m.page); if (!l) map.set(m.page, (l = [])); l.push({ s: m.s, e: m.e, current: i === cursor }); });
    return map;
  }, [matches, cursor]);
  const openSearch = useCallback(() => { setSearchOpen(true); requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); }); }, []);
  const closeSearch = useCallback(() => { setSearchOpen(false); scroller.current?.focus({ preventScroll: true }); }, []);

  // keyboard: ⌘F search, ⌘+ ⌘− ⌘0 zoom (the browser's own handling is replaced while the viewer is open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (!scroller.current?.closest('[role=dialog]')?.contains(e.target as Node) && e.target !== document.body) return;
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); openSearch(); }
      else if (k === '+' || k === '=') { e.preventDefault(); zoomTo((s) => s * STEP); }
      else if (k === '-') { e.preventDefault(); zoomTo((s) => s / STEP); }
      else if (k === '0') { e.preventDefault(); fitTo('auto'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch, zoomTo, fitTo]);

  // pinch on touch screens and on trackpads (ctrl + wheel), zooming around the fingers
  useEffect(() => {
    const el = scroller.current!;
    let pinch: { d: number; scale: number } | null = null;
    const point = (x: number, y: number) => { const r = el.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY);
    const onWheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoomTo((s) => s * Math.exp(-e.deltaY * 0.01), point(e.clientX, e.clientY)); };
    const onStart = (e: TouchEvent) => { if (e.touches.length === 2) pinch = { d: dist(e), scale: live.current.scale }; };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const p = pinch;
      zoomTo(p.scale * (dist(e) / Math.max(1, p.d)), point((e.touches[0]!.clientX + e.touches[1]!.clientX) / 2, (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2));
    };
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    const stop = (e: Event) => e.preventDefault(); // Safari's own page zoom gesture
    el.addEventListener('wheel', onWheel, { passive: false }); el.addEventListener('touchstart', onStart, { passive: true }); el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd); el.addEventListener('touchcancel', onEnd); el.addEventListener('gesturestart', stop); el.addEventListener('gesturechange', stop);
    return () => {
      el.removeEventListener('wheel', onWheel); el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd); el.removeEventListener('touchcancel', onEnd); el.removeEventListener('gesturestart', stop); el.removeEventListener('gesturechange', stop);
    };
  }, [zoomTo]);

  const from = Math.max(0, range.first - 2), to = Math.min(count - 1, range.last + 2);
  const visible: number[] = [];
  if (box.w) for (let i = from; i <= to; i++) visible.push(i);
  const submitPage = () => { const n = Number.parseInt(pageText, 10); if (Number.isFinite(n)) goTo(n); else setPageText(String(current)); };
  return (
    <>
      <Tools>
        <label className="flex shrink-0 items-center gap-1.5 pl-1 text-xs text-ink-2">
          <span className="sr-only">{t('preview.page')}</span>
          <input value={pageText} inputMode="numeric" pattern="[0-9]*" aria-label={t('preview.page')} data-testid="pdf-page-input" enterKeyHint="go"
            onChange={(e) => setPageText(e.target.value.replace(/\D/g, '').slice(0, 6))} onFocus={(e) => e.currentTarget.select()} onBlur={submitPage}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitPage(); e.currentTarget.select(); } }}
            className="h-9 w-12 rounded-lg border border-line-strong bg-surface text-center text-sm tabular-nums text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25" />
          <span className="tabular-nums" data-testid="pdf-page-count">/ {count}</span>
        </label>
        <span className="mx-1 hidden h-5 w-px shrink-0 bg-line sm:block" />
        <IconButton icon="zoomOut" label={t('preview.zoomOut')} disabled={scale <= MIN_SCALE} onClick={() => zoomTo((s) => s / STEP)} data-testid="pdf-zoom-out" />
        <ToolText data-testid="pdf-zoom">{Math.round(scale * 100)} %</ToolText>
        <IconButton icon="zoomIn" label={t('preview.zoomIn')} disabled={scale >= MAX_SCALE} onClick={() => zoomTo((s) => s * STEP)} data-testid="pdf-zoom-in" />
        <IconButton icon="fitWidth" label={t('preview.fitWidth')} active={mode === 'width'} onClick={() => fitTo('width')} data-testid="pdf-fit-width" />
        <IconButton icon="fitPage" label={t('preview.fitPage')} active={mode === 'page'} onClick={() => fitTo('page')} data-testid="pdf-fit-page" />
        <IconButton icon="search" label={t('preview.searchOpen')} active={searchOpen} onClick={() => (searchOpen ? closeSearch() : openSearch())} data-testid="pdf-search-toggle" />
      </Tools>
      {searchOpen ? (
        <div role="search" className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-2 py-1.5 sm:justify-end sm:px-3" data-noswipe>
          <input ref={input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('preview.searchPlaceholder')} aria-label={t('preview.searchPlaceholder')} data-testid="pdf-search-input" enterKeyHint="search"
            autoComplete="off" autoCorrect="off" spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); } }}
            className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 sm:max-w-xs" />
          <span className={cx('min-w-16 shrink-0 px-1 text-center text-xs tabular-nums', needle && !searching && !matches.length ? 'text-danger' : 'text-ink-2')} aria-live="polite" data-testid="pdf-search-count" data-searching={searching ? '1' : '0'}>
            {!needle ? '' : matches.length ? `${cursor + 1} / ${matches.length}${searching ? '…' : ''}` : searching ? '…' : t('preview.searchNone')}
          </span>
          <IconButton icon="arrowUp" label={t('preview.searchPrev')} disabled={!matches.length} onClick={() => step(-1)} data-testid="pdf-search-prev" />
          <IconButton icon="arrowDown" label={t('preview.searchNext')} disabled={!matches.length} onClick={() => step(1)} data-testid="pdf-search-next" />
          <IconButton icon="x" label={t('preview.searchClose')} onClick={closeSearch} />
        </div>
      ) : null}
      <div ref={scroller} tabIndex={0} data-testid="pdf-scroll" data-pages={count} data-page={current} aria-label={t('preview.pdfDocument', { n: count })}
        className="relative min-h-0 flex-1 overflow-auto outline-none [overflow-anchor:none]">
        <div className="relative" style={{ height: layout.total, width: layout.inner }}>
          {visible.map((i) => (
            <PdfPage key={i} doc={doc} n={i + 1} w={layout.w[i]!} h={layout.h[i]!} top={layout.tops[i]!} left={Math.floor((layout.inner - layout.w[i]!) / 2)} scale={scale} renderScale={renderScale}
              hits={hitsByPage.get(i + 1)} indexOf={indexOf} label={t('preview.pageOf', { n: i + 1, total: count })} />
          ))}
        </div>
      </div>
    </>
  );
}
