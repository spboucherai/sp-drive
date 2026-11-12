// Pieces shared by every preview: the viewer context (toolbar slot, swipe lock), fetching with explicit states
// (ready / still being produced / failed), and the calm panels shown instead of content.
import { formatBytes } from '@spd/shared';
import { Component, createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { errorText, getLocale, useT } from '../i18n.ts';
import type { PreviewSource } from '../types.ts';
import { Button, cx, Spinner } from '../ui.tsx';

export interface ViewerContext { toolsEl: HTMLElement | null; setSwipeLocked: (locked: boolean) => void }
export const ViewerCtx = createContext<ViewerContext>({ toolsEl: null, setSwipeLocked: () => {} });
/** Renders its children in the viewer's top bar. */
export function Tools({ children }: { children: ReactNode }) {
  const { toolsEl } = useContext(ViewerCtx);
  return toolsEl ? createPortal(children, toolsEl) : null;
}
export function ToolText({ children, ...p }: { children: ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span {...p} className="shrink-0 px-1 text-xs tabular-nums text-ink-2">{children}</span>;
}
/** A labelled on/off choice in the toolbar. */
export function ToolToggle({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} data-testid={testId}
      className={cx('inline-flex h-10 shrink-0 items-center rounded-xl px-3 text-sm font-medium transition', active ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-hover hover:text-ink')}>
      {children}
    </button>
  );
}

// --- fetching ---
export async function errorOf(res: Response): Promise<ApiError> {
  const body = (res.headers.get('content-type') ?? '').includes('json') ? await res.json().catch(() => null) : null;
  return new ApiError(res.status, body?.error ?? 'http_error', body?.message ?? `HTTP ${res.status}`, body ?? {});
}
const network = (e: Error): never => { if (e.name === 'AbortError') throw e; throw new ApiError(0, 'network', 'network error'); };
/** Why a URL that an <img>, <video> or pdf.js could not use fails: the API's own error when there is one. */
export async function explain(url: string): Promise<ApiError | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', headers: { Range: 'bytes=0-0' } });
    if (res.ok || res.status === 416) { void res.body?.cancel().catch(() => {}); return null; }
    return await errorOf(res);
  } catch { return new ApiError(0, 'network', 'network error'); }
}

export type Derived<T> =
  | { status: 'loading' } | { status: 'pending' } | { status: 'timeout' }
  | { status: 'failed'; error: ApiError } | { status: 'error'; error: ApiError } | { status: 'ready'; data: T };
const GIVE_UP_MS = 120_000;
/**
 * A derived preview made by the worker. 202 = not produced yet: poll (1.5 s, backing off to 5 s) and give up after two
 * minutes; 422 = the conversion failed (the server's reason is kept). `probe` only checks availability (first byte),
 * for previews that an <img> or pdf.js will load themselves.
 */
export function useDerived<T>(url: string, mode: 'json' | 'probe'): [Derived<T>, () => void] {
  const [state, setState] = useState<Derived<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    let delay = 1500;
    setState({ status: 'loading' });
    const run = async () => {
      try {
        const res = await fetch(url, { credentials: 'same-origin', signal: ctl.signal, headers: mode === 'probe' ? { Range: 'bytes=0-0' } : {} }).catch(network);
        if (res.status === 202) {
          void res.body?.cancel().catch(() => {});
          if (Date.now() - started > GIVE_UP_MS) return setState({ status: 'timeout' });
          setState({ status: 'pending' });
          timer = setTimeout(() => void run(), delay);
          delay = Math.min(5000, delay * 1.5);
          return;
        }
        if (!res.ok && !(mode === 'probe' && res.status === 416)) { const error = await errorOf(res); return setState({ status: res.status === 422 ? 'failed' : 'error', error }); }
        if (mode === 'probe') { void res.body?.cancel().catch(() => {}); return setState({ status: 'ready', data: undefined as T }); }
        setState({ status: 'ready', data: (await res.json()) as T });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setState({ status: 'error', error: e instanceof ApiError ? e : new ApiError(0, 'unknown', (e as Error).message) });
      }
    };
    void run();
    return () => { ctl.abort(); clearTimeout(timer); };
  }, [url, mode, attempt]);
  return [state, useCallback(() => setAttempt((n) => n + 1), [])];
}

export const TEXT_CAP = 2 * 1024 * 1024;
export type TextState = { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; text: string; truncated: boolean; total: number };
/** The first 2 MB of a file as text (a Range request: a huge log is never downloaded whole). */
export function useText(source: PreviewSource): [TextState, () => void] {
  const [state, setState] = useState<TextState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const url = source.contentUrl({ text: true });
  useEffect(() => {
    const ctl = new AbortController();
    setState({ status: 'loading' });
    (async () => {
      try {
        const res = await fetch(url, { credentials: 'same-origin', signal: ctl.signal, headers: { Range: `bytes=0-${TEXT_CAP - 1}` } }).catch(network);
        if (res.status === 416) return setState({ status: 'ready', text: '', truncated: false, total: 0 }); // empty file
        if (!res.ok) return setState({ status: 'error', error: await errorOf(res) });
        // a server that ignored the Range header must not make us hold more than the cap
        const reader = res.body!.getReader();
        const parts: Uint8Array[] = [];
        let got = 0, cut = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (got + value.length > TEXT_CAP) { parts.push(value.subarray(0, TEXT_CAP - got)); got = TEXT_CAP; cut = true; void reader.cancel().catch(() => {}); break; }
          parts.push(value); got += value.length;
        }
        const bytes = new Uint8Array(got);
        let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
        const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1] ?? (cut ? source.size : got));
        const enc = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
        setState({ status: 'ready', text: new TextDecoder(enc).decode(bytes), truncated: cut || total > got, total: Math.max(total, got) });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setState({ status: 'error', error: e instanceof ApiError ? e : new ApiError(0, 'unknown', (e as Error).message) });
      }
    })();
    return () => ctl.abort();
  }, [url, attempt, source.size]);
  return [state, useCallback(() => setAttempt((n) => n + 1), [])];
}

// --- panels ---
export function DownloadLink({ source, primary }: { source: PreviewSource; primary?: boolean }) {
  const t = useT();
  if (!source.canDownload) return null;
  return (
    <a href={source.contentUrl({ download: true })} download={source.name} data-testid="panel-download"
      className={cx('inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition', primary ? 'bg-accent text-accent-ink hover:brightness-110' : 'border border-line-strong bg-surface text-ink hover:bg-hover')}>
      <Glyph name="download" size={18} />{t('common.download')}
    </a>
  );
}
export function Panel({ icon, tone = 'neutral', title, text, detail, children, testId }: { icon: string; tone?: 'neutral' | 'warn'; title: string; text?: string; detail?: string; children?: ReactNode; testId?: string }) {
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center overflow-y-auto p-6" data-testid={testId}>
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className={cx('flex h-14 w-14 items-center justify-center rounded-2xl', tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent')}><Glyph name={icon} size={28} /></div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {text ? <p className="text-sm leading-relaxed text-ink-2">{text}</p> : null}
        {detail ? <p className="break-words rounded-xl bg-hover px-3 py-2 font-mono text-xs text-ink-2" data-testid="panel-detail">{detail}</p> : null}
        {children ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
      </div>
    </div>
  );
}
export function Busy({ label, text }: { label: string; text?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-2" role="status" data-testid="preview-busy">
      <Spinner size={26} />
      <p className="text-sm font-medium text-ink">{label}</p>
      {text ? <p className="max-w-sm text-xs text-ink-3">{text}</p> : null}
    </div>
  );
}
/** An explicit state for an error from the API or the network, with a retry and the download when allowed. */
export function Failure({ error, source, onRetry, title }: { error: unknown; source: PreviewSource; onRetry?: () => void; title?: string }) {
  const t = useT();
  const e = error as Partial<ApiError> | null;
  const infected = e?.code === 'infected';
  const translated = errorText(error);
  return (
    <Panel icon={infected ? 'shield' : 'warning'} tone="warn" title={title ?? translated} text={title ? translated : undefined} testId="preview-error">
      {onRetry && !infected ? <Button icon="refresh" onClick={onRetry}>{t('common.retry')}</Button> : null}
      {e?.status === 401 || e?.status === 403 || e?.status === 404 ? null : <DownloadLink source={source} />}
    </Panel>
  );
}
/** Loading / pending / failed / timed-out states of a derived preview; renders `children` once it is ready. */
export function DerivedGate<T>({ state, retry, source, children }: { state: Derived<T>; retry: () => void; source: PreviewSource; children: (data: T) => ReactNode }) {
  const t = useT();
  switch (state.status) {
    case 'loading': return <Busy label={t('common.loading')} />;
    case 'pending': return <Busy label={t('preview.converting')} text={t('preview.convertingHint')} />;
    case 'timeout': return <Panel icon="clock" tone="warn" title={t('preview.timeoutTitle')} text={t('preview.timeoutText')} testId="preview-timeout"><Button icon="refresh" onClick={retry}>{t('common.retry')}</Button><DownloadLink source={source} /></Panel>;
    case 'failed': return (
      <Panel icon="warning" tone="warn" title={t('preview.failedTitle')} text={t('preview.failedText')} detail={state.error.message} testId="preview-failed">
        <DownloadLink source={source} primary />
      </Panel>
    );
    case 'error': return state.error.code === 'preview_unsupported' ? <NoPreview source={source} /> : <Failure error={state.error} source={source} onRetry={retry} />;
    case 'ready': return <>{children(state.data)}</>;
  }
}
export const extLabel = (name: string): string => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(name); return m ? m[1]!.toUpperCase() : ''; };
export function NoPreview({ source }: { source: PreviewSource }) {
  const t = useT();
  const ext = extLabel(source.name);
  return (
    <Panel icon="file" title={t('preview.noneTitle')} text={`${ext ? t('preview.noneType', { ext }) : t('preview.noneTypeUnknown')} · ${fmtSize(source.size)}`} testId="preview-none">
      {source.canDownload ? <DownloadLink source={source} primary /> : <p className="text-xs text-ink-3">{t('preview.noDownload')}</p>}
    </Panel>
  );
}
/** A slim strip of information above the content (truncation, converted rendering…). */
export function Note({ tone = 'info', children, testId }: { tone?: 'info' | 'warn'; children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} role={tone === 'warn' ? 'alert' : 'note'} className={cx('flex shrink-0 items-start gap-2 border-b border-line px-4 py-2 text-xs leading-relaxed', tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-surface text-ink-2')}>
      <Glyph name={tone === 'warn' ? 'warning' : 'info'} size={15} className="mt-0.5 shrink-0" /><span className="min-w-0">{children}</span>
    </div>
  );
}

export const fmtSize = (n: number) => formatBytes(n, getLocale());

/** Fixed-height row windowing for long lists inside a scroll container. */
export function useWindow(count: number, rowHeight: number, overscan = 12) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf = 0;
    const read = () => { raf = 0; setView((v) => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight })); };
    const on = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    el.addEventListener('scroll', on, { passive: true });
    const ro = new ResizeObserver(on); ro.observe(el);
    return () => { el.removeEventListener('scroll', on); ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  const start = Math.max(0, Math.floor(view.top / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((view.top + view.height) / rowHeight) + overscan);
  return { ref, start, end, before: start * rowHeight, after: Math.max(0, count - end) * rowHeight };
}

/** A view that throws while rendering (an unexpected shape in a preview, a browser limit) ends in a panel, not a blank screen. */
export class Guard extends Component<{ source: PreviewSource; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? <CrashPanel source={this.props.source} /> : this.props.children; }
}
function CrashPanel({ source }: { source: PreviewSource }) {
  const t = useT();
  return <Panel icon="warning" tone="warn" title={t('preview.crashTitle')} text={t('preview.crashText')} testId="preview-error"><DownloadLink source={source} primary /></Panel>;
}
