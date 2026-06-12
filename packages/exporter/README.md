# Factorio data exporter

A Rust CLI that produces the data the editor renders: it runs Factorio headless
with a small injected mod, dumps a curated slice of `data.raw` to `data.json`,
and compresses every referenced sprite into a `.basis` atlas. Output is written
**per pack** under `data/output/<id>/`, served on `:8081` for the website's dev
server to proxy.

> This tool is **out of band from normal feature work** — it's large,
> credentialed, and the committed atlas is what the app/e2e builds actually use.
> You only need it to (re)generate a pack's data. See the root `CLAUDE.md`.

## Prerequisites

- Rust (stable) — `cargo` on `PATH`.
- A Factorio account that owns the game. Put credentials in a `.env` here:
  ```
  FACTORIO_USERNAME=your-name
  FACTORIO_TOKEN=your-token
  ```
  (Token is on your factorio.com profile.) These are used both to **download
  Factorio** and, for third-party mod packs, to let Factorio fetch mods from the
  portal.
- `basisu` — committed alongside this crate (`./basisu`), invoked per sprite.

The pinned Factorio version is `FACTORIO_VERSION` in `src/main.rs`. The download
is cached under `data/factorio/`; only that directory is replaced on a version
change — the committed `data/output/` packs are left untouched.

## Packs

`data/output/packs.json` is the manifest the editor and exporter share. Each
entry:

```json
{ "id": "space-age", "label": "Space Age (2.0)", "factorioVersion": "2.0",
  "mods": ["base", "space-age", "quality", "elevated-rails"] }
```

The exporter reads `id` (the output sub-directory) and `mods` (which mods to
enable for the run). The bundled packs today — `vanilla-2.0` and `space-age` —
use mods that **ship inside the Factorio install** (the `base`/`space-age`/…
data dirs), so no portal download is needed.

## Regenerating a pack

```bash
# from packages/exporter/
cargo run -- --pack vanilla-2.0     # or --pack space-age
cargo run                           # no flag → the manifest's `default` pack
```

What a run does:

1. Ensures the pinned Factorio is downloaded (`data/factorio/`).
2. Writes `mods/mod-list.json` enabling exactly that pack's `mods` (plus the
   injected `export-data` mod); every other known mod is explicitly disabled, so
   regenerating `vanilla-2.0` after `space-age` correctly drops the DLC.
3. Runs Factorio headless against the `export-data` scenario, which writes
   `data.json` **and** `active-mods.json` (the actually-loaded mod set).
4. **Verifies** the loaded mods match the pack's declared `mods` — a mismatch
   aborts *before* the long atlas build rather than producing a mislabeled pack.
5. Writes `data/output/<id>/data.json` and compresses each referenced sprite to
   `data/output/<id>/<__mod__>/…​.basis` (incremental — an mtime/size cache in
   `metadata.json` skips unchanged sprites on reruns).

When the run finishes it serves `data/output/` on `http://localhost:8081`. Point
the website at it (`VITE_DATA_URL`) or just commit the new `data/output/<id>/`.

## Adding a new pack

1. Add an entry to `packs.json` with a new `id` and its `mods`.
2. `cargo run -- --pack <id>`.

For packs whose mods ship with the game (DLC), that's all. For **third-party
mods** (e.g. Space Exploration) the mods must be present in `data/factorio/mods/`
first — Factorio can fetch them itself via `--sync-mods <save>`, but wiring that
up plus reading sprites/locale out of the downloaded `.zip` mods is follow-up
work (see issue #9). The sprite-path mapping is already mod-agnostic
(`__<mod>__/…` → `<mod>/…`); the missing piece is zip-aware asset extraction.
