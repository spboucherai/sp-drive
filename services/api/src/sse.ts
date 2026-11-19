// Server-Sent Events over a hijacked reply: headers that keep proxies from buffering, one writer, one clean-up.
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface SseStream { send(event: string, data: unknown): void; comment(text: string): void; end(): void; readonly closed: boolean; onClose(fn: () => void): void }
/** Take over the reply and start an event stream. The security headers already set on the reply are kept. */
const open = new Set<{ end(): void; socket(): { destroy(): void } | null }>();
/** Streams open in this process (administration, tests). */
export const openSseCount = (): number => open.size;
/**
 * End every open stream, for a shutdown: an event stream never ends by itself, so the HTTP server would wait for it
 * for ever. Each response is finished (the client sees the end of the stream and reconnects elsewhere) and its
 * connection is closed.
 */
export function closeAllSse(): void {
  for (const s of [...open]) { const sock = s.socket(); s.end(); try { sock?.destroy(); } catch { /* already gone */ } }
}

export function openSse(req: FastifyRequest, reply: FastifyReply): SseStream {
  reply.hijack();
  const res = reply.raw;
  const kept = Object.fromEntries(Object.entries(reply.getHeaders()).filter(([k, v]) => v !== undefined && !['content-length', 'content-type'].includes(k))) as Record<string, string>;
  res.writeHead(200, {
    ...kept, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store, no-transform', Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx-style proxies; Caddy streams as soon as it sees text/event-stream and flushed chunks
  });
  res.flushHeaders();
  (req.raw.socket as { setNoDelay?: (on: boolean) => void } | undefined)?.setNoDelay?.(true);
  let closed = false;
  const closers: (() => void)[] = [];
  const close = () => { if (closed) return; closed = true; open.delete(entry); for (const fn of closers.splice(0)) { try { fn(); } catch { /* clean-up must not throw */ } } };
  const end = () => { if (!res.writableEnded) { try { res.end(); } catch { /* already gone */ } } close(); };
  const entry = { end, socket: () => res.socket };
  open.add(entry);
  res.on('close', close); res.on('error', close); req.raw.on('aborted', close);
  const write = (chunk: string) => { if (closed || res.writableEnded || res.destroyed) return; try { res.write(chunk); } catch { close(); } };
  return {
    send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    comment: (text) => write(`: ${text}\n\n`),
    end,
    get closed() { return closed; },
    onClose: (fn) => { if (closed) fn(); else closers.push(fn); },
  };
}
