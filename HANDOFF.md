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

## UNVERIFIED — do this first in a session that can install

The Slice 1/2 editor code was written without a compiler/runtime available, so:

```bash
npm install --legacy-peer-deps
npm run type-check     # confirm Slice 1/2 TS compiles  <-- highest priority
npm run lint
npm test               # vitest gesture tests
npx playwright install chromium && npm run test:e2e
```

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
`registry.npmjs.org` and the Playwright CDN
(`cdn.playwright.dev`, `playwright.download.prss.microsoft.com`). The hook is
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
