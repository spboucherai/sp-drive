# SP Drive Next Generation — audit and delivery record (2026-11-19)

"Verified" means a command was run and its result observed. Per-platform detail: `sp-drive-macos.git docs/next/AUDIT-macOS.md`,
`sp-drive-ios.git docs/next/AUDIT-iOS.md`, this repository `docs/next/API-NEXT.md`, `PERF-web.md`, `DESIGN-SYSTEM-V2.md`.

## Starting point (1.0, measured before any change)
| | State | Baseline |
|---|---|---|
| Backend + web (m5ma:8660) | production, 1 account, 25 files (38 GB), nightly sealed backup on the same SSD | 75 integration tests; Playwright 118 passed / 4 failed (office conversion) |
| macOS 1.0.0 | notarized, installed; production Finder location never enabled by the owner | 42/42 tests, self-test 19/19, Finder scenario 22/22 (test variant) |
| iOS 1.0.0 (1) | TestFlight, never run on a real device | engine 12/12, hosted 6/6, UI 3/4 |

Known 1.0 defects found: LibreOffice frozen by a pending Gatekeeper evaluation on its path (office previews dead in production);
no off-node backup; a download finished while the iOS app was dead was fetched again; no CI; no English on macOS.

## Delivered state (2.0)
| | Commit | Verified |
|---|---|---|
| Backend + web | `0073557` on `main`, live on drive.spboucher.ai | 147 integration tests; Playwright 150 passed / 0 failed; migration `003_next` rehearsed twice on a copy of production (up/down/up); production smoke 22/22 twice; 39 objects re-hashed after the upgrade, 0 damaged |
| macOS 2.0.0 (3) | `c6c11d2`, tag `v2.0.0` | 61/61 + 14/14 tests, self-test 75/75 twice, Finder scenario 22/22 (test variant), notarized + stapled, installed, seen by production as `macos/2.0.0` |
| iOS 2.0.0 (2) | `c3188a5`, tag `v2.0.0` | engine 40/40, hosted 10/10 ×2, UI iPad 15/15, UI iPhone 13/15 (1 iPad-only skip, 1 timing-dependent failure that passes alone); App Store Connect build `VALID` |

Checked on production itself after the upgrade: content search with highlighted snippets (Word, Excel), OCR, event stream through the
public gateway (hello + change), collections, storage overview, activity, semantic search answering, Word → PDF conversion, antivirus
(EICAR refused), share link create/open/revoke, portal deposit, and SP Drive AI with the **real local model** (Qwen3 30B on the cluster):
correct answer with citation `[1]`, and no model call when nothing is retrieved. An independent security review found one blocking
defect and 13 others; all 14 were fixed with regression tests before deployment (see SECURITY-REVIEW.md).

## Not verified (honest list)
- Anything on a real iPhone/iPad: passkey + Face ID, document camera, Apple Pencil, cellular/Low Power signals, background transfers across a lock.
- Finder integration against production: the production location is user-disabled in System Settings (owner action required).
- Anthropic / OpenAI / OpenRouter providers (no key; code paths tested against fake servers only).
- Web animations (card → preview morph, drop targets) never observed; no frame-rate trace. High-contrast, reduced-motion, screen readers.
- Similar-images duplicates with real look-alike photos; real pointer drags on macOS; the macOS status-item popover.
- Cross-language semantic search does not work (recall 0.00 FR↔EN); same-language recall@1 0.67.

## Not built
Spatial Drive; English on macOS; full English on iOS (638 strings done, ~144 interpolated ones + extensions remain); moving items
inside a shared folder (web); shared folders through the File Provider domains; merging the two 1.0 Swift engines.
