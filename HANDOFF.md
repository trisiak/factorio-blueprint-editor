# HANDOFF — validate the exporter's per-pack run (issue #9, slice 1)

> **Temporary file.** Delete it (and mention that in your PR/commit) once the
> validation below is done. It exists because the session that wrote the
> exporter changes could not run them.

## Why this exists

PR #23 (merged) taught the Rust exporter to **regenerate** a pack per `--pack
<id>` (mod-list.json generation, mod-agnostic sprite mapping, active-mods
verification, per-pack output). It was verified by **compilation only** —
`cargo build`/`fmt`/`clippy` clean and the `__mod__` regex checked against the
committed `data.json` — but the **headless Factorio run was never executed**:
that session's environment blocked `factorio.com` at the network-policy proxy
(`x-deny-reason: host_not_allowed`).

**Your job:** if this environment *can* reach Factorio, run the exporter
end-to-end and confirm it reproduces the committed packs. (If it still can't,
stop and tell the user — nothing here is runnable without it.)

## Preconditions — check these first

1. **Network policy allows Factorio.** Expect a 2xx/3xx, NOT `403`:
   ```bash
   curl -sS -m10 -o /dev/null -w "%{http_code}\n" https://www.factorio.com/
   ```
   If it's `403` with `x-deny-reason: host_not_allowed` (check `curl -I`), this
   environment is still blocked — stop here. Slice 2 additionally needs
   `mods.factorio.com`.
2. **Credentials.** `packages/exporter/.env` must hold:
   ```
   FACTORIO_USERNAME=...
   FACTORIO_TOKEN=...
   ```
   `.env` is gitignored (`.gitignore:7`) — keep it so. **Never commit it.**
3. **Toolchain.** `cargo` on PATH.

## Run + validate slice 1

```bash
cd packages/exporter
cargo run -- --pack vanilla-2.0
cargo run -- --pack space-age
```

Expected console milestones per run: `Exporting pack '<id>'` → `Downloading
Factorio v2.0.68` (or "matches required version") → `Generating defines.lua` →
**`Mod verification OK: active mods match pack '<id>'`** → sprite progress bar →
`DONE!`. Any `FAILED: <path>` line means a sprite didn't resolve/compress —
investigate (likely the `__mod__` mapping or a missing asset).

**The goal is parity with the committed packs, not replacing them.** Validate
`data.json` structurally rather than byte-wise:

```bash
git diff --stat packages/exporter/data/output/vanilla-2.0/data.json
```

Sanity counts (top-level key sizes):
- `vanilla-2.0`: 121 entities, 214 recipes, 251 items, 8 tiles
- `space-age`: 155 entities, 653 recipes, 340 items

Some churn is normal (serpent key ordering; a different Factorio patch if the
pin moved). **Structural** diffs — missing/extra entities, changed schema — are
the real signal; dig into those. `.basis` atlas bytes can differ run-to-run
(basisu is not deterministic), so **don't treat atlas-only diffs as failures**.

## Reporting / committing — be careful

- **Do not commit regenerated data without asking the user.** The atlases are
  large (`vanilla-2.0` ~68 MB, `space-age` ~458 MB) and the committed ones are
  the baseline. If `data.json` is semantically identical, the win is *proving
  reproducibility* — just report it; no commit needed.
- Before any commit, confirm `git status` shows **no `.env`** and **no
  `packages/exporter/data/factorio/`** (the downloaded game; gitignored via
  `packages/exporter/data/*`). `output/metadata.json` is also intentionally
  ignored (the per-pack sprite cache).
- Report: did each run finish? Did verification pass? Is regenerated `data.json`
  at parity? Any `FAILED:` sprites? Update issue #9 with the result.

## If you continue to slice 2 (third-party mods, e.g. Space Exploration)

Out of scope for slice 1; needs code. Sketch (see `packages/exporter/README.md`
"Adding a new pack" + issue #9):
- Acquire mods via Factorio itself — `--sync-mods <save>` downloads the save's
  mod set from the portal (needs `mods.factorio.com` allowed + credentials).
- Mods land as **`.zip`** in `data/factorio/mods/`. The current asset pipeline
  reads sprites/locale from **unpacked** `data/<mod>/` dirs, so make extraction
  zip-aware (or unpack-after-sync). The sprite *path* mapping is already
  mod-agnostic, so this is the main remaining lift.

## Pointers

- Branch for this work: `claude/blissful-dirac-f0axnq` (this file is on it).
- Exporter entry: `packages/exporter/src/main.rs`; logic: `src/setup.rs`;
  injected mod: `src/export-data/`.
- Repo conventions + exporter caveats: root `CLAUDE.md`,
  `packages/exporter/README.md`.
