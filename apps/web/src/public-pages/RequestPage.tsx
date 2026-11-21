/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/public-pages/RequestPage.tsx
 * Module           : public-pages
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-11
 * Last Modified    : 2026-11-11
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

// Deposit portal, as seen by someone without an account. The page knows the portal's public description and, once a
// deposit is admitted, a submission token that can only send the declared files and read the state of that deposit.
import { formatBytes, type RequestFields } from '@spd/shared';
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError, get, post } from '../api.ts';
import { Glyph } from '../glyphs.tsx';
import { fmtDate, getLocale, useT } from '../i18n.ts';
import { Button, copyText, cx, ProgressBar, Spinner } from '../ui.tsx';
import { transfer } from '../upload-engine.ts';
import { Notice, PField, PublicShell } from './PublicShell.tsx';
import { accentVars, BLOCKED_EXT, isTouch, serverExt, store, tokenKey } from './util.ts';

interface PortalInfo {
  title: string; description: string; instructions: string; brandName: string; brandColor: string; needsPassword: boolean; expiresAt: string | null;
  maxFileBytes: number; maxFiles: number; remainingBytes: number; allowedExtensions: string[]; fields: RequestFields; requireConsent: boolean; consentText: string; retentionNote: string; chunkBytes: number;
}
interface Head { title: string; description: string; brandName: string; brandColor: string }
interface Admitted { ref: string; submissionToken: string; items: { uploadId: string; name: string; size: number }[] }
interface StatusOut { ref: string; status: 'open' | 'processing' | 'completed' | 'rejected' | 'expired'; confirmationMessage: string; items: { name: string; status: 'accepted' | 'rejected' | 'pending'; reason: string | null }[] }
/** What survives an accidental reload of the tab (sessionStorage): enough to resume or to show the receipt again. */
interface Pending { v: 1; token: string; ref: string; chunkBytes: number; head: Head; items: { uploadId: string; name: string; original: string; size: number }[]; receivedAt?: string }
type Loaded =
  | { kind: 'loading' } | { kind: 'unavailable' } | { kind: 'closed' } | { kind: 'error'; tooMany?: boolean }
  | { kind: 'ready'; info: PortalInfo | null; pending: Pending | null; status: StatusOut | null };

const REASONS = ['type_not_allowed', 'incomplete', 'executable', 'type_mismatch', 'infected', 'unscannable', 'target_unavailable', 'quota_exceeded', 'expired'];
const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

export function RequestPage({ token }: { token: string }) {
  const t = useT();
  const key = tokenKey('spd.deposit', token);
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  const [round, setRound] = useState(0); // "another deposit" and "retry" load the portal again

  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    void (async () => {
      // a deposit begun in this tab comes first: it must stay reachable even if the portal has filled up or closed since
      let pending = store.get<Pending>(key), status: StatusOut | null = null;
      if (pending?.v === 1) {
        try { status = await get<StatusOut>('/public/submissions/status', bearer(pending.token)); if (status.status === 'expired') throw new ApiError(410, 'portal_closed', ''); }
        catch (e) { if (e instanceof ApiError && e.status >= 400 && e.status < 500) { store.del(key); pending = null; status = null; } }
      } else pending = null;
      let info: PortalInfo | null = null, fail: Loaded | null = null;
      try { info = await get<PortalInfo>(`/public/requests/${token}`); }
      catch (e) { fail = e instanceof ApiError && e.status === 404 ? { kind: 'unavailable' } : e instanceof ApiError && e.status === 410 ? { kind: 'closed' } : { kind: 'error', tooMany: e instanceof ApiError && e.status === 429 }; }
      if (!live) return;
      if (pending && (status || info)) setState({ kind: 'ready', info, pending, status });
      else if (info) setState({ kind: 'ready', info, pending: null, status: null });
      else setState(fail!);
    })();
    return () => { live = false; };
  }, [token, key, round]);

  const head: Head | null = state.kind === 'ready' ? state.info ?? state.pending!.head : null;
  const title = head ? [head.title, head.brandName].filter(Boolean).join(' — ') : t('public.portal.title');
  return (
    <PublicShell title={title}>
      {state.kind === 'loading' ? <div className="flex justify-center py-24 text-ink-3"><Spinner size={28} /></div>
        : state.kind === 'unavailable' ? <Notice icon="link" title={t('public.portal.unavailable')} text={t('public.portal.unavailableText')} />
          : state.kind === 'closed' ? <Notice icon="lock" title={t('public.portal.closed')} text={t('public.portal.closedText')} />
            : state.kind === 'error' ? <Notice icon="warning" tone="warn" title={state.tooMany ? t('public.err.tooMany') : t('public.err.network')} action={<Button size="lg" icon="refresh" onClick={() => setRound((n) => n + 1)}>{t('public.retry')}</Button>} />
              : <Deposit key={round} token={token} storeKey={key} info={state.info} pending={state.pending} status={state.status} head={head!} onRestart={() => { store.del(key); setRound((n) => n + 1); }} />}
    </PublicShell>
  );
}

function PortalHeader({ head, info }: { head: Head; info: PortalInfo | null }) {
  const t = useT();
  const loc = getLocale();
  return (
    <header className="overflow-hidden card">
      <div className="relative overflow-hidden bg-accent px-6 pt-8 pb-7 text-accent-ink after:pointer-events-none after:absolute after:inset-0 after:bg-[radial-gradient(120%_90%_at_100%_0%,rgb(255_255_255/0.28),transparent_60%)] sm:px-8 sm:pt-9 sm:pb-8" style={accentVars(head.brandColor)} data-testid="portal-banner">
        {head.brandName ? <p className="relative z-10 text-[13px] font-bold tracking-[0.08em] uppercase opacity-90">{head.brandName}</p> : null}
        <h1 className="relative z-10 mt-1 text-[30px] leading-[1.1] font-bold tracking-[-0.03em] break-words">{head.title}</h1>
        {head.description ? <p className="relative z-10 mt-2.5 text-[16px] leading-relaxed break-words whitespace-pre-line opacity-95">{head.description}</p> : null}
      </div>
      {info ? (
        <div className="space-y-4 px-5 py-5 sm:px-7">
          {info.instructions ? (
            <section aria-label={t('public.portal.instructions')}>
              <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{t('public.portal.instructions')}</h2>
              <p className="mt-1.5 text-[15px] leading-relaxed break-words whitespace-pre-line text-ink">{info.instructions}</p>
            </section>
          ) : null}
          <section aria-label={t('public.portal.rules')}>
            <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{t('public.portal.rules')}</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-2" data-testid="portal-rules">
              <Rule icon="file">{info.allowedExtensions.length ? t('public.portal.types', { list: info.allowedExtensions.map((e) => e.toUpperCase()).join(', ') }) : t('public.portal.typesAny')}</Rule>
              <Rule icon="upload">{t('public.portal.maxSize', { size: formatBytes(info.maxFileBytes, loc) })} · {t('public.portal.maxFiles', { n: info.maxFiles })}</Rule>
              {info.remainingBytes < info.maxFileBytes * info.maxFiles ? <Rule icon="inbox">{t('public.portal.remaining', { size: formatBytes(info.remainingBytes, loc) })}</Rule> : null}
              {info.expiresAt ? <Rule icon="clock">{t('public.portal.deadline', { date: fmtDate(info.expiresAt) })}</Rule> : null}
            </ul>
          </section>
        </div>
      ) : null}
    </header>
  );
}
const Rule = ({ icon, children }: { icon: string; children: React.ReactNode }) => <li className="flex items-start gap-2.5"><Glyph name={icon} size={17} className="mt-0.5 shrink-0 text-ink-3" /><span className="min-w-0 break-words">{children}</span></li>;

type Phase = 'form' | 'resume' | 'sending' | 'failed' | 'analysing' | 'receipt' | 'closedMid';
interface Row { uploadId: string; name: string; size: number; sent: number; state: 'waiting' | 'sending' | 'done' | 'error' }

function Deposit({ token, storeKey, info, pending: initial, status: initialStatus, head, onRestart }: { token: string; storeKey: string; info: PortalInfo | null; pending: Pending | null; status: StatusOut | null; head: Head; onRestart: () => void }) {
  const t = useT();
  const [pending, setPending] = useState<Pending | null>(initial);
  const [phase, setPhase] = useState<Phase>(() => !initial || !initialStatus ? (initial ? 'resume' : 'form') : initialStatus.status === 'open' ? 'resume' : initialStatus.status === 'processing' ? 'analysing' : 'receipt');
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<StatusOut | null>(initialStatus && (initialStatus.status === 'completed' || initialStatus.status === 'rejected') ? initialStatus : null);
  const files = useRef(new Map<string, File>()); // uploadId → the depositor's file (memory only)
  const abort = useRef<AbortController | null>(null);
  const shut = useRef(false); // the server said the deposit is over: nothing may put the page back in a sending state
  const patch = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.uploadId === id ? { ...r, ...p } : r)));

  /** Send whatever the server does not hold yet, three files at a time, then hand the deposit over for inspection. */
  const run = useCallback(async (p: Pending, resume: boolean) => {
    const ctl = new AbortController(); abort.current = ctl;
    const auth = bearer(p.token);
    setRows((old) => p.items.map((i) => ({ uploadId: i.uploadId, name: i.name, size: i.size, sent: old.find((o) => o.uploadId === i.uploadId)?.sent ?? 0, state: 'waiting' })));
    setPhase('sending');
    const queue = [...p.items];
    let closed = false, failed = false;
    const worker = async () => {
      for (let item = queue.shift(); item && !ctl.signal.aborted; item = queue.shift()) {
        const id = item.uploadId;
        try {
          const startAt = resume ? (await get<{ received: number }>(`/public/uploads/${id}`, { ...auth, signal: ctl.signal })).received : 0;
          patch(id, { state: 'sending', sent: startAt });
          await transfer({ file: files.current.get(id)!, chunkPath: (o) => `/public/uploads/${id}?offset=${o}`, statusPath: `/public/uploads/${id}`, headers: auth.headers, chunkBytes: p.chunkBytes, startAt, signal: ctl.signal, onProgress: (sent) => patch(id, { sent }) });
          patch(id, { state: 'done', sent: item.size });
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
          // refused for good: the portal expired or was revoked (410), or was deleted with its submissions (401/404)
          if (e instanceof ApiError && [401, 404, 410].includes(e.status)) closed = true; else failed = true;
          patch(id, { state: 'error' });
          ctl.abort();
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (shut.current) return;
    if (closed) { store.del(storeKey); setPhase('closedMid'); return; }
    if (failed || ctl.signal.aborted) { setPhase('failed'); return; }
    try { await post('/public/submissions/finalize', undefined, auth); }
    catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) { store.del(storeKey); setPhase('closedMid'); } else setPhase('failed');
      return;
    }
    setPhase('analysing');
  }, [storeKey]);

  // the transfer must not be lost to a stray swipe or a closed tab
  useEffect(() => {
    if (phase !== 'sending') return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);
  useEffect(() => () => abort.current?.abort(), []);
  // A portal revoked or expired during a transfer is noticed within seconds, without waiting for the answer to a block
  // that may still be travelling (a server that refuses early does not always get its answer through to a busy upload).
  useEffect(() => {
    if (phase !== 'sending' || !pending) return;
    const timer = window.setInterval(async () => {
      let over = false;
      try { over = (await get<StatusOut>('/public/submissions/status', bearer(pending.token))).status === 'expired'; }
      catch (e) { over = e instanceof ApiError && [401, 404, 410].includes(e.status); }
      if (!over || shut.current) return;
      shut.current = true; abort.current?.abort(); store.del(storeKey); setPhase('closedMid');
    }, 4000);
    return () => clearInterval(timer);
  }, [phase, pending, storeKey]);

  // inspection: ask every two seconds until every file has its verdict
  useEffect(() => {
    if (phase !== 'analysing' || !pending) return;
    let live = true, timer = 0;
    const tick = async () => {
      try {
        const s = await get<StatusOut>('/public/submissions/status', bearer(pending.token));
        if (!live) return;
        if (s.status === 'completed' || s.status === 'rejected') {
          const done = { ...pending, receivedAt: pending.receivedAt ?? new Date().toISOString() };
          store.set(storeKey, done); setPending(done); setResult(s); setPhase('receipt'); return;
        }
        if (s.status === 'expired') { store.del(storeKey); setPhase('closedMid'); return; }
      } catch (e) { if (live && e instanceof ApiError && [401, 404, 410].includes(e.status)) { store.del(storeKey); setPhase('closedMid'); return; } }
      if (live) timer = window.setTimeout(tick, 2000);
    };
    void tick();
    return () => { live = false; clearTimeout(timer); };
  }, [phase, pending, storeKey]);

  const admitted = (a: Admitted, picked: File[]) => {
    const p: Pending = { v: 1, token: a.submissionToken, ref: a.ref, chunkBytes: info!.chunkBytes, head: { title: head.title, description: head.description, brandName: head.brandName, brandColor: head.brandColor }, items: a.items.map((i, n) => ({ ...i, original: picked[n]!.name })) };
    a.items.forEach((i, n) => files.current.set(i.uploadId, picked[n]!));
    store.set(storeKey, p); setPending(p);
    void run(p, false);
  };

  return (
    <div className="space-y-4">
      <PortalHeader head={head} info={phase === 'form' ? info : null} />
      {phase === 'form' && info ? <DepositForm token={token} info={info} onAdmitted={admitted} /> : null}
      {phase === 'resume' && pending ? <Resume pending={pending} color={head.brandColor} onAbandon={onRestart} onContinue={(m) => { files.current = m; void run(pending, true); }} /> : null}
      {(phase === 'sending' || phase === 'failed') && pending ? <Sending rows={rows} failed={phase === 'failed'} color={head.brandColor} onResume={() => void run(pending, true)} /> : null}
      {phase === 'analysing' ? (
        <section className="card px-6 py-12 text-center" role="status" aria-live="polite" data-testid="analysing">
          <div className="flex justify-center text-ink-2"><Spinner size={30} /></div>
          <h2 className="mt-4 text-lg font-semibold">{t('public.portal.analysing')}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-2">{t('public.portal.analysingText')}</p>
        </section>
      ) : null}
      {phase === 'closedMid' ? <Notice icon="lock" tone="warn" title={t('public.portal.closedMid')} text={t('public.portal.closedMidText')} /> : null}
      {phase === 'receipt' && pending && result ? <Receipt pending={pending} result={result} color={head.brandColor} onAnother={onRestart} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- the form ----------------------------------------------------------------
function DepositForm({ token, info, onAdmitted }: { token: string; info: PortalInfo; onAdmitted: (a: Admitted, files: File[]) => void }) {
  const t = useT();
  const loc = getLocale();
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), photoInput = useRef<HTMLInputElement>(null), formRef = useRef<HTMLFormElement>(null);
  const touch = useMemo(isTouch, []);
  const imagesOk = !info.allowedExtensions.length || ['jpg', 'jpeg', 'heic', 'png'].some((e) => info.allowedExtensions.includes(e));

  const set = (k: string, v: string) => { setValues((s) => ({ ...s, [k]: v })); if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest); };
  /** Why a file cannot be sent, or null. Checked before anything leaves the device. */
  const problem = (f: File): string | null => {
    const ext = serverExt(f.name);
    if (BLOCKED_EXT.has(ext)) return t('public.portal.fileBlocked', { ext });
    if (info.allowedExtensions.length && !info.allowedExtensions.includes(ext)) return ext ? t('public.portal.fileType', { ext }) : t('public.portal.fileTypeNone');
    if (f.size === 0) return t('public.portal.fileEmpty');
    if (f.size > info.maxFileBytes) return t('public.portal.fileTooLarge', { size: formatBytes(f.size, loc), max: formatBytes(info.maxFileBytes, loc) });
    return null;
  };
  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = [...list]; // copied now: the input's FileList is emptied right after this call
    setPicked((cur) => { const seen = new Set(cur.map(fileKey)); return [...cur, ...incoming.filter((f) => !seen.has(fileKey(f)) && seen.add(fileKey(f)))]; });
    setBanner(null); setErrors(({ files: _, ...rest }) => rest);
  };
  const invalid = picked.filter((f) => problem(f));
  const total = picked.reduce((n, f) => n + f.size, 0);
  const listError = picked.length > info.maxFiles ? t('public.portal.tooMany', { max: info.maxFiles, n: picked.length })
    : total > info.remainingBytes ? t('public.portal.overTotal', { size: formatBytes(total, loc), max: formatBytes(info.remainingBytes, loc) })
      : invalid.length ? t('public.portal.fixFiles') : errors.files ?? null;

  const fieldDefs = [
    ...(['name', 'email', 'reference'] as const).filter((k) => info.fields[k] !== 'off').map((k) => ({ key: k, label: t(`public.portal.${k}`), required: info.fields[k] === 'required', builtin: true })),
    ...info.fields.custom.map((c) => ({ key: `c:${c.key}`, label: c.label, required: c.required, builtin: false })),
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (info.needsPassword && !values.password) errs.password = t('public.err.passwordRequired');
    for (const f of fieldDefs) if (f.required && !(values[f.key] ?? '').trim()) errs[f.key] = t('public.portal.required');
    const email = (values.email ?? '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = t('public.portal.emailInvalid');
    if (!picked.length) errs.files = t('public.portal.noFiles');
    if (info.requireConsent && !consent) errs.consent = t('public.portal.consentRequired');
    setErrors(errs); setBanner(null);
    if (Object.keys(errs).length || listError) {
      requestAnimationFrame(() => (formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? formRef.current?.querySelector<HTMLElement>('[data-list-error]'))?.focus());
      return;
    }
    setBusy(true);
    try {
      const custom: Record<string, string> = {};
      for (const c of info.fields.custom) { const v = (values[`c:${c.key}`] ?? '').trim(); if (v) custom[c.key] = v; }
      const a = await post<Admitted>(`/public/requests/${token}/submissions`, {
        password: info.needsPassword ? values.password : undefined, name: (values.name ?? '').trim(), email, reference: (values.reference ?? '').trim(), custom, consent,
        files: picked.map((f) => ({ name: f.name, size: f.size })),
      });
      onAdmitted(a, picked);
    } catch (err) {
      setBusy(false);
      const x = err instanceof ApiError ? err : new ApiError(0, 'network', '');
      const fe: Record<string, string> = {};
      if (x.code === 'password_invalid') fe.password = t('public.err.passwordInvalid');
      else if (x.code === 'password_required') fe.password = t('public.err.passwordRequired');
      else if (x.code === 'field_required') { const k = String(x.data.field ?? ''); fe[['name', 'email', 'reference'].includes(k) ? k : `c:${k}`] = t('public.portal.required'); }
      else if (x.code === 'consent_required') fe.consent = t('public.portal.consentRequired');
      else if (x.code === 'invalid_request' && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) && email) fe.email = t('public.portal.emailInvalid');
      if (Object.keys(fe).length) { setErrors(fe); requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
      setBanner(x.code === 'too_many_files' ? t('public.portal.serverTooMany', { max: x.data.max ?? info.maxFiles }) : x.code === 'type_not_allowed' ? t('public.portal.serverType', { name: x.data.name ?? '' })
        : x.code === 'file_too_large' ? t('public.portal.serverTooLarge', { name: x.data.name ?? '' }) : x.code === 'portal_full' ? t('public.portal.full')
          : x.code === 'too_many_attempts' ? t('public.err.tooMany') : x.status === 429 ? t('public.portal.rate')
            : x.status === 410 ? t('public.portal.closed') : x.status === 404 ? t('public.portal.unavailable') : x.status === 0 ? t('public.err.network') : t('public.err.generic'));
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-4" aria-labelledby={`${formId}-h`}>
      <h2 id={`${formId}-h`} className="sr-only">{t('public.portal.title')}</h2>
      {info.needsPassword || fieldDefs.length ? (
        <section className="space-y-4 card px-5 py-5 sm:px-7">
          {info.needsPassword ? <PField label={t('public.password')} type="password" required autoComplete="off" value={values.password ?? ''} onChange={(e) => set('password', e.target.value)} error={errors.password} hint={t('public.portal.passwordHint')} /> : null}
          {fieldDefs.map((f) => (
            <PField key={f.key} label={f.label} required={f.required} optional={t('public.optional')} value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} error={errors[f.key]}
              maxLength={f.builtin ? (f.key === 'email' ? 200 : 120) : 500} hint={f.key === 'reference' ? t('public.portal.referenceHint') : undefined}
              type={f.key === 'email' ? 'email' : 'text'} inputMode={f.key === 'email' ? 'email' : undefined} autoComplete={f.key === 'name' ? 'name' : f.key === 'email' ? 'email' : 'off'} autoCapitalize={f.key === 'email' ? 'none' : undefined} />
          ))}
          {info.needsPassword || fieldDefs.some((f) => f.required) ? <p className="text-xs text-ink-3">{t('public.portal.requiredLegend')}</p> : null}
        </section>
      ) : null}

      <section className="card px-5 py-5 sm:px-7" aria-label={t('public.portal.files')}>
        <h2 className="text-sm font-medium text-ink">{t('public.portal.files')}<span aria-hidden="true" className="text-danger"> *</span></h2>
        <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="file-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <input ref={photoInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="photo-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <div data-testid="dropzone" onClick={(e) => { if (e.target === e.currentTarget) fileInput.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          className={cx('mt-3 flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 text-center transition', picked.length ? 'py-5' : 'py-9', over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-bg')}>
          {picked.length ? null : <div className="pointer-events-none flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-ink-2 shadow-sm"><Glyph name="upload" size={24} /></div>}
          <p className="pointer-events-none text-[15px] font-medium text-ink">{over ? t('public.portal.dropActive') : touch ? t('public.portal.dropTouch') : t('public.portal.drop')}</p>
          <div className="flex w-full flex-col items-stretch justify-center gap-2 sm:w-auto sm:flex-row">
            <Button size="lg" icon={picked.length ? 'plus' : 'file'} onClick={() => fileInput.current?.click()}>{picked.length ? t('public.portal.addMore') : t('public.portal.choose')}</Button>
            {touch && imagesOk ? <Button size="lg" icon="camera" onClick={() => photoInput.current?.click()}>{t('public.portal.photo')}</Button> : null}
          </div>
        </div>
        {picked.length ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-2" aria-live="polite">{t('public.portal.selected', { n: picked.length, size: formatBytes(total, loc) })}</p>
              {invalid.length ? <Button size="sm" variant="ghost" icon="trash" onClick={() => setPicked((c) => c.filter((f) => !problem(f)))}>{t('public.portal.removeInvalid')}</Button> : null}
            </div>
            <ul className="mt-2 divide-y divide-line rounded-2xl border border-line" data-testid="picked">
              {picked.map((f) => {
                const bad = problem(f);
                return (
                  <li key={fileKey(f)} className="flex items-center gap-3 py-2 pr-1 pl-3" data-invalid={bad ? 'true' : undefined}>
                    <Glyph name={bad ? 'warning' : 'file'} size={20} className={cx('shrink-0', bad ? 'text-danger' : 'text-ink-3')} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{f.name}</p>
                      {bad ? <p className="text-sm text-danger">{bad}</p> : <p className="text-xs text-ink-3">{formatBytes(f.size, loc)}</p>}
                    </div>
                    <button type="button" aria-label={t('public.portal.remove', { name: f.name })} onClick={() => setPicked((c) => c.filter((x) => x !== f))}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-2 hover:bg-hover hover:text-ink"><Glyph name="x" size={18} /></button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {listError ? <p role="alert" tabIndex={-1} data-list-error className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger outline-none">{listError}</p> : null}
      </section>

      {info.requireConsent || info.retentionNote ? (
        <section className="space-y-3 card px-5 py-5 sm:px-7">
          {info.requireConsent ? (
            <div>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setErrors(({ consent: _, ...rest }) => rest); }} aria-invalid={!!errors.consent || undefined} aria-describedby={errors.consent ? `${formId}-c` : undefined}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" />
                <span className="min-w-0 text-[15px] leading-relaxed break-words whitespace-pre-line text-ink">{info.consentText || t('public.portal.consentDefault')}<span aria-hidden="true" className="text-danger"> *</span></span>
              </label>
              {errors.consent ? <p id={`${formId}-c`} role="alert" className="mt-1.5 pl-8 text-sm text-danger">{errors.consent}</p> : null}
            </div>
          ) : null}
          {info.retentionNote ? <p className="text-xs leading-relaxed break-words whitespace-pre-line text-ink-3"><span className="font-semibold">{t('public.portal.retention')} — </span>{info.retentionNote}</p> : null}
        </section>
      ) : null}

      {banner ? <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger" data-testid="submit-error">{banner}</p> : null}
      <Button type="submit" variant="primary" size="lg" busy={busy} icon="upload" className="h-14! w-full text-base!" style={accentVars(info.brandColor)}>
        {picked.length ? t('public.portal.sendN', { n: picked.length }) : t('public.portal.send')}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- transfer ----------------------------------------------------------------
function Sending({ rows, failed, color, onResume }: { rows: Row[]; failed: boolean; color: string; onResume: () => void }) {
  const t = useT();
  const loc = getLocale();
  const total = rows.reduce((n, r) => n + r.size, 0), sent = rows.reduce((n, r) => n + Math.min(r.sent, r.size), 0);
  return (
    <section className="card px-5 py-5 sm:px-7" data-testid="sending">
      <h2 className="text-lg font-semibold">{failed ? t('public.portal.failed') : t('public.portal.sending')}</h2>
      {failed ? (
        <div role="alert" className="mt-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <p>{t('public.portal.failedText')}</p>
          <Button className="mt-3" variant="primary" icon="refresh" onClick={onResume}>{t('public.portal.resumeBtn')}</Button>
        </div>
      ) : <p className="mt-2 flex items-start gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn" data-testid="keep-open"><Glyph name="warning" size={18} className="mt-px shrink-0" />{t('public.portal.keepOpen')}</p>}
      <div className="mt-5" style={accentVars(color)}>
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm"><span className="font-medium">{t('public.portal.overall')}</span><span className="text-ink-2 tabular-nums">{t('public.portal.sentOf', { sent: formatBytes(sent, loc), total: formatBytes(total, loc) })} · {total ? Math.floor((sent / total) * 100) : 0} %</span></div>
        <ProgressBar value={total ? sent / total : 0} label={t('public.portal.overall')} />
      </div>
      <ul className="mt-5 space-y-3.5" style={accentVars(color)}>
        {rows.map((r) => (
          <li key={r.uploadId}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{r.name}</span>
              <span className={cx('flex shrink-0 items-center gap-1 text-xs', r.state === 'done' ? 'text-ok' : r.state === 'error' ? 'text-warn' : 'text-ink-3')}>
                {r.state === 'done' ? <><Glyph name="check" size={14} />{t('public.portal.sent')}</> : r.state === 'error' ? t('public.portal.fileError') : r.state === 'waiting' ? t('public.portal.waiting') : `${Math.floor((r.sent / r.size) * 100)} %`}
              </span>
            </div>
            <ProgressBar value={r.size ? r.sent / r.size : 0} label={t('public.portal.fileProgress', { name: r.name })} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** After a reload in the middle of a transfer: the browser has forgotten the files, the server has not forgotten the bytes. */
function Resume({ pending, color, onContinue, onAbandon }: { pending: Pending; color: string; onContinue: (files: Map<string, File>) => void; onAbandon: () => void }) {
  const t = useT();
  const loc = getLocale();
  const [found, setFound] = useState<Map<string, File>>(new Map());
  const [mismatch, setMismatch] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) => {
    if (!list) return;
    const next = new Map(found); let miss: string | null = null;
    for (const f of list) { const item = pending.items.find((i) => !next.has(i.uploadId) && i.original === f.name && i.size === f.size); if (item) next.set(item.uploadId, f); else if (![...next.values()].includes(f)) miss = f.name; }
    setFound(next); setMismatch(miss);
  };
  return (
    <section className="card px-5 py-5 sm:px-7" data-testid="resume">
      <h2 className="text-lg font-semibold">{t('public.portal.resume')}</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{t('public.portal.resumeText', { ref: pending.ref })}</p>
      <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
        {pending.items.map((i) => (
          <li key={i.uploadId} className="flex items-center gap-3 px-3 py-2.5">
            <Glyph name={found.has(i.uploadId) ? 'check' : 'file'} size={18} className={found.has(i.uploadId) ? 'text-ok' : 'text-ink-3'} />
            <span className="min-w-0 flex-1 truncate text-sm">{i.original}</span>
            <span className="shrink-0 text-xs text-ink-3">{formatBytes(i.size, loc)} · {found.has(i.uploadId) ? t('public.portal.resumeFound') : t('public.portal.resumeMissing')}</span>
          </li>
        ))}
      </ul>
      {mismatch ? <p role="alert" className="mt-3 text-sm text-danger">{t('public.portal.resumeMismatch', { name: mismatch })}</p> : null}
      <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="resume-input" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {found.size < pending.items.length ? <Button size="lg" icon="file" onClick={() => input.current?.click()}>{t('public.portal.resumeChoose')}</Button>
          : <Button size="lg" variant="primary" icon="upload" style={accentVars(color)} onClick={() => onContinue(found)}>{t('public.portal.resumeGo')}</Button>}
        <Button size="lg" variant="ghost" onClick={onAbandon}>{t('public.portal.resumeAbandon')}</Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- receipt ----------------------------------------------------------------
function Receipt({ pending, result, color, onAnother }: { pending: Pending; result: StatusOut; color: string; onAnother: () => void }) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { heading.current?.focus(); window.scrollTo({ top: 0 }); }, []);
  const ok = result.items.filter((i) => i.status === 'accepted').length, ko = result.items.filter((i) => i.status === 'rejected').length;
  const none = ok === 0;
  return (
    <section className="card px-5 py-7 sm:px-7" data-testid="receipt">
      <div className="text-center">
        <div className={cx('mx-auto flex h-14 w-14 items-center justify-center rounded-full', none ? 'bg-danger-soft text-danger' : ko ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}><Glyph name={none ? 'x' : ko ? 'warning' : 'check'} size={30} /></div>
        <h2 ref={heading} tabIndex={-1} className="mt-4 text-xl font-semibold outline-none">{none ? t('public.portal.receiptNone') : ko ? t('public.portal.receiptPartial') : t('public.portal.receipt')}</h2>
        {none ? <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">{t('public.portal.receiptNoneText')}</p> : null}
        {result.confirmationMessage ? <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed break-words whitespace-pre-line text-ink" data-testid="confirmation">{result.confirmationMessage}</p> : null}
      </div>
      <div className="mt-6 rounded-2xl bg-bg px-4 py-4 text-center">
        <p className="text-xs font-semibold tracking-wide text-ink-3 uppercase">{t('public.portal.refLabel')}</p>
        <p className="mt-1 font-mono text-3xl font-semibold tracking-wider select-all" data-testid="receipt-ref">{result.ref}</p>
        <div className="mt-3 flex justify-center"><Button size="sm" icon={copied ? 'check' : 'copy'} onClick={async () => { if (await copyText(result.ref)) { setCopied(true); setTimeout(() => setCopied(false), 1800); } }}>{copied ? t('common.copied') : t('public.portal.copyRef')}</Button></div>
        <p className="mt-3 text-xs text-ink-3">{t('public.portal.refHint')}</p>
        {pending.receivedAt ? <p className="mt-1 text-xs text-ink-3">{t('public.portal.date', { date: fmtDate(pending.receivedAt) })}</p> : null}
      </div>
      <p className="mt-6 text-sm font-medium">{t('public.portal.summary', { ok, ko })}</p>
      <ul className="mt-2 divide-y divide-line rounded-2xl border border-line" data-testid="receipt-files">
        {result.items.map((i, n) => (
          <li key={n} className="flex items-start gap-3 px-3 py-3" data-status={i.status}>
            <Glyph name={i.status === 'accepted' ? 'check' : i.status === 'rejected' ? 'x' : 'clock'} size={20} className={cx('mt-0.5 shrink-0', i.status === 'accepted' ? 'text-ok' : i.status === 'rejected' ? 'text-danger' : 'text-ink-3')} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium break-words">{i.name}</p>
              <p className={cx('text-sm', i.status === 'accepted' ? 'text-ok' : i.status === 'rejected' ? 'text-danger' : 'text-ink-3')}>
                {i.status === 'accepted' ? t('public.portal.accepted') : i.status === 'rejected' ? `${t('public.portal.rejected')} — ${t(`public.reason.${REASONS.includes(i.reason ?? '') ? i.reason : 'other'}`)}` : t('public.portal.pending')}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <Button size="lg" className="mt-6 w-full" icon="plus" onClick={onAnother} style={accentVars(color)}>{t('public.portal.another')}</Button>
    </section>
  );
}
