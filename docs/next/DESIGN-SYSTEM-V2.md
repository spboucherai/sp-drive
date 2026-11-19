# SP Drive Visual System 2.0 — web

The token contract is shared by the three clients and lives in `sp-drive-macos.git`, `docs/next/DESIGN-SYSTEM-V2.md`
(macOS: `SPDTheme`). This file is the **web section**: how the web application mirrors those tokens, what it adds, the
components built on them and the motion rules. Implementation: `apps/web/src/styles.css` (tokens, motion),
`apps/web/src/ui.tsx` (building blocks), `apps/web/src/next/` (2.0 screens).

## 1. Principles, as applied on the web

1. **Calm surfaces.** White canvas (`canvas`), one pane colour for the sidebar and the inspector (`surface`), one well
   behind previews and tracks (`sunken`). No gradient background, no glow, no card around a whole screen. Lists and
   groups are delimited by a hairline (`elevation.e0`), not by a filled card.
2. **Editorial type.** The serif (`ui-serif, "New York", "Iowan Old Style", Georgia`) names places and moments: every
   `h1` (folder titles, screen titles), dialog titles, empty states, the product name. Everything you operate is the
   system sans. Group labels are the `eyebrow` (10 px, semibold, +0.06 em, uppercase).
3. **One accent.** Violet `brand` for controls, selection, progress, links. The indigo → violet gradient exists in the
   app mark only. The 1.0 gradient classes (`.grad`, `.btn-grad`, `.text-grad`) are kept as names and are now flat.
4. **Restrained translucency.** `.glass` (the `bar` colour + 20 px blur) is used where content really passes
   underneath: the command palette, menus and popovers, the phone tab bar. Nowhere else.
5. **Meaning is never colour alone.** Status colours always come with a glyph or a word (`Badge`, activity dots carry
   an icon, the live indicator has a label, chart swatches have a name and a value).
6. **Motion explains, then gets out of the way.** Every animation is one of the named motions below, transform /
   opacity only, with a reduced form.

## 2. Tokens

All tokens are CSS custom properties on `:root`, re-declared under `.dark` (the class is on `<html>`, or on a subtree
such as the immersive viewer) and under `@media (prefers-contrast: more)`. Names and values are the shared ones.

| Shared token | CSS variable | Tailwind utility used in components |
|---|---|---|
| `brand`, `brandIndigo` | `--spd-color-brand`, `--spd-color-brand-indigo` | `bg-accent`, `text-accent` |
| `brandWash`, `selection` | `--spd-color-brand-wash`, `--spd-color-selection` | `bg-accent-soft`, `bg-selection` |
| `canvas`, `surface`, `surfaceRaised`, `sunken` | `--spd-color-canvas` / `-surface` / `-surface-raised` / `-sunken` | `bg-canvas` (`bg-bg`), `bg-pane` (`bg-hover`), `bg-surface` / `bg-raised`, `bg-well` |
| `hairline` | `--spd-color-hairline` | `border-line`, `divide-line` |
| `textPrimary`, `textSecondary`, `textTertiary` | `--spd-color-text-primary` / `-secondary` / `-tertiary` | `text-ink`, `text-ink-2`, (see below) |
| `onBrand` | `--spd-color-on-brand` | `text-on-brand`, `text-accent-ink` |
| `positive`, `warning`, `critical` | `--spd-color-positive` / `-warning` / `-critical` | `text-ok` / `text-warn` / `text-danger` (+ `bg-*-soft`) |
| type scale `display … figure` | `--spd-type-display`, `-title`, `-headline`, `-body`, `-body-strong`, `-callout`, `-caption`, `-eyebrow`, `-mono`, `-figure` (CSS `font` shorthands) | classes `.spd-display`, `.spd-title`, `.spd-eyebrow`, `.spd-mono`, `.spd-figure` |
| `Space.xxs … xxxl` | `--spd-space-xxs` … `--spd-space-xxxl` (2 · 4 · 8 · 12 · 16 · 24 · 32 · 48) | Tailwind's 4-px scale (`gap-2` = `sm`, `p-4` = `lg`…) |
| `Radius.xs … xl` | `--spd-radius-xs` … `-xl` (4 · 6 · 10 · 14 · 20) | `rounded-md` 6, `rounded-[10px]` / `rounded-xl` 10, `rounded-[12px]`, `rounded-[14px]`, `rounded-[20px]` |
| `Size.gridCell`, `Size.palette` | `--spd-size-grid-cell` (148), `--spd-size-palette` (620) | grid `minmax(10.5rem, 1fr)` (168 px: the 148 step plus the cell padding); palette `max-w-[620px]` |
| `Elevation.e0 … e3` | `--spd-elevation-e0` … `-e3` (each includes the hairline; shadow opacity ×1.7 in dark through `--spd-shadow-k`) | `shadow-(--spd-elevation-e0)`, `shadow-card` = e1, `shadow-pop` = e2 |
| durations, curves | `--spd-duration-instant/quick/standard/slow`, `--spd-curve-standard/enter/exit/spring-snappy/spring-gentle` | — |
| motions | `--spd-motion-select/hover/navigate/reveal/dismiss/drop/progress/ambient` (`<duration> <curve>`) | classes of §4 |

The short names the 1.0 components were written with (`--bg`, `--surface`, `--ink`, `--accent`, `--line`…) are now
aliases of the shared tokens, declared once: this is what re-skinned the 8,000 existing lines without rewriting them.

### Web additions (not in the shared table)

| CSS variable | Light / dark | Why |
|---|---|---|
| `--spd-color-text-tertiary-aa` | `#6C6C76` / `#9696A0` | `textTertiary` is 3.4 : 1 on white. The web uses the tertiary role for 11–13 px captions everywhere, which WCAG AA wants at 4.5 : 1. `text-ink-3` therefore maps to this AA form (5.2 : 1 on white, 5.9 : 1 on the dark canvas); the exact `textTertiary` stays available for large glyphs and chart neutrals. |
| `--spd-color-hairline-strong` | black 17 % / white 20 % | Field borders (inputs, selects) need more than a separator to read as a control. |
| `--spd-color-positive-wash`, `-warning-wash`, `-critical-wash` | status colour at 10–16 % | Soft fills behind status text (badges, banners). |
| `--spd-color-scrim`, `--spd-color-bar` | — | The veil under sheets; the translucent bar/menu material. |
| `--spd-viz-1 … 8` | `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #6250d6 #e34948` / dark steps | Categorical palette of the storage charts, in fixed slots (image, PDF, document, sheet, video, audio, archive, text). Checked with a colour-vision validator on both canvases: adjacent pairs ≥ ΔE 8 under protan/deutan simulation, ≥ ΔE 15 for normal vision. Three light-mode slots are under 3 : 1 against white, so a swatch is never alone: the legend always gives the name and the value. |
| `--spd-curve-spring-snappy`, `-spring-gentle` | cubic-bézier approximations | CSS has no spring; the two shared springs are approximated (`(0.3, 1.25, 0.5, 1)`, `(0.25, 1.1, 0.4, 1)`). |

Body size: the shared `body` is 13 px (macOS point size). The web uses 13 px for rows, menus and controls on pointer
devices (`sm:` and up) and 15–16 px on phones (touch targets 44 px, and iOS zooms a focused field under 16 px).

Contrast computed (WCAG 2.1 ratio, light / dark, against `canvas`): `textPrimary` 18.0 / 15.4 · `textSecondary` 6.6 /
7.1 · `textTertiary` 3.4 / 4.2 (hence the AA form) · tertiary-AA 5.2 / 5.9 (4.8 on `surface` and on `surfaceRaised`
dark) · `brand` 5.8 / 5.7 · `onBrand` on `brand` 5.8 / 6.1 · `positive` 4.1 / 7.8 · `warning` 4.0 / 9.3 · `critical`
5.3 / 6.2. In light mode `positive` and `warning` are under 4.5 : 1: they are used with a glyph, at 13 px medium or
larger, or as fills — never as the only carrier of a small caption.

## 3. Components

| Component | Where | Notes |
|---|---|---|
| Shell | `shell/Shell.tsx` | Sidebar on `surface` with a hairline (places · collections · library · storage meter), top bar (search well, live indicator, transfers, theme, notifications, account). Phones: compact top bar + translucent tab bar (4 destinations + "Plus"). |
| Buttons | `ui.tsx` `Button`, `IconButton` | Radius `md`; 44 px on touch, 36 px with a pointer. Primary = flat `brand`. |
| Dialog | `ui.tsx` `Dialog` | `layout="sheet"` (bottom sheet on phones, card elsewhere, `wide` / `wide="xl"`), `"palette"` (bare translucent panel, 620 px, near the top), `"side"`. Focus is trapped and restored, Escape closes, the title is the accessible name. |
| Menu | `ui.tsx` `Menu` | Popover on pointer devices (translucent, e2), action sheet on phones. Arrow keys, Home/End, Escape. |
| Empty state | `ui.tsx` `EmptyState`, `art.tsx` | Halo symbol in the accent, `display` title, one sentence, **real actions** (upload, new folder, receive files here, clear filters, search by meaning, go to my files). |
| Folder tile / file card / list row | `explorer/Items.tsx` | Folder: a hairline tile with the accent symbol. File: the thumbnail in a `sunken` well (radius `md`), name and facts under it, no card chrome. Selected: `selection` wash + accent ring. List: one hairline group, 48 px rows (64 px on phones). Search results add the snippet with `<mark>` and a page chip. |
| Inspector | `next/Inspector.tsx` | Docked pane (sheet on phones, side pane in the viewer): Details · Activity · Text · Members · Ask. Opening it never leaves the listing. |
| Transfer centre | `explorer/UploadPanel.tsx` | Mounted by the shell: reachable from every screen (top-bar button, palette). Ring + bar with real bytes, speed, remaining bytes, pause / resume / retry / cancel, interrupted sessions, history from `GET /uploads?state=recent`. Stays beside the inspector. |
| Command palette | `shell/Palette.tsx` | Actions of the screen in front (from `next/context.ts`), navigation, collections, recent files, files by name and content with the passage. |
| Timeline | `next/Activity.tsx` | Icon dot + sentence + who + when, grouped by day; used by the inspector, the folder dialog, the member view and the account page. |
| Time machine | `next/TimeMachine.tsx` | Version rail + comparison pane: line diff (Myers, `next/diff.ts`), images and PDF pages side by side, an explicit statement for other binary formats. |
| Storage charts | `next/Storage.tsx` | Segmented quota bar, stacked bar by kind with a labelled legend, squarified treemap with drill-down, 90-day bars, largest files with proportional washes. Plain SVG/CSS, ~200 lines, no chart library. |
| Collection builder | `next/Collections.tsx` | Field · comparison · value rows, all/any, sort, live preview from `POST /collections/preview`. |
| Members | `next/Members.tsx`, `next/Shared.tsx` | Invite by exact address, role picker with what each role allows, workspace name, folder activity; member side with role-appropriate UI. |
| AI | `next/ai/` | Streamed answer, `[n]` citation chips that reveal and open the source, route/model selector with original monochrome marks (`marks.tsx`: MacLustr, Anthropic, OpenAI, OpenRouter) and the maker of the model in words, explicit unavailable states, review list for suggestions. |
| Portal builder | `sharing/RequestDialog.tsx`, `next/PortalPreview.tsx` | The 1.0 form beside a live, inert preview of the public page ("Deposit" / "After sending"). |
| Public pages | `public-pages/` | Same tokens; the portal keeps its owner-chosen brand colour for the header band and the send button. |

Accessibility rules applied everywhere: every control has a text label or `aria-label`; tabs are `role="tab"` with
`aria-selected`; the listing is a `grid` with roving focus; focus is visible (2 px accent outline, fields show their
own border ring); dialogs and sheets trap and restore focus; live regions announce transfers, answers and counts;
nothing depends on hover (treemap and chart hints are also reachable by focus, and their figures are in the legends).

## 4. Motion

| Motion | CSS | Used for | Reduced motion |
|---|---|---|---|
| `select` | `var(--spd-motion-select)` | selection, pressed states | instant |
| `hover` | `var(--spd-motion-hover)` — `.press` | hover washes, button press (scale 0.97) | instant |
| `navigate` | `.anim-nav[data-dir]` (`nav-deeper` / `nav-back`: 18 px + fade), `.anim-side`, `.anim-rise` | **Fluid folder navigation**: entering a folder slides the listing in from the right, going back from the left, same level cross-fades (the direction comes from the breadcrumb depth). Side panes arrive from their edge. | 0.10 s fade, no shift (`--spd-navigate-shift: 0`) |
| `reveal` | `.anim-pop`, `.anim-sheet` | palette, menus, dialogs (sheet from the bottom on phones) | 0.10 s fade |
| `dismiss` | `var(--spd-motion-dismiss)` | closing | 0.10 s fade |
| `drop` | `.drop-target` (`drop-pulse`: scale 1 → 1.05 → 1.03, wash, accent ring, e2) | **A valid drop target answers the drag**: folder tiles, breadcrumb crumbs, the upload surface of a shared folder, the desktop drop overlay | wash and ring only |
| `progress` | `transform: scaleX()` with `var(--spd-motion-progress)`; `stroke-dashoffset` for rings | progress bars, the storage meter, the transfer ring | same |
| `ambient` | `.anim-ambient` | the live indicator while the stream is down | removed |
| chart entrance | `.anim-grow-x`, `.anim-grow-y`, `.anim-cell` (slow, `enter`) | storage bars and treemap cells growing from their baseline | none (global rule below) |

**File card → preview morph.** Opening a file runs a View Transition: the thumbnail of the card gets
`view-transition-name: spd-morph`, the state changes inside `document.startViewTransition` (`flushSync`), and the
content area of the viewer carries the same name — the browser animates one element from the card's rectangle to the
full preview (`::view-transition-group(spd-morph)`, slow / enter). Closing runs it backwards. Where the API is missing
(Firefox at the time of writing) or reduced motion is on, the viewer simply fades in. The theme switch uses the root
view transition.

Rules: only `transform` and `opacity` are animated (progress bars are scaled, not resized; rings animate a stroke
offset); nothing loops except `ambient`, the spinner and the loading shimmer;
`@media (prefers-reduced-motion: reduce)` maps the motion variables to their reduced forms and cuts every remaining
animation and view transition to nothing.

## 5. What is deliberately not here

- No external font, icon font, script or image: the CSP is `script-src 'self'; connect-src 'self'`. Icons are inline
  SVG paths (`glyphs.tsx`), illustrations are drawn in code.
- No chart or animation library.
- "Spatial Drive" (free canvas) is not part of this delivery — see `PERF-web.md` / the delivery notes.
