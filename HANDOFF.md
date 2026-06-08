# Touch-support work — session handoff

Branch: `claude/repo-exploration-Gv3dZ`. This note travels with the branch so a
new session can pick up without re-deriving context. (The original design brief
lives outside the repo; this file is the working state.)

## How work transfers between sessions

Git is the only channel — the container is ephemeral (home dir / `node_modules`
do **not** survive). Everything below is committed and pushed. A fresh session
that checks out this branch has all of it. Install + test must run in a session
whose network policy allows it (see "Environment" below); some sessions can't.

## What's done

- **Slice 0 — mobile gate lifted** (`packages/website/src/index.ts`): the hard
  `MOBILE_DEVICE_NOT_SUPPORTED` throw is now opt-in via `?desktopOnly`; touch
  devices load and get an "experimental" toast.
- **Slice 1 — pinch-zoom + two-finger pan**
  (`packages/editor/src/containers/PointerGestures.ts` +
  `BlueprintContainer.ts`): framework-free `PinchPanRecognizer` (unit-tested)
  wired to `viewport.zoomBy` / `translateBy`; a 2nd finger cancels the
  single-pointer action.
- **Slice 2 — one-finger tap vs. drag** (`BlueprintContainer.ts`,
  `GridData.ts`): touch pointers are deferred on down; drag past 10px = pan,
  release within 10px/300ms = tap routed through the existing left-click
  press/release pipeline (place/select/open unchanged). Mouse/pen unchanged.
- **Test infra**: vitest (`npm test`) + Playwright e2e (`npm run test:e2e`,
  desktop + Pixel-7 touch projects). SessionStart hook installs deps + chromium.

## Verification status (2026-06-08)

The Slice 1/2 editor code was originally written without a compiler/runtime
available. It has now been verified in a session that could install:

```bash
npm install --legacy-peer-deps
npm run type-check     # confirm Slice 1/2 TS compiles  <-- highest priority
npm run lint
npm test               # vitest gesture tests
npx playwright install chromium && npm run test:e2e
```

Results:

- **`type-check`** — Slice 1/2 touch files (`PointerGestures.ts`,
  `BlueprintContainer.ts`, `GridData.ts`, website `index.ts`) compile clean. The
  81 remaining errors (`spriteDataBuilder.ts`, `EntityInfoPanel.ts`, etc.) are a
  **pre-existing master baseline** — identical count/files on `master` — and are
  out of scope for the touch work.
- **`lint`** — 96 errors, **identical on `master`**; the touch work adds zero new
  lint errors. (The lone `BlueprintContainer.ts` `prefer-const` on `mult` is
  pre-existing, just shifted down by the inserted touch code.)
- **`npm test`** — 11/11 pass. One assertion in `PointerGestures.test.ts`
  ("reports the screen-space translation…") originally expected `scale === 1`
  for a two-finger pan; pointer events fire one finger at a time, so the spread
  wobbles 100→80→100 and the second event's *incremental* scale is `100/80 =
  1.25` (the two per-event scales 0.8·1.25 net to 1). Fixed the test to assert
  the true incremental value; the recognizer was correct.
- **`test:e2e`** — could **not** run here: the Playwright browser download host
  (`playwright-verizon.azureedge.net`, the azureedge CDN actually used) is not
  in this env's egress allowlist. Still needs a session whose policy allows it.

Then verify on a real touch device:
```bash
npx serve packages/exporter/data/output -l 8081   # committed atlas -> /data
npm run start:website -- --host                    # open http://<ip>:8080 on a phone
```
Expect: pinch zooms, two-finger drag pans, one-finger tap places/selects,
one-finger drag pans.

## Environment / install constraint

The web env proxies egress with an allowlist (`Host not in allowlist`). For the
SessionStart hook (and manual installs) to work, the policy must allow
`registry.npmjs.org` (verified working here) and the Playwright browser CDN.
The download host observed in this env is `playwright-verizon.azureedge.net`
(Playwright also uses `cdn.playwright.dev` /
`playwright.download.prss.microsoft.com` depending on version/region) — none are
currently allowlisted, so `playwright install chromium` 403s. The hook is
synchronous (`.claude/settings.json` + `.claude/hooks/session-start.sh`); only
sessions started from the branch (or, once merged, the default branch) run it.

## Next steps / known gaps

- Slice 1 pinch e2e is a `fixme` — Playwright's high-level touch API is
  single-touch; pinch needs CDP `Input.dispatchTouchEvent` (two points).
- Slice 2 tap-to-place e2e is a `fixme` — needs a window-level handle to read
  blueprint state for assertions (none exposed yet).
- Slice 3 (not started): mirror the `actions.ts` registry into an on-screen
  touch toolbar (rotate/flip/pipette/copy/delete/undo).
- After a pinch, the still-down finger is inert until lifted (acceptable; could
  be smoothed later).
