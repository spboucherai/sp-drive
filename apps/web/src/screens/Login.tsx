/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : apps/web/src/screens/Login.tsx
 * Module           : screens
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

// Sign-in: one button, the passkey. Nothing biometric ever leaves the device; the page says so.
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { get } from '../api.ts';
import { Link, Redirect, useLocation, useSearch } from 'wouter';
import { errorText, setLocale, useT } from '../i18n.ts';
import { AUTH_KEY, PasskeyCancelled, passkeysSupported, signIn, useAuth } from '../session.ts';
import { Alert, AuthFrame, linkCls } from '../shell/account-ui.tsx';
import type { AuthState } from '../types.ts';
import { Button, ErrorState, Loading } from '../ui.tsx';

/** Only a path of this site may follow the sign-in. */
export const safeNext = (raw: string | null): string => (raw && /^\/(?![/\\])/.test(raw) && !/^\/(login|recovery|invite)(\/|\?|$)/.test(raw) ? raw : '/');

export function Login() {
  const t = useT();
  const qc = useQueryClient();
  const { state, loading, error, refetch } = useAuth();
  const [, navigate] = useLocation();
  const next = safeNext(new URLSearchParams(useSearch()).get('next'));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  if (loading) return <Loading />;
  if (error && !state) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (state?.authenticated && !busy) return <Redirect to={state.recovery ? '/recovery' : next} replace />;
  const supported = passkeysSupported();
  const go = async () => {
    setBusy(true); setFailure(null); setCancelled(false);
    try {
      await signIn();
      const s = await get<AuthState>('/auth/state');
      qc.setQueryData(AUTH_KEY, s);
      if (s.user?.locale === 'fr' || s.user?.locale === 'en') setLocale(s.user.locale);
      navigate(next, { replace: true });
    } catch (e) {
      if (e instanceof PasskeyCancelled) setCancelled(true); else setFailure(errorText(e));
      setBusy(false);
    }
  };
  return (
    <AuthFrame title={t('account.login.title')} subtitle={t('account.login.subtitle')}
      footer={<Link href="/recovery" className={linkCls}>{t('account.login.recovery')}</Link>}>
      <div className="flex flex-col gap-4">
        {!supported ? <Alert tone="warn">{t('account.login.unsupported')}</Alert> : null}
        {failure ? <Alert>{failure}</Alert> : null}
        <Button variant="primary" size="lg" icon="key" busy={busy} disabled={!supported} onClick={go} className="w-full" data-autofocus>{t('account.login.button')}</Button>
        {cancelled ? <p role="status" className="text-center text-sm text-ink-2">{t('account.login.cancelled')}</p> : null}
        <p className="text-xs leading-relaxed text-ink-3">{t('account.login.hint')}</p>
      </div>
    </AuthFrame>
  );
}
