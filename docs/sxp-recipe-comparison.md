# Space Exploration: what changed from 1.1 + SE 0.6 to 2.0 + SE 0.7

A recipe/item diff between two independently-produced datasets for the same
overhaul mod, one Factorio generation apart.

## The two datasets

| | "Old" side | "New" side |
| --- | --- | --- |
| Provenance | [FactorioLab](https://factoriolab.github.io/) `sxp` dataset (`data/sxp/data.json`, version 28) | This repo's baked-in pack (`packages/exporter/data/output/space-exploration/data.json`) |
| Engine | Factorio **1.1.109** | Factorio **2.0.76** |
| Space Exploration | **0.6.138** | **0.7.56** |
| Raw counts | 1470 items (incl. fluids), 1625 "recipes" | 2366 items, 48 fluids, 918 recipes, 338 entities |
| Shape | Curated *calculator* dataset (flat `items[]`/`recipes[]`, `in`/`out` maps) | Raw Factorio *data.raw* dump (prototype objects keyed by name) |

**Raw counts are not comparable** — the two datasets are built for different
purposes, so before any conclusion the numbers have to be normalized:

1. **FactorioLab folds technologies into both lists.** 571 of its 1625 "recipes"
   (and 571 "items") are technologies modeled as craftable research. The raw dump
   doesn't put technologies in `items`/`recipes`. Stripping them: **1054** real
   non-tech recipes on the 0.6 side vs **918** on the 0.7 side.
2. **FactorioLab models mining/pumping/scanning as pseudo-recipes** (128 in the
   `resources` category: `iron-ore`, `glass-from-sand`, `se-core-fragment-*-mining`,
   `coal-liquefaction-steam-*`, …). The raw dump only has actual `recipe`
   prototypes. These inflate the 0.6 "removed recipes" set but aren't real losses.
3. **FactorioLab pre-computes probabilistic outputs as expected value**
   (`amount × probability`), e.g. it lists `2.7` where the raw dump stores
   `amount_max: 3, probability: 0.9`, and `2` where the dump stores a `0–4` range.
   Comparing raw amounts against expected values produced **138 false "product
   changes"**; normalizing to expected value drops that to **32 real ones**.
4. **The raw dump keeps hidden/utility items** FactorioLab curates out (`barrel`,
   `blueprint`, `copy-paste-tool`, `parameter-0…9`, `*-unknown` placeholders,
   infinity/heat-interface test entities). These dominate the "1616 new vanilla
   items" and are noise.

Everything below is on the **shared Factorio internal-id space** after that
normalization. IDs match across both games, so set differences are exact; where a
number could still be a representation artifact it's called out.

Two distinct kinds of change are interleaved and worth separating:

- **Engine (base 1.1 → 2.0)** — renames and base rebalances that every 2.0 mod
  inherits.
- **Mod (SE 0.6 → 0.7)** — Space Exploration's own redesign for 2.0.

---

## 1. Fluids — the steam temperature system was collapsed

The cleanest and most structural change. 0.6 → 0.7 goes 50 → 48 fluids, but the
real story is a **-14 / +1** swap:

**Removed (14):** every discrete temperature-variant steam fluid —
`steam-100`, `steam-500`, `steam-5000`, and `se-decompressing-steam-165`
through `-5000` (`165/200/300/400/415/500/600/700/800/900/5000`).

**Added (1 real):** `se-energy-transmitter-fluid` (plus UI-only
`fluid-unknown` and `parameter-0…9`).

In 0.6, SE encoded steam pressure/temperature by minting a **separate fluid per
temperature band**. Factorio 2.0 gave fluids a first-class *temperature* property,
so 0.7 deletes the whole family and uses a single `steam` /
`se-decompressing-steam` fluid whose temperature varies. This ripples into every
turbine/condenser recipe (see §3).

---

## 2. Items

Restricted to the SE id space (`se-`/`deep-space-`), the item count is
**562 → 472** (436 common, **126 removed, 36 added**). The removals cluster into
a few deliberate system retirements:

### Delivery-cannon packaging economy — removed (~95 items)
In 0.6 the delivery cannon required every payload to be crafted into a dedicated
package item: ~90 `se-delivery-cannon-package-*` (one per ore/plate/barrel/
core-fragment), plus `se-delivery-cannon-weapon-package-*` and
`se-delivery-cannon-artillery-targeter-*`. In 0.7 that entire family is gone — the
0.7 dump contains only **9** `delivery-cannon` names total (the cannon, a generic
`se-delivery-cannon-capsule`/`-capsule-iridium`, a `se-delivery-cannon-targeter`,
the weapon variant). The per-item packaging was replaced by a **generic capsule**
mechanism.

### "Grounded" machine duplicates — removed (18 items)
0.6 shipped a `*-grounded` twin of every space machine
(`se-space-assembling-machine-grounded`, `se-space-manufactory-grounded`, all the
`se-space-*-laboratory-grounded`, `se-space-radiator[-2]-grounded`,
`se-space-supercomputer-1…4-grounded`, …). 0.7 removes all of them —
**0** `grounded` names remain in the dump. The space/surface distinction is no
longer modeled as separate prototypes.

### Renames / reworks (removed old id, added new)
- `se-core-miner` → **`se-core-miner-drill`**
- `se-naquium-heat-pipe-long--+--` / `--+-----+--` → **`--t--`** / **`--t-----t--`**
  (glyph change in the shape-suffix naming)
- `se-rocket-landing-pad`, `se-rocket-launch-pad-silo`, `se-rtg-equipment-2`,
  `se-fuel-refinery-spaced`, `se-gate-platform-scaffold`,
  `se-energy-transmitter-injector-reactor` — removed prototypes.

### SE items added in 0.7 (36)
- **Equipment tier-ups:** `se-antimatter-reactor-equipment`,
  `se-fusion-reactor-equipment` (replaces base `fusion-reactor-equipment`, now
  SE-prefixed).
- **Naquium gate content:** `se-gate-fragment-1…13`, `se-dimensional-anchor`,
  `se-space-elevator-connection-blocker`.
- **Elevated rails in space:** `se-space-rail-ramp`, `se-space-rail-support`
  (SE's take on the 2.0 elevated-rails feature).
- **Generic struct/clamp UI proxies:** `se-struct-generic-input/output/settings/
  clamp-east/clamp-west`, `se-*-targeter`, `se-spaceship-console-alt` — mostly
  editor/GUI helper prototypes.
- Misc: `se-iridium-piledriver`, `se-plasma-canister`, `se-capsule-se-biter-friend`,
  `se-cargo-rocket-section-packed`.

### Vanilla item changes = the known Factorio 2.0 renames
The 20 "removed vanilla items" are exactly the documented 2.0 renames — a good
sanity check that the diff is picking up real changes, not noise:

| 0.6 (1.1) | 0.7 (2.0) |
| --- | --- |
| `effectivity-module[-2…9]` | `efficiency-module[-2…9]` |
| `empty-barrel` | `barrel` |
| `stack-inserter`, `filter-inserter`, `stack-filter-inserter` | `bulk-inserter` (filtering folded into all inserters) |
| `logistic-chest-{active-provider,passive-provider,buffer,requester,storage}` | `{active-provider,passive-provider,buffer,requester,storage}-chest` |
| `used-up-uranium-fuel-cell` | `depleted-uranium-fuel-cell` |

---

## 3. Recipes

Non-technology recipes: **1054 (0.6) → 918 (0.7)**; **812 common**, 242 only-in-0.6,
106 only-in-0.7. After filtering the FactorioLab pseudo-recipes and renames, the
substantive changes are:

### Removed systems (real, not schema)
- **Delivery-cannon packing recipes** — all `se-delivery-cannon-pack-*`,
  `se-delivery-cannon-weapon-pack-*`, `se-delivery-cannon-artillery-targeter-*`
  (matches the item removal in §2).
- **Space-probe / telemetry launch recipes** — `se-satellite-telemetry`,
  `se-belt-probe-data`, `se-star-probe-data`, `se-void-probe-data`,
  `se-astrometric-analysis-multispectral-1`, and the
  `se-rocket-launch-pad-silo-*-launch` / `se-space-probe-rocket-silo-*-launch`
  families. The 0.6 rocket-silo-launches-a-probe modeling is gone;
  `se-astrometric-data` is the 0.7 replacement.
- Coolant/misc reworks: `se-space-coolant`, `se-space-coolant-cryonite`,
  `se-radiating-space-coolant-normal`, `se-scrap-recycling`,
  `se-empty-barrel-reprocessing`, `se-antimatter-canister-burn`,
  `se-lifesupport-canister-coal`, `se-core-miner`.

### Added systems (real)
- **Finer steam-condenser bands:** 0.6 had condenser-turbine reclaim recipes only
  for a few temperatures; 0.7 adds
  `se-condenser-turbine-reclaim-water-{200-300,300-400,400-415,415-500,600-700,
  700-800,800-900,900-1000}` — a denser temperature ladder, enabled by the new
  fluid-temperature system.
- **Spaceship engine burn recipes** now modeled:
  `se-spaceship-{rocket,ion,antimatter}-engine-burn`.
- **Direct plate recipes** replace the 0.6 `*-ingot-to-plate` pseudo-recipes:
  `se-beryllium-plate`, `se-holmium-plate`, `se-iridium-plate`, `se-naquium-plate`.
- New equipment/content recipes: `se-antimatter-reactor-equipment`,
  `se-fusion-reactor-equipment`, `se-gate-platform`, `se-dimensional-anchor`,
  `se-plasma-canister[-empty]`, `se-lifesupport-canister`, `se-methane-gas`,
  `se-space-elevator-maintenance`, `se-cargo-rocket-section-{packed,unpack}`,
  `se-scrap-hard-recycling`, `se-space-coolant-{hot,hot-cryonite,warm}`.
- Engine-side additions inherited from 2.0: `selector-combinator`,
  `display-panel`, `cargo-landing-pad`, `rail-ramp`, `rail-support`,
  `concrete-gate`, `steel-gate`, `equipment-gantry-insert/remove`.

### Genuine recipe rebalances (49 of 812 common recipes changed)

Of the 49, most are **engine renames flowing through ingredients** — not balance:
- `empty-barrel → barrel` in `cliff-explosives` + all 24 `empty-*-barrel` recipes.
- `effectivity-module → efficiency-module` in `jetpack-4`, `power-armor-mk2`,
  `se-space-material-fabricator`, `utility-science-pack`.
- `used-up-uranium-fuel-cell → depleted-uranium-fuel-cell` in
  `nuclear-fuel-reprocessing`.

The **genuinely rebalanced** recipes (mod + base):

| Recipe | Change |
| --- | --- |
| **Steam / turbine rework** (`se-big-turbine-internal`, `se-condenser-turbine-reclaim-water-100-165 / 165-200 / 500-600`) | Ingredient/output `steam-NNNN` → unified `steam`; water-reclaim output cut ~10× (e.g. `99 → 9.9`, `78 → 7.8`) while `se-decompressing-steam` output holds at 75.¹ |
| `se-steam-to-water` | Steam in `100 → 1000`, time `0.5 → 5` (10× scale-up) |
| `se-vulcanite-block` | Steam byproduct `4 → 40` |
| `se-pyroflux-steam` | Water in `500 → 50` |
| `se-cryonite-crystal` | Steam in `6 → 20`, water out `4 → 2` |
| `se-methane-ice` | Now crafted (`se-cryonite-slush` 10 + `se-methane-gas` 100 → 10) instead of a 0.6 raw/mined 1-output |
| `se-water-ice` | Now crafted (`se-cryonite-slush` 1 + `water` 100) instead of empty inputs |
| `se-rtg-equipment` | `uranium-fuel-cell` 4 → `uranium-238` 20 |
| `se-recycle-small-electric-pole` | Outputs halved (recycling yield change) |
| `atomic-bomb`, `spidertron` | `rocket-control-unit` → `processing-unit` |
| `electronic-circuit` | `wood` → `stone-tablet` (AAI early-game circuit) |
| `rocket` (capsule) | Dropped `electronic-circuit` ingredient, time `8 → 4` |
| `piercing-rounds-magazine` (base 2.0) | Now batches ×2: `firearm-magazine` 1→2, `copper-plate` 5→2, output 1→2, time 3→6 |
| `small-electric-pole` (base 2.0) | Output `1 → 2` |
| `concrete-wall`, `small-iron-electric-pole` | Time `0.5 → 0.25` |
| `steel-wall` | Time `0.5 → 1` |

¹ The ~10× water-reclaim drop is consistent across all condenser/turbine recipes
and affects only the (non-probabilistic) water output while decompressing-steam is
unchanged, so it isn't an expected-value artifact — but since it coincides with
the fluid-temperature rework it's worth confirming in-game before treating it as a
pure nerf.

---

## Headline summary

- **Engine (1.1 → 2.0):** module rename (`effectivity`→`efficiency`), barrel rename
  (`empty-barrel`→`barrel`), inserter consolidation (stack/filter →
  `bulk-inserter`), logistic-chest renames, fuel-cell rename, and the new
  first-class **fluid temperature** property. Base additions: selector combinator,
  display panel, elevated-rails ramps/supports, cargo landing pad.
- **Mod (SE 0.6 → 0.7):** the **discrete steam-temperature fluid family (-14)** is
  deleted in favor of temperature-carrying steam; the **delivery-cannon per-item
  packaging economy (~95 items + recipes)** is replaced by a generic capsule; the
  **`*-grounded` space-machine duplicates (18)** are removed; the **space-probe /
  telemetry launch** recipes are reworked into `se-astrometric-data`; naquium
  **gate-fragment** content and **antimatter/fusion reactor equipment** are added;
  ingot→plate crafting is made direct; and a cluster of thermodynamics recipes are
  rebalanced.

## Caveats

- The 0.6 side is FactorioLab's community-maintained dataset, not a first-party
  dump; it can lag or approximate the mod (esp. probabilistic yields, which it
  stores as expected value). The 0.7 side is a first-party `data.raw` dump. A
  couple of the rebalances above (notably the 10× water-reclaim drop) are inferred
  from dataset values and worth an in-game check.
- Technologies, mining/pumping pseudo-recipes, and hidden/UI items were excluded
  to keep the comparison apples-to-apples; this is a **recipe/item content** diff,
  not a tech-tree or entity-stats diff.
- Data sources: FactorioLab `sxp` v28 (SE 0.6.138 / Factorio 1.1.109) vs this
  repo's `space-exploration` pack (SE 0.7.56 / Factorio 2.0.76).
