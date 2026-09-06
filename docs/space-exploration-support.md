# Space Exploration support — status

> Closes the rendering/editor fidelity tracked in #28. The pack itself (exporter
> portal-mod support, the pinned 35-mod dump, atlas) shipped in #25; the mod-list
> extraction + per-mod data is in `space-exploration-modlist.md`.

The Space Exploration pack (SE 0.7.56 on Factorio 2.0.76) is supported to the
same bar as vanilla/Space Age: **every placeable, blueprint-able entity renders,
and every entity with configurable state has a reachable editor.**

## How (no mod-specific code)

Factorio's prototype graphics are shape-polymorphic — a `Sprite`/`Animation`
field may be a plain definition, `{layers: […]}` (recursive), a per-direction
map (`{north,east,south,west}`), or split across files via `filenames`/`stripes`;
a `Sprite4Way` carries either `sheet` or `sheets`. The game's data loader
normalizes all of these. The editor had been written to whichever single shape
vanilla happens to use per field, so modded prototypes using a different (still
valid) shape threw and fell back to the labeled box.

The fixes are **general shape handling**, not special-casing — every branch keys
off the shape, never an entity name or mod (`grep` for `'se-'` in `editor/src`
finds nothing). Dispatch stays by prototype _type_, as in the game itself.

- `layersOf()` — flatten `{layers}`/plain at the generator seam and the draw
  sites that indexed `.layers` directly (roboport, ammo/electric turret, beacon,
  generator, lamp, electric-energy-interface, container).
- `getAnimation()` — resolve a per-direction `Animation4Way` (or pass a plain
  animation through) for directional idle/picture/animation fields.
- `structureSheets()` — `sheet` vs `sheets` for belt/underground structures.
- `stripes` in `EntitySprite` — render frame 0 from `stripes[0]`, like `filenames`.
- Editor routing by _type_ + module slots (not vanilla name) so modded
  beacon/lab/mining-drill variants reach their editor; the module grid wraps for
  high-slot entities (SE wide beacons have up to 20).

That these changes also improved vanilla and Space Age (not just SE) is the
signal they're principled rather than ad-hoc.

## Guard rails

- `core/spriteCensus.test.ts` — runs every entity of every pack through the
  sprite builder and pins the failed/partial counts (a fix must lower them, a
  regression can't land silently).
- `UI/editors/editorRouting.test.ts` — pins the set of entities with
  configurable state that route to no editor (now empty in every pack).
- `core/recipeIcon.test.ts` — every recipe resolves to a renderable icon; the
  assembler fluid getters are total over all recipes.
- `e2e/se-modpack.spec.ts` — pack load, a real SE blueprint book, the inventory,
  and a fixed-entity fixture all render without app errors.

## Census (current)

| pack              | partial | failed |
| ----------------- | ------- | ------ |
| vanilla-2.0       | 0       | 2      |
| space-age         | 0       | 3      |
| space-exploration | 0       | 10     |

## Corrected re-export (2026-07-20)

The committed dump predated the exporter's load-last fix (`f714ad6`) and had
only been hand-patched for 17 recipes — everything else SE's _postprocess_
mod finalizes in `data-final-fixes` was still in its pre-fix state. A full
re-export with the fix applied corrected:

- **Beacon stats** — the basic beacon is `distribution_effectivity` **0.5**
  with the `[1, 0]` beacon-overload profile (was vanilla's `1.5` + 1/√N),
  which the beacon effect math in `EntityInfoPanel` now honors via
  `core/beaconEffects.ts` (profile × effectivity, `beacon_counter` semantics).
- **102 entities, 109 recipes, 210 items** that postprocess generates late
  (grounded/spaced structure variants, placeable ruin remnants, late recipe
  variants) are now in the dump. The ruins' `animations`-array shape
  (AnimationVariations) is handled in `draw_simple_entity`, keeping the
  census at 0 partial without ratcheting.

The re-encode is deterministic — no previously committed `.basis` changed —
so the atlas diff is exactly the data diff (95 added, 9 pruned).

## Accepted box-fallbacks (intentionally not rendered)

The remaining "failed" entries are **graphics-less internal/script entities**,
not placeable buildings — none are produced by an item's `place_result` (the one
exception, `se-space-elevator-connection-blocker`, is a `not-deconstructable`
neutral blocker the space elevator auto-places). They essentially never appear in
a user blueprint, and the labeled-box fallback is acceptable graceful
degradation if one does:

- vanilla/SA baseline: `dummy-rail-ramp`, `dummy-rail-support`,
  `fulgoran-ruin-attractor`.
- SE: `se-spaceship-clamp`(+`-power-pole-internal/external-west/east`),
  `se-spaceship-console-output`, `se-spaceship-obstacle-entity-large-targetable`,
  `se-space-elevator-connection-blocker`, `se-energy-transmitter-injector-reactor`.

## Round-trip fidelity fixes (2026-09)

Two classes of bug found by exporting from the SE pack and importing the result
back into the game. Neither is SE-specific in its _cause_ — the SE pack is just
where they showed, because it is the pack people paste back into a running save.

**Filters exported without a quality spec.** Every item filter Factorio writes —
an inserter's `filters`, a splitter's `filter`, a chest request, a constant
combinator signal — carries `quality` + `comparator`, and it does so in a game
with no Quality mod too (`quality/normal` is a base-2.0 prototype; the SE dump's
own blueprints read `quality: "normal", comparator: "="` even though SE's 35-mod
list has no Quality). Omitting the pair is not "no quality stated": the game
reads it as _any_ quality and paints the five-dot any-quality symbol over the
slot. `core/itemFilters.ts` now supplies the pair — preferring an imported
blueprint's own values, which the filter UI used to flatten on any edit, and a
pasted setting's over the target's.

**16-way directions, 8-way arithmetic.** `PositionGrid.getOpposingEntity` — the
walk that finds an underground belt's other end — still derived its axis and
sign the 1.1 way (`direction % 4 !== 0` for "horizontal", `=== 6` for west).
Under 2.0's 16 directions _every_ cardinal is `% 4 === 0` and west is 12, so
east- and west-facing runs both searched straight down and never found their
partner: the held ghost stayed an entrance, a pipetted exit came back as an
entrance facing the wrong way, and the pair silently didn't connect once the
blueprint was back in the game (the overlay line drew off-axis for the same
reason). `util.directionToVector` is now the one place that maps a direction to
a step. Pinned by `core/undergroundPairs.test.ts`, all four directions, vanilla
and SE.

Two mod-safety slips rode along, both of the kind this pack exists to catch —
name checks where a type check belongs: `EntityContainer`'s neighbour-redraw
groups were a hardcoded vanilla belt list (so none of SE's nine belts,
undergrounds or splitters ever redrew their neighbours, leaving stale corners
and underground structures), and `PaintEntityContainer` tested for the literal
`pipe-to-ground`, so `se-space-pipe-to-ground` got no pair line and its ghost
never flipped to place the far end.

## Exporter caveats (won't-fix)

- **4 skipped sprite refs.** SE's `energy-transmitter`/`antimatter-reactor` copy
  base's 1.1-era `nuclear-reactor/connection-patch-*.png` paths, which base 2.0
  removed — the files don't exist on disk, so the exporter skips them with a
  warning. Cost is a missing heat-pipe overlay on those two entities.
- **Hidden auto-generated recipes** (e.g. `se-delivery-cannon-pack-*`) are
  filtered from the dump, as in vanilla; the cannon's editor shows no recipe,
  which matches the game's hidden-recipe behavior.

## Out of scope

Idle-state entity animations (playing animated sprites rather than frame 0) are
an editor-wide extension tracked in #29.
