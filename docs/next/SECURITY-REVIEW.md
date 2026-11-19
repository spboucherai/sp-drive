# SP Drive 2.0 — security review (2026-11-19)

## Model (unchanged, stated accurately)
Encryption is **server-side at rest**: AES-256-GCM per object, keys wrapped by a master key held on the node. SP Drive is **not**
end-to-end encrypted. Passkeys (WebAuthn), device sessions (bearer), strict CSP, CSRF header rule, ClamAV quarantine, sandboxed converters.

## New exposure introduced by 2.0, and how it is bounded
| Change | Risk | Bound |
|---|---|---|
| Content index (`object_passages`) | extracted text is plaintext in PostgreSQL on the node | dump stays sealed in backups; `SPD_INDEX_CONTENT=off` + `purge-index`; documented in the threat model |
| Text helper (PDFKit/Vision) | hostile documents | `sandbox-exec`, no network, cannot read master key or blob store (tested); two extra allow rules limited to its model cache; page/char/pixel/time caps |
| Node-side extraction | regex/zip abuse | runs in a sandboxed child with a 60 s kill, linear scanner, 24 MB inflated cap |
| AI | documents leaving the node; prompt injection | local model by default; external providers need `SPD_AI_EXTERNAL=on` **and** the account flag (currently off); model has no tools, output is text; only retrieved passages are sent |
| Private sharing | cross-tenant access | separate `/shared/:grantId` route family; every call re-checks grant, grantee, subtree, trash; owner lock on revoke/downgrade |
| Event streams | resource exhaustion | 16 per account, 1000 global, session re-checked every 25 s, closed on shutdown |

## Independent review (separate reviewer, read-only, before deployment)
No cross-tenant read or write hole: 28 cross-account attempts refused against the running API. Findings, all fixed in `0073557` with
regression tests (`services/api/test/next-hardening.test.ts`):
1. **High** — a crafted HTML/Office file froze the worker for hours (quadratic regexes); reachable by anonymous portal depositors.
2. **Medium** — a grantee saw the owner's full audit history of a shared folder and could turn a user id into an e-mail address.
3. Low — stream cap race; 4. Low — rate-limit escape on refused upload chunks.
5–14 (plausible, treated as real) — similar-images memory blow-up, semantic cache memory, unbounded helper spawns, uploader
name probing, revoke/downgrade races, quota reservation by a grantee, helper memory on pixel bombs, rollback leftovers,
`backup-verify --no-key` claiming a check it had not made, indexing under the wrong name.

## Residual risks
- Revoke-vs-complete race is covered by a 12-round concurrent test, not a deterministic interleaving.
- The Anthropic/OpenAI/OpenRouter adapters were never run against the real services: test before enabling `SPD_AI_EXTERNAL`.
- The gateway (Caddy) access log still records public link tokens in URLs (known since 1.0).
- A LibreOffice copy lives at `/Users/Shared/sp-drive-tools/` (notarized binary, world-readable location): update it with LibreOffice.
- Backups: master key is in no backup set (verified on the off-node copy); losing the node **and** the laptop copy of the key loses the data.

## Backups and recovery
Nightly sealed backup 03:40 (`status.json`, `manifest.tsv`), `backup-verify.sh`, `restore-test.sh` (39 objects re-hashed, OK).
Off-node: gateway LaunchDaemon `io.maclustr.sp-drive-offnode` (04:30) copies the sealed set m5ma → M2U64
`~/backups-offnode/sp-drive`, verifies it there without the key and reports `offnode.json` to the admin view. Rollback of the 2.0
code: tag `pre-2.0`, build kept in `~/apps/sp-drive-dist-1.0`, SQL in `docs/runbooks/operations.md`.
