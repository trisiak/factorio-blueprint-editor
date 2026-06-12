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

| Element                                         | Anchor                                                  | Intrinsic size              | Scaling / behavior                                     | Portrait notes                                                       |
| ----------------------------------------------- | ------------------------------------------------------- | --------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| **Quickbar** (`QuickbarPanel`, 2 rows)          | bottom-center                                           | 442 × 100                   | `fitToWidthScale` (8px margin) → ~0.90 → **~396 × 90** | The one already-fixed panel; bottom-pinned                           |
| **Wires panel** (`WiresPanel`)                  | beside quickbar's right edge, else **stacked above** it | 136 × 62                    | clamp on-screen                                        | Can't fit beside on a phone → lands **bottom-right, above quickbar** |
| **Entity-info** (`EntityInfoPanel`)             | top-right                                               | 270 × 270 (grows w/ recipe) | fit + clamp; shown on hover/selection                  | Occupies **top-right** when active                                   |
| **Editors** (machine/inserter/chest/splitter/…) | centered                                                | 402–**504** × 171–176       | scale-to-fit + clamp                                   | Centered modal                                                       |
| **Inventory** (`InventoryDialog`)               | centered                                                | 404 × ~520                  | scale-to-fit (W & H) + clamp                           | Centered modal, tall                                                 |
| **Paint ghost icon**                            | follows finger (`globalX+16`)                           | small                       | tracks pointer                                         | Not edge-anchored                                                    |
| **Debug** (`DebugContainer`)                    | top-left (≈145, 5)                                      | text                        | hidden unless `?debug`                                 | —                                                                    |

## Layer 2 — DOM overlays (on top of the canvas)

| Element                               | Anchor                                          | Size                                        | z-index | Mobile behavior                                                                                                           |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Action rail** (`#action-toolbar`)   | **left gutter** (below the logo + corner btns)  | 44px flush squares + labels; ⋯ overflow     | 4       | **Mobile only**; reserves a left canvas inset (`setViewportInsets`); **1-col + overflow portrait / 3-row grid landscape** |
| **Logo / info** (`#corner-panel`)     | **top-left** (0,0)                              | ~52px logo badge                            | 5       | Tap = info-panel toggle (the "Press I" hint was dropped)                                                                  |
| **Corner buttons** (`#buttons`)       | **top-left**, under the logo                    | desktop text rows; **mobile 44×44 squares** | 5       | Github / Settings (Discord dropped); **fold into the rail** on mobile (flush dark squares)                                |
| **Settings pane** (`.dg.main`)        | **top-left**, under `#buttons` (ResizeObserver) | 320px desktop / `min(360px,100vw)` mobile   | 5       | Starts **closed** on mobile                                                                                               |
| **Info panel** (`#info-panel`)        | **centered**                                    | `min(640px,90vw)` × `≤100dvh−32px`, scrolls | **100** | Hidden unless toggled; close ✕ top-right                                                                                  |
| **Toasts** (`.toasts-container`)      | **bottom-right**                                | 320px wide, stacks upward                   | 20      | Same on mobile (transient)                                                                                                |
| **Loading screen** (`#loadingScreen`) | full-screen                                     | 100vw × 100vh                               | 10      | Boot only                                                                                                                 |

## The competition map (portrait)

**✅ Top band — largely resolved (slice 1).** The action buttons moved off the
top-center into a **left gutter** (`#action-toolbar` is now a vertical rail), and
the canvas is **inset** by the gutter width so the Pixi UI reflows out of it —
the first real "layout authority". What remains top-left: `#corner-panel`
(0–80px) → `#buttons` → settings pane (a loose stack the rail now sits below; full
top-left consolidation is a follow-up). Top-**right** still hosts the Pixi
**entity-info** panel (clips in short landscape — see below).

**🔴 Bottom band — Pixi vs DOM with no awareness of each other.**

- Pixi **quickbar** (bottom-center) + **wires** (bottom-right, above quickbar).
- DOM **toasts** (bottom-right, z20) render _over_ that corner → **toasts overlap
  the wires panel** and the quickbar's right end.

**🟡 Two opposite "action" surfaces.** Primary touch actions are split: the
**quickbar at the bottom (Pixi)** and the **action toolbar at the top (DOM)** —
different tech stacks, opposite edges, neither knows the other's bounds.

**🟡 Centered modals stack by luck.** Pixi dialogs/inventory (centered) and the
DOM info-panel (centered, z100) share the middle; they rarely coexist.

**🟡 Inventory group-tab overflow (Space Age).** The inventory's group tabs are
laid out at `groupIndex * 70` against a fixed 404px dialog body — fine for
vanilla's ~5 groups, but Space Age adds more, so the tab row spills past the
dialog's right edge (horizontal overflow _inside_ the panel, independent of the
outer scale-to-fit). Surfaced by the storyboards, which load `?pack=space-age`.

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
