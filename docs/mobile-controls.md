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
  opt-in via `?desktopOnly`; touch devices load with an "experimental" toast.
  (`packages/website/src/index.ts`)
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
  installs `window.__FBE_TEST__.getState()` (logical input mode + quickbar
  bounds/scale/visibility, in CSS px); see `packages/editor/src/common/testHook.ts`.
  Opt-in, so it's absent in normal use. Extend its `EditorTestState` to unblock
  the deferred touch `fixme`s below (e.g. add blueprint entity count for
  tap-to-place).

## Not done / next

- ⬜ **On-screen action toolbar** — mobile has no keyboard, so mirror the
  `actions.ts` registry into on-screen buttons: rotate / flip / pipette / copy /
  delete / undo / open-inventory. This is the natural next slice.
- ⬜ **Touch area/marquee select** — multi-select for copy/delete is desktop-only
  (drag with a modifier); needs a touch gesture (e.g. long-press-drag).
- ⬜ **Blueprint persistence across reloads** — the blueprint is _not_ saved
  locally today (only quickbar / settings / keybinds are); persistence is via
  blueprint strings + `?source`. Mobile users can't easily Ctrl+C, so an autosave
  (serialize on `visibilitychange`, restore on load) would help a lot.
- 🚧 **e2e coverage gaps** (both `fixme`): pinch needs CDP
  `Input.dispatchTouchEvent` (the high-level touch API is single-touch);
  tap-to-place can now read state via the `?test` hook above — extend
  `EditorTestState` with blueprint state and drop the `fixme`.
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
