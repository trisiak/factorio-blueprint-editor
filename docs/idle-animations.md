# Idle-state entity animations — design (#29)

> Investigation + plan, not yet implemented. Goal: a **global toggle** that plays
> entities' idle animations on the canvas (instead of the static frame 0 we draw
> today), surfaced as a switch in Settings and a button on the mobile action rail
> (see `mobile-controls.md`). Spun out of the Space Exploration work (#28); the
> shape-normalized renderer there means animation metadata now reaches the
> sprites uniformly across packs.

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
- **Viewport culling** — only step sprites whose entity is within the visible
  viewport (the `Viewport`/`PositionGrid` already know on-screen bounds); a huge
  off-screen factory costs nothing.
- **Pause when hidden** — drop the ticker callback on `visibilitychange`
  (pattern already used in `settingsPane`/`index.ts`).
- Optional **zoom threshold** (don't animate when zoomed far out — sub-pixel
  motion isn't visible anyway) and a **hard cap** with graceful "animate the
  first N on-screen" if a blueprint is pathologically large.

## Scope / open questions

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

- **v1** — metadata on sprites + per-frame texture resolver + shared ticker
  driver + `animationsEnabled` setting + Settings checkbox + action-rail button +
  viewport culling + pause-when-hidden. Single-sheet parts, "preview" semantics.
- **v2** — idle-only semantics, `run_mode` fidelity, multi-file (stripes/
  filenames) animations, optional per-entity-type opt-out for noisy ones.

No new data or exporter work is required — this is purely an editor-rendering
feature.
