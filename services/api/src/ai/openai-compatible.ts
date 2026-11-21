/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/ai/openai-compatible.ts
 * Module           : ai
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

// Chat completions over the OpenAI-compatible wire format (the cluster's own endpoint, OpenAI, OpenRouter), streamed.
import { AiError, type ChatEvent, type ChatRequest } from './providers.ts';

export interface CompatTarget { url: string; key: string; tokenField: 'max_tokens' | 'max_completion_tokens'; headers?: Record<string, string> }

export async function* openAiCompatibleStream(target: CompatTarget, req: ChatRequest): AsyncGenerator<ChatEvent> {
  let res: Response;
  try {
    res = await fetch(`${target.url}/chat/completions`, {
      method: 'POST', signal: req.signal,
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', authorization: `Bearer ${target.key}`, ...target.headers },
      body: JSON.stringify({ model: req.model, stream: true, stream_options: { include_usage: true }, [target.tokenField]: req.maxTokens,
        messages: [{ role: 'system', content: req.system }, ...req.messages] }),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AiError('provider_unreachable', 'the model provider could not be reached', 502);
  }
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    // the body of an error may repeat the prompt: only the status is kept
    if (res.status === 401 || res.status === 403) throw new AiError('provider_auth', 'the model provider refused the configured key', 502);
    if (res.status === 404) throw new AiError('model_unknown', 'the model provider does not know this model', 502);
    if (res.status === 429) throw new AiError('provider_rate_limited', 'the model provider is rate limiting, try again shortly', 503);
    throw new AiError(res.status >= 500 ? 'provider_unavailable' : 'provider_error', `the model provider answered ${res.status}`, res.status >= 500 ? 503 : 502);
  }
  const usage = { inputTokens: null as number | null, outputTokens: null as number | null };
  let stopReason: string | null = null, buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
      const line = buffer.slice(0, nl).replace(/\r$/, ''); buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let j: { choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } | null; error?: { message?: string } };
      try { j = JSON.parse(data); } catch { continue; }
      if (j.error) throw new AiError('provider_error', 'the model provider reported an error while answering', 502);
      const c = j.choices?.[0];
      if (c?.delta?.content) yield { type: 'delta', text: c.delta.content };
      if (c?.finish_reason) stopReason = c.finish_reason;
      if (j.usage) { usage.inputTokens = j.usage.prompt_tokens ?? null; usage.outputTokens = j.usage.completion_tokens ?? null; }
    }
    if (buffer.length > 1024 * 1024) throw new AiError('provider_error', 'the model provider sent an unreadable stream', 502);
  }
  yield { type: 'done', usage, stopReason };
}
