/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/src/ai/anthropic.ts
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

// Claude through the official Anthropic SDK (Messages API, streamed). Adaptive thinking (the only mode the current
// models accept), an explicit effort level, no sampling parameters, no assistant prefill. Claude Opus 5.5 and
// Claude Sonnet 5.5 opt into server-side refusal fallbacks; a final `refusal` is reported as such, never as an answer.
import Anthropic from '@anthropic-ai/sdk';
import { AiError, type ChatEvent, type ChatRequest } from './providers.ts';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** Models that take the `fallbacks` parameter (Claude Haiku 5.5 has no server-side fallback). */
const WITH_FALLBACKS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export async function* anthropicStream(target: { key: string; url?: string }, req: ChatRequest): AsyncGenerator<ChatEvent> {
  const client = new Anthropic({ apiKey: target.key, ...(target.url ? { baseURL: target.url } : {}), maxRetries: 1 });
  const base = {
    model: req.model, max_tokens: Math.max(req.maxTokens, 4096), system: req.system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    thinking: { type: 'adaptive' as const },
    output_config: { effort: 'medium' as const },
  };
  try {
    const stream = WITH_FALLBACKS.has(req.model)
      ? client.beta.messages.stream({ ...base, betas: [FALLBACK_BETA], fallbacks: 'default' } as unknown as Parameters<typeof client.beta.messages.stream>[0], { signal: req.signal })
      : client.messages.stream(base as unknown as Parameters<typeof client.messages.stream>[0], { signal: req.signal });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield { type: 'delta', text: event.delta.text };
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') throw new AiError('provider_refused', 'the model declined to answer this request', 422);
    yield { type: 'done', usage: { inputTokens: final.usage?.input_tokens ?? null, outputTokens: final.usage?.output_tokens ?? null }, stopReason: final.stop_reason ?? null };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.APIUserAbortError) { const a = new Error('aborted'); a.name = 'AbortError'; throw a; }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('provider_auth', 'the model provider refused the configured key', 502);
    if (e instanceof Anthropic.NotFoundError) throw new AiError('model_unknown', 'the model provider does not know this model', 502);
    if (e instanceof Anthropic.RateLimitError) throw new AiError('provider_rate_limited', 'the model provider is rate limiting, try again shortly', 503);
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('provider_unreachable', 'the model provider could not be reached', 502);
    if (e instanceof Anthropic.APIError) throw new AiError(Number(e.status) >= 500 ? 'provider_unavailable' : 'provider_error', `the model provider answered ${e.status ?? 'an error'}`, Number(e.status) >= 500 ? 503 : 502);
    throw e;
  }
}
