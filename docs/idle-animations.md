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
  honest interpretation of "turn on animations." **v2** could restrict to
  genuinely-idle animations by keying off `always_draw` / the
  idle-vs-working-visualisation distinction.
- **Multi-file animations** (`stripes`/`filenames`, 8 in SE) span files per
  frame; v1 animates only single-sheet parts (renders frame 0 for multi-file, as
  today). v2 extends the per-frame resolver to walk stripes/filenames.
- **Coordinate with the mobile action rail** (`mobile-controls.md`) — the rail is
  under active layout work; the new button slots into its existing priority/
  overflow scheme, but land it without regressing that.

## Phasing

- **v1** _(done)_ — metadata on sprites + per-frame texture resolver + shared
  ticker driver + `animationsEnabled` setting + Settings checkbox + action-rail
  button + viewport culling + zoom gate + hidden-tab guard. Single-sheet parts,
  "preview" semantics.
- **v2** — idle-only semantics, `run_mode` fidelity, multi-file (stripes/
  filenames) animations, optional per-entity-type opt-out for noisy ones.

No new data or exporter work is required — this is purely an editor-rendering
feature.
