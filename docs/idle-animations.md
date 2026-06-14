# Idle-state entity animations — design (#29)

> Goal: a **global toggle** that plays entities' idle animations on the canvas
> (instead of the static frame 0 we draw today), surfaced as a switch in Settings
> and a button on the mobile action rail (see `mobile-controls.md`). Spun out of
> the Space Exploration work (#28); the shape-normalized renderer there means
> animation metadata now reaches the sprites uniformly across packs.
>
> **Status: v1 has landed** (single-sheet animations + shared-clock ticker
> driver + `animationsEnabled` setting + Settings checkbox + action-rail Animate
> button + viewport culling + zoom gate + hidden-tab guard). All of v2 (idle-only
> semantics, `run_mode` fidelity, multi-file animations) is still open — see
> Phasing.

## Why it's feasible (the data + plumbing already exist)

- **The frames are already in the atlas.** Each animation's spritesheet is one
  `.basis`; we currently draw only frame 0. `getTexture(path, x, y, w, h)`
  (`common/globals.ts`) returns a cached `Texture` whose `frame` rect points at a
  sub-region of that sheet — so "play frame N" is just a different frame rect on
  the same loaded source. No new assets, no re-fetch.
- **The metadata is in the dump.** `frame_count`, `line_length`,
  `animation_speed`, `run_mode`, `repeat_count` are all present
  (`frame_count` appears ~4.9k times across the SE pack). Frame N of a sheet is
  at `x = baseX + (N % cols) * width`, `y = baseY + floor(N / cols) * height`,
  where `cols = line_length || frame_count` (single-row sheets set
  `line_length = 0`).
- **There's a ticker.** `G.app.ticker.add(fn)` is the established pattern
  (`BlueprintContainer`, `DebugContainer`).
- **Scope (measured via a one-off census pass):** entity types with a drawn
  `frame_count > 1` part — vanilla **38/121** (79 parts), space-exploration
  **131/338** (362 parts). Multi-file animations (`stripes`/`filenames`) are rare
  (0 vanilla, 8 SE) → defer to v2.

## Architecture

1. **Animation metadata on `EntitySprite`.** `EntitySprite.getParts` already has
   each part's `frame_count`/`line_length`/`animation_speed` and the base
   `x/y/width/height`. For a part with `frame_count > 1`, stash an
   `AnimationSpec { frames, cols, speed, baseX, baseY, w, h, runMode }` on the
   sprite instead of discarding it.
2. **Per-frame textures, cached + shared.** Compute frame N's texture lazily via
   the existing `getTexture(path, baseX + (N%cols)*w, baseY + floor(N/cols)*h,
w, h)`. `textureCache` is keyed by `path-x-y-w-h`, so frame textures are
   shared across every sprite of the same type and the same animation frame —
   memory stays bounded (one texture per (type, frame), not per sprite).
3. **One global driver, one shared clock.** A single `G.app.ticker` callback
   advances a monotonic time; each registered animated sprite computes its frame
   from `floor(time * speed) % frames` (respecting `run_mode`:
   `forward` / `backward` / `forward-then-backward`) and swaps `sprite.texture`.
   Texture swap is cheap in Pixi (no geometry change). Register animated sprites
   in a `static Set<EntitySprite>` on construction (when an `AnimationSpec`
   exists) and remove on `destroy()` — `EntityContainer` rebuilds an entity's
   sprites on redraw, so an `EntitySprite.destroy()` override must unregister to
   avoid leaks.
4. **Global toggle, gated.** `editor.animationsEnabled` (persisted to
   `localStorage`, default **off** — keep the editor calm/battery-friendly).
   When off, the ticker callback isn't added and sprites show frame 0 (today's
   behavior); flipping it on adds the callback, off removes it and resets every
   registered sprite to frame 0.
5. **UI.**
    - **Settings:** a `gui.add({ animations }, 'animations').onChange(...)`
      checkbox in `settingsPane.ts`, alongside `debug` / `limitWireReach`.
    - **Action rail:** a new `toggleAnimations` action (`actions.ts`
      `registerAction`) + an entry in `actionToolbar.ts`'s priority list
      (`{ action: 'toggleAnimations', glyph: '▶'/'⏸', label: 'Animate' }`),
      reflecting on/off state. The two stay in sync through the one
      `editor.animationsEnabled` setter.

## Performance plan (the real risk)

Thousands of sprites can be on screen. Mitigations, in priority order:

- **Off by default**; zero cost until toggled.
- **Shared clock, integer frame index** computed per tick; sprites only swap
  `texture` when their frame index actually changes (skip no-op swaps).
- **Viewport culling** _(landed, v1)_ — each tick inverts the live
  `BlueprintContainer` transform (`getViewportScale` + `position`/`scale`) into a
  world-space rect and skips stepping any sprite whose tile (padded by its own
  extent) falls outside it. Off-screen sprites cost a bounds check, not a texture
  swap; `EntitySprite.visibleRect` / `inRect`.
- **Pause when hidden** _(landed, v1)_ — browsers already pause
  `requestAnimationFrame` (and thus Pixi's ticker) for a backgrounded tab, so the
  driver simply early-returns on `document.hidden` as an explicit belt-and-braces
  guard rather than wiring a separate `visibilitychange` listener.
- **Zoom threshold** _(landed, v1)_ — below `ANIM_MIN_SCALE` (0.35) the driver
  holds every sprite on frame 0; the reset runs once on the transition (tracked
  by `animDormant`), not every tick.
- Still open: a **hard cap** with graceful "animate the first N on-screen" if a
  blueprint is pathologically large (the culling above makes this lower-priority).

## Scope / open questions

### Why a given entity does (or doesn't) animate — the taxonomy

An entity animates in v1 **iff the specific part the draw function selects is a
single-sheet `Animation` with `frame_count > 1`.** Four buckets cover what we see
in practice (handy when triaging "why is X static?"):

| Bucket                                                                                                                                 | Example                                                                                                                                                                                                 | v1                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Real animation** — drawn part has `frame_count > 1`                                                                                  | vanilla `steam-turbine` (a `generator`; `horizontal/vertical_animation` layer 0 is `frame_count: 8`), beacons                                                                                           | ✅ animates                                                      |
| **Static-by-design idle** — drawn part is `frame_count: 1`; the motion lives on a `working_visualisation` _or a hidden sibling entity_ | SE `se-big-turbine`/`se-condenser-turbine` (`furnace`, only a `frame_count: 1` `idle_animation`); the spin is on hidden `se-big-turbine-generator-NW/-SE` `generator`s that never appear in a blueprint | ❌ static (correct — the motion isn't on the blueprinted entity) |
| **Rotation, not animation** — `RotatedSprite`/`direction_count`, no `frame_count`                                                      | `radar` (`pictures` is a 64-`direction_count` rotated sprite; the in-game dish sweep is the engine stepping through _orientations_, not a fixed-speed frame loop)                                       | ❌ static                                                        |
| **Multi-file frames** — `stripes`/`filenames`                                                                                          | SE core miner                                                                                                                                                                                           | ❌ frame 0 (deferred, below)                                     |

The middle two are _correct_ to leave static: SE's turbine has no idle motion of
its own, and the radar "motion" is a rotational sweep. **Radar is a candidate v2
special-case** — synthesize a spin by cycling the `direction_count` orientations
on a slow clock (a distinct path from the `frame_count` driver). The hidden-
sibling-entity pattern (animation on a script-placed companion, not the
blueprinted prototype) is generally out of scope — we render what's in the
blueprint.

- **Idle vs working semantics.** In-game, some animations only play while the
  entity is _working_ (assembling-machine craft cycle) while others play idle
  (beacons pulse, radar dishes, `always_draw` working-visualisations). The draw
  functions emit the entity's main animation regardless. **v1** treats this as a
  _preview_ toggle — animate every drawn multi-frame part — which is the simplest
  honest interpretation of "turn on animations." **v2** narrows this to keep the
  good loops and drop the noisy/aggressive ones — see the dedicated
  [Idle vs working — research & tuning plan](#idle-vs-working--research--tuning-plan-v2)
  below.
- **Multi-file animations** (`stripes`/`filenames`, 8 in SE) span files per
  frame; v1 animates only single-sheet parts (renders frame 0 for multi-file, as
  today). v2 extends the per-frame resolver to walk stripes/filenames.
- **Coordinate with the mobile action rail** (`mobile-controls.md`) — the rail is
  under active layout work; the new button slots into its existing priority/
  overflow scheme, but land it without regressing that.

## Idle vs working — research & tuning plan (v2)

> Goal: keep the loops that make the factory feel alive (belts, crafters,
> beacons, the roboport antenna) and drop the ones that read as noise when looped
> forever (gate open/close, the logistic-chest status blink, the rocket-silo
> launch sequence). v1's blanket "animate every multi-frame part" is too eager.
> Findings below are from a measurement pass over both packs' dumps — no scripts
> were run, so this is what the _prototype data_ tells us; the in-game
> idle/working truth lives in Lua we don't execute, so some hand-tuning is
> unavoidable and expected.

### Loop speed alone won't separate good from bad

Loop time is `frame_count * 1000 / (animation_speed * 60)` ms (the driver's
per-frame `frameMs * frame_count`). Measuring the _drawn_ part of each entity:

| Entity (drawn part)                                 | frame_count | speed   | loop      | loops/s | verdict |
| --------------------------------------------------- | ----------- | ------- | --------- | ------- | ------- |
| transport-belt (`belt_animation_set.animation_set`) | 16          | 1.0     | 267ms     | 3.75    | ✅ keep |
| roboport `base_animation` (antenna)                 | 8           | 0.5     | 267ms     | 3.75    | ✅ keep |
| roboport `door_animation_up/down`                   | 16          | 1.0     | 267ms     | 3.75    | ❌ drop |
| gate `vertical/horizontal_animation`                | 16          | 1.0     | 267ms     | 3.75    | ❌ drop |
| logistic-container `animation`                      | 7–8         | 1.0     | 117–133ms | ~8      | ❌ drop |
| rocket-silo `arm_*` / `satellite_animation`         | 32          | 0.3–0.4 | 1.3–1.8s  | ~0.6    | ❌ drop |
| assembling-machine `graphics_set.animation`         | 32          | 1.0     | 533ms     | 1.88    | ✅ keep |
| beacon `animation_list`                             | 45          | 0.5     | 1.5s      | 0.67    | ✅ keep |
| centrifuge `graphics_set.idle_animation`            | 64          | 1.0     | 1067ms    | 0.94    | ✅ keep |
| generator (steam engine/turbine `*_animation`)      | 32          | 1.0     | 533ms     | 1.88    | ✅ keep |
| pumpjack `animation`                                | 40          | 0.5     | 1.3s      | 0.75    | ✅ keep |

The roboport antenna and its doors loop at the **same** 267ms; gates are
moderate; the rocket silo is _slow_ (0.6/s) yet clearly wrong. Only the logistic
chest is genuinely fast. So a speed cut-off catches the chest, misses gate +
silo, and a low cap would wrongly kill belts. **Speed is a secondary safety net,
not the primary signal.**

### The real signal is semantic — and it's in the field name

What separates "loop forever is correct" from "looping is noise" is the _kind_ of
motion the prototype field encodes, which Factorio expresses through field naming
rather than any flag we can read generically:

- **Continuous / genuinely idle → animate.** `belt_animation_set`,
  `idle_animation` (centrifuge names it outright), roboport `base_animation`,
  beacon `animation_list`, generator `horizontal/vertical_animation`.
- **Event-driven → freeze.** roboport `door_animation_*` (opens when a bot
  passes), gate `vertical/horizontal_animation` (opens on approach).
- **One-shot sequence → freeze.** rocket-silo `arm_*` / `satellite_animation` /
  `door_*` — the launch animation; looping the "ready" pose is the odd loop.
- **Status indicator → freeze (or occasional "fun").** logistic-container
  `animation` (the fast ~8/s blink), accumulator `charge_animation`, lab
  `on_animation`.
- **Working-while-crafting → keep as preview.** `working_visualisations[]`,
  crafter `graphics_set.animation`. Technically working-only, but reads as the
  classic "factory is alive" look.

**The catch:** by the time a sprite reaches the driver the draw functions have
flattened everything to `filename + frame_count` — the field name is gone. To act
on this signal, `getParts` (or the draw functions) must tag each sprite with its
**source field** (provenance). That tag is the one bit of plumbing beyond a pure
data file, and it's exactly what roboport needs (animate `base_animation`, freeze
`door_*` on the _same_ entity).

### Entity `type` is the practical coarse bucket

Maps cleanly to intent and fixes all three problem cases without per-part tagging:

- **Always-on (continuous in-game):** transport-belt, underground-belt, splitter,
  loader, generator, beacon → animate.
- **Crafters (preview-nice):** assembling-machine, furnace, mining-drill,
  chemical-plant → animate.
- **Suppress by default (event / sequence / status):** `gate`,
  `logistic-container`, `rocket-silo`.
- **Mixed → needs per-part policy:** `roboport` (antenna yes, doors no).

### Two incidental findings

- **`run_mode`:** ~30% of all animations are `backward` or
  `forward-then-backward` (ping-pong), but the driver is forward-only-modulo. The
  drawn _main_ animations sampled are all `forward`, so it doesn't bite today —
  but it will the moment working sub-parts get animated (already a v2 item).
- **Belts already animate** — `belt_animation_set.animation_set` (`frame_count:
16`) flows through `getBeltSprites` → `setupAnimation` intact. Worth a visual
  confirm, but "keep belts" is the default, not new work.

### Proposed rules file (shape, not yet built)

A small declarative table, pack-overridable, tuned over time:

```jsonc
{
    // default policy by entity type (everything not listed: 'animate')
    "typePolicy": { "gate": "static", "logistic-container": "static", "rocket-silo": "static" },
    // per-entity name overrides (pack-specific escape hatch)
    "entityPolicy": {},
    // per-part suppression by source field — needs the provenance tag
    "partDenylist": [
        "door_animation_up",
        "door_animation_down",
        "recharging_animation",
        "charge_animation",
    ],
    // safety net for stray fast flickers
    "maxLoopsPerSecond": 7,
}
```

The type/entity/safety levers are pure data; only `partDenylist` needs the
provenance tag to function (and it's what makes roboport behave).

### Rollout (two slices, low debt)

1. **Type denylist + safety cap** — pure data, no plumbing. Instantly fixes
   gates, logistic chests, and rocket silos; leaves belts/crafters/beacons/
   generators on. Ship this first.
2. **Provenance tag + per-part policy** — tag sprites with their source field in
   `getParts`, then apply `partDenylist`. Unlocks roboport (antenna on, doors
   off) and any other mixed entity.

Radar's rotation sweep (see the taxonomy table above) is a separate, optional
slice — synthesize a spin from `direction_count`, not part of this idle/working
work.

## Phasing

- **v1** _(done)_ — metadata on sprites + per-frame texture resolver + shared
  ticker driver + `animationsEnabled` setting + Settings checkbox + action-rail
  button + viewport culling + zoom gate + hidden-tab guard. Single-sheet parts,
  "preview" semantics.
- **v2** — idle-vs-working tuning (see the research & tuning plan above: a
  type-denylist + safety-cap slice, then a provenance-tag + per-part slice),
  `run_mode` fidelity, multi-file (stripes/filenames) animations, and optionally
  radar's rotation sweep.

No new data or exporter work is required — this is purely an editor-rendering
feature.
