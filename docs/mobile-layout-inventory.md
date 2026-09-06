# Mobile layout inventory

> **Companion doc:** [`mobile-controls.md`](./mobile-controls.md) (status +
> backlog). The action rail is now **mode-gated** (#33). **Layout-v2 tracking
> issue: #89** — its checklist mirrors this doc's 🔴 entries. Keep this
> inventory current as the layout work lands — see CLAUDE.md "Keep issues in
> sync with the work".

A map of **every element that consumes screen space** in the editor, split by
the two rendering layers (PixiJS on the canvas vs. DOM overlays), with anchors,
sizes, and how they collide on a phone. This is the shared reference we design
the mobile layout against — keep it current as the layout work lands.

**Variants are first-class:** every layout decision is judged against desktop
(mouse/keyboard), **portrait touch** and **landscape touch** — the storyboard
platforms (`e2e/storyboard.spec.ts`: Pixel 7 portrait + landscape, desktop
1280, iPhone SE) are the reference set, with iPhone SE as the small-screen
stress case. Resolution is a **responsive axis, not a design target**: bands
may resize and panels reflow/scroll, but no layout may assume a fixed screen
size. Regenerate the strips with `STORYBOARD=1 npx playwright test
storyboard.spec.ts` — before/after strips are the acceptance artifact for
every layout slice.

**What the instrument can't show:** the strips are **Chromium** emulation —
they're density-true (captured at the device's emulated `devicePixelRatio`,
2.625 on Pixel 7), but Playwright cannot emulate **mobile Firefox** at all
(`isMobile` is Chromium-only), and Firefox genuinely differs here: its own
font rendering, and FBE deliberately defaults it to the WebGL renderer (#79).
The storyboard is authoritative for _geometry_ (what sits where, what
collides); look-and-feel on Firefox-on-Android needs a real-device spot check.

Reference viewport for concrete numbers: a Pixel-7-ish **portrait** screen,
**412 × 915 CSS px**.

## Layer 0 — the canvas (base)

- **`#editor`** — `position: fixed`, always `window.innerWidth × innerHeight`
  (full viewport), z-index `auto` (0). **Full-bleed by design** (#89): the world
  renders under all chrome and shows through the empty parts of the reserved
  bands — no dead letterbox pixels. What the reservations constrain is the
  **UI**, not the world: `G.safeArea` (viewport minus the reserved bands, set
  via `Editor.setViewportInsets`) is the rect every Pixi panel/dialog anchors
  and clamps within (`Panel.clampToSafeArea`), and `centerViewport` biases the
  blueprint to its centre. "Restrict the panels, not the world."

## Layer 1 — Pixi UI (drawn _on_ the canvas, via `UIContainer`)

| Element                                         | Anchor                                    | Intrinsic size              | Scaling / behavior                                                                  | Portrait notes                                                                                                                                                                            |
| ----------------------------------------------- | ----------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Quickbar** (`QuickbarPanel`, 2 rows)          | bottom-center of `G.safeArea` (desktop)   | 442 × 100                   | `fitToWidthScale`; **retired on mobile** (hidden)                                   | **Gone on mobile** — actions live in the rail; on desktop it now anchors inside the rail's inset (#101 Slice 4). DOM for both in Slice 5                                                  |
| ~~**Wires panel** (`WiresPanel`)~~ **retired**  | ~~beside the quickbar (desktop)~~         | —                           | —                                                                                   | **Gone everywhere** (#101 Slice 4) — the three wires are colour-coded rail buttons (toggle to hold/drop) in every layout; the class is deleted, `WIRE_ITEMS` moved to `core/wireItems.ts` |
| **Entity-info** (`EntityInfoPanel`)             | top-right of `G.safeArea` (desktop)       | 270 × 270 (grows w/ recipe) | fit + clamp; **desktop-only** (hidden on mobile)                                    | **Gone on mobile** — presented by the DOM `#entity-info-sheet` instead (#89 Phase 2)                                                                                                      |
| **Rates panel** (`RatesPanel`, #87)             | top-right, below the info panel (desktop) | 270 × 400                   | fit + clamp; **desktop-only** (hidden on mobile)                                    | **Gone on mobile** — presented by the DOM `#rates-drawer` instead (#89 Phase 2)                                                                                                           |
| **Editors** (machine/inserter/chest/splitter/…) | centered                                  | 402–**504** × 171–176       | scale-to-fit + clamp                                                                | Centered modal                                                                                                                                                                            |
| **Inventory** (`InventoryDialog`)               | centered                                  | **responsive W** × ~520     | width fits the tabs (capped to screen, ≥404); tab/item **scroll** + **Recents tab** | Touch-usable: long-press preview + Pin/Unpin                                                                                                                                              |
| **Paint ghost icon**                            | follows finger (`globalX+16`)             | small                       | tracks pointer                                                                      | Not edge-anchored                                                                                                                                                                         |
| **Debug** (`DebugContainer`)                    | top-left (≈145, 5)                        | text                        | hidden unless `?debug`                                                              | —                                                                                                                                                                                         |

## Layer 2 — DOM overlays (on top of the canvas)

| Element                                          | Anchor                                                                                                            | Size                                                                                    | z-index | Mobile behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action rail** (`#action-toolbar`)              | **left gutter** (below the logo + corner btns)                                                                    | `coarse`: 44px squares + labels; else a slim 34px strip with keybind badges; ⋯ overflow | 4       | **Universal** since #101 Slice 4 (was mobile-only). Reserves the left band of `G.safeArea` (`setViewportInsets`) in **every** layout — world shows through below its last button. Sized by signals, not device: cells by `coarse`, badges by `keys` (`aria-keyshortcuts` + `.hint`, from the registry's `keyCombo`), width/overflow by what fits — coarse keeps 1-col portrait / 3-col landscape, a fine pointer starts single-file and only widens if the live buttons don't fit. Management actions permanently parked in ⋯. **Mode-gated** (#33): only live buttons show |
| **Paint d-pad** (`#paint-dpad`)                  | **bottom-center** (the freed quickbar band)                                                                       | 3×3 grid of 52px buttons (▲◀▶▼ + green ✓)                                             | **21**  | **Mobile + PAINT only**; nudge arrows + Place for steering a held ghost. Above toasts (z20) so they don't swallow its taps; has the bottom band to itself now that the wires panel is retired on mobile                                                                                                                                                                                                                                                                                                                                                                     |
| **Select d-pad** (`#select-dpad`)                | **bottom-center**, above the select row                                                                           | 3×3 grid (▲◀▶▼, empty centre)                                                         | **21**  | **Mobile + SELECT only**; nudges the held selection in place (preserves wiring)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Select actions** (`#select-actions`)           | **bottom-center** (same band as the d-pads)                                                                       | row of 64px buttons (Copy/Cut/Delete/Cancel)                                            | **21**  | **Mobile + SELECT only**; what to do with the box selection (#21). One cluster shown per mode, so these never coexist                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Edit bar** (`#edit-bar`)                       | **bottom-center** (same band)                                                                                     | row of 64px buttons (Select / Edit)                                                     | **21**  | **Mobile + EDIT only**; a tapped entity → promote to selection, or open its editor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Logo / info** (`#corner-panel`)                | **top-left** (0,0)                                                                                                | ~52px logo badge                                                                        | 5       | Tap = info-panel toggle (the "Press I" hint was dropped)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Corner buttons** (`#buttons`)                  | **top-left**, under the logo                                                                                      | one 3-wide row of `--rail-cell` squares                                                 | 5       | Github / Settings / **Library** (#50; Discord dropped); the fold is **universal** since #101 Slice 4 — the head of the rail's column in every layout (the desktop three-tall stack of labelled rows is gone; captions live in `title`/`aria-label`). Cell size follows the rail's `--rail-cell`                                                                                                                                                                                                                                                                             |
| **Active-project pill** (`#active-project`, #50) | **top-center** (`top: 8px, left: 50%`)                                                                            | `min(50vw, 360px)` × ~28px                                                              | 5       | **Always visible**; its footprint is **reserved** in every layout — `viewportRegions.ts` measures it (+ the corner logo, unless the rail's column already covers it) into `G.safeArea` via `setViewportInsets({ top })` (#89 Phase 1, universal since #101 Slice 4), so panels anchor below it while the world shows through                                                                                                                                                                                                                                                |
| **Library panel** (`#library-panel`, #50)        | **centered** overlay (like `#info-panel`)                                                                         | responsive                                                                              | 100     | Toggled from the library button / the pill; joins the "centered modals stack by luck" club below                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Settings pane** (`.dg.main`)                   | under `#buttons`; **beside the rail** on a fine pointer, `left: 0` overlay when `coarse` (ResizeObserver on both) | 320px desktop / `min(360px,100vw)` mobile                                               | 5       | Starts **closed** when `coarse`. On desktop it steps right of the rail's column instead of covering it (#101 Slice 4)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Info panel** (`#info-panel`)                   | **centered**                                                                                                      | `min(640px,90vw)` × `≤100dvh−32px`, scrolls                                             | **100** | Hidden unless toggled; close ✕ top-right                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Toasts** (`.toasts-container`)                 | **bottom-right**                                                                                                  | 320px wide, stacks upward                                                               | 20      | Same on mobile (transient); container is `pointer-events:none` (toasts themselves stay tappable) so its empty area doesn't eat taps on what's under it                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Loading screen** (`#loadingScreen`)            | full-screen                                                                                                       | 100vw × 100vh                                                                           | 10      | Boot only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## The competition map (✅ = resolved · 🔴 = live collision, tracked in #89)

**✅ Top band — reserved (#89 Phase 1).** Re-opened when the #50 chrome landed
top-center (the **active-project pill** sat exactly on the Pixi
**entity-info** panel's `y=0` top-right anchor — a DOM overlay the canvas
couldn't see), and now resolved the structural way: the website's
`viewportRegions.ts` measures the fixed top chrome live (the corner logo +
the pill, via ResizeObserver) and reserves the band through
`editor.setViewportInsets({ top })`, which bounds **`G.safeArea`** — so on
mobile every top-anchored panel starts _below_ the chrome, while the canvas
itself stays full-bleed and the world shows through the band's empty parts.
One writer per edge: the rail owns `left`, this module owns `top`. Both run in
**every** layout since #101 Slice 4 — desktop gained the rail, so it gained the
left inset with it. The top band reserves only chrome that actually overlaps the
canvas: `viewportRegions` reads (never writes) the rail's width and skips any
chrome already inside that column, so a slim desktop column doesn't buy a
full-width top band for the logo it already covers. Guarded by the disjointness
ratchet in `e2e/panels.spec.ts` ("top band") and the inset ratchet in
`e2e/actionToolbar.spec.ts` ("reserves the left inset").
_(History: "✅" as of #19 → regressed by #50's chrome landing without an
inventory update — exactly the drift this doc warns about — → re-resolved
by construction in Phase 1, first by cropping the canvas, then refined to the
full-bleed + safe-area model.)_

**✅ Bottom band.** The quickbar retirement removed the big tenant, and the
**wires panel** — which had stayed on as a permanent always-visible resident of
the freed band, in every state — went with it (#89 on mobile, then **deleted
outright** in #101 Slice 4): its only job was spawning one of three paint items,
an _action_, so the wires live in the rail as colour-coded toggle buttons and
the band belongs to the modal PAINT/SELECT clusters alone. Keeping a Pixi panel
on desktop for the same three toggles was two affordances for one action, so the
class is gone and the rail is the single one. DOM **toasts** (bottom-right) can
still pass over the band briefly, but they're transient.

**✅ Two opposite "action" surfaces.** Resolved by the above — touch actions now
live in one place (the left rail), and the bottom Pixi quickbar is gone.

**✅ Modals vs. the DOM readouts.** Phase 2's split — passive readouts in DOM,
modal dialogs in Pixi — created a cross-technology stack with no arbiter: the
browser composites DOM above the canvas no matter what, so the entity-info
sheet sat **on top of** a centered entity editor (in landscape, directly over
its recipe/module slots, eating their taps — storyboard state "editor + info").
Resolved by the **layering contract** (below): `Dialog` mirrors its open count
over `fbe:dialogs`, and while any dialog is open the website hides the sheet
and the rates drawer (`body.fbe-dialog-open`); both restore themselves on
close since their state (selection, rates toggle) lives in the editor and is
never cleared. Guarded by the "modal layering" ratchet in `e2e/panels.spec.ts`.

**🟡 Centered DOM overlays vs. Pixi dialogs.** The DOM info-panel and library
panel (both centered, z100) can still sit over a centered Pixi dialog; they
rarely coexist (both are explicitly toggled, and per the contract below they
rank _above_ modals as active overlays). Unchanged — low priority; the full
answer, if iteration is ever needed here, is migrating the Pixi dialogs to DOM
wholesale rather than more coexistence rules.

**✅ Inventory group-tab overflow (Space Age).** The tab row + item grid are
**clipped to the dialog** (Pixi masks) and scroll (◀ ▶ tabs / ▲ ▼ items), with
viewport-gated hit-testing. The body width is now **responsive** so the tab scroll
only engages when tabs truly can't fit, and a **Recents tab** + **long-press
preview** (Confirm / Pin-Unpin) make the selector touch-usable.

## The layering contract (mobile)

The mixed DOM/Pixi stack needs an explicit rank order, because the browser's
compositor (DOM always above canvas) does not match the UX intent (a modal
should eclipse a readout). From bottom to top:

1. **The world** — the full-bleed canvas; renders through every band.
2. **Passive DOM readouts** — entity-info sheet, rates drawer. Yield to
   everything above: they hide while any Pixi dialog is open, via
   `fbe:dialogs` → `body.fbe-dialog-open` (the editor announces from
   `Dialog`'s ctor/`close()`; the website toggles the class; CSS does the
   hiding). Their logical state stays in the editor, so they restore on close.
3. **Pixi modal dialogs** — entity editors, inventory, item preview. Centered
   in `G.safeArea`; win the surface over readouts _by the readouts yielding_,
   since no z-index can put canvas content above DOM.
4. **Active DOM overlays** — info-panel, library panel (z100), the contextual
   clusters (z21). Explicitly toggled, genuinely above modals.
5. **Transient chrome** — toasts. Pass over anything, briefly.

**The rule for new UI:** any new DOM overlay must declare its tier. A passive
readout must subscribe to the `fbe-dialog-open` gate (or live inside an
element that does); anything interactive that may coexist with a Pixi dialog
must either rank above it deliberately (tier 4) or reserve its own band via
`setViewportInsets`.

## Root cause

There is **no layout authority**. The canvas is full-bleed; every DOM overlay is
independently `position: fixed` with hand-picked corners; the Pixi panels
position off `app.screen` with no knowledge of the DOM chrome (or vice-versa).
Nothing carves the viewport into regions, so "don't put X where Y is" is enforced
only by manual coordinates.

The rail (#19) built the fix's first half: `Editor.setViewportInsets` — which
**already accepts all four edges** — bounds `G.safeArea` and re-anchors the Pixi
panels via `fbe:viewportchange`. Two edges are in use (the rail's `left`, the top
band's `top`), and since #101 Slice 4 both apply in **every** layout rather than
on touch only; every DOM element that isn't transient should reserve its band the
same way.

## The plan — layout v2 (tracking: #89)

The old "design directions" list is superseded by the phased plan in **#89**
(direction 1, gutters-as-authority, won; direction 2 happened via the quickbar
retirement; direction 3 via the rail's ⋯ overflow). Summary:

1. ✅ **Phase 0 — instrument + docs** (this refresh + the storyboard's new
   states: rates, library, PAINT ghost + d-pad, held marquee).
2. ✅ **Wires → rail** — the quick win on the bottom band (above).
3. ✅ **Phase 1 — generalize the authority**: `viewportRegions.ts` reserves
   the top band (measured live off the corner logo + the pill) through
   `setViewportInsets({ top })`, alongside the rail's `left`. Killed the
   top-band collision by construction. _Follow-up idea it enables: in
   portrait, the rail could **wrap around the corner** — overflow buttons
   flowing along the top band instead of hiding behind the ⋯ sheet._
   3b. ✅ **The rail goes universal** (#101 Slice 4) — the same left column for
   every input: logo + corner buttons + the live actions, 44 px cells when
   `coarse` and a slim keybind-badged strip otherwise, and the left inset now
   reserved on desktop too. The Pixi wires panel is deleted with it (one
   affordance per action). The remaining Pixi residents — quickbar, entity-info
   and rates panels — move to DOM in #101 Slice 5.
4. ✅ **Phase 2 — reclassify by role**: actions → rail; **entity-info →
   DOM** (`buildEntityInfo` → `fbe:entityinfo` → `entityInfoSheet.ts`, a
   full-width **top** sheet in portrait / bottom-right drawer in landscape);
   **rates → DOM** (`RatesData` → `fbe:rates` → `ratesDrawer.ts`,
   bottom-right in portrait / top-right in landscape). Portrait follows the
   **reachability rule**: the active area of a portrait phone is the bottom,
   so the passive tap-select readout goes top and the explicitly toggled,
   interactive overview goes bottom. Both can be open at once. The Pixi
   panels are desktop-only; modal dialogs stay Pixi, anchored within the
   safe area, by design.
5. ✅ **Phase 3 — DOM icon seam** (`packIcons.ts`): icon-id →
   `background-position` over the pack's `icons.webp`, keyed on the canonical
   pack id, glyph fallback. Wire buttons show real sprites; prototype icons
   only, so pure editor actions keep glyphs by design.
6. **Phase 4 — e2e ratchets**: bounds-disjointness assertions via the `?test`
   hook for each resolved collision, so bands can't silently regress again.
