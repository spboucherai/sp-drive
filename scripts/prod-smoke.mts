// Smoke test against a deployed instance with a throw-away account: sign-up by passkey (virtual authenticator),
// upload, previews through the sandboxed converters, antivirus, share link, anonymous portal deposit.
// Usage: pnpm exec tsx scripts/prod-smoke.mts <base-url> <invite-url>     Prints one line per check; exits 1 on failure.
import { readFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';

const [base, invite] = process.argv.slice(2);
if (!base || !invite) { console.error('usage: prod-smoke.mts <base-url> <invite-url>'); process.exit(2); }
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const fx = (n: string) => [...readFileSync(new URL(`../tests/e2e/fixtures/${n}`, import.meta.url))];
const EICAR = [...Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')];

const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: base });
await ctx.addInitScript('globalThis.__name = (f) => f'); // tsx keeps function names with a helper the page does not have
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
await page.goto('/pwa/favicon.svg');
const call = (p: Page, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => p.evaluate(async ([m, u, b, h]) => {
  const raw = Array.isArray(b);
  const r = await fetch(`/api/v1${u}`, { method: m as string, headers: { 'X-SPD-CSRF': '1', 'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...(h as Record<string, string>) },
    body: m === 'GET' ? undefined : raw ? new Uint8Array(b as number[]) : JSON.stringify(b ?? {}) });
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : (await r.arrayBuffer()).byteLength };
}, [method, path, body, headers] as const);
const upload = async (p: Page, folderId: string, name: string, data: number[]) => {
  const u = await call(p, 'POST', '/uploads', { folderId, name, size: data.length });
  await call(p, 'PATCH', `/uploads/${u.body.id}?offset=0`, data);
  return (await call(p, 'POST', `/uploads/${u.body.id}/complete`)).body.file;
};
const until = async (fn: () => Promise<boolean>, ms = 90_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 1500)); } return false; };

// --- account ---
const token = invite.split('/').pop()!;
const reg = await page.evaluate(async (inv) => {
  const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const un = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const post = async (path: string, body: unknown) => { const r = await fetch(`/api/v1${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SPD-CSRF': '1' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const o = await post('/auth/register/options', { invite: inv, displayName: 'Smoke test' });
  if (o.status !== 200) return o;
  const pk = o.body.options;
  const cred = (await navigator.credentials.create({ publicKey: { ...pk, challenge: un(pk.challenge), user: { ...pk.user, id: un(pk.user.id) }, excludeCredentials: [] } })) as PublicKeyCredential;
  const r = cred.response as AuthenticatorAttestationResponse;
  return post('/auth/register/verify', { invite: inv, challengeId: o.body.challengeId, label: 'smoke', response: { id: cred.id, rawId: b64(cred.rawId), type: cred.type, clientExtensionResults: {}, response: { clientDataJSON: b64(r.clientDataJSON), attestationObject: b64(r.attestationObject), transports: ['internal'] } } });
}, token);
check('passkey registration on the real origin', reg.status === 200, JSON.stringify(reg.body).slice(0, 120));
const cookies = await ctx.cookies();
const sess = cookies.find((c) => c.name === '__Host-spd');
check('session cookie is __Host-, HttpOnly, Secure, SameSite=Lax', !!sess && sess.httpOnly && sess.secure && sess.sameSite === 'Lax');
const root = (await call(page, 'GET', '/folders/root')).body.folder.id;

// --- files, previews, antivirus ---
const folder = (await call(page, 'POST', '/folders', { parentId: root, name: 'Smoke' })).body;
const docx = await upload(page, folder.id, 'sample.docx', fx('sample.docx'));
const png = await upload(page, folder.id, 'sample.png', fx('sample.png'));
const heic = await upload(page, folder.id, 'sample.heic', fx('sample.heic'));
const xlsx = await upload(page, folder.id, 'sample.xlsx', fx('sample.xlsx'));
const virus = await upload(page, folder.id, 'eicar.txt', EICAR);
check('uploads stored', [docx, png, heic, xlsx, virus].every((f) => f?.id));
const ready = async (id: string, kind: string) => (await call(page, 'GET', `/files/${id}/preview/${kind}`)).status;
check('thumbnail (sips, sandboxed)', await until(async () => (await ready(png.id, 'thumb')) === 200));
check('HEIC → JPEG', await until(async () => (await ready(heic.id, 'image')) === 200));
await until(async () => [200, 422].includes(await ready(docx.id, 'pdf')), 120_000);
const office = await call(page, 'GET', `/files/${docx.id}/preview/pdf`);
check('DOCX → PDF (LibreOffice, sandboxed)', office.status === 200, office.status === 200 ? '' : `status ${office.status}: ${office.body?.message ?? ''}`);
check('XLSX → sheets (child process, sandboxed)', await until(async () => [200, 422].includes(await ready(xlsx.id, 'sheet'))) && (await ready(xlsx.id, 'sheet')) === 200, `status ${await ready(xlsx.id, 'sheet')}`);
check('antivirus flags EICAR', await until(async () => (await call(page, 'GET', `/files/${virus.id}`)).body.file.scan === 'infected'));
check('clean file marked clean', (await call(page, 'GET', `/files/${png.id}`)).body.file.scan === 'clean');

// --- share link, anonymous visitor ---
const share = (await call(page, 'POST', '/shares', { fileId: png.id })).body;
const anonCtx = await browser.newContext({ baseURL: base, extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.77' } });
await anonCtx.addInitScript('globalThis.__name = (f) => f');
const anon = await anonCtx.newPage();
await anon.goto('/pwa/favicon.svg');
const st = new URL(share.url).pathname.split('/').pop()!;
check('share opens for an anonymous visitor', (await call(anon, 'POST', `/public/shares/${st}/open`)).status === 200);
check('shared file downloads', (await call(anon, 'GET', `/public/shares/${st}/files/${png.id}/content?download=1`)).body === fx('sample.png').length);
check('visitor cannot reach the owner API', (await call(anon, 'GET', '/folders/root')).status === 401 && (await call(anon, 'GET', `/files/${docx.id}/content`)).status === 401);
const ev = (await call(page, 'GET', `/shares/${share.share.id}/events`)).body as { ip: string }[];
check('a forged X-Forwarded-For is not taken as the client address', ev.length > 0 && ev.every((e) => e.ip !== '203.0.113.77'), `recorded ${ev[0]?.ip}`);
await call(page, 'DELETE', `/shares/${share.share.id}`);
check('revoked share is dead at once', (await call(anon, 'GET', `/public/shares/${st}/files/${png.id}/content`)).status === 404);

// --- deposit portal, anonymous ---
const portal = (await call(page, 'POST', '/requests', { folderId: folder.id, title: 'Smoke portal' })).body;
const pt = new URL(portal.url).pathname.split('/').pop()!;
const pdf = fx('sample.pdf');
const sub = (await call(anon, 'POST', `/public/requests/${pt}/submissions`, { name: 'Smoke', files: [{ name: 'ok.pdf', size: pdf.length }, { name: 'virus.pdf', size: EICAR.length }] })).body;
const auth = { Authorization: `Bearer ${sub.submissionToken}` };
await call(anon, 'PATCH', `/public/uploads/${sub.items[0].uploadId}?offset=0`, pdf, auth);
await call(anon, 'PATCH', `/public/uploads/${sub.items[1].uploadId}?offset=0`, EICAR, auth);
await call(anon, 'POST', '/public/submissions/finalize', {}, auth);
let status: any;
await until(async () => { status = (await call(anon, 'GET', '/public/submissions/status', undefined, auth)).body; return status.status !== 'processing'; });
check('portal deposit: clean file accepted, infected file refused', status?.status === 'completed' && status.items[0].status === 'accepted' && status.items[1].reason === 'infected', JSON.stringify(status?.items));
check('depositor token reads nothing', (await call(anon, 'GET', '/folders/root', undefined, auth)).status === 401);
await call(page, 'DELETE', `/requests/${portal.request.id}?purge=1`);

// --- static shell ---
for (const p of ['/manifest.webmanifest', '/sw.js', '/pwa/icon-512.png', '/s/unknown-link', '/request/unknown-link']) { const r = await page.request.get(p); check(`GET ${p}`, r.status() === 200); }
await page.goto('/');
await page.waitForLoadState('networkidle');
check('application shell renders', await page.locator('#main').isVisible().catch(() => false));
const state = (await call(page, 'GET', '/auth/state')).body;
console.log(`account: ${state.user.email} (${state.user.id})`);
await browser.close();
process.exit(failed ? 1 : 0);
