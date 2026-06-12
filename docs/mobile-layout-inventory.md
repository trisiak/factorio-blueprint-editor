# Mobile layout inventory

A map of **every element that consumes screen space** in the editor, split by
the two rendering layers (PixiJS on the canvas vs. DOM overlays), with anchors,
sizes, and how they collide on a phone. This is the shared reference we design
the mobile layout against — keep it current as the layout work lands.

Reference viewport for concrete numbers: a Pixel-7-ish **portrait** screen,
**412 × 915 CSS px**.

## Layer 0 — the canvas (base)

- **`#editor`** — `position: fixed`, resized to `window.innerWidth × innerHeight`
  (full viewport), z-index `auto` (0). Everything else floats on top of it, and
  **nothing reserves space away from it** — all chrome overlaps live editing area.

## Layer 1 — Pixi UI (drawn _on_ the canvas, via `UIContainer`)

| Element                                         | Anchor                                  | Intrinsic size              | Scaling / behavior                                                                  | Portrait notes                                                                              |
| ----------------------------------------------- | --------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Quickbar** (`QuickbarPanel`, 2 rows)          | bottom-center (desktop)                 | 442 × 100                   | `fitToWidthScale`; **retired on mobile** (hidden)                                   | **Gone on mobile** — actions live in the rail; slots/keybinds still work, desktop unchanged |
| **Wires panel** (`WiresPanel`)                  | beside the quickbar, else bottom-center | 136 × 62                    | clamp on-screen                                                                     | With the quickbar gone it **re-centres at the bottom**                                      |
| **Entity-info** (`EntityInfoPanel`)             | top-right                               | 270 × 270 (grows w/ recipe) | fit + clamp; re-anchors on canvas inset                                             | Occupies **top-right** when active                                                          |
| **Editors** (machine/inserter/chest/splitter/…) | centered                                | 402–**504** × 171–176       | scale-to-fit + clamp                                                                | Centered modal                                                                              |
| **Inventory** (`InventoryDialog`)               | centered                                | **responsive W** × ~520     | width fits the tabs (capped to screen, ≥404); tab/item **scroll** + **Recents tab** | Touch-usable: long-press preview + Pin/Unpin                                                |
| **Paint ghost icon**                            | follows finger (`globalX+16`)           | small                       | tracks pointer                                                                      | Not edge-anchored                                                                           |
| **Debug** (`DebugContainer`)                    | top-left (≈145, 5)                      | text                        | hidden unless `?debug`                                                              | —                                                                                           |

## Layer 2 — DOM overlays (on top of the canvas)

| Element                               | Anchor                                          | Size                                        | z-index | Mobile behavior                                                                                                      |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| **Action rail** (`#action-toolbar`)   | **left gutter** (below the logo + corner btns)  | 44px flush squares + labels; ⋯ overflow     | 4       | **Mobile only**; reserves a left canvas inset (`setViewportInsets`); **1-col portrait / 3-col landscape**, rest in ⋯ |
| **Logo / info** (`#corner-panel`)     | **top-left** (0,0)                              | ~52px logo badge                            | 5       | Tap = info-panel toggle (the "Press I" hint was dropped)                                                             |
| **Corner buttons** (`#buttons`)       | **top-left**, under the logo                    | desktop text rows; **mobile 44×44 squares** | 5       | Github / Settings (Discord dropped); **fold into the rail** on mobile (flush dark squares)                           |
| **Settings pane** (`.dg.main`)        | **top-left**, under `#buttons` (ResizeObserver) | 320px desktop / `min(360px,100vw)` mobile   | 5       | Starts **closed** on mobile                                                                                          |
| **Info panel** (`#info-panel`)        | **centered**                                    | `min(640px,90vw)` × `≤100dvh−32px`, scrolls | **100** | Hidden unless toggled; close ✕ top-right                                                                             |
| **Toasts** (`.toasts-container`)      | **bottom-right**                                | 320px wide, stacks upward                   | 20      | Same on mobile (transient)                                                                                           |
| **Loading screen** (`#loadingScreen`) | full-screen                                     | 100vw × 100vh                               | 10      | Boot only                                                                                                            |

## The competition map (was the problem; ✅ = now resolved)

**✅ Top band.** The action buttons moved off the top-center into a **left gutter**
(`#action-toolbar` is a vertical rail), the canvas is **inset** by the gutter so
the Pixi UI is _restricted_ rather than covered (the layout authority), and the
top-left logo + Github/Settings fold into the bar. The Pixi **entity-info** panel
(top-right) re-anchors on the inset (`fbe:viewportchange`), so it no longer spills
off the right edge in landscape.

**✅ Bottom band.** The **quickbar is retired on mobile**, so the Pixi/DOM
bottom-edge clash is gone; the small **wires** panel re-centres there. DOM
**toasts** (bottom-right) can still pass over the wires panel briefly, but they're
transient.

**✅ Two opposite "action" surfaces.** Resolved by the above — touch actions now
live in one place (the left rail), and the bottom Pixi quickbar is gone.

**🟡 Centered modals stack by luck.** Pixi dialogs/inventory (centered) and the
DOM info-panel (centered, z100) share the middle; they rarely coexist. (Unchanged
— low priority.)

**✅ Inventory group-tab overflow (Space Age).** The tab row + item grid are
**clipped to the dialog** (Pixi masks) and scroll (◀ ▶ tabs / ▲ ▼ items), with
viewport-gated hit-testing. The body width is now **responsive** so the tab scroll
only engages when tabs truly can't fit, and a **Recents tab** + **long-press
preview** (Confirm / Pin-Unpin) make the selector touch-usable.

## Root cause

There is **no layout authority**. The canvas is full-bleed; every DOM overlay is
independently `position: fixed` with hand-picked corners; the Pixi panels
position off `app.screen` with no knowledge of the DOM chrome (or vice-versa).
Nothing carves the viewport into regions, so "don't put X where Y is" is enforced
only by manual coordinates.

## Design directions on the table

(To be fleshed out together — captured here so we map ideas onto the inventory.)

1. **Gutters (portrait vs landscape)** — reserve top/bottom/side bands per
   orientation and shrink the canvas into the remainder; gives the missing layout
   authority.
2. **Rework the quickbar** — addresses the bottom-band Pixi/DOM split.
3. **Collapsible action buttons** — tame the top-band wrapping blow-up.
