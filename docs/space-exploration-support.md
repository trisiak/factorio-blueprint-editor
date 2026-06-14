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
