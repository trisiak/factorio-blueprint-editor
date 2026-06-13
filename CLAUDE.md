# CLAUDE.md

Guidance for AI agents (Claude Code and friends) working in this repo. Humans
should read `README.md` and `CONTRIBUTING.md` first; this file assumes you're an
agent and optimizes for getting useful work done quickly and safely.

## What this is

A feature-rich **Factorio Blueprint Editor** — a browser app that renders and
edits Factorio blueprints. Rendering is done with **PixiJS 8** on a canvas;
there is no React/Vue/framework — UI is hand-built.

> **This is a fork.** Upstream is
> [`Teoxoy/factorio-blueprint-editor`](https://github.com/Teoxoy/factorio-blueprint-editor),
> hosted at https://fbe.teoxoy.com. This fork is **not** expected to merge back
> upstream — treat it as an independent line of development (mobile/touch + e2e
> are this fork's focus, not necessarily upstream's). It deploys on its own via
> **GitHub Pages** (the `gh-pages` branch, base path `/factorio-blueprint-editor/`,
> i.e. `https://trisiak.github.io/factorio-blueprint-editor/`); see
> `.github/workflows/pages-*.yml`. Don't assume changes here go to teoxoy.com,
> and don't open upstream PRs.

### Current focus areas

Two threads of work are the priority right now. Bias new work toward these:

1. **Mobile / touch controls** — making the editor usable on touch devices
   without regressing desktop. Status, architecture, and the prioritized backlog
   live in **`docs/mobile-controls.md`** — read it before touching anything
   input-related. Keep its checkboxes up to date as work lands.
2. **End-to-end testing** — growing Playwright coverage (`e2e/`), especially the
   touch paths. Several tests are intentionally `test.fixme(...)` and double as a
   to-do list (tap-to-place needs a window-level blueprint-state handle; pinch
   needs CDP `Input.dispatchTouchEvent`). See `e2e/touch.spec.ts`.

## Repo layout

Monorepo with npm workspaces (`packages/editor`, `packages/website`). The
exporter is a separate Rust tool and is **not** a JS workspace.

- `packages/editor/` (`@fbe/editor`) — the editor engine. No build step; the
  website imports its TypeScript source directly.
    - `src/Editor.ts` — top-level wiring.
    - `src/common/input.ts` — the `inputMode` controller (`desktop` vs `mobile`),
      the source of truth for the explicit-input-mode architecture.
    - `src/containers/` — PixiJS scene graph. `BlueprintContainer.ts` dispatches
      pointer events per input mode; `PointerGestures.ts` is the framework-free
      pinch/pan recognizer (unit-tested in `PointerGestures.test.ts`); `Paint*` are
      the place/preview containers; `Viewport.ts` is pan/zoom.
    - `src/core/` — framework-free domain logic: `Blueprint`, `Book`, `Entity`,
      `Tile`, `History` (undo/redo), `bpString.ts` (import/export encoding),
      `PositionGrid`, wire connections, `generators/` (e.g. oil outpost).
    - `src/UI/` — hand-built dialogs/panels/controls and per-entity editors.
    - `src/actions.ts` — the keybind/action registry (rotate, flip, pipette, copy,
      delete, undo, …). Mirroring this into an on-screen toolbar is the next mobile
      slice — see `docs/mobile-controls.md`.
- `packages/website/` (`@fbe/website`) — the deployable Vite app that hosts the
  editor. `src/index.ts` (boot + the mobile gate / `?desktopOnly`),
  `settingsPane.ts` (settings UI incl. the Input Mode toggle and the Data Pack
  selector), `toasts.ts`.
- `packages/exporter/` — **Rust** CLI that pulls Factorio's data + sprites and
  builds the atlas/data the editor consumes. Needs Factorio credentials; you
  almost never need to run it (the committed atlas is baked into e2e builds).
  Excluded from eslint/vitest.
    - **Data packs (modpack support):** `data/output/` holds one sub-directory
      per dump — `vanilla-2.0/` (base 2.0) and `space-age/` (2.0 + Space Age +
      Quality + Elevated Rails), each with its own `data.json` + `*.basis` atlas
      — plus a `packs.json` manifest. The editor renders one pack at a time,
      chosen at runtime (`?pack=` query > persisted choice > default
      `vanilla-2.0`); see `DATA_ROOT` / `DATA_PACK` / `setDataPack` in
      `editor/src/common/globals.ts` and the "Data Pack" selector in the
      website `settingsPane.ts`. The SA-aware rendering code is **backwards
      compatible** (defensive null-guards + additive draw branches), so a single
      build renders any pack. Adding a pack = drop a new `data/output/<id>/`
      dump + a `packs.json` entry; no code changes.
- `functions/corsproxy.js` — Cloudflare Pages Function for URL blueprint import.
  **Does not run on GitHub Pages**; paste-string import + editing do.
- `e2e/` — Playwright specs. `docs/` — design/tracking docs.

## Commands

Node is pinned via `.nvmrc` (v23.x; CI uses Node 22). Install deps with the
legacy peer flag — a plain `npm install` will fail:

```bash
npm install --legacy-peer-deps
```

| Task                          | Command                                        |
| ----------------------------- | ---------------------------------------------- |
| Run the website (dev)         | `npm run start:website`                        |
| Build the website             | `npm run build:website`                        |
| Type-check (whole repo)       | `npm run type-check`                           |
| Unit tests (vitest, one-shot) | `npm test`                                     |
| Unit tests (watch)            | `npm run test:watch`                           |
| E2E tests (Playwright)        | `npm run test:e2e`                             |
| E2E tests (UI mode)           | `npm run test:e2e:ui`                          |
| Lint                          | `npm run lint` (`npm run lint:fix` to autofix) |
| Format check / fix            | `npm run format` / `npm run format:fix`        |

Before declaring a change done, run the relevant subset of:
`npm run type-check`, `npm test`, `npm run lint`, `npm run format`.

### Testing notes

- **Unit (vitest):** node environment, covers framework-free logic only
  (geometry, encoding, etc.). Files match `packages/**/*.test.ts`. The PixiJS
  rendering layer is **not** unit-tested — verify it by running the app.
- **E2E (Playwright):** runs against a self-contained production build
  (`build:website` bakes the atlas into `dist/`, `preview:website` serves :8080 —
  no exporter/:8081 needed). The web server is started automatically by the
  config. Two projects: `desktop-chromium` and `mobile-chromium` (Pixel 7 →
  `isMobile + hasTouch`). Touch-only specs guard on
  `project.name === 'mobile-chromium'`. Playwright's high-level `touchscreen` API
  is **single-touch**; multi-touch (pinch) requires raw CDP
  `Input.dispatchTouchEvent`.

## Conventions

- **TypeScript**, ESM. `strict` is **off** (TODO in `tsconfig.json`); `any` and
  `@ts-` comments are tolerated but don't add new ones gratuitously.
- Prettier + ESLint enforced; match the existing style (the comments in this repo
  are dense and explanatory — keep that voice when you add or edit them).
- No UI framework — don't reach for React. Add UI with the existing PixiJS
  controls under `src/UI/`.
- Cross-package imports use the `@fbe/*` alias (resolves to each package's
  `src/index.ts`).
- The `desktop`/`mobile` input modes are **mutually exclusive on purpose**
  (running both pipelines caused double-acting taps via synthetic mouse events).
  Don't blur that boundary — route through `input.ts`.

## Working agreements for agents

- **Branch/PR:** commit and push only when asked; never open a PR unless the user
  explicitly requests it.
- **Don't run the exporter** or commit regenerated atlas/data unless explicitly
  asked — it's large, credentialed, and out of band from normal feature work.
- When you finish a mobile or e2e slice, **update `docs/mobile-controls.md`**
  (its checkboxes) and remove/convert the relevant `test.fixme` rather than
  leaving the doc stale.
- Prefer extending the existing `e2e/` specs and the `actions.ts`/`input.ts`
  seams over inventing parallel mechanisms.

### Keep issues in sync with the work

GitHub issues are the index; the `docs/` tracking files and the merged code are
the durable record. They drift apart easily — keep them reconciled as you go,
in the **same change** that lands the work (don't leave it for "later"):

- **Reference the issue in commits** that advance it (`#NN` in the subject), so
  the issue's timeline shows what touched it. Match the existing convention —
  `(#30)` / `(issue #28)`.
- **Tick the boxes / advance the ratchet.** Tracking issues (e.g. #28, #31) embed
  checklists and ratchet numbers (the sprite census table, `partial`/`failed`
  counts). When your work flips a box or lowers a count, edit the issue body in
  the same change — use the repo's `~~old~~ **new**` strike style already in
  those tables. A stale "38 failed" next to a green test is exactly the drift to
  avoid.
- **Close on completion, or say why not.** When an issue's work is fully done,
  close it (`state: completed`) with a one-line pointer to the commit/PR. For a
  *tracking* issue, close only when every box is ticked; otherwise leave it open
  and the unchecked boxes are the remaining backlog.
- **Mind orphaned tickets.** Work often lands under a *different* PR/issue number
  than the one that filed it (e.g. #7's follow-up shipped under #38). When that
  happens, cross-link and close the original rather than letting it linger.
- **Cross-link docs ↔ issues.** A tracking issue and its companion doc
  (`mobile-controls.md` ↔ the mobile issues; `space-exploration-modlist.md` /
  the census ↔ #28) should point at each other and not contradict each other. If
  the doc says ✅ and the issue is still open, one of them is wrong — fix it.
- You have the GitHub tools to do this directly; if they're unavailable in your
  environment, note the needed issue update in your summary so the maintainer can
  apply it.
