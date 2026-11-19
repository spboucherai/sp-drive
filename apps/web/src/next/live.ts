// Live refresh. The server's event stream (GET /sync/events) says "something changed" — never what: on a hint the
// cached listings are invalidated and react-query re-reads what is on screen. Events are a hint, not the truth, so a
// polling fallback runs while the stream is down (30 s in the foreground) and the stream is retried with exponential
// back-off and jitter (1 s → 60 s). After a reconnect, `hello.head` tells whether anything was missed.
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { get } from '../api.ts';

export type LiveState = 'connecting' | 'live' | 'polling' | 'off';
let state: LiveState = 'off';
const listeners = new Set<() => void>();
const setState = (s: LiveState) => { if (s !== state) { state = s; document.documentElement.dataset.live = s; listeners.forEach((f) => f()); } };
export const useLiveState = (): LiveState => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);

const KEYS = [['explorer'], ['next'], ['shares'], ['requests']];
function refresh(qc: QueryClient, auth = true): void {
  for (const queryKey of KEYS) void qc.invalidateQueries({ queryKey });
  if (auth) void qc.invalidateQueries({ queryKey: ['auth'] }); // the quota follows the files
}

export function startLive(qc: QueryClient, events: boolean): () => void {
  let es: EventSource | null = null, stopped = false, attempt = 0, head = -1;
  let retry: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined, debounce: ReturnType<typeof setTimeout> | undefined;
  const changed = () => { clearTimeout(debounce); debounce = setTimeout(() => refresh(qc), 150); };
  const seen = (h: unknown) => { if (typeof h !== 'number') return; if (head >= 0 && h !== head) changed(); head = h; };
  const tick = async () => {
    if (document.visibilityState !== 'visible') return;
    try { seen((await get<{ head: number }>('/sync/cursor')).head); } catch { /* offline or signed out: the next tick or the stream will tell */ }
  };
  const startPolling = () => { if (!poll) { poll = setInterval(() => void tick(), 30_000); } };
  const stopPolling = () => { clearInterval(poll); poll = undefined; };
  const connect = () => {
    if (stopped) return;
    if (!events || typeof EventSource === 'undefined') { setState('polling'); startPolling(); void tick(); return; }
    setState(attempt ? 'polling' : 'connecting');
    es = new EventSource('/api/v1/sync/events', { withCredentials: true });
    es.addEventListener('hello', (e) => { attempt = 0; stopPolling(); setState('live'); try { seen(JSON.parse((e as MessageEvent).data).head); } catch { /* ignore */ } });
    es.addEventListener('change', (e) => { try { head = JSON.parse((e as MessageEvent).data).head; } catch { /* ignore */ } changed(); });
    es.addEventListener('notify', () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); void qc.invalidateQueries({ queryKey: ['next', 'shared-with-me'] }); });
    es.onerror = () => {
      // the browser would retry by itself at a fixed pace: close and schedule our own back-off instead
      es?.close(); es = null;
      if (stopped) return;
      setState('polling'); startPolling();
      const wait = Math.min(60_000, 1000 * 2 ** attempt++) * (0.6 + Math.random() * 0.8);
      clearTimeout(retry); retry = setTimeout(connect, wait);
    };
  };
  const onVisible = () => { if (document.visibilityState === 'visible' && state !== 'live') void tick(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);
  connect();
  return () => { stopped = true; es?.close(); clearTimeout(retry); clearTimeout(debounce); stopPolling(); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onVisible); setState('off'); };
}
/** Mounted once by the shell. */
export function useLive(events: boolean, ready: boolean): void {
  const qc = useQueryClient();
  useEffect(() => (ready ? startLive(qc, events) : undefined), [qc, events, ready]);
}
