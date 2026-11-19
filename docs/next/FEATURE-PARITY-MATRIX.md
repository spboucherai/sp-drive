# SP Drive 2.0 — feature parity matrix (2026-11-19)

T = implemented and covered by an automated test or an observed run · B = built, not exercised · — = absent.
iOS/iPadOS results are simulator-only.

| Feature | Web | macOS | iOS | iPadOS | Note |
|---|---|---|---|---|---|
| Browse, folder operations | T | T | T | T | |
| Uploads (resumable), downloads | T | T | T | T | |
| Transfer centre (speed, pause, retry, history) | T | T | T | T | upload history from the server on the web |
| Live refresh (events + polling fallback) | T | T | T | T | |
| Search in names | T | T | T | T | |
| Search in content with snippets, OCR | T | T | T | T | |
| Semantic search | T | T | B | B | same-language only |
| Favourites | T | T | T | T | |
| Tags | T | — | T | T | macOS has no tag support |
| Versions timeline, restore, text diff | T | T | T | T | |
| Image / PDF version comparison | T | B | B | B | |
| Trash | T | T | T | T | |
| Share links (expiry, password, limits, rotation, log, QR) | T | T | T | T | |
| Private sharing: members and roles | T | T | T | T | |
| Shared with me | T | T (API level) | T | T | online only on native; editor cannot move on the web |
| Deposit portals + builder | T | T | T | T | |
| Smart collections | T | T | T | T | |
| Activity (file, account) | T | T | T | T | |
| Storage command centre | T | T | T | T | |
| Duplicates (exact) | T | T | T | T | |
| Duplicates (similar images) | B | B | B | B | never run on real look-alikes |
| Ask a document / Ask my Drive | T | T | T | T | real local model verified through the API; clients tested with a fake model |
| AI organisation suggestions | T | T | B | B | |
| Devices dashboard | T | T | T | T | |
| Admin infrastructure view | T | T | B | B | admins only |
| Command palette | T | T | — | T (shortcuts) | platform difference |
| Offline files, offline operations | — | T | T | T | web is online by nature |
| Conflict resolution sheet | — | T | T | T | conflicts arise on syncing clients |
| Finder / Files integration | — | T (test variant) | T | T | production Finder location awaits activation |
| Menu bar command centre, drop zone, Spotlight | — | T / T / T | — | — | macOS only |
| Share extension, widgets | — | — | T | T | |
| Document scanner + OCR, PDF annotation | — | — | T (pipeline) | T (pipeline) | camera and Pencil need a device |
| Wi-Fi only / Low Power / bandwidth cap | — | T | T | T | simulated conditions |
| English | T | — | partial | partial | |
