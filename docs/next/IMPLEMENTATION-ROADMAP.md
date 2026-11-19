# SP Drive Next Generation — roadmap: done and remaining (2026-11-19)

| Phase | Status |
|---|---|
| 1 Audit | done — three repositories, baselines re-run |
| 2 Architecture | done — `ARCHITECTURE-NEXT.md`, `API-NEXT.md` (23 recorded deviations), shared Swift package `SPDriveNext` |
| 3 Design | done on the three clients (`DESIGN-SYSTEM-V2.md`, one token table); Spatial Drive not built |
| 4 Sync engine | done — events, adaptive concurrency, priorities, backoff, caps, policies, crash-safe resume, conflict sheets |
| 5 Apple integration | done in code — Finder decorations/actions, menu bar, drop zone, Spotlight; share extension, widgets, scanner + OCR, PDF annotation; device validation outstanding |
| 6 Search | done — full text, OCR, optional semantic (same-language only) |
| 7 AI | done — local model live in production; external providers built, off, untested for real |
| 8 Sharing | done — members, roles, workspaces, shared-with-me |
| 9 Portals | builder with live preview done; smart intake (classification, routing) not built |
| 10 Storage | done — command centre, collections, duplicates |
| 11 Security & reliability | done — independent review + 14 fixes, off-node backup, verify scripts, `scripts/ci.sh` (manual trigger, no automatic pipeline) |
| 12 Testing | done per platform; the full iPhone → Web → Finder scenario on production is blocked by the disabled Finder location and the absence of a device |
| 13 Delivery | web/API live; macOS notarized, published, installed; iOS 2.0.0 (2) on TestFlight |

## Next, in order of value
1. Owner: enable the SP Drive location in System Settings (File Providers); install TestFlight build 2 and run the device pass in `sp-drive-ios docs/next/DELIVERY-CHECKLIST.md`.
2. Run the cross-device scenario of the brief (§20.5) on production once 1 is done.
3. English: macOS String Catalog; finish iOS.
4. Automatic CI on push (spbgit hook → `scripts/ci.sh`).
5. A multilingual embedding model for cross-language semantic search.
6. Shared folders inside the File Provider domains; move inside a shared folder on the web.
7. Portal smart intake; Spatial Drive; watched validation of the animations with a frame-rate trace.
8. Remove the caches left by development on m5ma (`~/dev/sp-drive-next*`, test databases) once no longer needed.
