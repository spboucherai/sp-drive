# SP Drive 2.0 — API reference of everything new or changed

Branch `next`, migration `003_next`. This file is the precise contract for the web application and the native
clients: when it differs from `ARCHITECTURE-NEXT.md`, **this file wins**. Every example below was produced by the
development server of this branch (`scripts/next-dev.sh`), then shortened.

Everything is additive. A 1.0 client keeps working unchanged against a 2.0 server.

## 0. Deviations from the contract (read first)

| # | Contract | What the server does | Why |
|---|---|---|---|
| D1 | role too weak → "a failed check answers 404" | a **live grant with an insufficient role answers `403 forbidden`**; every other failed check (grant revoked / foreign / unknown, target outside the subtree, trashed) answers `404 not_found` | the member already knows the grant exists (it is in `shared-with-me`), so 403 reveals nothing and lets a client grey out an action instead of believing the folder vanished |
| D2 | `POST /ai/ask` SSE: `sources`, `delta`…, `done` | an extra event **`notice { unindexed: [{ fileId, name, status }] }`** may precede `sources` when `scope.fileIds` names files whose text is not indexed | "a file whose text is not indexed is reported as such" needed a place that keeps `sources` an array |
| D3 | `done` with `{ empty: true }` | `done` is `{ empty: true, provider, model, usage: null }` | same shape as a normal `done`, plus the flag |
| D4 | `GET /ai/providers` | adds `external: { server, account }` and per provider `usable` | a client must tell "not configured" from "not allowed for this account" |
| D5 | `storage/overview.duplicates { groups, reclaimableBytes }` | `{ groups, duplicateBytes, reclaimableBytes }` and **`reclaimableBytes` is always `0`** | identical content is stored once per account (dedup since 1.0): deleting a duplicate frees a name, not bytes. `duplicateBytes` is the logical size of the redundant copies |
| D6 | `index/status.content { ready, pending, failed, unsupported }` | adds `enabled` and `empty` | `empty` (a file with no text at all, e.g. a photo without writing) is not a failure |
| D7 | `GET /files/:id/text` | adds `error` (a displayable reason when `failed` / `unsupported`) | |
| D8 | search results reachable "through an active grant" | **search, semantic search and AI only cover the caller's own files** in 2.0; shared folders are browsed, not searched | keeps the search path owner-scoped by construction; can be added later without changing shapes |
| D9 | sync events | a `change` event is sent for the **owner's own tree only**; a member is not told when a folder shared with them changes (they re-list) | same reason as D8 |
| D10 | semantic search | `available: true` only when the on-device model answers; scores are **relative** (see §4.4) and cross-language queries do not work | measured, see `docs/progress.md` (section 2.0) and `scripts/semantic-eval.mts` |
| D11 | — | new helper routes not in the contract: `POST /collections/preview`, `PATCH /folders/:id/workspace`, `GET /collab/outgoing`, `GET /shared/:grantId/activity`, `GET|DELETE /shared/:grantId/uploads/:id` | needed by any real client |
| D12 | `duplicates?mode=similar-images` | optional `distance=0..16` (default 6) | |
| D13 | change feed | when the **thumbnail** of a content becomes ready, every live file whose current version is that content gets a new `rev` (nothing else changes in the row): `GET /sync/changes` returns it with `thumb: true` and a `change` event is sent | a client that mirrored the file before the worker ran kept `thumb: false` for ever. Text extraction becoming ready does **not** bump `rev` (`GET /files/:id/text` is polled by whoever shows it) |
| D14 | rate limits | the per-address limit (900 requests / minute) no longer counts the **chunk traffic of resumable uploads** — `PATCH` and `GET` of `/uploads/:id` and `/shared/:grantId/uploads/:id` — when the request carries a cookie or a well-formed bearer. Those requests have their own budget: **6000 / minute per account** (`429 rate_limited` with `retryAfterS` beyond). A cookie or bearer that is not a live session gets 120 such requests / minute per address; without any credential the ordinary per-address limit applies. `POST /uploads`, `…/complete`, authentication and public routes are unchanged | 6–8 parallel uploads of large files from one native client made thousands of chunk requests a minute and tripped the address limit |

## 1. Conventions (unchanged from 1.0)

- Base path `/api/v1`. JSON in, JSON out, UTF-8. Dates are ISO 8601 UTC strings. Sizes are bytes (numbers).
- Authentication: the session cookie (web) or `Authorization: Bearer <device token>` (native). A browser call that
  changes state sends `X-SPD-CSRF: 1`; a bearer call needs neither that header nor an `Origin`.
- Errors: `{ "error": "<stable code>", "message": "<English text>", ...extra }` with the HTTP status. Codes used
  below: `unauthenticated` 401, `forbidden` 403, `not_found` 404, `invalid_request` 400 (with `issues`),
  `name_conflict` 409, `quota_exceeded` 413, `rate_limited` 429 (with `retryAfterS`), `infected` 451.
- A foreign or unknown identifier is always `404`, never `403`.
- `File` and `Folder` below are the 1.0 objects (`fileJson`, `folderJson`). **`Folder` gains one field:
  `workspaceName: string | null`.** Nothing else changed in them.

```json
{ "id": "5c8a03c4-…", "type": "file", "name": "Rapport trimestriel.pdf", "folderId": "5fa9fc32-…", "size": 740,
  "sha256": "38777b16…", "kind": "pdf", "origin": "upload", "starred": false, "createdAt": "2026-11-19T18:44:54.900Z",
  "updatedAt": "2026-11-19T18:44:54.900Z", "trashedAt": null, "scan": "clean", "thumb": true, "tagIds": [],
  "versions": 1, "trashRoot": false, "rev": 13, "versionId": "ad4c0df5-…", "versionSeq": 1,
  "contentAt": "2026-11-19T18:44:54.900Z" }
```
```json
{ "id": "60a6d559-…", "type": "folder", "name": "Équipe", "parentId": "7e53e088-…", "starred": false,
  "createdAt": "…", "updatedAt": "…", "trashedAt": null, "trashRoot": false, "rev": 27, "workspaceName": "Équipe Projet" }
```

## 2. Capability discovery and client identification

### `GET /api/v1/meta` — no authentication
```json
{ "api": 2, "version": "2.0.0",
  "features": ["events", "content-search", "ocr", "semantic", "collab", "collections", "activity", "storage", "similar-images", "upload-history"] }
```
A feature is listed only when it works on this server right now:

| feature | listed when |
|---|---|
| `events`, `collab`, `collections`, `activity`, `storage`, `upload-history` | always on a 2.0 server |
| `content-search` | `SPD_INDEX_CONTENT` is not `off` |
| `ocr` | content indexing on, `SPD_OCR` not `off`, the local helper `dist/spd-textkit` starts |
| `similar-images` | the local helper starts |
| `semantic` | the helper's on-device embedding model has its assets (and `SPD_SEMANTIC` is not `off`) |
| `ai` | at least one provider is configured and allowed at server level |

A 1.0 server answers `404` to this route: treat that as `{ api: 1, features: [] }`.

### `X-SPD-Client` request header (native clients)
`X-SPD-Client: <platform>/<app version> (<os version>)`, platform ∈ `macos | ios | ipados`, e.g.
`X-SPD-Client: macos/2.0.0 (27.0)`. The version is `[0-9A-Za-z][0-9A-Za-z.+_-]{0,23}`; the parenthesised part is
optional (≤ 40 characters). Send it on **every** request (at least on sign-in and on the first request after an app
update): the server stores it on the device session at sign-in and refreshes it whenever it is present. A malformed
header is ignored.

### `GET /api/v1/account/sessions` — changed: each session gains `client`
```json
[{ "id": "b384a139-…", "createdAt": "…", "lastSeenAt": "…", "ip": "192.168.2.40", "userAgent": "SPDrive/2.0.0",
   "method": "passkey", "kind": "device", "deviceName": "Mac Studio", "current": true,
   "client": { "platform": "macos", "version": "2.0.0", "os": "27.0" } }]
```
`client` is `null` for web sessions and for devices that never sent the header.

### `PATCH /api/v1/account` — changed: accepts `aiExternal`
Body `{ "displayName"?, "locale"?: "fr"|"en", "aiExternal"?: boolean }` → `{ "ok": true }`. `aiExternal` is the
account's own switch for external AI providers (§5); changing it is recorded in the account's security activity.

## 3. Sync events

### `GET /api/v1/sync/events` — Server-Sent Events, cookie or bearer
Response headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-store, no-transform`,
`X-Accel-Buffering: no`. The stream never ends by itself.

```
event: hello
data: {"head":27}

event: change
data: {"head":29}

event: notify
data: {"kind":"collab.shared"}

: ping
```

| event | data | meaning |
|---|---|---|
| `hello` | `{ "head": number }` | once, right after connecting; `head` is the same number as `GET /sync/cursor` |
| `change` | `{ "head": number }` | the owner's head revision moved. Bursts are folded: at most one event per second per account. Carries no item: call `GET /sync/changes?since=<your cursor>` |
| `notify` | `{ "kind": string }` | a notification was created for the account (`GET /notifications` to read it) |
| comment `: ping` | — | every 25 s |

Rules for clients: events are a hint, never the source of truth — keep a polling fallback (30 s in the foreground
while the stream is down). Reconnect with exponential backoff + jitter (1 s → 60 s). There is no `Last-Event-ID`
replay: after a reconnect, `hello.head` tells whether anything was missed. Errors before the stream starts are
ordinary JSON: `401 unauthenticated`, `429 too_many_streams` (more than 16 streams for one account). The server
closes the stream of a session that was revoked or expired (within one ping).

## 4. Search intelligence

### 4.1 `GET /api/v1/search` — changed
All 1.0 parameters are unchanged (`q`, `kind`, `tag`, `starred`, `from`, `to`, `minSize`, `maxSize`, `sort`, `dir`).
New: **`in=name|content|all`** (default `all`).

- Without `q` the answer is exactly the 1.0 answer (filters only, no `match`).
- With `q`, every folder and file gains **`match`**:

```json
{ "folders": [{ "…Folder": "…", "match": { "where": "name" } }],
  "files": [
    { "…File": "…", "name": "Budget.csv", "match": { "where": "name" } },
    { "…File": "…", "name": "Notes de réunion.txt",
      "match": { "where": "content", "snippet": "Ordre du jour Le ⟦budget⟧ de la coopérative Hirondelle est adopté.", "page": null } },
    { "…File": "…", "name": "contrat.docx", "match": { "where": "both", "snippet": "⟦Contrat⟧ de location du chalet…", "page": null } }
  ] }
```
`match.where` ∈ `name | content | both`. `snippet` (≤ 400 characters, whitespace collapsed) and `page` (1-based page
or slide number, `null` when the format has no pages) are present for `content` and `both`. Matched words are wrapped
in `⟦` `⟧` (U+27E6 / U+27E7); the snippet is plain text, never HTML. Content matching is accent- and case-insensitive,
with French and English stemming (`turbine` finds `turbines`); `q` follows web-search syntax (`"exact phrase"`,
`-word`, `or`). Folders are only matched by name. Limits unchanged: 300 folders, 500 files.

### 4.2 `GET /api/v1/files/:id/text`
```json
{ "status": "ready", "source": "pdf-text", "pages": 1, "chars": 112,
  "excerpt": "Rapport trimestriel\nLa societe Borealis a livre 42 turbines.\nThe maintenance schedule was approved by the board.",
  "error": null }
```
- `status` ∈ `pending` (queued, or waiting for the antivirus) · `ready` · `empty` (readable, no text) ·
  `unsupported` (format never indexed, indexing off, too large, protected PDF, infected) · `failed`.
- `source` ∈ `text` · `office-xml` (docx, pptx, xlsx, odt, odp, ods) · `textutil` (doc, rtf) · `pdf-text` · `ocr` ·
  `pdf-text+ocr` · `office-pdf` (ppt, xls through their PDF rendition) · `null`.
- `pages`: page or slide count (0 when not paged). `excerpt`: the first ≤ 800 characters. `error`: a displayable
  English reason when `failed` or `unsupported`, else `null`. `404` for a foreign id.

### 4.3 `GET /api/v1/index/status`
```json
{ "content": { "enabled": true, "ready": 5, "pending": 0, "failed": 0, "unsupported": 0, "empty": 0 },
  "semantic": { "available": true, "model": "apple-nl-contextual", "embedded": 5 } }
```
Counts are distinct stored contents behind the caller's live files. `embedded` counts passages that have a vector.

### 4.4 `GET /api/v1/search/semantic?q=&limit=`
`q` 1–500 characters (required), `limit` 1–50 (default 10). Rate limit 60/min.
```json
{ "available": true,
  "hits": [{ "file": { "…File": "…", "name": "Contrat chalet.md" }, "score": 0.7609,
             "passage": { "text": "# Contrat de location\n\nLe locataire verse un dépôt de 500 dollars avant le 1er juin.", "page": null } }] }
```
One hit per file (its nearest passage), best first. `score` is a cosine in `[-1, 1]`; **only the order means
something** — with this model unrelated text also scores ≈ 0.7–0.85, so never show the score as a percentage and
never threshold on it. When the backend is unavailable: `{ "available": false, "hits": [] }` (HTTP 200).

## 5. Document intelligence

### 5.1 `GET /api/v1/ai/providers`
```json
{ "enabled": true, "externalAllowed": false, "external": { "server": false, "account": false },
  "default": { "provider": "maclustr", "model": "qwen3-30b-a3b" },
  "providers": [
    { "id": "maclustr", "label": "MacLustr (local)", "local": true, "configured": true, "usable": true,
      "models": [{ "id": "qwen3-30b-a3b", "label": "Qwen3 30B", "creator": "Alibaba" }] },
    { "id": "anthropic", "label": "Anthropic", "local": false, "configured": false, "usable": false,
      "models": [{ "id": "claude-opus-5-5", "label": "Claude Opus 5.5", "creator": "Anthropic" },
                 { "id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5", "creator": "Anthropic" },
                 { "id": "claude-haiku-5-5", "label": "Claude Haiku 5.5", "creator": "Anthropic" }] },
    { "id": "openai", "label": "OpenAI", "local": false, "configured": false, "usable": false, "models": [] },
    { "id": "openrouter", "label": "OpenRouter", "local": false, "configured": false, "usable": false, "models": [] }
  ] }
```
- `enabled`: at least one provider is usable **by this account**. `default` is `null` when none is.
- `usable` = `configured` and (`local` or (`external.server` and `external.account`)).
- `externalAllowed` = `external.server && external.account`. `external.server` is the server switch
  (`SPD_AI_EXTERNAL=on`); `external.account` is the account switch (`PATCH /account { aiExternal }`).
- `creator` is who made the model; `id` of the provider is the route to it (they differ on a router).
- The default prefers the local provider; an external one is never chosen silently when it is not allowed.

### 5.2 `POST /api/v1/ai/ask` — answer as Server-Sent Events
Request (rate limit 20/min):
```json
{ "scope": { "fileIds": ["3398f77d-…"] },
  "question": "Quel est le montant du dépôt ?",
  "provider": "maclustr", "model": "qwen3-30b-a3b",
  "history": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }] }
```
- `scope`: **exactly one** of `fileIds` (1–50 ids), `folderId` (an id or `"root"`, whole subtree), `all: true`.
- `question` 1–2000 characters. `provider`, `model` optional (default: §5.1 `default`). `history` optional, ≤ 12
  turns of ≤ 8000 characters; the last 10 are sent.

Errors **before** the stream (plain JSON): `400 invalid_request`, `400 provider_unknown`, `400 model_unknown`,
`404 not_found` (a foreign file or folder in the scope), `403 ai_external_disabled` (`{ server, account }` tell which
switch is off), `409 provider_not_configured`, `503 ai_unavailable` (no usable provider), `429 rate_limited`.

Stream (`Content-Type: text/event-stream`), in this order:
```
event: notice
data: {"unindexed":[{"fileId":"9b1f…","name":"film.mp4","status":"unsupported"}]}

event: sources
data: [{"n":1,"fileId":"3398f77d-…","name":"Contrat chalet.md","page":null,"text":"# Contrat de location\n\nLe locataire verse un dépôt de 500 dollars avant le 1er juin."}]

event: delta
data: {"text":"Le dépôt est de 500 dollars "}

event: delta
data: {"text":"[1]."}

event: done
data: {"provider":"maclustr","model":"qwen3-30b-a3b","usage":{"inputTokens":321,"outputTokens":7},"stopReason":"stop"}
```
| event | data | notes |
|---|---|---|
| `notice` | `{ unindexed: [{ fileId, name, status }] }` | optional, only with `scope.fileIds`; `status` as in §4.2 |
| `sources` | `[{ n, fileId, name, page, text }]` | always sent once, possibly `[]`. `n` starts at 1 and is what `[n]` in the answer refers to. `text` ≤ 1200 characters. At most 8 sources |
| `delta` | `{ text }` | pieces of the answer, to concatenate |
| `done` | `{ provider, model, usage: { inputTokens, outputTokens } \| null, stopReason }` | end of a successful answer. `usage` numbers may be `null` when the provider does not report them |
| `done` (nothing retrieved) | `{ empty: true, provider, model, usage: null }` | no model was called; show "nothing in these documents matches" |
| `error` | `{ code, message }` | instead of `done`. Codes: `provider_auth`, `provider_unreachable`, `provider_unavailable`, `provider_rate_limited`, `provider_refused` (the model declined), `model_unknown`, `provider_error` |

The stream ends after `done` or `error`. Closing the connection cancels the model call.
Retrieval: words decide whether anything was found (French/English full-text over the scope, any word may match);
the local sentence model, when available, re-ranks and completes that result. With `scope.fileIds` and a question
that matches no word ("résume ce document"), the opening passages of those files are used. The prompt contains only
these passages — never a whole document, never another account's content.

### 5.3 `POST /api/v1/ai/suggest`
Request `{ "fileIds": ["…", "…"], "provider"?, "model"? }` (1–20 ids, rate limit 10/min) →
```json
{ "provider": "maclustr", "model": "qwen3-30b-a3b",
  "suggestions": [
    { "fileId": "3398f77d-…", "name": "Contrat de location – chalet des Laurentides.txt", "tags": ["Juridique", "Location"],
      "folder": { "id": "0f2c…", "path": "/Contrats" }, "category": "Contrat", "reason": "Bail de location saisonnière." },
    { "fileId": "77aa…", "category": "Recette", "reason": "Recette de dessert." } ] }
```
`name`, `tags` (≤ 3 names, existing or new), `folder`, `category` are each present only when the model proposed
something valid: a name never changes the extension, a folder is always one of the caller's live folders and never
the current one. A file may be missing from the list. **Nothing is applied**: the client applies with
`PATCH /files/:id`, `POST /tags`, `POST /move` after the user confirms. Errors: as §5.2, plus `502 ai_bad_answer`.

### 5.4 Server configuration (operators)
Environment or `~/.config/sp-drive/ai.env` (`KEY=value` lines, mode 600; the environment wins):

| key | meaning |
|---|---|
| `SPD_AI_MACLUSTR_URL` (default `https://llm.spboucher.ai/v1`), `SPD_AI_MACLUSTR_KEY`, `SPD_AI_MACLUSTR_MODEL`, `SPD_AI_MACLUSTR_MODELS` | the local OpenAI-compatible endpoint. `…_MODELS` = `id\|label\|creator, id2\|…` |
| `SPD_AI_EXTERNAL=on` | server switch for the three external providers |
| `ANTHROPIC_API_KEY`, `SPD_AI_ANTHROPIC_MODEL` (default `claude-opus-5-5`) | Anthropic (official SDK, Messages API) |
| `OPENAI_API_KEY`, `SPD_AI_OPENAI_MODEL`, `SPD_AI_OPENAI_MODELS` | OpenAI (no model is assumed: none listed = not configured) |
| `OPENROUTER_API_KEY`, `SPD_AI_OPENROUTER_MODEL`, `SPD_AI_OPENROUTER_MODELS` | OpenRouter |

## 6. Private sharing and workspaces

Roles: `viewer` (browse, read, preview, download) · `editor` (viewer + create, rename, move, trash, upload, new
versions) · `uploader` (send files in; lists nothing, reads nothing).

### 6.1 Owner routes (the folder's owner only; anyone else gets 404)

**`POST /api/v1/collab/resolve`** `{ "email": "bob@example.test" }` → `{ "userId": "b52c6d94-…", "displayName": "Bob Gagnon" }`
or `404`. Exact address only, never the caller's own, 10 calls/min.

**`GET /api/v1/folders/:id/members`** →
```json
{ "folder": { "…Folder": "…" },
  "members": [{ "grantId": "d315eccf-…", "userId": "b52c6d94-…", "displayName": "Bob Gagnon", "email": "bob@example.test",
                "role": "uploader", "createdAt": "2026-11-19T18:44:54.963Z" }] }
```
**`POST /api/v1/folders/:id/members`** `{ "userId": "…" | "email": "…", "role": "viewer"|"editor"|"uploader", "workspaceName"?: "…" }`
→ one member object (as above). Errors: `400 root_immutable` (the root cannot be shared), `404` (no such account, or
oneself), `409 already_member`.
**`PATCH /api/v1/folders/:id/members/:userId`** `{ "role": "…" }` → the member object. Dropping to `viewer` aborts
that member's uploads in flight.
**`DELETE /api/v1/folders/:id/members/:userId`** → `{ "ok": true }`. Immediate; the grant id is dead for good (access
given again is a new `grantId`).
**`PATCH /api/v1/folders/:id/workspace`** `{ "name": "Atelier" | null }` → the `Folder`.
**`GET /api/v1/collab/outgoing`** → `[{ "folder": Folder, "members": 2 }]` — folders the caller shares.
**`GET /api/v1/folders/:id/activity?before=&limit=`** → `{ events, more }` (§7.2) for the folder and everything
below it, members' actions included (`meta.via: "grant"`, `meta.grantId`).

### 6.2 Grantee routes — `/api/v1/shared/…`

**`GET /api/v1/shared-with-me`** →
```json
[{ "grantId": "012c60d3-…", "role": "viewer", "owner": { "displayName": "Alice Tremblay" },
   "folder": { "id": "60a6d559-…", "name": "Équipe", "workspaceName": "Équipe Projet", "updatedAt": "…" },
   "createdAt": "2026-11-19T18:44:54.958Z" }]
```
Only live grants (not revoked, folder not in the trash, owner not disabled). Display `workspaceName ?? name`.

Every route below starts by re-checking the grant; see D1 for 403 vs 404.

| route | role | answer |
|---|---|---|
| `GET /shared/:grantId/children?folderId=` | viewer, editor | `{ grantId, role, folder, breadcrumbs, folders, files }` |
| `GET /shared/:grantId/files/:fileId` | viewer, editor | `{ grantId, role, file, path }` |
| `GET /shared/:grantId/files/:fileId/content` | viewer, editor | the bytes; `Range`, `?download=1`, `?as=text` as on the owner route. `451 infected` always (no acknowledgement for members) |
| `GET /shared/:grantId/files/:fileId/preview/:kind` | viewer, editor | as the owner route (`202 {status:"pending"}`, `404 preview_unsupported`, …) |
| `GET /shared/:grantId/activity?before=&limit=` | viewer, editor | `{ events, more }` |
| `POST /shared/:grantId/folders` `{ parentId?, name, onConflict?: "fail"\|"rename" }` | editor | the new shared `Folder` |
| `PATCH /shared/:grantId/items/:id` `{ name?, parentId?, onConflict? }` | editor | the shared `Folder` or `File`. `:id` is a file or a folder of the grant; `parentId` must be a folder of the same grant. The granted folder itself: `403` |
| `POST /shared/:grantId/trash` `{ fileIds?, folderIds? }` | editor | `{ ok: true }`. Goes to the **owner's** trash; only the owner restores or purges |
| `POST /shared/:grantId/uploads` `{ folderId?, name, size, relativePath?, onConflict? }` | editor, uploader | the upload object `{ id, name, size, received, status, fileId }` |
| `GET /shared/:grantId/uploads/:id` | editor, uploader | the upload object |
| `PATCH /shared/:grantId/uploads/:id?offset=` (raw body, optional `X-Chunk-SHA256`) | editor, uploader | the upload object |
| `POST /shared/:grantId/uploads/:id/complete` `{ sha256? }` | editor, uploader | `{ …upload, file, created }` |
| `DELETE /shared/:grantId/uploads/:id` | editor, uploader | `{ ok: true }` |

```json
{ "grantId": "012c60d3-…", "role": "viewer",
  "folder": { "…Folder": "…", "id": "60a6d559-…", "name": "Équipe", "parentId": null, "isGrantRoot": true },
  "breadcrumbs": [{ "id": "60a6d559-…", "name": "Équipe" }],
  "folders": [{ "…Folder": "…", "parentId": "60a6d559-…", "isGrantRoot": false }],
  "files": [{ "…File": "…", "name": "Charte.txt", "tagIds": [], "starred": false }] }
```
- Shared folders carry `isGrantRoot`; the granted folder's `parentId` is `null` and `breadcrumbs` / `path` start at
  it: nothing of the owner's tree above the grant is ever shown. Shared files always have `tagIds: []` and
  `starred: false` (those are the owner's private marks).
- `folderId` / `parentId` omitted = the granted folder.
- Uploads use the same resumable protocol as `/api/v1/uploads` (same chunk limits, same errors:
  `offset_mismatch` 409 with `received`, `chunk_corrupt` 422, `checksum_mismatch` 422, `upload_closed`).
  **Bytes count against the owner's quota** (`413 quota_exceeded` reports the owner's numbers) and go through the
  owner's antivirus pipeline. `onConflict`: `rename` (default) | `fail` | `version` — an **uploader may only use
  `rename`** (403 otherwise). There is no `fileId` / `baseVersionId` here: an editor makes a new version by uploading
  under the same name with `onConflict: "version"`.
- `complete` for an **uploader** returns `file: { id, name, size }` only; for an editor the shared `File`.
- An upload opened through a grant is invisible to the ordinary `/api/v1/uploads/:id` routes (404) and vice versa;
  it does appear in the member's own `GET /api/v1/uploads` history with `grantId` set and `folderId: null`.

### 6.3 Notifications (`GET /api/v1/notifications`, plus a `notify` event)
| kind | to | data |
|---|---|---|
| `collab.shared` | the member | `{ grantId, role, folderName, ownerName }` |
| `collab.role_changed` | the member | `{ grantId, role, folderName, ownerName }` |
| `collab.revoked` | the member | `{ grantId, folderName, ownerName }` |
| `collab.upload` | the owner | `{ grantId, folderId, byName }` — at most one unread per grant per 30 min |

## 7. Collections, activity, storage, duplicates, versions, uploads

### 7.1 Collections
A rule: `{ "match": "all"|"any", "conditions": [Condition, …1..20], "sort"?: { "by": "name"|"updated"|"size"|"created", "dir": "asc"|"desc" } }`.
Unknown keys, fields, operators or value types are `400 invalid_request`.

| field | op | value |
|---|---|---|
| `kind` | `is`, `isNot` | `image`, `pdf`, `document`, `sheet`, `video`, `audio`, `archive`, `text` |
| `ext` | `is`, `isNot` | extension without dot, `[A-Za-z0-9]{1,10}` |
| `name` | `contains`, `is`, `isNot` | string 1–200 (accent- and case-insensitive for `contains`) |
| `tag` | `is`, `isNot` | a tag id of the caller (`404` otherwise) |
| `untagged` | `is` | boolean |
| `size` | `gt`, `lt` | bytes (integer) |
| `modified`, `created` | `gt`, `lt` | ISO date (`2026-11-01`) or date-time with offset |
| `modified`, `created` | `within` | number of days (integer 1–36500) |
| `starred` | `is` | boolean |
| `shared` | `is` | boolean — has a live public link, or sits in a folder shared by link or by grant |
| `folder` | `is`, `isNot` | a folder id of the caller: the whole subtree (`404` otherwise) |
| `text` | `contains` | string 1–200, searched in the extracted text (§4) |

A collection always selects among the caller's own live files; it references files and never copies bytes.

**`GET /api/v1/collections`** →
```json
[{ "id": "cf09f64a-…", "name": "Documents récents", "icon": "", "color": "blue",
   "rule": { "match": "all", "conditions": [{ "field": "modified", "op": "within", "value": 30 }, { "field": "kind", "op": "isNot", "value": "video" }],
             "sort": { "by": "updated", "dir": "desc" } },
   "createdAt": "…", "updatedAt": "…", "count": 6 }]
```
**`POST /api/v1/collections`** `{ "name": "…", "icon"?: "doc.text", "color"?: "slate|red|orange|amber|green|teal|blue|violet|pink", "rule": Rule }`
→ the collection (without `count`). `icon` is a free identifier `[A-Za-z0-9._-]{0,40}` the clients agree on.
`409 name_conflict`, `409 too_many_collections` (100).
**`PATCH /api/v1/collections/:id`** any subset of the same body → the collection. **`DELETE …/:id`** → `{ "ok": true }`.
**`GET /api/v1/collections/:id/items?limit=&offset=`** (limit ≤ 500, default 200) →
`{ "collection": {…}, "files": [File], "total": 12, "limit": 200, "offset": 0 }`.
**`POST /api/v1/collections/preview`** `{ "rule": Rule, "limit"?: 1..200 }` → `{ "files": [File], "total": 12 }` (nothing saved).

### 7.2 Activity
**`GET /api/v1/files/:id/activity?before=&limit=`** and **`GET /api/v1/activity?before=&limit=`** (limit ≤ 200, default 50) →
```json
{ "events": [{ "id": "5", "at": "2026-11-19T18:44:54.900Z", "action": "file.uploaded",
               "actor": { "kind": "user", "userId": "1f6c3c04-…", "displayName": "Alice Tremblay", "me": true },
               "target": { "type": "file", "id": "5c8a03c4-…" }, "meta": { "size": 740 } }],
  "more": false }
```
Newest first. Page with `before=<id of the last event received>` while `more` is true. `actor.kind` ∈
`user | anonymous | system` (`displayName` is `null` for `system`); `target` may be `null`.

| action | target | meta |
|---|---|---|
| `file.uploaded`, `file.version_added` | file | `{ size }` |
| `file.version_restored` | file | `{ from: <seq> }` |
| `file.version_deleted` | file | `{}` |
| `file.renamed`, `folder.renamed` | file / folder | `{ from: "<old name>" }` |
| `file.downloaded` | file | `{ versionId? }` — explicit downloads only (`?download=1`) |
| `folder.created` | folder | `{}` |
| `items.moved` | — | `{ files, folders, fileIds, folderIds, destinationId }` |
| `items.copied` | — | `{ files, folders, fileIds, folderIds }` |
| `items.trashed`, `items.restored` | — | `{ files, folders, fileIds, folderIds }` |
| `items.purged` | — | `{ files, folders }` or `{ all: true }` |
| `zip.downloaded` | — | `{ files }` |
| `share.created` | share | `{ target: "file"\|"folder", fileId \| folderId, password, expires }` |
| `share.updated`, `share.revoked`, `share.deleted`, `share.rotated` | share | `{}` |
| `submission.completed` | submission | `{ placed, rejected, bytes, reason }` |
| `scan.infected` | object | `{ signature, files: [fileId] }` |
| `collab.member_added`, `collab.member_updated` | folder | `{ grantId, userId, role }` |
| `collab.member_removed` | folder | `{ grantId, userId }` |
| `collab.workspace_named` | folder | `{ named }` |

`fileIds` / `folderIds` hold at most 200 ids each (`files` / `folders` are the true counts). A file's own feed
contains the events aimed at it and the bulk events that name it. Actions done by a member through a grant also carry
`meta.via = "grant"` and `meta.grantId`. Events from before 2.0 exist but bulk ones carry no ids (they appear in
`/activity`, not in a file's feed); renames and downloads were not recorded before 2.0. Sign-ins and security changes
stay in `GET /account/activity`.

### 7.3 Storage
**`GET /api/v1/storage/overview`** →
```json
{ "quota": { "limit": 5368709120, "used": 1018, "uploading": 0 },
  "liveBytes": 1057, "trashBytes": 0, "oldVersionBytes": 0,
  "counts": { "files": 6, "folders": 3, "versions": 6, "trashedFiles": 0 },
  "byKind": [{ "kind": "pdf", "files": 1, "bytes": 740 }, { "kind": "text", "files": 3, "bytes": 239 }, { "kind": "sheet", "files": 2, "bytes": 78 }],
  "byFolder": [{ "folder": { "…Folder": "…", "name": "Projets" }, "files": 3, "bytes": 929 },
               { "folder": { "…Folder (the root)": "…" }, "files": 2, "bytes": 78, "direct": true }],
  "largest": [File, "… up to 20"],
  "growth": [{ "date": "2026-11-19", "bytes": 1057, "versions": 6 }],
  "duplicates": { "groups": 1, "duplicateBytes": 39, "reclaimableBytes": 0 } }
```
- `quota.used` = bytes really stored (distinct contents, all versions, trash included); `uploading` = bytes promised
  to uploads in flight. `liveBytes` = sum of the sizes of live files (can exceed `used`: identical files share bytes).
- `trashBytes` = bytes only the trash still holds; `oldVersionBytes` = bytes only non-current versions still hold.
- `byKind.kind` ∈ the eight kinds of §7.1 or `other`, largest first. `byFolder`: each direct child of the root with
  its whole live subtree (largest first, ≤ 50), then one entry `direct: true` for the files directly in the root.
- `growth`: one entry per day **that had uploads** in the last 90 days (bytes and versions added that day).

**`GET /api/v1/storage/folder/:id`** (`:id` or `root`) →
`{ "folder": Folder, "breadcrumbs": [{id,name}], "total": { "files", "bytes" }, "direct": { "files", "bytes" }, "children": [{ "folder": Folder, "files", "bytes" }], "files": [File … the 100 largest directly inside] }`.

### 7.4 Duplicates — `GET /api/v1/duplicates?mode=exact|similar-images` (changed)
`mode=exact` (default):
```json
{ "mode": "exact", "groups": [{ "sha256": "c93340f2…", "size": 39, "distinctNames": true, "files": [File, File] }] }
```
`distinctNames: true` = same content under different names. (1.0 clients reading `groups` are unaffected.)

`mode=similar-images` (`distance` 0–16, default 6 = number of differing bits of a 64-bit difference hash):
```json
{ "mode": "similar-images", "distance": 6,
  "groups": [{ "maxDistance": 2, "files": [{ "…File": "…", "dhash": "90d0000000000000" }, { "…File": "…", "dhash": "90c0000000000000" }] }] }
```
A group holds at least two **different** contents that look alike (resized, re-encoded, converted); exact copies of
a member are included in its group. Rotated or cropped pictures are not matched. Nothing is ever deleted.

### 7.5 Versions
**`GET /api/v1/files/:id/versions`** →
```json
{ "fileId": "5c8a03c4-…", "currentVersionId": "ad4c0df5-…",
  "versions": [{ "id": "ad4c0df5-…", "seq": 1, "size": 740, "sha256": "38777b16…", "createdAt": "…", "note": "",
                 "current": true, "scan": "clean",
                 "createdBy": { "userId": "1f6c3c04-…", "displayName": "Alice Tremblay", "me": true } }] }
```
Newest first. `createdBy` is `null` for a deposit-portal file; it is a member when the version came through a grant.
**`GET /api/v1/files/:id/versions/:versionId/content`** → the bytes of that version (`Range`, `?download=1`;
`451 infected` unless `?download=1&infected=ack`). Same as the 1.0 `GET /files/:id/content?v=<versionId>`.
**`POST /api/v1/files/:id/versions/:versionId/restore`** (1.0 route, behaviour verified): the old content becomes a
**new current version** (`seq` = highest + 1, `note: "restored from version N"`); every existing version is kept.
Restoring the content that is already current records nothing.

### 7.6 Upload history — `GET /api/v1/uploads?state=recent|active&limit=`
```json
{ "uploads": [{ "id": "3712e0bb-…", "name": "Copie du budget.csv", "size": 39, "received": 39, "status": "done",
                "fileId": "7c32cf6f-…", "fileExists": true, "folderId": "7e53e088-…", "grantId": null,
                "createdAt": "…", "updatedAt": "…" }] }
```
The caller's own uploads, most recently updated first (`limit` ≤ 500, default 200). `status` ∈
`active | completing | done | aborted`. `fileId` is set when `done`; `fileExists` is false once that file was trashed
or purged. Finished and aborted uploads are kept 7 days. `state=active`: only `active` and `completing`.

## 8. Administration — `GET /api/v1/admin/system` (administrators; 404 for others)
All 1.0 fields are unchanged. New fields:
```json
{ "version": "2.0.0", "features": ["events", "…"],
  "worker": { "alive": true, "heartbeatAgeS": 32, "pid": 24660 },
  "jobs": [{ "kind": "extract_text", "status": "done", "count": 5, "oldestAgeS": null },
           { "kind": "scan_object", "status": "queued", "count": 2, "oldestAgeS": 4 }],
  "previewFailures": [{ "kind": "thumb", "count": 1, "lastError": "image conversion failed: …" }],
  "converter": { "available": true, "path": "/Applications/LibreOffice.app/Contents/MacOS/soffice" },
  "textkit": { "available": true, "contextual": true },
  "antivirusSignatures": { "engine": "1.4.3", "signatures": 27824, "signaturesAt": "2026-11-18T14:24:11.000Z", "ageS": 100820 },
  "index": { "enabled": true, "ocr": true, "byStatus": { "ready": 5 }, "semantic": { "available": true, "model": "apple-nl-contextual", "dim": 512 } },
  "events": { "owners": 0, "streams": 0, "timers": 0 },
  "backup": { "dir": "/Users/…/backups/sp-drive",
              "last": { "ok": true, "at": "…", "startedAt": "…", "durationS": 41, "dump": "sp-drive-20261119-0340.dump.enc", "dumpBytes": 181234, "dumpSha256": "…", "dumpsKept": 30, "blobs": 51, "blobBytes": 40912345678, "remote": null, "ageS": 37800 },
              "restoreTest": { "ok": true, "at": "…", "dump": "…", "objects": 25, "files": 25, "ageS": 86400 },
              "verify": { "ok": true, "at": "…", "host": "m5ma", "dump": "…", "dumpChecked": true, "dumpDecrypted": true, "sampled": 30, "liveCompared": 30, "mismatched": 0, "missing": 0, "objects": 51, "errors": [], "ageS": 600 },
              "offNode": null } }
```
- `worker.alive` = a heartbeat less than 180 s old. `jobs`: everything not done, plus what finished in the last 24 h;
  `oldestAgeS` only for `queued` / `running`. `converter`, `textkit`, `antivirusSignatures` are what the **worker**
  last reported (`available: null` before its first heartbeat).
- `backup.*` are the JSON status files in the backup directory, each `null` when absent, each with `ageS` computed
  from its `at`: `status.json` (written by `scripts/backup.sh`; `ok: false` with `error` when a run stopped),
  `restore-test.json` (`scripts/restore-test.sh`), `verify.json` (`scripts/backup-verify.sh`), `offnode.json`
  (written by the off-node puller: run `scripts/backup-verify.sh <copy> --no-key --write offnode.json --label <node>`
  on the other node and copy the file back into the backup directory).
