// Who is signed in, and the passkey ceremonies. Screens never call WebAuthn directly.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, get, post } from './api.ts';
import type { AuthState } from './types.ts';

export const AUTH_KEY = ['auth'];
export function useAuth() {
  const q = useQuery({ queryKey: AUTH_KEY, queryFn: () => get<AuthState>('/auth/state'), staleTime: 30_000 });
  return { state: q.data, loading: q.isLoading, error: q.error, refetch: q.refetch };
}
export function useRefreshAuth() { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: AUTH_KEY }); }

/** The user dismissed the system passkey sheet, or the device has no usable passkey. */
export class PasskeyCancelled extends Error {}
const ceremony = async <T>(fn: () => Promise<T>): Promise<T> => {
  try { return await fn(); } catch (e) {
    const name = (e as Error)?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') throw new PasskeyCancelled('cancelled');
    throw e;
  }
};
export const passkeysSupported = () => typeof window.PublicKeyCredential === 'function';

export async function signIn(): Promise<void> {
  const o = await post<{ challengeId: string; options: any }>('/auth/login/options');
  const response = await ceremony(() => startAuthentication({ optionsJSON: o.options }));
  await post('/auth/login/verify', { challengeId: o.challengeId, response });
}
export async function register(invite: string, displayName: string, label: string): Promise<string[]> {
  const o = await post<{ challengeId: string; options: any }>('/auth/register/options', { invite, displayName });
  const response = await ceremony(() => startRegistration({ optionsJSON: o.options }));
  return (await post<{ recoveryCodes: string[] }>('/auth/register/verify', { invite, challengeId: o.challengeId, response, label })).recoveryCodes;
}
export async function reauthenticate(): Promise<void> {
  const o = await post<{ challengeId: string; options: any }>('/auth/reauth/options');
  const response = await ceremony(() => startAuthentication({ optionsJSON: o.options }));
  await post('/auth/reauth/verify', { challengeId: o.challengeId, response });
}
export async function addPasskey(label: string): Promise<void> {
  const o = await withFreshAuth(() => post<{ challengeId: string; options: any }>('/account/passkeys/options'));
  const response = await ceremony(() => startRegistration({ optionsJSON: o.options }));
  await post('/account/passkeys/verify', { challengeId: o.challengeId, response, label });
}
/** Run a sensitive call; when the server asks for a recent passkey confirmation, do it and retry once. */
export async function withFreshAuth<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'reauth_required') throw e;
    await reauthenticate();
    return fn();
  }
}
/** A readable default name for a new passkey, from the device. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Macintosh/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : 'Appareil';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [device, browser].filter(Boolean).join(' · ');
}
