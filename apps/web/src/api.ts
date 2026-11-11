// One place for every call to the API: same-origin, cookies, the CSRF header, and errors with a stable code.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, any> = {}) { super(message); }
}
export interface CallOptions { headers?: Record<string, string>; signal?: AbortSignal }

async function parse<T>(res: Response): Promise<T> {
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'http_error', body?.message ?? `HTTP ${res.status}`, body ?? {});
  return body as T;
}
export async function api<T = unknown>(method: string, path: string, body?: unknown, o: CallOptions = {}): Promise<T> {
  const raw = body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
  const res = await fetch(`/api/v1${path}`, {
    method, credentials: 'same-origin', signal: o.signal,
    headers: { ...(method !== 'GET' ? { 'X-SPD-CSRF': '1' } : {}), ...(raw ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...o.headers },
    body: raw ? (body as BodyInit) : body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
  }).catch((e: Error) => { if (e.name === 'AbortError') throw e; throw new ApiError(0, 'network', 'network error'); });
  if (res.status === 401 && !path.startsWith('/public/') && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('spd:unauthenticated', { detail: await res.clone().json().catch(() => ({})) }));
  return parse<T>(res);
}
export const get = <T = unknown>(path: string, o?: CallOptions) => api<T>('GET', path, undefined, o);
export const post = <T = unknown>(path: string, body?: unknown, o?: CallOptions) => api<T>('POST', path, body, o);
export const patch = <T = unknown>(path: string, body?: unknown, o?: CallOptions) => api<T>('PATCH', path, body, o);
export const del = <T = unknown>(path: string, o?: CallOptions) => api<T>('DELETE', path, undefined, o);
/** Query string from an object, skipping empty values. */
export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
export const sha256Hex = async (data: BufferSource): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
