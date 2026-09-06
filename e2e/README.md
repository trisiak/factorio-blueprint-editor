# End-to-end tests (Playwright)

Specs that drive a real browser against a production build of the website. This
is the **only** layer that exercises the PixiJS rendering + pointer pipeline —
vitest covers framework-free logic only (see the root `CLAUDE.md`).

## Running

```bash
npm run test:e2e         # headless, both projects
npm run test:e2e:ui      # Playwright UI mode (pick/inspect specs)
```

No manual server step: `playwright.config.ts` runs `build:website &&
preview:website` for you, and `preview:website` serves the app on :8080 — so the
Rust exporter / :8081 are **not** needed.

The web server start has a 180s timeout because it does a full production build
first; the initial run is slow, subsequent runs reuse the server locally
(`reuseExistingServer` is on outside CI).

### Live data

The build under test fetches its pack data (`packs.json`, each pack's
`data.json` + `.basis` atlas) from the **published data plane**,
`https://trisiak.github.io/factorio-pack-data` — the same URL production and the
PR previews use. Nothing pack-related is committed here or baked into `dist/`,
so this suite is also a **canary for the data plane**: a break there (site down,
pack renamed, format drift) fails the suite the same way an app regression does.
When triaging a red run, check whether the data still serves before assuming the
code broke.

The root is set as `VITE_DATA_URL` on the webServer in `playwright.config.ts`;
export your own to test against something else — a local `npm run serve:data`
(`VITE_DATA_URL=/data` won't work, the preview server has no proxy — use
`http://127.0.0.1:8081`) or a staging host. Specs must **not** assume the URL
shape above `<pack-id>/data.json`; the modpack specs tail-match it deliberately.

Because the browser now talks to the public internet, sandboxed hosts whose
egress goes through an agent proxy need Chromium to use it too. The config does
that automatically when `HTTPS_PROXY` is set and `CI` is not: it routes `https=`
through the proxy and leaves the local `http://localhost:8080` server direct. CI
is on a direct network, so the plumbing is never engaged there. If your host's
Chromium lives outside Playwright's cache, point at it:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```

### Parallelism & the render loop

The whole app is one PixiJS `<canvas>`, so **every** spec is render-heavy and the
render loop is the shared bottleneck. Run several workers and they fight over it:
a CDP touch dispatch or a canvas state read-back that's instant in isolation
takes _seconds_ under load. The config compensates with generous budgets
**everywhere** (not just CI) — 60s per test, 10s per assertion, one local retry
(two on CI) — and CI further serializes to a single worker. Earlier the local
budgets were tight (30s/5s, assuming a quiet single run), which made the touch
specs flaky under a full parallel `npm run test:e2e` even though single-test and
sharded-CI runs passed. If you tighten these, expect the touch specs to flake
first. (See also the slimmed CDP gesture helper under "Touch input" below.)

### Browser

The suite uses Chromium only. This environment (and CI) already has a Chromium
that `@playwright/test` targets, so **don't** run `playwright install` — the
browser-download CDN isn't in the egress allowlist and the step will 403. (This
is also why the SessionStart hook installs deps but not browsers.)

### Constrained / rootless hosts (`test:e2e:host`)

On a normal box `npm run test:e2e` is all you need. On a sandboxed host the
_environment around_ Playwright can be wrong in ways that make **every** spec die
at browser launch in a few ms — long before any test logic — which reads like a
mass failure but isn't:

- `PLAYWRIGHT_BROWSERS_PATH` is exported but points at a directory that doesn't
  exist, so Playwright can't find the browser; or
- Chromium's system libs (`libnss3`, `libgbm`, `libX11`, …) are missing and there's
  no root to `playwright install --with-deps` them, so the renderer dies at launch.

`npm run test:e2e:host` (a thin wrapper, `e2e/run-e2e.sh`) heals both and then
forwards every argument straight to `playwright test`, so it's a transparent no-op
where the environment is already fine — args pass through as usual:

```bash
npm run test:e2e:host -- --project=desktop-chromium --workers=1
```

It never downloads anything (see the CDN note above); it only fixes how Playwright
_finds_ an already-installed browser. If your host stages the Chromium system libs
somewhere, point the loader at that dir (host-specific, so it lives in your env, not
in the repo):

```bash
export PLAYWRIGHT_SYS_LIBS=/path/to/staged/usr/lib/x86_64-linux-gnu
```

One caveat the wrapper can only _warn_ about, not fix: the app is a single
software-rendered (SwiftShader, no GPU) WebGL canvas, so under a tight cgroup
memory cap the canvas-heavy specs (library / modpack / persistence) can OOM-crash
the renderer as a `Target crashed` — even single-worker. That's a host limit, not a
regression; run those on a box with more headroom (or lean on CI, which shards).

## Projects

Three projects are defined; most specs run on the first two, touch specs on the
mobile one, and the hybrid project runs only its own spec:

| Project            | Device           | Capabilities                     |
| ------------------ | ---------------- | -------------------------------- |
| `desktop-chromium` | Desktop          | mouse + keyboard                 |
| `mobile-chromium`  | Pixel 7          | `isMobile + hasTouch`            |
| `hybrid-chromium`  | Desktop 1280×720 | mouse **and** touch (`hasTouch`) |

`hybrid-chromium` is the touchscreen-laptop case (#101 Slice 1): mouse and touch
on the same page, exercising the per-pointer dispatch and the input signals. It's
scoped with `testMatch` to `hybridInput.spec.ts` — the rest of the suite is
already covered by the other two projects, and a render-bound suite shouldn't run
a third time for no signal. Note that Chromium reports `(pointer: coarse)`
whenever touch emulation is on, so the _fine-pointer_ half of the hybrid case is
produced by stubbing `matchMedia` at boot (see the spec) rather than by device
emulation.

Run just one:

```bash
npx playwright test --project=mobile-chromium
```

Touch-only specs self-skip elsewhere — mirror the existing guard rather than
inventing a new one:

```ts
test.beforeEach(() => {
    test.skip(
        test.info().project.name !== 'mobile-chromium',
        'touch tests run on the mobile project only'
    )
})
```

The editor's hard mobile block is opt-in (`?desktopOnly`), which is why the app
loads at all under `mobile-chromium`. `smoke.spec.ts` asserts desktop never hits
`MOBILE_DEVICE_NOT_SUPPORTED`; `touch.spec.ts` asserts the gate is lifted and
that `?desktopOnly` restores it.

## Touch input: single- vs multi-touch

Playwright's high-level `touchscreen` / `locator.tap()` API is **single-touch**,
and it only _taps_ — it can't drag. A single tap is enough for tap-to-place:

```ts
await page.locator('#editor').tap()
```

A one-finger **drag** (pan / grab-a-ghost / marquee) does need CDP, but it's a
common enough need that the recipe is centralized in **`e2e/touchGestures.ts`** —
import `dragOneFinger(page, from, to)` rather than re-rolling it per spec:

```ts
import { dragOneFinger } from './touchGestures'
await dragOneFinger(page, { x: 70, y: 180 }, { x: 380, y: 700 })
```

That helper keeps the synthesized touch stream deliberately short and pipelines
the dispatches (awaiting `touchEnd` last) so the gesture survives the parallel
render-loop contention described above — `await`ing ~10 separate moves used to
stack up and blow the test budget mid-drag. Coordinates are canvas-relative (same
frame as `tap({position})`); the helper adds the `#editor` offset.

A **two-finger** gesture (pinch-zoom / two-finger pan) the high-level API can't
express at all, so it needs raw CDP `Input.dispatchTouchEvent` with two touch
points. Recipe:

```ts
const client = await page.context().newCDPSession(page)

// Two fingers down, ~100px apart…
await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
        { x: 350, y: 300 },
        { x: 450, y: 300 },
    ],
})

// …then move them apart to zoom in (send several frames for a smooth gesture).
await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
        { x: 300, y: 300 },
        { x: 500, y: 300 },
    ],
})

await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
```

This drives the framework-free `PinchPanRecognizer`
(`packages/editor/src/containers/PointerGestures.ts`, unit-tested in
`PointerGestures.test.ts`) → `viewport.zoomBy` / `translateBy`.

## Asserting on-canvas state (the `?test` hook)

Everything inside the editor renders into a single `<canvas>`, so Playwright
can't query on-canvas UI (the quickbar, wires panel, paint ghost, …) through the
DOM. Loading the page with **`?test`** installs `window.__FBE_TEST__`, whose
`getState()` returns a read-only `EditorTestState` snapshot (CSS px), exposing:

- `inputMode` (the derived compatibility mode), `signals` + `inputPreset` (#101
  Slice 1), `screen` size, `dialogOpen`, `viewportScale`
- `quickbar` / `wires` bounds + visibility (and the quickbar's fit scale)
- `blueprint.entityCount` — what got placed
- `paint` — the held ghost's `active`/`visible`/`tile`/`direction`, plus
  `sourceCenter` (a marquee Copy/Cut previews the ghost _at the source_, so
  `tile === sourceCenter` is how a spec asserts it stayed put)
- `marquee` — the held selection's `count`/`tileCount`/`origin`/`direction`; and
  `entityPositions()` alongside, for asserting a _move_ (every entity shifted by
  the same tile delta) rather than inferring it

It's opt-in, so it's absent in normal use. See
`packages/editor/src/common/testHook.ts`; `panels.spec.ts` and
`touchPlacement.spec.ts` read it. To assert something the snapshot doesn't cover
yet, extend `EditorTestState` rather than reaching into the DOM. The hook also
exposes a few **sandbox controls** (`showEntityInfo`, `openEntityEditor`,
`openInventory`, `closeDialogs`, `centerView`) used to drive on-canvas UI into a
given state deterministically.

## Storyboards (visual layout sandbox)

`storyboard.spec.ts` is **not** an assertion test — it's a visual-inspection
tool for the mobile-layout work (see `docs/mobile-layout-inventory.md`). It loads
one sample blueprint and, for each target platform (Pixel 7 portrait/landscape,
a 1280 desktop reference, and a small iPhone SE), screenshots a fixed set of UI
states — **base · settings open · entity info · inventory · entity editor** —
then composites them into one labelled strip per platform under
`e2e/storyboards/<platform>.png`. The committed images are the current reference;
regenerate them (and eyeball the diff) after layout changes.

It writes files and takes a few minutes, so it's **excluded from the normal
suite** (gated behind an env flag). Generate with:

```bash
STORYBOARD=1 npx playwright test storyboard.spec.ts --project=desktop-chromium
```

To change the states or platforms, edit the `PLATFORMS` / `capture()` list; the
sample blueprint is a `?source=` string with an assembler holding a complex
recipe so the info/editor panels are non-trivial.

## Open work

The one remaining `test.fixme(...)` in `touch.spec.ts`:

- **pinch-zoom** — needs the CDP `Input.dispatchTouchEvent` recipe above wired
  into a spec (the high-level touch API is single-touch).

(Deferred tap-to-place is covered for real in `touchPlacement.spec.ts`.)
