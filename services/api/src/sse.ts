/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/sse.ts
 * Module           : services
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-19
 * Last Modified    : 2026-11-19
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: support@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
