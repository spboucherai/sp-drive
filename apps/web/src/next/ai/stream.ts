// POST /ai/ask answers as Server-Sent Events; EventSource cannot POST, so the stream is read from fetch.
import { ApiError } from '../../api.ts';
import type { AiSource } from '../types.ts';

export interface AskRequest { scope: { fileIds?: string[]; folderId?: string; all?: true }; question: string; provider?: string; model?: string; history?: { role: 'user' | 'assistant'; content: string }[] }
export interface AskHandlers {
  notice?(n: { unindexed: { fileId: string; name: string; status: string }[] }): void;
  sources?(s: AiSource[]): void;
  delta?(text: string): void;
  done?(d: { empty?: boolean; provider: string; model: string; usage: { inputTokens: number | null; outputTokens: number | null } | null; stopReason?: string }): void;
  error?(e: { code: string; message: string }): void;
}
/** Resolves when the stream ended (after `done` or `error`). Rejects with ApiError for a refusal before the stream, AbortError when cancelled. */
export async function ask(body: AskRequest, h: AskHandlers, signal: AbortSignal): Promise<void> {
  const res = await fetch('/api/v1/ai/ask', { method: 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json', 'X-SPD-CSRF': '1', Accept: 'text/event-stream' }, body: JSON.stringify(body) })
    .catch((e: Error) => { if (e.name === 'AbortError') throw e; throw new ApiError(0, 'network', 'network error'); });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const j = await res.json().catch(() => null);
    throw new ApiError(res.status, j?.error ?? 'http_error', j?.message ?? `HTTP ${res.status}`, j ?? {});
  }
  const reader = res.body!.getReader(), dec = new TextDecoder();
  let buf = '', ended = false;
  const dispatch = (block: string) => {
    let event = 'message', data = '';
    for (const line of block.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, ''); }
    if (!data) return;
    let v: any; try { v = JSON.parse(data); } catch { return; }
    if (event === 'notice') h.notice?.(v); else if (event === 'sources') h.sources?.(v); else if (event === 'delta') h.delta?.(String(v.text ?? ''));
    else if (event === 'done') { ended = true; h.done?.(v); } else if (event === 'error') { ended = true; h.error?.(v); }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) { dispatch(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  if (buf.trim()) dispatch(buf);
  if (!ended) h.error?.({ code: 'provider_error', message: 'the answer stopped before its end' });
}
