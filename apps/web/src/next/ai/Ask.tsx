// SP Drive AI — questions answered from the account's own documents. The server retrieves passages, sends only those
// to the model, and streams the answer; `[n]` in the answer refers to the numbered sources, which open the cited file
// (at the cited page for a PDF). Nothing here invents an answer: when AI is not configured, not allowed for this
// account, or when nothing was retrieved, the panel says exactly that.
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ApiError, get } from '../../api.ts';
import { Glyph } from '../../glyphs.tsx';
import { errorText, useT } from '../../i18n.ts';
import { Button, cx, Spinner } from '../../ui.tsx';
import type { AiProviders, AiSource } from '../types.ts';
import { RouteMark } from './marks.tsx';
import { ask, type AskRequest } from './stream.ts';

export const AI_KEY = ['next', 'ai', 'providers'];
export const useAiProviders = (enabled = true) => useQuery({ queryKey: AI_KEY, queryFn: () => get<AiProviders>('/ai/providers'), staleTime: 30_000, enabled });
const PREF = 'spd.ai.choice';
type Choice = { provider: string; model: string };
const loadChoice = (): Choice | null => { try { const v = JSON.parse(localStorage.getItem(PREF) ?? 'null'); return v && typeof v.provider === 'string' && typeof v.model === 'string' ? v : null; } catch { return null; } };

interface Turn {
  id: number; question: string; answer: string; sources: AiSource[]; unindexed: { fileId: string; name: string; status: string }[];
  state: 'streaming' | 'done' | 'empty' | 'error' | 'stopped'; error?: string; errorCode?: string; via?: { provider: string; model: string }; usage?: { inputTokens: number | null; outputTokens: number | null } | null;
}

/** Route and model selector. The route (who receives the request) and the maker of the model are two separate facts. */
export function ModelSelect({ data, value, onChange }: { data: AiProviders; value: Choice; onChange: (c: Choice) => void }) {
  const t = useT();
  const usable = data.providers.filter((p) => p.usable && p.models.length);
  const provider = usable.find((p) => p.id === value.provider) ?? usable[0];
  const model = provider?.models.find((m) => m.id === value.model) ?? provider?.models[0];
  if (!provider || !model) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2" data-testid="ai-model">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-hover text-ink" title={provider.label}><RouteMark id={provider.id} size={16} /></span>
      <label className="sr-only" htmlFor="spd-ai-model">{t('next.ai.model')}</label>
      <select id="spd-ai-model" value={`${provider.id}\u0000${model.id}`} onChange={(e) => { const [p, m] = e.target.value.split('\u0000'); onChange({ provider: p!, model: m! }); }}
        className="h-8 max-w-full min-w-0 rounded-md border border-line-strong bg-surface pr-7 pl-2 text-[13px] text-ink focus:border-accent focus:outline-none">
        {usable.map((p) => <optgroup key={p.id} label={t('next.ai.route', { name: p.label })}>{p.models.map((m) => <option key={m.id} value={`${p.id}\u0000${m.id}`}>{m.label}</option>)}</optgroup>)}
      </select>
      <span className="min-w-0 truncate" data-testid="ai-route">{t('next.ai.madeBy', { creator: model.creator || '—' })} · {provider.local ? t('next.ai.local') : t('next.ai.external', { name: provider.label })}</span>
    </div>
  );
}

/** Why AI cannot be used right now, in plain words, with the way out when there is one. */
export function AiUnavailable({ data, compact }: { data: AiProviders; compact?: boolean }) {
  const t = useT();
  const configured = data.providers.filter((p) => p.configured);
  const blockedExternal = configured.some((p) => !p.local);
  let title = t('next.ai.offTitle'), text = t('next.ai.offText'), action: ReactNode = null;
  if (blockedExternal && !data.external.server) { title = t('next.ai.serverOffTitle'); text = t('next.ai.serverOffText'); }
  else if (blockedExternal && !data.external.account) { title = t('next.ai.accountOffTitle'); text = t('next.ai.accountOffText'); action = <Link href="/settings/profil" className="btn-grad press inline-flex h-9 items-center rounded-[10px] px-4 text-[13px] font-medium">{t('next.ai.openSettings')}</Link>; }
  return (
    <div className={cx('flex flex-col items-center gap-2 text-center', compact ? 'px-3 py-6' : 'px-6 py-14')} data-testid="ai-unavailable">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-hover text-ink-3"><Glyph name="sparkle" size={22} /></span>
      <h2 className={cx('spd-display text-ink', compact ? 'text-[18px]' : 'text-[26px]')}>{title}</h2>
      <p className="max-w-sm text-[13px] leading-relaxed text-ink-2">{text}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** The answer, with `[n]` turned into buttons that reveal and open source n. */
function Answer({ text, sources, onCite }: { text: string; sources: AiSource[]; onCite: (n: number) => void }) {
  const known = new Set(sources.map((s) => s.n));
  const parts = text.split(/(\[\d{1,2}\])/g);
  return (
    <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap text-ink" data-testid="ai-answer">
      {parts.map((p, i) => {
        const m = /^\[(\d{1,2})\]$/.exec(p);
        if (!m || !known.has(Number(m[1]))) return <span key={i}>{p}</span>;
        return <button key={i} type="button" onClick={() => onCite(Number(m[1]))} aria-label={`Source ${m[1]}`} className="mx-0.5 inline-flex h-[18px] min-w-[18px] translate-y-[-1px] items-center justify-center rounded-[5px] bg-accent-soft px-1 align-middle text-[11px] font-semibold text-accent tabular-nums transition-colors hover:bg-selection">{m[1]}</button>;
      })}
    </p>
  );
}
function Sources({ sources, flash }: { sources: AiSource[]; flash: number | null }) {
  const t = useT();
  if (!sources.length) return null;
  return (
    <ol className="mt-3 flex flex-col gap-1.5" aria-label={t('next.ai.sources')} data-testid="ai-sources">
      {sources.map((s) => (
        <li key={s.n} id={`spd-src-${s.n}`}>
          <Link href={`/open/${s.fileId}${s.page ? `?page=${s.page}` : ''}`} data-source={s.n}
            className={cx('flex gap-2.5 rounded-[10px] border px-2.5 py-2 transition-colors hover:bg-hover', flash === s.n ? 'border-accent bg-accent-soft' : 'border-line')}>
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] bg-accent-soft px-1 text-[11px] font-semibold text-accent tabular-nums">{s.n}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2"><span className="truncate text-[13px] font-medium text-ink">{s.name}</span>{s.page ? <span className="shrink-0 text-xs text-ink-3">{t('next.search.page', { n: s.page })}</span> : null}</span>
              <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-ink-2">{s.text}</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function AskPanel({ scope, compact, placeholder, intro }: { scope: AskRequest['scope']; compact?: boolean; placeholder?: string; intro?: ReactNode }) {
  const t = useT();
  const q = useAiProviders();
  const [choice, setChoice] = useState<Choice | null>(loadChoice);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [flash, setFlash] = useState<{ turn: number; n: number } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  const scopeKey = JSON.stringify(scope);
  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => { ctrl.current?.abort(); setTurns([]); }, [scopeKey]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [turns]);
  const data = q.data;
  const resolved = useMemo<Choice | null>(() => {
    if (!data?.enabled) return null;
    const usable = data.providers.filter((p) => p.usable && p.models.length);
    const p = usable.find((x) => x.id === choice?.provider);
    if (p && p.models.some((m) => m.id === choice?.model)) return choice;
    return data.default ?? (usable[0] ? { provider: usable[0].id, model: usable[0].models[0]!.id } : null);
  }, [data, choice]);
  if (q.isLoading) return <div className="flex justify-center py-10 text-accent"><Spinner /></div>;
  if (q.error || !data) return <p role="alert" className="px-4 py-8 text-center text-sm text-danger">{errorText(q.error)}</p>;
  if (!data.enabled || !resolved) return <AiUnavailable data={data} compact={compact} />;

  const busy = turns.some((x) => x.state === 'streaming');
  const patchTurn = (id: number, f: (x: Turn) => Turn) => setTurns((ts) => ts.map((x) => (x.id === id ? f(x) : x)));
  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const id = ++seq.current;
    const history = turns.filter((x) => x.state === 'done' && x.answer).slice(-5).flatMap((x) => [{ role: 'user' as const, content: x.question.slice(0, 8000) }, { role: 'assistant' as const, content: x.answer.slice(0, 8000) }]);
    setTurns((ts) => [...ts, { id, question, answer: '', sources: [], unindexed: [], state: 'streaming' }]);
    setQuestion('');
    const c = new AbortController(); ctrl.current = c;
    try {
      await ask({ scope, question, provider: resolved.provider, model: resolved.model, history: history.length ? history : undefined }, {
        notice: (n) => patchTurn(id, (x) => ({ ...x, unindexed: n.unindexed ?? [] })),
        sources: (s) => patchTurn(id, (x) => ({ ...x, sources: s })),
        delta: (d) => patchTurn(id, (x) => ({ ...x, answer: x.answer + d })),
        done: (d) => patchTurn(id, (x) => ({ ...x, state: d.empty ? 'empty' : 'done', via: { provider: d.provider, model: d.model }, usage: d.usage })),
        error: (e) => patchTurn(id, (x) => ({ ...x, state: 'error', errorCode: e.code, error: t(`next.ai.err.${e.code}`) === `next.ai.err.${e.code}` ? e.message : t(`next.ai.err.${e.code}`) })),
      }, c.signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') patchTurn(id, (x) => ({ ...x, state: 'stopped' }));
      else {
        const code = e instanceof ApiError ? e.code : 'network';
        patchTurn(id, (x) => ({ ...x, state: 'error', errorCode: code, error: t(`next.ai.err.${code}`) === `next.ai.err.${code}` ? errorText(e) : t(`next.ai.err.${code}`) }));
        if (code === 'ai_external_disabled' || code === 'ai_unavailable' || code === 'provider_not_configured') void q.refetch();
      }
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void send(question); };
  const cite = (turn: number, n: number) => { setFlash({ turn, n }); document.getElementById(`spd-src-${n}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); setTimeout(() => setFlash(null), 1600); };
  const label = (c: { provider: string; model: string }) => { const p = data.providers.find((x) => x.id === c.provider); const m = p?.models.find((x) => x.id === c.model); return `${m?.label ?? c.model} · ${p?.label ?? c.provider}`; };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="ask-panel">
      <div className={cx('min-h-0 flex-1 overflow-y-auto', compact ? 'px-0.5' : 'px-1')} aria-live="polite">
        {!turns.length ? <div className="py-2">{intro}</div> : null}
        {turns.map((x) => (
          <article key={x.id} className="border-b border-line py-4 last:border-b-0" data-testid="ai-turn" data-state={x.state}>
            <h3 className="spd-title text-[16px] leading-snug text-ink">{x.question}</h3>
            {x.unindexed.length ? <p className="mt-2 flex items-start gap-2 rounded-[10px] bg-warn-soft px-2.5 py-2 text-xs leading-snug text-warn" data-testid="ai-unindexed"><Glyph name="info" size={14} className="mt-px shrink-0" /><span>{t('next.ai.unindexed', { names: x.unindexed.map((u) => u.name).join(', ') })}</span></p> : null}
            <div className="mt-2">
              {x.state === 'streaming' && !x.answer ? <p className="flex items-center gap-2 text-[13px] text-ink-3"><Spinner size={14} />{x.sources.length ? t('next.ai.writing') : t('next.ai.reading')}</p> : null}
              {x.answer ? <Answer text={x.answer} sources={x.sources} onCite={(n) => cite(x.id, n)} /> : null}
              {x.state === 'empty' ? <p className="rounded-[10px] bg-hover px-3 py-2.5 text-[13px] leading-relaxed text-ink-2" data-testid="ai-empty">{t('next.ai.nothing')}</p> : null}
              {x.state === 'error' ? <p role="alert" className="mt-2 flex items-start gap-2 rounded-[10px] bg-danger-soft px-3 py-2.5 text-[13px] leading-snug text-danger"><Glyph name="warning" size={15} className="mt-px shrink-0" /><span>{x.error}</span></p> : null}
              {x.state === 'stopped' ? <p className="mt-2 text-xs text-ink-3">{t('next.ai.stopped')}</p> : null}
            </div>
            {x.state !== 'empty' ? <Sources sources={x.sources} flash={flash?.turn === x.id ? flash.n : null} /> : null}
            {x.via && x.state === 'done' ? <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-ink-3" data-testid="ai-via"><RouteMark id={x.via.provider} size={13} />{label(x.via)}{x.usage && x.usage.inputTokens != null && x.usage.outputTokens != null ? ` · ${t('next.ai.tokens', { in: x.usage.inputTokens, out: x.usage.outputTokens })}` : ''}</p> : null}
          </article>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="shrink-0 pt-2">
        <div className="flex items-end gap-2 rounded-[14px] border border-line-strong bg-surface p-1.5 transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={compact ? 1 : 2} maxLength={2000} aria-label={t('next.ai.question')} placeholder={placeholder ?? t('next.ai.placeholder')}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(question); } }}
            className="max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-base leading-snug text-ink outline-none placeholder:text-ink-3 sm:text-[14px]" />
          {busy ? <Button size="sm" icon="stop" onClick={() => ctrl.current?.abort()}>{t('next.ai.stop')}</Button>
            : <Button type="submit" size="sm" variant="primary" icon="send" disabled={!question.trim()}>{t('next.ai.ask')}</Button>}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <ModelSelect data={data} value={resolved} onChange={(c) => { setChoice(c); try { localStorage.setItem(PREF, JSON.stringify(c)); } catch { /* not remembered */ } }} />
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-ink-3">{t('next.ai.privacy')}</p>
      </form>
    </div>
  );
}

/** "Ask my Drive": the whole account, as a screen. */
export function AskScreen() {
  const t = useT();
  const examples = [t('next.ai.ex1'), t('next.ai.ex2'), t('next.ai.ex3')];
  return (
    <div className="pb-dock mx-auto flex h-full w-full max-w-3xl flex-col px-4 pt-3 sm:px-8 sm:pt-6" data-testid="ask-screen">
      <header className="mb-2 shrink-0">
        <h1 className="text-[30px] leading-[1.1] sm:text-[32px]">{t('next.ai.title')}</h1>
        <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-ink-2">{t('next.ai.intro')}</p>
      </header>
      <AskPanel scope={{ all: true }} intro={<ul className="flex flex-col gap-1 pt-2 text-[13px] text-ink-3">{examples.map((x) => <li key={x} className="flex items-start gap-2"><Glyph name="quote" size={13} className="mt-0.5 shrink-0" />{x}</li>)}</ul>} />
    </div>
  );
}
