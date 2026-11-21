/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/screens/LinkDevice.tsx
 * Module           : screens
 * Repository       : https://git.spboucher.ai/sp-drive
 * Project Website  : https://drive.spboucher.ai
 * Created          : 2026-11-18
 * Last Modified    : 2026-11-18
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

// Linking a native application: the app shows a short code, the owner approves it here with a passkey. The app then
// receives its own device session; nothing typed here ever reaches the device.
import { type FormEvent, useState } from 'react';
import { Link, Redirect, useSearch } from 'wouter';
import { get, post } from '../api.ts';
import { errorText, fmtRelative, useT } from '../i18n.ts';
import { PasskeyCancelled, useAuth, withFreshAuth } from '../session.ts';
import { Alert, AuthFrame, linkCls } from '../shell/account-ui.tsx';
import { Button, ErrorState, Loading, TextField } from '../ui.tsx';

interface Pending { code: string; name: string; ip: string; createdAt: string }
const clean = (raw: string) => { const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s; };

export function LinkDevice() {
  const t = useT();
  const { state, loading, error, refetch } = useAuth();
  const initial = clean(new URLSearchParams(useSearch()).get('code') ?? '');
  const [code, setCode] = useState(initial);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<'approved' | 'denied' | null>(null);
  if (loading) return <Loading />;
  if (error && !state) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!state?.authenticated) return <Redirect to={`/login?next=${encodeURIComponent(initial ? `/appareil?code=${initial}` : '/appareil')}`} replace />;
  if (state.recovery) return <Redirect to="/recovery" replace />;

  const find = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setFailure(null);
    try { const info = await get<{ name: string; ip: string; createdAt: string }>(`/auth/device/info?code=${encodeURIComponent(code)}`); setPending({ code, ...info }); }
    catch (err) { setFailure((err as { code?: string }).code === 'device_code_invalid' ? t('account.link.unknown') : errorText(err)); }
    setBusy(false);
  };
  const decide = async (approve: boolean) => {
    setBusy(true); setFailure(null);
    try {
      const call = () => post('/auth/device/decide', { code: pending!.code, approve });
      await (approve ? withFreshAuth(call) : call());
      setDone(approve ? 'approved' : 'denied');
    } catch (err) {
      if (!(err instanceof PasskeyCancelled)) { setFailure((err as { code?: string }).code === 'device_code_invalid' ? t('account.link.unknown') : errorText(err)); if ((err as { code?: string }).code === 'device_code_invalid') setPending(null); }
    }
    setBusy(false);
  };
  const footer = <Link href="/" className={linkCls}>{t('account.link.back')}</Link>;

  if (done) return (
    <AuthFrame title={t(done === 'approved' ? 'account.link.approved' : 'account.link.denied')} subtitle={t(done === 'approved' ? 'account.link.approvedText' : 'account.link.deniedText')} footer={footer}>
      <p role="status" className="text-sm text-ink-2" data-testid="link-result" data-result={done}>{pending?.name}</p>
    </AuthFrame>
  );
  if (pending) return (
    <AuthFrame title={t('account.link.confirmTitle')} subtitle={t('account.link.confirmText', { name: pending.name })} footer={footer}>
      <div className="flex flex-col gap-4">
        {failure ? <Alert>{failure}</Alert> : null}
        <Alert tone="warn">{t('account.link.warn')}</Alert>
        <p className="text-xs leading-relaxed text-ink-3">{t('account.link.from', { ip: pending.ip || '—', when: fmtRelative(pending.createdAt) })}</p>
        <Button variant="primary" size="lg" icon="key" busy={busy} onClick={() => void decide(true)} className="w-full" data-autofocus>{t('account.link.approve')}</Button>
        <Button size="lg" disabled={busy} onClick={() => void decide(false)} className="w-full">{t('account.link.deny')}</Button>
      </div>
    </AuthFrame>
  );
  return (
    <AuthFrame title={t('account.link.title')} subtitle={t('account.link.subtitle')} footer={footer}>
      <form onSubmit={find} className="flex flex-col gap-4" noValidate>
        {failure ? <Alert>{failure}</Alert> : null}
        <TextField label={t('account.link.code')} hint={t('account.link.codeHint')} value={code} onChange={(e) => setCode(clean(e.currentTarget.value))} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          inputMode="text" maxLength={9} className="text-center font-mono text-xl tracking-[0.3em]" data-autofocus />
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={code.length !== 9} className="w-full">{t('account.link.find')}</Button>
      </form>
    </AuthFrame>
  );
}
