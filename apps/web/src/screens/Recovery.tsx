// Lost every passkey: an e-mail address and a recovery code (plus the authenticator code when enabled) open a short
// session whose only use is to enrol a new passkey.
import { startRegistration } from '@simplewebauthn/browser';
import { type FormEvent, useState } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { post } from '../api.ts';
import { errorText, useT } from '../i18n.ts';
import { deviceLabel, passkeysSupported, useAuth, useRefreshAuth } from '../session.ts';
import { Alert, AuthFrame, linkCls, useSignOut } from '../shell/account-ui.tsx';
import { Button, ErrorState, Loading, TextField } from '../ui.tsx';

function Enrol({ email }: { email?: string }) {
  const t = useT();
  const refresh = useRefreshAuth();
  const signOut = useSignOut();
  const [, navigate] = useLocation();
  const [label, setLabel] = useState(deviceLabel());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const supported = passkeysSupported();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setFailure(null); setCancelled(false);
    try {
      // A recovery session needs no re-authentication, so the endpoints are called directly.
      const o = await post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/account/passkeys/options');
      const response = await startRegistration({ optionsJSON: o.options });
      await post('/account/passkeys/verify', { challengeId: o.challengeId, response, label: label.trim() });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === 'NotAllowedError' || name === 'AbortError') setCancelled(true);
      else if (name === 'InvalidStateError') setFailure(t('account.recovery.alreadyRegistered'));
      else setFailure(errorText(err));
      setBusy(false);
    }
  };
  return (
    <AuthFrame title={t('account.recovery.enrolTitle')} subtitle={<>{t('account.recovery.enrolText')}{email ? <> <strong className="font-semibold break-all text-ink">{email}</strong></> : null}</>}
      footer={<button type="button" className={linkCls} onClick={() => void signOut()}>{t('account.recovery.abandon')}</button>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {!supported ? <Alert tone="warn">{t('account.login.unsupported')}</Alert> : null}
        {failure ? <Alert>{failure}</Alert> : null}
        <TextField label={t('account.passkey.name')} hint={t('account.passkey.nameHint')} value={label} onChange={(e) => setLabel(e.currentTarget.value)} maxLength={60} autoComplete="off" />
        <Button type="submit" variant="primary" size="lg" icon="key" busy={busy} disabled={!supported} className="w-full">{t('account.recovery.enrolButton')}</Button>
        {cancelled ? <p role="status" className="text-center text-sm text-ink-2">{t('account.login.cancelled')}</p> : null}
        <p className="text-xs leading-relaxed text-ink-3">{t('account.recovery.enrolNote')}</p>
      </form>
    </AuthFrame>
  );
}

export function Recovery() {
  const t = useT();
  const { state, loading, error, refetch } = useAuth();
  const refresh = useRefreshAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (error && !state) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (state?.authenticated && state.recovery) return <Enrol email={state.user?.email} />;
  if (state?.authenticated) return <Redirect to="/" replace />;
  const ready = email.trim().length > 2 && code.trim().length >= 8;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setFailure(null);
    try {
      await post('/auth/recovery', { email: email.trim(), code: code.trim(), ...(totp.trim() ? { totp: totp.trim() } : {}) });
      await refresh();
    } catch (err) { setFailure(errorText(err)); }
    setBusy(false);
  };
  return (
    <AuthFrame title={t('account.recovery.title')} subtitle={t('account.recovery.subtitle')} footer={<Link href="/login" className={linkCls}>{t('account.recovery.backToLogin')}</Link>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {failure ? <Alert>{failure}</Alert> : null}
        <TextField label={t('account.recovery.email')} type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="email" inputMode="email" autoCapitalize="off" maxLength={200} required autoFocus />
        <TextField label={t('account.recovery.code')} hint={t('account.recovery.codeHint')} value={code} onChange={(e) => setCode(e.currentTarget.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={40} required className="font-mono tracking-wide" placeholder="XXXX-XXXX-XXXX-XXXX" />
        <TextField label={t('account.recovery.totp')} hint={t('account.recovery.totpHint')} value={totp} onChange={(e) => setTotp(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" inputMode="numeric" maxLength={6} className="font-mono tracking-widest" />
        <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!ready} className="w-full">{t('account.recovery.button')}</Button>
      </form>
    </AuthFrame>
  );
}
