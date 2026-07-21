# Decoupled, swappable graphics packs

Status: **design / RFC**. No code yet — this is the shape we're committing to
before touching the loader. Companion to the size analysis that motivated it
(frame-crop + resolution; see the "Size levers" section).

## Why

Today the editor ships its graphics **baked into the deploy**: the website
build copies `packages/exporter/data/output/*` into `dist/data`
(`packages/website/vite.config.js`), ~395 MB of `.basis` across three packs
(9,497 files each). That's the thing that's too heavy to host/upload and bloats
git (`.git` is ~600 MB). We want to stop shipping the heavy assets and instead:

1. **Ship a tiny baseline pack with the site** — low resolution, no animation
   frames, and for some/all entities just *placeholder symbols* instead of real
   art. Loads instantly, works on the worst connection.
2. **Let users point at (or upload) a higher-fidelity pack** — full resolution,
   optionally with idle-frame animation — loaded into the browser, cached, and
   swappable at runtime. Graphics live *away from* `data.json` and the website.
3. **Generate packs without a per-device CLI.** In-browser generation on a
   capable device, and/or extraction that happens *off* the person's device, so
   a **phone benefits from a high-fidelity pack it could never build itself**.

## The core idea: logical model vs. physical fidelity

`data.json` is the **logical model** — entities, recipes, and crucially the
*sprite metadata*: `filename`, `frame_count`, `line_length`, `width`, `height`,
`shift`, `scale` (see `spriteDataBuilder.ts`). It's small (2–4 MB) and tied to a
mod set, not to a fidelity.

A **graphics bundle** is the *physical pixels* at some fidelity. It carries its
own small **manifest** describing what it actually contains, per sprite path:
how many frames are present, the resolution factor, the encoding, and whether
the path is real art or a placeholder.

The renderer **reconciles** the two: for each sprite `data.json` asks for, it
consults the bundle manifest to decide how many frames physically exist and at
what scale, and draws accordingly. Consequences:

- **One `data.json`, many bundles.** The shipped `vanilla-2.0/data.json` pairs
  with the shipped lite bundle *or* a user's full-res animated bundle — no data
  regeneration to change fidelity. This is the whole swap.
- **Fidelity is additive and safe to degrade.** A lite bundle reports
  `frames: 1` → static draw, no ticker; a full bundle reports `frames: 8, fps:
  30` → idle loop. Same `data.json`, same entity, different bundle.
- **The mobile story falls out for free.** A phone loads the shipped `data.json`
  (small) and registers a hosted high-res bundle *URL*. It does no extraction —
  it just points at pixels someone else produced.

### Reconciliation detail (resolution)

`data.json`'s `shift`/`scale` are in *original* frame-pixel units. If a bundle
downscales art by factor `f`, the texture has `f×` fewer pixels but must draw at
the same world size, so the renderer uses `effectiveScale = data.scale / f`
(bundle manifest carries `resolutionFactor`, global or per-sprite). The bundle
is smaller; nothing in `data.json` changes.

## Fidelity tiers

Three points on one axis; all share a `data.json`.

| Tier | Contents | Rough size (all 3 packs) | Home |
| --- | --- | --- | --- |
| **0 — symbols** | icons only; entities drawn as icon-on-plate / colored box | a few MB | shipped with site |
| **1 — lite** | real entity sprites, frame 0 only, ~half-res, webp/basis | ~70 MB (cf. size analysis) | shipped or hosted |
| **2 — full** | full-res, optional idle animation | hundreds of MB | user-provided / hosted gallery |

Tier 0 needs *no per-entity art* — it's a manifest of placeholders plus the
(small) icon sprites, rendered through the existing `UnknownEntitySprite.ts`
path. Tier 1 is what the frame-crop + resolution levers produce. Tier 2 is the
"point the site at my pack" case, including the idle-frame animation work being
prototyped on the side.

## Components

### 1. `GraphicsSource` abstraction (editor)

Today there's exactly one graphics choke point: `getTexture` in
`packages/editor/src/common/globals.ts`, which hard-codes
`Assets.load(\`${DATA_URL}/${path}.basis\`)`. Introduce an interface it
delegates to:

```ts
interface GraphicsSource {
  readonly manifest: BundleManifest          // what's present + fidelity
  // Texture(s) for a sprite path, honoring fidelity; null → caller placeholders
  getSprite(path: string): SpriteHandle | null
}
```

Implementations:

- `HttpDirSource` — today's behavior (loose files under a base URL). Kept for
  the built-in pack during migration so Phase 0 is a no-op refactor.
- `LocalBundleSource` — a user-uploaded bundle unpacked into **OPFS**, served as
  `blob:` URLs. Needs **no CSP change** (`blob:` is already allowed in
  `public/_headers`).
- `RemoteBundleSource` — bundle fetched from a URL (hosted gallery / user's
  server), cached into OPFS. Requires `connect-src` to include the host + CORS
  (see Constraints).

`getTexture` becomes source-agnostic; `Editor.ts` wires the active source from
the selected registry entry.

### 2. Bundle format

A single artifact instead of thousands of loose files (9k files is hostile to
upload/host/cache). A bundle is **one `manifest.json` + payload**:

```jsonc
{
  "id": "space-age-full",
  "label": "Space Age (full res, animated)",
  "format": "webp",           // webp | basis | png
  "resolutionFactor": 1.0,
  "sprites": {
    "__base__/graphics/entity/assembling-machine-2/assembling-machine-2.png": {
      "present": true, "frames": 8, "cols": 8, "fps": 30,
      "offset": 12345, "len": 45678
    },
    "__base__/graphics/entity/foo/foo.png": { "placeholder": true }
  }
}
```

Two transport options (decide in Phase 1):

- **zip → unpack into OPFS once.** Simplest; natural upload artifact; browser
  unzips via `DecompressionStream` per entry.
- **pack file + range requests.** Concatenated payloads addressed by
  `offset/len` in the manifest; no unzip, good for large hosted bundles served
  from a CDN. Better for the gallery, more to build.

### 3. Animation rendering — new, additive capability

There is no frame playback today; `EntitySprite.ts` crops frame 0. Add an
animated mode used **only** when the active source reports `frames > 1 && fps`
for a sprite:

- Advance a frame index off the existing `BlueprintContainer` `Ticker`; move the
  crop rect across the sheet. Animate on-screen entities only; honor
  `prefers-reduced-motion` and expose a perf toggle (default off on mobile).
- Lite/symbol bundles report `frames: 1` → the animated path is never taken →
  zero cost. `spriteDataBuilder.ts` already resolves `idle_animation` metadata,
  so the builder can flag "this layer is animatable + its frame grid" and the
  renderer consumes it when the bundle actually has the frames.

### 4. Placeholders / partial packs

When `getSprite` returns null (absent or `placeholder: true`), render through
the existing `UnknownEntitySprite.ts` (colored box + label) or an
icon-on-plate. The symbols tier is *entirely* placeholders + icons, so it needs
no entity art at all — the smallest possible pack, and the graceful-degradation
path for any bundle that's missing a sprite.

### 5. Pack registry (runtime)

Replace static consumption of `packs.json` (`settingsPane.ts` fetch) with a
registry = built-in entries (shipped) + user entries (persisted in IndexedDB,
since they reference OPFS bundles). Entry:

```ts
interface PackEntry {
  id: string; label: string
  dataSource: { kind: 'builtin' | 'url'; ref: string }        // small
  graphicsSource: { kind: 'httpdir' | 'localbundle' | 'url'; ref: string }
  fidelity: 'symbols' | 'lite' | 'full'
}
```

`dataSource` and `graphicsSource` are **independent** — the common case for
"upload a graphics pack" is uploading *only* graphics while `data.json` stays
shipped/hosted. The settings "Data Pack" folder gains: choose built-in, "Add
from URL", "Upload bundle". Swapping reloads (as today; `setDataPack` already
does a clean reload).

This is also the split of `DATA_URL` (`globals.ts`): it stops being a single
`${DATA_ROOT}/${DATA_PACK}` base and becomes two resolved sources. `DATA_ROOT`
stops being a build-time `__DATA_URL__` constant and becomes runtime state.

### 6. Generation without a per-device CLI

The heavy realization: **the user already owns Factorio and has their mods
installed** — for their own content there's no portal-credential problem. But
extraction has two stages with very different portability:

- **Stage A — data dump (`data.json`).** Requires running headless Factorio (a
  native binary). *Cannot* run in a browser. Mitigation: **ship `data.json` for
  known mod sets** so most users never regenerate it; a novel modpack is the
  only case that needs a native data dump. State this plainly — it's the one
  residual native dependency.
- **Stage B — graphics.** Reads the mod's PNGs (the user has them), crops to the
  needed frames, downscales, re-encodes. This **can** run in-browser.

Three generation "stations", pick by capability:

**(a) In-browser, desktop, no CLI.** File System Access API reads the Factorio
install / mod zips; a Web Worker pipeline decodes each referenced PNG (list from
a `data.json`), crops frames, downscales, and re-encodes. **Encode as webp** via
`OffscreenCanvas.convertToBlob({ type: 'image/webp' })` — no wasm/basis toolchain
needed. Tradeoff: webp isn't GPU-sampleable, so it decompresses to RGBA in VRAM
(higher GPU memory than basis); fine for lite/half-res, offer optional
wasm-basis for the full tier. Output → OPFS + a downloadable zip to share/host.

**(b) Hosted extraction (off-device — serves mobile).** A server runs the
existing Rust exporter for a requested mod set (`packs.json` already encodes mod
names + versions) and publishes a bundle at a stable URL. A phone registers the
URL and does **zero** work. Ops cost: Factorio licensing + storage/CDN; can be
operator-run as a **curated gallery** so most users just pick a URL and never
generate anything.

**(c) Desktop-generates-for-phone handoff.** (a) produces a bundle, the user
pins it somewhere (their host, or a paste-like pin service) and gets a short
code; the phone enters the code to load it. Extraction on the desktop, benefit
on the phone, no server-side Factorio if `data.json` is shared.

**Recommended:** ship (a) for desktop self-service **and** an operator-run
gallery of prebuilt bundles (one-time runs of the existing exporter with the
size levers applied) so the mobile-first majority pick a URL with zero
generation. (b) full self-serve hosted extraction is a later, heavier option.

## Size levers (prerequisite, folded into generation)

The lite/full tiers are only reachable because of the two levers from the size
analysis, applied *in the generation pipeline*, not as separate work:

- **Frame-crop** (drop animation frames the editor doesn't render): −30–44% per
  pack.
- **Resolution** (downscale HR source art; most sprites are `scale: 0.5` 2× art):
  ~4× at half linear res.

Together: ~395 MB → ~70 MB across the three packs (SE 187 → ~29 MB). The symbols
tier is a few MB. The full tier *adds* idle frames back deliberately, for users
who opt into the weight.

## Constraints

- **CSP.** `public/_headers` is `connect-src 'self'`. Local bundles (upload →
  OPFS → `blob:`) need no change. Remote bundle URLs need the host added to
  `connect-src` (per-host allowlist or a documented setting) **and** CORS on the
  host. This nudges "upload a bundle" ahead of "point at an arbitrary URL".
- **OPFS quota / eviction.** Bundles are tens–hundreds of MB; need a storage
  budget + LRU eviction and a "manage packs" UI. Request persistent storage.
- **Format duality.** Generated packs default to webp (simple); operator gallery
  packs use basis (GPU-efficient). The source layer must handle both.

## Phasing

- **Phase 0 — refactor, no user-visible change.** Introduce `GraphicsSource`
  behind `getTexture` with `HttpDirSource` = current behavior. Split `DATA_URL`
  into independent `dataSource` + `graphicsSource`; make `DATA_ROOT` runtime.
- **Phase 1 — bundles + upload.** Bundle format, `LocalBundleSource`, OPFS
  cache, registry with "Upload bundle". Ship the **lite** built-in pack; move
  the big packs to hosted bundles; drop the `viteStaticCopy` of the huge atlas.
- **Phase 2 — remote + gallery.** `RemoteBundleSource`, curated hosted bundles,
  CSP/host settings. **Mobile story lands here.**
- **Phase 3 — in-browser generator.** File System Access + Web Worker + webp
  encode; OPFS output + zip export (station (a)).
- **Phase 4 — fidelity extras.** Idle-animation rendering; symbols tier.
- **Later (optional).** Hosted extraction service (station (b)); atlas
  consolidation (few big pages + rect map) for draw-call batching.

## Open questions

- `data.json` for arbitrary modpacks needs a native Factorio step — accept the
  residual native dependency (ship data for known sets), or stand up a hosted
  data-dump service?
- Commit to webp for generated packs and basis for gallery packs (dual-format
  source layer), or invest in in-browser basis encoding to unify?
- Bundle transport: zip-into-OPFS (simple) vs. pack-file + range (CDN-friendly)?
- OPFS storage budget + eviction policy for multi-hundred-MB packs.

## Affected seams (for implementation)

- `packages/editor/src/common/globals.ts` — `getTexture` (choke point),
  `DATA_ROOT`/`DATA_URL`/`DATA_PACK`, `setDataPack`.
- `packages/editor/src/Editor.ts` — `data.json` fetch (`DATA_URL`).
- `packages/editor/src/containers/EntitySprite.ts` — frame crop; add animated
  mode.
- `packages/editor/src/containers/UnknownEntitySprite.ts` — placeholder path.
- `packages/editor/src/core/spriteDataBuilder.ts` — already resolves
  `idle_animation`; emit animation/frame-grid hints.
- `packages/website/src/settingsPane.ts` — pack dropdown → registry UI.
- `packages/website/vite.config.js` — `__DATA_URL__` define + `viteStaticCopy`
  of the atlas.
- `packages/website/public/_headers` — CSP `connect-src` for remote bundles.
- `packages/exporter/` — add size levers + bundle output; seed the in-browser
  generator's algorithm.
