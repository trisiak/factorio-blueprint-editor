# Mobile / touch controls

Tracking doc for the touch-support arc: what's done, what's not, and where the
pieces live. Intentionally light — update the checkboxes as work lands.

Status: ✅ done · 🚧 partial · ⬜ not started

## Goal

Make the editor usable on touch devices without regressing the desktop
(mouse + keyboard) experience. The site used to hard-refuse to load on mobile.

## Architecture: explicit input mode

The page is in exactly one **input mode** at a time — `desktop` (mouse/keyboard)
or `mobile` (touch). They're mutually exclusive on purpose: running both
pipelines at once made touch taps double-act via the browser's synthetic
("compatibility") mouse events.

- Source of truth: `packages/editor/src/common/input.ts` — the `inputMode`
  controller. Auto-detects from `pointer: coarse` / `maxTouchPoints`, persists an
  explicit choice to `localStorage` (`fbe:inputMode`), emits `change`.
- Dispatch: `packages/editor/src/containers/BlueprintContainer.ts` reads the mode
  per pointer event. Desktop ignores `touch`; mobile ignores `mouse` and locks
  the canvas `touch-action: none`. Switching is live (no reload).
- Toggle: "Input Mode" dropdown in the settings pane
  (`packages/website/src/settingsPane.ts`).

## Done

- ✅ **Mobile gate lifted** — hard `MOBILE_DEVICE_NOT_SUPPORTED` block is now
  opt-in via `?desktopOnly`; touch devices load with an "experimental" toast,
  shown only once (persisted via `fbe:touchToastSeen`) so it doesn't nag on every
  reload. (`packages/website/src/index.ts`)
- ✅ **Blueprint persistence across reloads** — the working blueprint autosaves to
  `localStorage` (`fbe:blueprint`): serialized on `visibilitychange` (when the tab
  is hidden), restored on load. Clearing the editor (`shift+N` / emptying it)
  drops the save. A `?source` URL argument still wins on load (explicit intent);
  when both exist and differ, a toast offers a "Restore my saved blueprint" button
  (the mixed-state UX). `?source` parsing moved to `URLSearchParams` so raw
  blueprint strings (which carry `=` / `+` / `/`) survive. Storage + precedence
  logic lives in `packages/website/src/blueprintStorage.ts` (unit-tested); the
  loader wiring and autosave listener are in `packages/website/src/index.ts`;
  end-to-end coverage in `e2e/persistence.spec.ts`.
- ✅ **Pinch-zoom + two-finger pan** — framework-free `PinchPanRecognizer`
  (unit-tested), wired to `viewport.zoomBy` / `translateBy`.
  (`packages/editor/src/containers/PointerGestures.ts`)
- ✅ **One-finger tap vs. drag** — drag past ~10 px pans; release within
  10 px / 300 ms taps through the existing left-click pipeline (place / select /
  open unchanged).
- ✅ **Explicit desktop/mobile mode + double-tap fix** — see Architecture above.
- ✅ **Responsive overlays** — the INFO/shortcuts panel no longer overflows in
  portrait (`width: min(640px, 90vw)`, scrolls instead of clipping) and is now
  openable/closable without a keyboard (tap the corner panel; on-screen ✕). The
  quickbar scales to fit narrow viewports instead of running off both edges. The
  settings (dat.gui) pane gets touch-sized rows, a responsive width, and hides
  the keyboard-only Keybinds folder in `mobile` mode (driven by a `body.mobile`
  class off `inputMode`). (`packages/website/src/{index,settingsPane}.ts`,
  `index.styl`, `packages/editor/src/UI/QuickbarPanel.ts`)
- ✅ **Remaining pixi panels fit in portrait** — the quickbar fix left the other
  canvas panels overflowing on a phone. Now: the **wires** panel anchors off the
  quickbar's _actual_ (scaled) bounds and stacks above it when there's no room to
  the side (it previously fell entirely off the right edge); the **entity
  editors / inventory / entity-info** panels reuse the quickbar's `fitToWidthScale`
  to shrink to fit and clamp on-screen (the splitter editor is 504px, the
  inventory ~520px tall — wider/taller than a portrait phone). Shared
  `Panel.clampToScreen` helper. Covered in `e2e/panels.spec.ts` (the wires panel,
  via a new `wires` field on the `?test` hook). (`packages/editor/src/UI/`
  `WiresPanel.ts`, `EntityInfoPanel.ts`, `InventoryDialog.ts`, `controls/{Dialog,Panel}.ts`)
- ✅ **Settings moved off the quickbar** — dat.gui's bottom open/close bar sat on
  top of the quickbar (desktop too); it's hidden and replaced by a Settings
  button in the top-left stack, with the pane re-anchored just below it (tracked
  via a `ResizeObserver` on `#buttons`). On mobile the top-left buttons
  (Discord / Github / Settings) collapse to a flush column of square icon
  buttons to save space. (`index.html`, `index.styl`, `settingsPane.ts`)
- ✅ **Test + deploy infra** — vitest (`npm test`), Playwright e2e
  (`npm run test:e2e`, desktop + Pixel-7 projects), GitHub Pages production
  deploy + per-PR previews (shared atlas, `.nojekyll`). See
  `.github/workflows/pages-*.yml`.
- ✅ **Canvas e2e probe** — everything inside the editor is one `<canvas>`, so
  Playwright can't query on-canvas UI through the DOM. Loading with `?test`
  installs `window.__FBE_TEST__.getState()` (CSS px): logical input mode, screen
  size, `dialogOpen`, quickbar + wires bounds/scale/visibility, blueprint entity
  count, and the paint ghost's tile/direction; see
  `packages/editor/src/common/testHook.ts`. Opt-in, so it's absent in normal use.
  Extend its `EditorTestState` for any future on-canvas assertion.
- ✅ **Mobile layout: action rail + retired quickbar** — the layout redesign
  (PR #19). The keyboard-only actions are mirrored into a **left vertical rail**
  (DOM, mobile-only): as many priority-ordered buttons as fit stay in the rail,
  the rest collapse behind a ⋯ overflow sheet (1 column portrait, 3 columns
  landscape). The rail **reserves a left canvas inset** (`Editor.setViewportInsets`
  → `fbe:viewportchange`, which re-anchors the Pixi panels), so the canvas is
  _restricted_ rather than covered — the first real layout authority. The top-left
  logo + Github/Settings fold into the bar (Discord + the "Press I" hint dropped).
  Buttons route through `EDITOR.callAction`; **Cancel** (`closeWindow` →
  `clearCursor()`) is the keyboard-free way out of paint/copy/delete. With the rail
  carrying the build actions, the **bottom quickbar is retired on mobile** (its
  slots/keybinds still work; desktop unchanged), ending the bottom Pixi/DOM
  competition; the wires panel re-centres at the bottom. `actionToolbar.ts`,
  `index.{styl,ts,html}`, `Editor.setViewportInsets`/`onModeChange`, `Panel`;
  e2e `actionToolbar.spec.ts` + `panels.spec.ts`. Remaining: real game-sprite
  icons (unicode glyphs for now); touch box-select (#21).
- ✅ **Item-selector overhaul** (`InventoryDialog`, the shared item/recipe/module
  picker) — now touch-usable: **scrollable** group-tabs (◀▶) and item grid (▲▼),
  masked with viewport-gated hit-testing; a **Recents tab** (first/active) with
  three colour-coded sections — Recent / Quickbar / On-blueprint — seeded so it's
  never empty (`recentItems.ts`, persisted per category, reused by recipes/modules
  via `recentsKey`); **long-press preview** (quick tap commits, long-press opens a
  non-committing preview with **✓ Confirm** + **Pin/Unpin** that edits the quickbar
  in-dialog and refreshes live; recipe-on-hover gated to desktop, fixing the stray
  touch-drag tooltip); and a **responsive body width** so the tab scroll only
  engages when the tabs truly can't fit (more item columns on wider screens).

## Not done / next

- ⬜ **On-screen action toolbar — remaining polish**: real game-sprite icons
  (currently unicode glyphs — blocked on `.basis`→DOM delivery); touch box-select
  (issue #21).
- 🚧 **Touch placement: preview + confirm (Slice 1 done)** — desktop previews a
  placement by hovering (ghost shows orientation/validity before you click);
  touch had no such step — a tap committed blindly. Now, in `mobile` paint mode a
  tap **positions/previews** the ghost (the touch analogue of hover) and only a
  **second tap on the same tile** — or the on-screen **Place (✓)** button /
  `Enter` — commits it. Rotate/Flip from the toolbar preview live on the
  stationary ghost; the item stays in hand after a placement (place several with
  tap-elsewhere / tap-again). Seams: `BlueprintContainer.handlePaintTap()` +
  `confirmPlacement()` (new `confirmPlacement` action), `PaintContainer`'s ghost
  show/hide, and the hover handlers gated to desktop so synthetic touch
  `pointerout` no longer hides the ghost. The ghost is also pinned to its tapped
  world tile while you pan/pinch (the camera moves around it) — `GridData`'s
  pointer-move tracking and the per-frame `recalculate()` are gated to desktop,
  so a drag no longer drags the ghost along with the finger. Covered by
  `e2e/touchPlacement.spec.ts` via the extended `?test` hook (`paint` +
  `blueprint.entityCount`), incl. a CDP one-finger-drag pan assertion. **Slice 2
  (next):** one-finger _drag_ paints a continuous line (belts/pipes) — reuse the
  existing `gridData.on('update32', build)` drag-place path; tap stays deferred.
- 🚧 **Touch editing: select first, open on second tap** — same deferral for
  opening an entity's settings. On mobile the first tap on an entity selects it
  (`updateHoverContainer` already shows its info panel, highlight and range) and
  only a second tap on the _same_ entity opens the editor overlay, so a glance
  doesn't bury the canvas under a dialog. `BlueprintContainer.handleEditTap()`;
  desktop click-to-open is unchanged. A tap on the canvas _outside_ an open
  dialog dismisses it (dialogs swallow taps that land on them, so a tap reaching
  the BPC is necessarily outside) — so a stale editor doesn't linger when you tap
  away; re-tap an entity to open it. Covered in `e2e/touchPlacement.spec.ts`
  (`dialogOpen` added to the `?test` hook).
- ✅ **Touch placement of a pasted blueprint — drag / nudge / center** (issue #30) —
  a paste produces a multi-entity ghost that used to be unplaceable on touch (the
  only option was to blind-tap until it happened to land right). Now: a one-finger
  **drag that starts on the ghost grabs and moves it** (tile-snapped, preserving
  the grab point so it doesn't jump), while a drag starting **off** the ghost still
  pans the camera and two-finger pan/pinch always drives the viewport; **fine-tune
  arrows** (▲◀▶▼) in the rail — shown only in PAINT mode — nudge it a tile at a
  time (the arrow keys drive the same `moveEntity` path on desktop); and a **center
  crosshair** marks the ghost's origin (= the blueprint's bounding-box center) so
  taps/drags have a visible anchor. Drag-to-grab is restricted to the multi-entity
  paste ghost (`PaintBlueprintContainer`) — single-entity paint already positions
  fine by tapping. Seams: `BlueprintContainer` touch handlers (`touchPan.target`
  classify-once, `grabsPaintGhost`, `moveEntity` PAINT branch), `GridData.nudge()`,
  `PaintBlueprintContainer.containsWorldPoint()` + center-marker, `OverlayContainer`
  `updatePaintCenterMarker()`, the rail's mode-gated buttons (`actionToolbar.ts`).
  Covered by `e2e/touchPlacementMove.spec.ts` (CDP drag for grab-vs-pan, rail-arrow
  nudge, Place commit) via the `?test` hook (`paint.kind` + `spawnPasteGhost`).
- ⬜ **Touch area/marquee select** — multi-select for copy/delete is desktop-only
  (drag with a modifier); needs a touch gesture (issue #21). Pairs with the
  placement work above: a marquee **copy** hands you exactly the paste ghost that
  drag/nudge/center now makes placeable.
- 🚧 **e2e coverage gaps**: pinch needs CDP `Input.dispatchTouchEvent` (the
  high-level touch API is single-touch). Tap-to-place is now covered —
  `EditorTestState` was extended with `paint` + `blueprint.entityCount` and
  `e2e/touchPlacement.spec.ts` drives the deferred place/confirm flow.
- ⬜ **Pinch in desktop mode** — desktop currently ignores touch entirely, so a
  touch-laptop in desktop mode can't pinch. Out of scope for now (we don't care
  about touch-on-desktop yet); revisit if needed.

## Notes / tradeoffs

- `Editor.ts`'s window `pointerup` → `releaseButton` and `GridData`'s window
  `pointermove` still receive ghost-mouse events in mobile mode, but they're
  harmless no-ops (nothing held; the tap path re-seeds grid position before
  acting). Gate them if stricter isolation is ever wanted.
- Pen works in both modes (mouse-like on desktop, touch-like on mobile).
- The `/corsproxy` "import blueprint from a URL" feature is a Cloudflare Pages
  Function and does **not** work on GitHub Pages; paste-string import + editing do.
