/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : SP Drive
 * File             : services/api/test/authenticator.ts
 * Module           : services
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

// A software WebAuthn authenticator for tests: real ES256 keys, real signatures, so the server-side verification
// under test is the production code path (attestation "none", user verified).
import { createHash, createSign, generateKeyPairSync, type KeyObject, randomBytes } from 'node:crypto';

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
// minimal CBOR encoder: unsigned/negative ints, byte strings, text strings, maps
function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor: unsupported');
}
export class SoftAuthenticator {
  private creds = new Map<string, { key: KeyObject; userHandle: string; counter: number }>();
  constructor(private origin: string, private rpId: string) {}
  private authData(flags: number, counter: number, attested?: Buffer): Buffer {
    const c = Buffer.alloc(4); c.writeUInt32BE(counter);
    return Buffer.concat([createHash('sha256').update(this.rpId).digest(), Buffer.from([flags]), c, ...(attested ? [attested] : [])]);
  }
  /** Answer navigator.credentials.create(). */
  create(options: { challenge: string; user: { id: string } }) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const id = randomBytes(32);
    const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
    const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
    const authData = this.authData(0x45, 0, Buffer.concat([Buffer.alloc(16), len, id, cose])); // UP | UV | AT
    this.creds.set(b64u(id), { key: privateKey, userHandle: options.user.id, counter: 0 });
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    return { id: b64u(id), rawId: b64u(id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))), transports: ['internal'] } };
  }
  /** Answer navigator.credentials.get() with a discoverable credential (or the given one). */
  get(options: { challenge: string }, credentialId?: string, o: { origin?: string } = {}) {
    const id = credentialId ?? [...this.creds.keys()].pop()!;
    const c = this.creds.get(id)!;
    const authData = this.authData(0x05, ++c.counter);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: o.origin ?? this.origin, crossOrigin: false }));
    const signature = createSign('sha256').update(Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()])).sign(c.key);
    return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: c.userHandle } };
  }
}
