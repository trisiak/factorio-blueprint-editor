# Mobile / touch controls

> **Companion doc:** [`mobile-layout-inventory.md`](./mobile-layout-inventory.md)
> (the screen-space map). **Open issues:** #52 (reposition a selection without
> breaking wires — the broader problem behind the in-place nudge).
> This doc is the source of truth for _what's done_ on the touch arc (it leads
> the issue tracker) — when a slice lands, close/tick the matching issue in the
> same change so they don't contradict each other. See CLAUDE.md "Keep issues
> in sync with the work".

Tracking doc for the touch-support arc: what's done, what's not, and where the
pieces live. Intentionally light — update the checkboxes as work lands.

Status: ✅ done · 🚧 partial · ⬜ not started

## Goal

Make the editor usable on touch devices without regressing the desktop
(mouse + keyboard) experience. The site used to hard-refuse to load on mobile.

## Architecture: input signals + per-pointer dispatch

Replaces the old binary input mode (#101 Slice 1). There is no longer a global
"which device am I" switch: **every pointer event is routed by its own
`pointerType`**, and the _environment_ is described by orthogonal, live signals
that drive chrome and sizing.

- **Per-pointer dispatch** — `packages/editor/src/containers/BlueprintContainer.ts`
  sends `mouse`/`pen` to the press + hover pipeline and `touch` to the tap /
  one-finger-drag / pinch recogniser, per event. A touchscreen laptop (mouse
  _and_ touch on one page) therefore just works; nothing has to be switched.
  The double-firing that originally motivated the switch is killed at the source:
  `touch-action: none` on the canvas **always**, plus `preventDefault()` on a
  touch `pointerdown` (a cancelled pointerdown suppresses the browser's
  compatibility mouse events). Hover, `GridData`'s window `pointermove` tracking
  and the per-frame `gridData.recalculate()` key off the event's `pointerType` /
  `touchRecent` rather than a global — so the touch ghost stays pinned to its
  tapped tile while the mouse ghost keeps following the mouse.
- **Signals** — `packages/editor/src/common/input.ts` (the `inputMode`
  controller), all live:
    - `coarse` — `matchMedia('(pointer: coarse), (hover: none)')`, i.e. the
      _primary_ pointer. `navigator.maxTouchPoints` no longer decides anything:
      the old `coarse || maxTouchPoints > 0` booted every touchscreen laptop into
      the touch UI (#101 B1).
    - `keys` — true from the start on a fine pointer; on a coarse one, false
      until the first _real_ keydown (synthetic events, IME/virtual-keyboard
      composition and typing into a focused field on a coarse device don't count).
    - `compact` — narrow viewport (≤ 768 px), live on resize/orientation.
    - `touchRecent` — the last pointer event on `window` was a `touch`
      (mouse/pen clear it). Micro-affordances only.
    - Exposed as body classes on the website (`coarse`, `keys`, `compact`,
      `touch-recent`) so most gating can become CSS.
- **Preset** — `auto` (default) | `mouse` | `touch`: an override of the _inputs_,
  not a third pipeline. A forced preset filters pointer types exactly as the old
  binary mode did (mouse ignores touch, touch ignores mouse). Persisted to
  `localStorage` `fbe:inputPreset`; the pre-#101 `fbe:inputMode` value **migrates
  to `auto`** and the old key is removed. Toggle: the "Input" dropdown in the
  settings pane (`packages/website/src/settingsPane.ts`).
- **Compatibility** — `inputMode.mode` survives as a _derived_ value (forced
  preset wins, else `coarse ? 'mobile' : 'desktop'`) and still emits `change`, so
  every consumer that hasn't migrated yet (the website clusters, the Pixi panels,
  `armMarquee`, `body.mobile`) keeps today's behaviour. It goes away when the last
  consumer moves onto the signals (#101, later slices).
- **Tests** — pure decision logic (migration, derived mode, the signal reducers)
  is unit-tested in `packages/editor/src/common/input.test.ts`; the end-to-end
  behaviour has its own Playwright project, `hybrid-chromium` (desktop viewport +
  `hasTouch`), in `e2e/hybridInput.spec.ts`.

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
- ✅ **Explicit desktop/mobile mode + double-tap fix** — the original fix; since
  superseded by the signals + per-pointer dispatch below.
- ✅ **Input signals + per-pointer dispatch (#101 Slice 1)** — the binary input
  mode is gone as a dispatch authority: `BlueprintContainer` routes each pointer
  event by its own `pointerType`, the canvas is always `touch-action: none` and a
  touch `pointerdown` is `preventDefault()`ed (no compatibility mouse events, so
  no double-fire), and detection became the live `coarse` / `keys` / `compact` /
  `touchRecent` signals plus an `auto`/`mouse`/`touch` preset. A touchscreen
  laptop now boots the mouse UI (B1) and a mouse works on touch hardware (B2).
  `inputMode.mode` remains only as a derived compatibility value. See
  Architecture above; unit tests in `common/input.test.ts`, e2e in the new
  `hybrid-chromium` project (`e2e/hybridInput.spec.ts`).
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
  deploy + per-PR previews (both fetch pack data from the shared data plane via
  `VITE_DATA_URL`; `.nojekyll`). See `.github/workflows/pages-*.yml`.
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
  icons (unicode glyphs for now).
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
  Follow-up fix: the hit-test gate demanded the full 38px grid pitch fit the
  viewport, which left the **bottom row visible but unclickable at full scroll**
  (reproduces on the Space Age pack — no vanilla group overflows the 8-row
  viewport at 10 columns); the scroll math now lives in framework-free
  `inventoryScroll.ts` (unit-tested) gating on the button's rendered 36px, and
  `e2e/inventory.spec.ts` clicks the bottom row for real via a
  `__FBE_TEST__.inventoryScrollToLastItem()` probe.
- ✅ **Pasted blueprints keep their wires** (issue #37) — the touch/drag paste mode
  (#30) placed every entity but none of the wires: `Editor.appendBlueprint` rebound
  the pasted entities to the (empty) target blueprint, so `PaintBlueprintContainer`
  serialized its ghost from the wrong `wireConnections` and the placed paste had no
  circuit/copper connections at all — while the same blueprint loaded via `?source`
  (which keeps the source blueprint) wired up fine. Fix: keep the copies bound to
  the source blueprint, which still holds the connections parsed on import. `Editor.ts`;
  guarded by `e2e/wires.spec.ts`, which drives the real paste→place path and asserts
  the placed wires survive (via a `wireColorPixelCounts()` `?test` hook that extracts
  the wires container in isolation), plus `?source` load guards over a trivial and a
  real 96-wire combinator blueprint (`e2e/fixtures/circuit-wire-blueprint.txt`).
- ✅ **Circuit editing is touch-usable** — the combinator / enable-condition editors
  (see `docs/circuit-editing.md`, #44) were built touch-first: signal selection goes
  through a full-size `SignalPicker` (so the editor itself stays a few compact rows,
  not a cramped inline list), numeric entry uses a **canvas-rendered keypad**
  (`NumericKeypad`) instead of the touch-broken DOM `TextInput` (#56), controls fire
  on `pointerdown`, and **long-press clears** a slot (touch has no right-click). The
  base `Dialog` scales each editor to fit a narrow viewport. Known debt: the editors
  use ad-hoc absolute layout (#59).
- ✅ **Clearing a slot works on touch — everywhere, and it's discoverable** —
  emptying a module / recipe / filter / quickbar slot was **right-click only**, so
  on touch it was simply unreachable. `bindSlotGestures` (tap activates,
  long-press/right-click clears) already existed but was wired into the circuit
  slots only; it now backs **every** slot — `Modules`, `Filters` and the quickbar
  dropped their raw `e.button === 2` handlers for it, so one gesture contract
  covers the lot and desktop right-click is unchanged.
  Long-press is invisible, though, so two visible affordances back it up. The
  item selector opened **from a slot** carries an escape-hatch button in its
  title row (mirroring `SignalPicker`'s ✕ None), labelled for what it does:
  **"✕ Clear"** when the slot holds something, **"✕ Cancel"** when it doesn't —
  same action either way (empty the slot, then close). It's shown even on an
  empty slot because it doubles as the way _out_ of the picker: tapping away
  works but needs bare canvas, which a full-width picker on a phone barely
  leaves, and Escape is desktop-only — so picking a recipe for the first time and
  changing your mind previously had no obvious exit. And every entity editor
  holding a clearable slot shows a dim footer line — _"Hold a slot to clear it"_
  on touch, _"Right-click a slot to clear it"_ on desktop — from a hint band the
  base `Editor` now reserves; it **re-renders on a live input-mode switch**
  (`inputMode.on('change')`, unsubscribed on destroy), since the DOM settings
  pane can be toggled with a canvas editor still open.
  The **module selector commits on tap** (`m_commitOnTap`), so both ways out of
  it are a single tap: take a module, or ✕ Clear the slot. Filling a machine
  reopens the dialog once per slot, and the touch tap-to-preview → ✓ Confirm
  two-step doubled the taps for a choice already made before the dialog opened;
  ✕ Clear acting without confirmation is what made the asymmetry obvious. Scoped
  to modules — recipes/filters/items keep the deliberate two-step, and long-press
  still previews everywhere.
  Fixed en route: clearing a **splitter** filter threw a `TypeError`
  (`Entity`'s splitter setter indexed `filters[0]` of an array the `filters`
  setter had already emptied), so that slot couldn't be cleared on _either_ input.
  Seams: `UI/controls/gestures.ts`, `UI/editors/Editor.ts`
  (`declareClearableSlots`), `InventoryDialog` + `UIContainer.createInventory`'s
  `clearCallBack`, `core/Entity.ts` `splitterFilter`. Covered by
  `e2e/clearSlots.spec.ts` (long-press on both projects, right-click on desktop,
  the ✕ Clear round-trip, and the splitter regression) via new `?test` probes
  (`openEditorSlot`, `entityModules`/`entityFilters`, `inventoryClearButtonPos`)
  plus a `longPressOneFinger` CDP helper.
  ~~Known gap: **logistic-chest** filters still can't be cleared.~~ **Closed —
  see below.**
- ✅ **Logistic-chest requests are editable at all** — the follow-up to that gap,
  and bigger than it looked: chest requests had **no UI whatsoever**. Three
  things were broken at once. `ChestEditor` existed but **nothing routed to it**
  (`factory.ts` had no chest case, so the class was unreachable dead code);
  `Entity`'s `logisticChestFilters` setter was an unimplemented `throw`; and
  `requestFromBufferChest` dereferenced an absent `request_filters`, so even
  reaching the editor would have thrown while it built its checkbox. Now:
    - **Routed by type** (`logistic-container`) and gated on `filterSlots > 0`,
      so storage/requester/buffer chests open the editor and providers — which
      request nothing — still open none. `filters`, `canEditFilters` and
      `filterSlots` key off `type` + the new `Entity.logisticMode` rather than
      the vanilla chest names, so modded logistic containers work too (the
      mod-safety rule).
    - **The setter writes the 2.0 `request_filters.sections` shape**, preserving
      what it doesn't model: `request_from_buffers` / `trash_not_requested` and
      any further sections survive a write, and per-filter `quality` /
      `comparator` / `max_count` are merged back onto the entry being edited
      (`Filters` rebuilds slots as bare `{index,name,count}`, so an imported
      blueprint would otherwise lose them on a count change).
    - **Counts use `NumericField`/`NumericKeypad`**, not the DOM `TextInput`
      that's unusable on touch (#56) — this editor is now reachable on a phone,
      so the old overlay input would have made counts uneditable there. The
      drag-target slider went with it.
    - Covered by `packages/editor/src/core/logisticChestFilters.test.ts` — the
      first **unit** coverage of the entity setters (the harness gap noted in
      #31; `Blueprint`/`Entity` are framework-free, so no canvas needed), pinning
      the serialized shape because a wrong one produces a blueprint Factorio
      rejects. Plus e2e in `clearSlots.spec.ts` for open/set/clear and the
      provider-opens-nothing case.
- ✅ **Tile brush is controllable on touch** (size + erase) — the tile paint
  (landfill / concrete / …) was stuck at its 2×2 default on mobile (the `[` /
  `]` size ratchet is keyboard-only), and laid tiles couldn't be removed _at
  all_ (desktop mines them by right-click-dragging with a tile brush held —
  no touch equivalent existed). The PAINT d-pad's free corners now carry
  tile-gated controls: **Size − / +** (top corners; the same registry actions
  as `[` / `]`, so desktop and rail stay in lockstep) and **Erase**
  (bottom-left; fires the existing `mine` action, which in PAINT mode removes
  the tiles under the ghost footprint) — so the flow is tap-to-position, then
  ✓ paints or ⌫ erases the same size² square, and the brush size doubles as
  the eraser size, mirroring desktop. The corners show only while the cursor
  is a tile brush: `makeCluster` grew per-button `when` gating (re-evaluated
  on every mode emit — `spawnPaintContainer` re-emits PAINT on cursor swaps,
  so an entity→tile switch re-gates live), keyed on the new
  `Editor.cursorIsTile`. Desktop unchanged. Seams: `actionToolbar.ts`
  (`PAINT_DPAD` corners + cluster `refresh`), `Editor.cursorIsTile`,
  `PaintTileContainer.brushSize`. Covered by `e2e/touchTiles.spec.ts` via new
  `?test` fields (`paint.tileSize`, `blueprint.tileCount`).

- ✅ **Station names are typeable on touch** (issue #56) — the train-stop
  editor's station-name / trains-limit fields are DOM `<input>`s overlaid on the
  canvas (`UI/controls/TextInput.ts`) — the one editor UI that is _not_
  canvas-drawn, because free text needs the OS keyboard. The overlay was broken
  on every high-DPI device: the CSS transform double-applied the device pixel
  ratio (pixi-text-input math predating PixiJS v8, where `renderer.width` went
  from physical to logical px), landing the input off-screen — a tap focused
  `<body>`, so no caret and no virtual keyboard — and it inherited
  `user-select: none` from `<html>`. Fixed at the seam: the transform now maps
  logical→CSS px only; inputs opt back into `user-select: text` +
  `touch-action: manipulation`; the font-size is pinned at `16px` (it was
  invalid unitless CSS, silently falling back to the browser default — and
  anything under 16px triggers iOS focus-zoom); and the numeric variant
  requests the digit keyboard via `inputmode=numeric`. The train-stop fields
  were the last `TextInput` consumers — chest counts and circuit numbers had
  already moved to the canvas `NumericKeypad` (#44), which stays the right
  call for pure-numeric entry. e2e in `e2e/trainStop.spec.ts` (an in-viewport
  ratchet pinning the off-screen regression, plus a real tap → focus → type →
  entity round-trip on both projects) via a new `entityTrainStop` `?test` probe.
- ✅ **Train stop: full 2.0 editor, touch-first** — the editor grew the whole
  post-2.0 surface (priority, the sign colour — a one-tap preset swatch row
  with ✕ reset, live on the sprite — + the circuit pane: enable condition,
  send-to/read-from train, the four flag+signal outputs) built from the circuit
  editors' touch-first blocks — `Checkbox` fires on pointerdown, `SignalSlot`
  goes through the full-size picker and long-press-clears, priority uses the
  canvas `NumericField` keypad. Design record in `docs/circuit-editing.md`;
  probe-driven touch e2e in `e2e/trainStop.spec.ts`. Side effect: every routed
  editor now holds a clearable slot, so `clearSlots.spec.ts`'s "hint absent"
  negative case is extinct (the test now asserts the hint on the train stop).

- ✅ **Circuit editors: the read-mode arc + full 2.0 decider** — lamps,
  roboports, display panels and provider chests open (touch-first) editors at
  all now; inserters gained read-hand-contents (hold/pulse), chests the
  circuit mode-of-operation; and the decider combinator grew the full 2.0
  multi-condition/multi-output form with per-operand red/green `NetworkToggle`
  filters — which also fixed silent **data loss** (the old editor committed
  1-element clause arrays, deleting the rest of a multi-clause combinator on
  any edit). Design record in `docs/circuit-editing.md`; validate the whole
  arc with **`npm run test:circuits`**. e2e drives real canvas taps via the
  generalized `editorControlPos`/`entityControlBehavior` probes
  (`Editor.registerControl` — TrainStopEditor's bespoke probe generalized).

## Not done / next

- 🚧 **Mobile panel layout v2** (issue #89, the phased plan; screen-space map in
  `mobile-layout-inventory.md`) — finish the layout authority #19 started. Live
  collisions: the top-center active-project pill (#50) covers the Pixi
  entity-info panel; the always-visible wires panel squats the bottom band. All
  variants first-class (desktop / portrait touch / landscape touch; resolution
  responsive, not a hard constraint).
    - ✅ **Phase 0 — instrument + docs**: storyboard states added (rates panel,
      library panel, PAINT ghost + d-pad, held marquee), inventory doc
      refreshed with the post-#19 arrivals + re-opened top band.
    - ✅ **Wires → rail**: three colour-coded rail buttons (toggle semantics via
      `Editor.togglePaintItem` — tap to hold the wire, tap again to drop it);
      `WiresPanel` retired on mobile like the quickbar, freeing the bottom band
      for the PAINT/SELECT clusters. Desktop unchanged. e2e in
      `actionToolbar.spec.ts` (toggle + panel absence) and `panels.spec.ts`.
    - ✅ **Phase 1 — the top band is reserved, panels restricted, world
      full-bleed**: `viewportRegions.ts` measures the fixed top chrome live
      (corner logo + active-project pill, ResizeObserver) and reserves the band
      via `setViewportInsets({ top })`, which bounds **`G.safeArea`** — the
      rect every Pixi panel/dialog anchors and clamps within
      (`Panel.clampToSafeArea`; `centerViewport` biases to its centre). The
      canvas stays **full-bleed**, so the blueprint shows through the empty
      parts of the rail gutter and top band instead of dead letterbox pixels.
      Pill can no longer cover the entity-info panel; one writer per edge
      (rail = `left`, regions = `top`). Desktop reserves nothing. Ratchet in
      `e2e/panels.spec.ts` ("top band").
      _Enabled follow-up (not built): wrap the rail around the corner in
      portrait — overflow buttons flowing along the top band instead of the
      ⋯ sheet._
    - ✅ **Phase 2 — status readouts → DOM.** Entity info ✅: the editor
      projects a render-free `EntityInfoData` (`buildEntityInfo` in
      `EntityInfoPanel.ts`, sharing the canvas panel's helpers so the numbers
      can't drift) and dispatches it on `fbe:entityinfo`;
      `website/src/entityInfoSheet.ts` renders it as a **full-width top
      sheet** (portrait) / **bottom-right drawer** (landscape, CSS
      `orientation` query) with real game icons via the Phase 3 seam. The Pixi
      panel is now desktop-only — one presentation per input mode. Portrait
      placement follows the reachability rule (feedback on PR #91): the
      active, reachable area of a portrait phone is the **bottom**, so the
      passive tap-select readout goes to the top, clear of the thumbs and of
      the EDIT Select/Edit bar that always co-occurs with it.
      Sheet v1 renders the circuit summary as plain text (the canvas panel's
      icon-rich version is the model for an upgrade). Ratchet reworked in
      `panels.spec.ts` ("top band"): desktop asserts panel-not-sheet, mobile
      asserts sheet-not-panel + clearance of the pill and the bottom band;
      marquee suppression covers the sheet too (`touchMarquee.spec.ts`).
      Rates ✅ (same recipe): `RatesPanel` stays the state holder + computer
      (its `showRates` toggle, live-recompute subscriptions and the e2e probe
      key off a new logical `shown`, decoupled from Pixi `visible`) and
      mirrors every recompute over `fbe:rates` as a `RatesData` projection —
      same report, same bucketing/sorting, `formatRate` shared — which
      `website/src/ratesDrawer.ts` renders bottom-right in portrait — the
      reachable band, right for an explicitly toggled overview the user
      scrolls and dismisses — and top-right in landscape (its ✕ routes back
      through the `showRates` action). Both readouts can be open at once on
      mobile, anchored complementarily (portrait: info top / rates bottom;
      landscape: rates top-right / info bottom-right). `rates.spec.ts`
      dismisses via the drawer's DOM ✕ on mobile and asserts drawer-not-panel
      per mode. **Phase 2 is complete** — both status readouts are DOM on
      mobile; modal dialogs stay Pixi within the safe area by design.
    - ✅ **Rail refinements** (feedback rounds): the corner
      Github/Settings/Library block is **one 3-wide row** of flush squares
      under the logo (a single 44px row instead of the old three-tall stack),
      with the rail single-file below in portrait (a second rail column
      cramps a Pixel-7-class width; landscape stays 3-col). The **management
      actions (Copy BP / Paste BP / Export / New) are permanently parked in
      the ⋯ overflow** (`parked` on `ToolbarButton`) — rare and deliberate,
      they no longer occupy rail cells, so the everyday rail is short and its
      cells sit in the same places across modes. Deliberately **no priority
      inversion** toward the bottom: the default grip is right thumb at the
      bottom (canvas work) with the left hand free for the rail, so
      top-anchored is right. Ratchet in `actionToolbar.spec.ts` (parked
      buttons overflow-only; ⋯ always present).
    - ✅ **Phase 3 — DOM icon seam** (`website/src/packIcons.ts`): any DOM
      element marked `data-pack-icon="<id>"` upgrades to a real game icon,
      rendered as a CSS background crop of the pack's `browser/icons.webp`
      (fetched off the canonical pack id, so slim variants resolve to their
      full pack's sheet; progressive — glyphs stay if the pack ships no
      browser tier). The rail's **wire buttons** now show the actual wire item
      sprites. Scope note: the sheet holds _prototype_ icons only — pure
      editor actions (undo, rotate, …) have no game sprite and keep their
      glyphs by design; Phase 2's DOM panels are the seam's bigger consumer.
      e2e canary in `actionToolbar.spec.ts` (polls the upgraded background).
    - ✅ **Modal layering contract**: Phase 2's DOM readouts painted _over_
      the Pixi entity editors (DOM always composites above the canvas — in
      landscape the info sheet covered the recipe/module slots, blocking
      recipe changes, with no way to dismiss it). Now `Dialog` mirrors its
      open count over `fbe:dialogs` and the readouts yield while any dialog
      is open (`body.fbe-dialog-open`), restoring themselves on close. The
      full rank order lives in `mobile-layout-inventory.md` ("The layering
      contract"). Ratchet: "modal layering" in `panels.spec.ts`. The fallback
      if this ever needs iteration is migrating dialogs to DOM wholesale, not
      more coexistence rules.
    - ✅ **DOM dialogs — shell + main item selector (#98 Slices 0–1)**: the
      "pull the plug" arc begins. `website/src/dialogs/` gains the modal
      shell (`shell.ts`: backdrop, ✕, Escape, auto-close on mode switch) and
      `dialogLayer.ts` (owns `body.fbe-dialog-open`, ORing the Pixi
      `fbe:dialogs` count with open DOM dialogs, so the contract holds
      through the migration). First tenant: the **main inventory** —
      E / rail "Items" on mobile opens the DOM `inventorySelector.ts`
      (group tabs, native scrolling, a real **search box** — the first
      selector text input touch users get, retiring that #56 case for this
      dialog — ★ Recents with the Recent/Quickbar/On-blueprint sections,
      tap-to-preview → ✓ Confirm, Pin/Unpin). It renders from the new
      render-free `core/itemCatalog.ts` (unit-tested; the same walk the Pixi
      dialog does inline) and commits through `editor.spawnPaintItem`.
      Desktop keeps the Pixi dialog; so do the editor-embedded pickers
      (recipe/module/filter slots) until their editors migrate. Seam:
      `UIContainer.openMainInventory` → `fbe:openinventory`. Ratchets in
      `inventorySelector.spec.ts` (per-mode presentation, search→select→
      paint, backdrop/E close, readouts yield + restore).
    - ✅ **DOM entity editor — crafting machines (#98 Slice 2)**: the
      recipe+modules form (the editor behind the recipe-changing bug)
      presents as the DOM `dialogs/entityEditor.ts` on mobile — both the
      `machine` kind (assembling machines) and the generic `temp` kind
      (furnaces, refineries, chem plants, and every modded/expansion machine
      the name switch doesn't know — the first live-testing gap: SE's space
      assembler opened nothing). The recipe row gates on the new shared
      `Entity.hasRecipeSlot` (furnaces/rocket silos auto-pick — modules
      only), now also used by editor routing and the Pixi TempEditor. Routed
      per kind from `UIContainer.openEntityEditor` → `fbe:openentityeditor`
      (the event
      carries the live `Entity`; the DOM editor reads its accessors, writes
      its History-wrapped setters, and follows its change events — undo/redo
      reflect live, destroy closes it). Slots keep the established touch
      grammar: tap opens the **filtered DOM picker** (the shared
      `itemPicker.ts` — recipes confirm-gated, modules commit-on-tap, ✕
      Clear/Cancel escape hatch), long-press clears, hint line included; the
      picker stacks over the editor (Escape peels the top dialog only —
      `dialogLayer.isTopDomDialog`). A mobile→desktop switch closes the DOM
      editor (presentation follows mode). Preview decision (v1): **no live
      sprite preview** — the header carries the entity's pack-sheet icon;
      revisit with render-to-texture if missed. The `?test` hook is
      DOM-aware (slot/✕/✓ probes report DOM coords in the same shape), so the
      whole `clearSlots.spec.ts` gesture matrix runs against the DOM editor
      unchanged; new per-mode + recipe-end-to-end ratchets in
      `entityEditor.spec.ts`. Other kinds keep Pixi until their slices.
    - ⬜ **Phase 4 — e2e bounds-disjointness ratchets**
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
- ✅ **Touch placement — drag / nudge / center** (issue #30) — a paste produces a
  multi-entity ghost that used to be unplaceable on touch (the only option was to
  blind-tap until it happened to land right); placing single entities was nearly as
  fiddly. Now: a one-finger **drag that starts on the ghost grabs and moves it**
  (tile-snapped, preserving the grab point so it doesn't jump) — for **both a single
  entity and a pasted blueprint** (each reports its own footprint via
  `containsWorldPoint`); a drag starting **off** the ghost still pans the camera and
  two-finger pan/pinch always drives the viewport. **Fine-tune arrows** (▲◀▶▼) plus
  **Place** (✓, green, centred like a gamepad's confirm) live in a **fixed
  bottom-centre d-pad** — shown only in PAINT mode, in the band the retired quickbar
  freed, so it never fights the rail's ⋯ overflow; the arrow keys drive the same
  `moveEntity`/`GridData.nudge()` path on desktop. A **center crosshair** marks the
  ghost's origin (= the blueprint's bounding-box center) so taps/drags have a visible
  anchor. **Cancel** stays in the left rail. Seams: `BlueprintContainer` touch
  handlers (`touchPan.target` classify-once, `grabsPaintGhost` via `toWorld` →
  world-space hit-test, `moveEntity` PAINT branch), `GridData.nudge()` (exact
  cached-coord shift, zoom-independent), `PaintContainer.containsWorldPoint()` /
  `worldBoundsContain()`, `OverlayContainer.updatePaintCenterMarker()`, the
  bottom d-pad + toast `pointer-events`/z-index fix (`actionToolbar.ts`,
  `index.styl`). Covered by `e2e/touchPlacement*.spec.ts` (CDP drag for grab-vs-pan
  on both ghost kinds, d-pad nudge, Place commit) via the `?test` hook (`paint.kind`
    - `spawnPasteGhost`). Follow-up: fixed bottom-arrows idea realised.
- ✅ **Mode-gated action rail** (issue #33) — the rail now shows only the buttons
  whose action is live in the current mode, instead of the full set at all times.
  Each `ToolbarButton` declares the `modes` it's useful in (omit = global); a
  `when` predicate adds non-mode conditions (Select needs a non-empty blueprint).
  `layout()` filters to the live set on every mode change (`editor.onModeChange`)
  and on entity add/remove (`editor.onBlueprintChange`, a new stable emitter that
  survives blueprint swaps). Mapping: **global** Items/Undo/Redo/Center +
  Copy/Paste BP/Export/New; **PAINT** Rotate/Flip H/Flip V/Pick/Cancel; **EDIT**
  Rotate/Delete/Pick/Copy cfg/Paste cfg; **SELECT** Rotate/Cancel; **Select**
  (marquee) in NONE/EDIT when non-empty. Priority order is preserved so the rail
  collapses rather than reshuffling. `actionToolbar.ts`, `Editor.onBlueprintChange`
  / `blueprintEmpty`; covered in `e2e/actionToolbar.spec.ts`.
- ✅ **Touch box-select / marquee** (issue #21) — desktop area-select is
  modifier+drag and commits on mouse-release (copy → paste ghost, delete →
  remove); touch had no modifier and no way to _choose_ the action. Now **one
  button**: the rail's **Select** arms the gesture, a **one-finger drag draws a
  selection box**, and releasing **holds** the selection (new `EditorMode.SELECT`)
  while a fixed bottom-center **Copy / Cut / Delete / Cancel** bar waits. **Copy** →
  paste ghost (originals stay); **Cut** → ghost + remove originals; **Delete** →
  remove; **Cancel** / Escape / tap-away / rail-Cancel drop it. Copy/Cut spawn the
  ghost **over the source tiles** (`GridData.moveToWorld` to the selection's
  bounding-box center) so it previews _in place_ — for Cut this reads as
  move-in-place; the ghost is then the same paste ghost the placement work (#30)
  makes drag/nudge/center-placeable, closing the cut/copy/paste loop on touch.
  Reuses the desktop selection rectangle + `getEntitiesInArea` + cursor-box
  highlight. _(Originally the box stayed frozen on release; the tiles round
  changed that — the rectangle is drag feedback only and hides once the
  selection is held, whose visual is the cursor boxes / tile highlight.)_
  While the box is drawn/held the hover/info panel is suppressed (it would
  obscure the box), and a second finger mid-draw cleanly **abandons** the box so
  pinch/zoom can't strand it. Seams: `BlueprintContainer`
  (`armMarquee`/`begin`/`end`/`copy`/`cut`/`delete`/`cancelMarquee`,
  `touchPan.target = 'marquee'`), `GridData.moveToWorld`, `Editor` delegators, the
  Select button + marquee bar (`actionToolbar.ts`, `index.styl`). Covered by
  `e2e/touchMarquee.spec.ts` (CDP box-drag → Copy/Cut/Delete/Cancel, plus Cut →
  Place restoring the originals in place) via the `?test` hook (`marquee.count`).
- ✅ **Selection nudge-in-place + EDIT bar + inventory focus-tap** (polish round) —
  four touches on top of the above:
    - **Held-selection nudge.** SELECT shows a **nudge d-pad** (4 arrows) that
      moves the actual selected entities a tile at a time _in place_, preserving
      wiring — `Blueprint.moveEntitiesBy` validates the group as a unit (lifting it
      out of the position grid so members don't block each other) and applies
      leading-edge-first via `Entity.forceMoveBy`. The wire-safe alternative to
      cut→paste. **Single-entity Rotate** (rail) also works in SELECT (in place, no
      pivot); multi-entity rotation is deferred (needs a pivot + collision/wire
      handling). The cursor-box highlight now follows the entities as they move/
      rotate (`EntityContainer.refreshCursorBox`).
    - **Illegal-wire flag (first step).** In-place nudge/rotate bypass the wire-
      reach guard, so a wire to a non-selected entity can stretch past the limit
      (a blueprint that won't import). A move/rotate that _newly_ breaks reach now
      **warns** (toast, counts affected entities). A persistent per-wire visual
      marker is a follow-up.
    - **Copy / Cut / Delete / Cancel** sit in a row below the d-pad (Cancel drops
      the selection; any in-place nudges already applied persist).
    - **EDIT bar.** Tapping a single entity (EDIT) shows a **Select / Edit** bar:
      _Select_ promotes it to a one-entity held selection (so the nudge applies to
      one entity too); _Edit_ **toggles** its editor (open, or close if already open).
    - **Inventory focus-tap.** On touch, a **tap** in the item picker now _focuses_
      the item (name/details + Confirm/Pin) instead of committing — selecting is a
      deliberate two-step, fewer misclicks. Desktop click-to-commit is unchanged.
      _(Later narrowed: the **module** selector commits on tap instead — see the
      clear-a-slot entry above. Everywhere else this still holds.)_
    - **Overflow on top.** The rail's ⋯ overflow now renders above the contextual
      bottom clusters (z22 > z21) so its buttons aren't hidden behind the d-pad.
    - Seams: `Blueprint.moveEntitiesBy` / `Entity.forceMoveBy`, `BlueprintContainer`
      `nudgeSelection`/`selectHovered`/`editHovered`/`rotate` (SELECT) +
      `warnNewOverReach`, `EntityContainer.refreshCursorBox`, `Editor` delegators,
      the contextual clusters in `actionToolbar.ts` + `index.styl`, `InventoryDialog`
      pointerup. e2e in `touchMarquee.spec.ts` (nudge-in-place, EDIT bar, Edit
      toggle, single-entity rotate) via `marquee.origin`/`marquee.direction` /
      `entityScreenPos` hooks.
- 🚧 **e2e coverage gaps**: pinch needs CDP `Input.dispatchTouchEvent` (the
  high-level touch API is single-touch). Tap-to-place is now covered —
  `EditorTestState` was extended with `paint` + `blueprint.entityCount` and
  `e2e/touchPlacement.spec.ts` drives the deferred place/confirm flow.
- ⬜ **Pinch in desktop mode** — desktop currently ignores touch entirely, so a
  touch-laptop in desktop mode can't pinch. Out of scope for now (we don't care
  about touch-on-desktop yet); revisit if needed.
- ⬜ **Toasts can swallow taps aimed at an open dialog** — the toast stack is
  bottom-right with `pointer-events: auto` per toast (tap-to-dismiss); on a
  phone several stacked toasts reach the lower rows of a centred canvas dialog,
  and until they expire (5s) a tap meant for a control under one lands on the
  toast instead. Surfaced by the train-stop editor's flag checkboxes
  (`trainStop.spec.ts` clears toasts before tapping as a workaround). Fix idea:
  on mobile, anchor toasts in the reserved top band (out of the reach zone and
  clear of dialogs, which clamp to the safe area below it) — needs #89's layout
  authority to reserve/route correctly.
- ✅ **Tiles in selections (marquee)** — the marquee now sees tiles, resolved
  like the game: the box selects **entities**, and only when it holds none does
  it fall back to the **tiles** underneath (either/or, never mixed). The rail
  gains **Select tiles** (shown only while the blueprint holds tiles, via new
  `create-tile`/`remove-tile` blueprint events feeding `onBlueprintChange`) —
  the tiles-flavoured arm that collects tiles even _under_ entities, the case
  the entities-win rule can't reach. A held tile selection offers Copy / Cut /
  Delete: Delete → `Blueprint.removeTiles`; Copy/Cut ride a **tiles-capable
  paste ghost** — `PaintBlueprintContainer` carries name+offset tile records
  (kept out of its internal wire-rebinding `Blueprint` on purpose), renders
  them under the entity sprites, lays them via `createTiles` on place and
  clears them on right-click mine. `Editor.appendBlueprint` passes tiles
  through too, so **pasted blueprint strings keep their landfill/concrete**
  (previously dropped silently). Selection visuals: selected tiles get a
  **per-tile highlight** (`OverlayContainer.updateTileSelectionHighlight`,
  translucent fill + outline per cell in the desktop copy-select green — tiles
  have no container mapping to hang a cursor box on), live during the drag;
  and the blue **rectangle now hides on release** for _all_ selections (it
  used to stay frozen over the canvas) — once held, the cursor boxes / tile
  highlight are the selection's visual. Scoped out on purpose: the entity-only
  nudge d-pad hides for a tile selection (no group-move path for tiles); a
  tile-carrying ghost can't flip/rotate (those re-spawn from entity copies —
  `canFlipOrRotateByCopying` gates them off);
  and desktop's modifier+drag COPY/DELETE modes remain entity-only. Seams:
  `Blueprint.getTilesInArea` + tile events, `BlueprintContainer`
  (`armMarquee(tilesOnly)`, either/or `marqueeUpdateFn`, `marqueeTiles` through
  copy/cut/delete), `PaintBlueprintContainer` ghost tiles,
  `actionToolbar.ts` (Select tiles button, `when`-gated SELECT d-pad).
  Covered by the marquee half of `e2e/touchTiles.spec.ts` via
  `marquee.tileCount` on the `?test` hook.

## Notes / tradeoffs

- `Editor.ts`'s window `pointerup` → `releaseButton` and `GridData`'s window
  `pointermove` still receive ghost-mouse events in mobile mode, but they're
  harmless no-ops (nothing held; the tap path re-seeds grid position before
  acting). Gate them if stricter isolation is ever wanted.
- Pen works in both modes (mouse-like on desktop, touch-like on mobile).
- The `/corsproxy` "import blueprint from a URL" feature is a Cloudflare Pages
  Function and does **not** work on GitHub Pages; paste-string import + editing do.
