# SP Drive 2.0 — web performance, before and after

Measured on the node (m5ma, Apple M5 Pro) on 2026-11-19. "Before" is commit `ace03c1` (branch `next` before the web
work, i.e. the 1.0 interface on the 2.0 API), built in a separate worktree; "after" is the head of `next`.

## Method (the same for both)

- `pnpm build` in each checkout; sizes are the files Vite wrote to `dist/web/assets` (raw, and gzip of each file).
- `scripts/perf-web.sh <checkout> <label> <port>` starts **that checkout's API** on a scratch database with **its built
  bundle** (not the Vite dev server), creates an account with a virtual passkey, seeds it (3 folders and 12 files at
  the root; a folder with **2,000 files**: 100 uploads, then copied in place 19 times), and runs
  `scripts/perf-web.mjs` with headless Chromium (Playwright 1.65), viewport 1440 × 900, localhost.
- Each figure is the **median** of 9 loads (explorer root) or 5 loads (2,000-file folder). Every load starts from another
  document, with a warm HTTP cache.
  - *first row*: `performance.now()` (from navigation start) when the first row of the listing is in the DOM, taken by
    a `MutationObserver` installed before any script of the page.
  - *long tasks*: sum of the `longtask` entries (> 50 ms) from navigation start to network idle.
  - *DOM nodes*, *rows rendered*: counted after network idle.
  - *select*: from a click on the first row to the frame that paints it selected.
- *transfer*: script and style the explorer route downloads on a cold cache (`performance.getEntriesByType('resource')`).
  The API serves files uncompressed; the reverse proxy compresses in production, hence the gzip column of the bundle table.

Run it again: `pnpm build && zsh scripts/perf-web.sh "$PWD" after 8672` (and the same on a worktree of the commit to compare).

## Results

### Explorer and the 2,000-file folder

| | before | after |
|---|---|---|
| Explorer root (3 folders, 12 files) — first row | 331 ms | 334 ms |
| — long tasks | 0 ms | 0 ms |
| — DOM nodes | 442 | 486 |
| — select a row | 29 ms | 32 ms |
| 2,000 files, list — first row | 466 ms | **373 ms** |
| — rows rendered at first | 2,000 | **240** (the rest as the end of the list comes into view) |
| — DOM nodes | 38,202 | **4,787** |
| — long tasks | 1,320 ms | **0 ms** |
| — select a row | 55 ms | **30 ms** |
| 2,000 files, grid — first row | 413 ms | **367 ms** |
| — DOM nodes | 34,193 | **4,778** |
| — long tasks | 990 ms | **0 ms** |
| — select a row | 45 ms | **30 ms** |
| Explorer route, cold cache: script + style | 17 requests, 667 kB | 28 requests, 795 kB |

What changed for large folders: the listing renders 240 rows, then 240 more each time a sentinel 800 px before the end
enters the viewport (`IntersectionObserver`); keyboard navigation to a row not rendered yet (End, Shift+End) renders
the whole list first, select-all works on the data, not on the DOM. The 1.0 `content-visibility: auto` on list rows is
kept. The staggered entrance of 1.0 (a per-child animation) is gone: one `navigate` motion on the container.

The route is heavier by 128 kB uncompressed (11 more small requests): the shell now carries live refresh, the
transfer centre and the 2.0 dictionary (two languages, ≈ 45 kB), and the explorer the inspector. First row at the
root did not move (331 → 334 ms, within noise).

### Bundle, per chunk (kB raw / kB gzip)

| chunk | before | after | note |
|---|---|---|---|
| `index` (entry: router, i18n, react-query) | 263.0 / 82.6 | 242.4 / 76.4 | a new shared chunk `useBaseQuery` (23.1 / 7.7) appeared beside it |
| `ui` (React DOM + building blocks) | 141.4 / 43.8 | 191.8 / 58.2 | the bundler groups shared modules differently now that more lazy screens import them (not analysed module by module) |
| `Explorer` | 73.4 / 21.3 | 65.0 / 18.4 | the viewer left it (below) |
| `Viewer` (lazy with the explorer) | in `Explorer` + `Thumb` (31.9 / 10.4) | 29.7 / 9.7 + `Thumb` 2.7 / 1.4 | |
| `Shell` | 24.4 / 7.9 | 24.5 / 7.8 | palette is now lazy (7.9 / 3.2) |
| `UploadPanel` (transfer centre) | in `Explorer` | 21.4 / 7.1 | loaded with the shell |
| `PdfView` (pdf.js, lazy) | 477.6 / 143.4 | 477.8 / 143.5 | unchanged; also used on demand by the PDF version comparison |
| `MarkdownView` (lazy) | 80.8 / 27.5 | 80.8 / 27.5 | |
| `Settings` / `Admin` (lazy) | 17.4 / 4.8 · 13.9 / 3.9 | 20.9 / 5.8 · 21.7 / 5.9 | devices, AI switch, infrastructure |
| `RequestDialog` (lazy) | 15.5 / 4.9 | 22.0 / 6.4 | live preview |
| new lazy screens | — | `Storage` 15.4 / 4.8 · `TimeMachine` 14.3 / 5.0 · `Ask` 13.9 / 5.2 · `Collections` 13.8 / 4.4 · `Shared` 13.7 / 4.2 · `Activity` 7.5 / 2.7 · `Members` 7.0 / 2.6 · `Suggest` 5.2 / 2.1 | each loads on first use |
| CSS (`index`) | 67.5 / 13.7 | 82.1 / 16.6 | token layer (3 themes × contrast), new utilities |
| **all script** (30 → 48 files, pdf worker excluded) | 1,283 / 400 | 1,482 / 466 | +199 kB raw for every 2.0 screen |
| **all style** | 72.8 / 14.9 | 87.3 / 17.7 | |

No dependency was added: the charts (treemap, bars, rings), the line diff, the SSE reader and the view-transition
morph are written in the application (`next/Storage.tsx`, `next/diff.ts`, `next/ai/stream.ts`, `explorer/Explorer.tsx`).
Heavy views stay lazy: pdf.js, the Markdown pipeline, every 2.0 screen, the palette, the time machine, the member and
suggestion dialogs.

### Motion

Animations use `transform` and `opacity` only (progress bars are scaled, rings animate a stroke offset), so they run
on the compositor; no frame-rate trace was recorded in this delivery — the long-task figures above are the only
measured smoothness indicator.
