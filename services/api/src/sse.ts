// Server-Sent Events over a hijacked reply: headers that keep proxies from buffering, one writer, one clean-up.
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface SseStream { send(event: string, data: unknown): void; comment(text: string): void; end(): void; readonly closed: boolean; onClose(fn: () => void): void }
/** Take over the reply and start an event stream. The security headers already set on the reply are kept. */
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
  const close = () => { if (closed) return; closed = true; for (const fn of closers.splice(0)) { try { fn(); } catch { /* clean-up must not throw */ } } };
  res.on('close', close); res.on('error', close); req.raw.on('aborted', close);
  const write = (chunk: string) => { if (closed || res.writableEnded || res.destroyed) return; try { res.write(chunk); } catch { close(); } };
  return {
    send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    comment: (text) => write(`: ${text}\n\n`),
    end: () => { if (!res.writableEnded) { try { res.end(); } catch { /* already gone */ } } close(); },
    get closed() { return closed; },
    onClose: (fn) => { if (closed) fn(); else closers.push(fn); },
  };
}
