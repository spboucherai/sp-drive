// Document intelligence providers. One small interface, four routes to a model:
//   maclustr   — the cluster's own OpenAI-compatible endpoint (local to the owner's machines): preferred, always allowed
//   anthropic, openai, openrouter — external: used only when SPD_AI_EXTERNAL=on AND the account allowed it
// Keys come from the environment or from ~/.config/sp-drive/ai.env (never from the repository, never logged).
import { existsSync, readFileSync } from 'node:fs';
import { config } from '../config.ts';
import { anthropicStream } from './anthropic.ts';
import { openAiCompatibleStream } from './openai-compatible.ts';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatRequest { model: string; system: string; messages: ChatMessage[]; maxTokens: number; signal?: AbortSignal }
export type ChatEvent = { type: 'delta'; text: string } | { type: 'done'; usage: { inputTokens: number | null; outputTokens: number | null }; stopReason: string | null };
/** A failure whose `code` is stable and whose message is safe to show (never the upstream body, which may echo the prompt). */
export class AiError extends Error { constructor(public code: string, message: string, public status = 502) { super(message); } }
export interface ModelInfo { id: string; label: string; creator: string }
export type ProviderId = 'maclustr' | 'anthropic' | 'openai' | 'openrouter';
export interface Provider { id: ProviderId; label: string; local: boolean; configured: boolean; models: ModelInfo[]; defaultModel: string | null; stream(req: ChatRequest): AsyncIterable<ChatEvent> }

/** KEY=VALUE lines of the optional secrets file; the process environment wins. */
function fileEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(config.aiEnvFile)) return out;
  for (const line of readFileSync(config.aiEnvFile, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
/** "id|label|creator, id2|label2|creator2" (label and creator optional). */
function parseModels(raw: string | undefined, creatorOf: (id: string) => string): ModelInfo[] {
  return (raw ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 40).map((x) => { const [id, label, creator] = x.split('|').map((y) => y.trim()); return { id: id!, label: label || id!, creator: creator || creatorOf(id!) }; });
}
const CREATORS: [RegExp, string][] = [[/claude/i, 'Anthropic'], [/^(gpt|o\d|chatgpt)/i, 'OpenAI'], [/qwen/i, 'Alibaba'], [/gemini|gemma/i, 'Google'], [/llama/i, 'Meta'], [/mistral|mixtral|codestral/i, 'Mistral AI'], [/deepseek/i, 'DeepSeek'], [/grok/i, 'xAI']];
/** Who made a model, guessed from its identifier ("anthropic/claude-…" on a router, "qwen3-…" on the cluster). */
export const creatorOf = (id: string): string => {
  const slash = id.includes('/') ? id.split('/')[0]! : '';
  const hit = CREATORS.find(([re]) => re.test(id));
  return hit ? hit[1] : slash ? slash.charAt(0).toUpperCase() + slash.slice(1) : 'unknown';
};

export interface AiSettings {
  maclustr: { url: string; key: string; models: ModelInfo[]; model: string };
  anthropic: { url: string; key: string; model: string };
  openai: { url: string; key: string; models: ModelInfo[]; model: string };
  openrouter: { url: string; key: string; models: ModelInfo[]; model: string };
}
function load(): AiSettings {
  const f = fileEnv();
  const e = (k: string, d = '') => process.env[k] ?? f[k] ?? d;
  const list = (models: string, one: string) => { const m = parseModels(models || one, creatorOf); return { models: m, model: one || m[0]?.id || '' }; };
  return {
    maclustr: { url: e('SPD_AI_MACLUSTR_URL', 'https://llm.spboucher.ai/v1').replace(/\/+$/, ''), key: e('SPD_AI_MACLUSTR_KEY'), ...list(e('SPD_AI_MACLUSTR_MODELS'), e('SPD_AI_MACLUSTR_MODEL')) },
    anthropic: { url: e('SPD_AI_ANTHROPIC_URL'), key: e('ANTHROPIC_API_KEY'), model: e('SPD_AI_ANTHROPIC_MODEL', 'claude-opus-5-5') },
    openai: { url: e('SPD_AI_OPENAI_URL', 'https://api.openai.com/v1').replace(/\/+$/, ''), key: e('OPENAI_API_KEY'), ...list(e('SPD_AI_OPENAI_MODELS'), e('SPD_AI_OPENAI_MODEL')) },
    openrouter: { url: e('SPD_AI_OPENROUTER_URL', 'https://openrouter.ai/api/v1').replace(/\/+$/, ''), key: e('OPENROUTER_API_KEY'), ...list(e('SPD_AI_OPENROUTER_MODELS'), e('SPD_AI_OPENROUTER_MODEL')) },
  };
}
/** Read once at start; tests replace fields to point a provider at a fake server. `reloadAiSettings` re-reads the file. */
export let aiSettings: AiSettings = load();
export const reloadAiSettings = () => { aiSettings = load(); };

export const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', creator: 'Anthropic' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', creator: 'Anthropic' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', creator: 'Anthropic' },
];

export function providers(): Provider[] {
  const s = aiSettings;
  const compat = (id: 'maclustr' | 'openai' | 'openrouter', label: string, local: boolean): Provider => {
    const c = s[id];
    return { id, label, local, configured: !!(c.key && c.url && c.model), models: c.models, defaultModel: c.model || null,
      stream: (req) => openAiCompatibleStream({ url: c.url, key: c.key, tokenField: id === 'openai' ? 'max_completion_tokens' : 'max_tokens',
        headers: id === 'openrouter' ? { 'X-Title': 'SP Drive' } : {} }, req) };
  };
  return [
    compat('maclustr', 'MacLustr (local)', true),
    { id: 'anthropic', label: 'Anthropic', local: false, configured: !!s.anthropic.key, models: ANTHROPIC_MODELS, defaultModel: s.anthropic.model,
      stream: (req) => anthropicStream({ key: s.anthropic.key, url: s.anthropic.url || undefined }, req) },
    compat('openai', 'OpenAI', false),
    compat('openrouter', 'OpenRouter', false),
  ];
}
/** At least one provider could answer on this server (the feature `ai` of GET /api/v1/meta). */
export const aiEnabled = (): boolean => providers().some((p) => p.configured && (p.local || config.aiExternal));
