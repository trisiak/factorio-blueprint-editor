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
preview:website` for you. `build:website` bakes the committed `vanilla-2.0`
atlas into `dist/`, and `preview:website` serves it on :8080 — so the Rust
exporter / :8081 are **not** needed.

The web server start has a 180s timeout because it does a full production build
first; the initial run is slow, subsequent runs reuse the server locally
(`reuseExistingServer` is on outside CI).

### Browser

The suite uses Chromium only. This environment (and CI) already has a Chromium
that `@playwright/test` targets, so **don't** run `playwright install` — the
browser-download CDN isn't in the egress allowlist and the step will 403. (This
is also why the SessionStart hook installs deps but not browsers.)

## Projects

Two projects are defined; most specs run on both, touch specs on the mobile one:

| Project            | Device  | Capabilities          |
| ------------------ | ------- | --------------------- |
| `desktop-chromium` | Desktop | mouse + keyboard      |
| `mobile-chromium`  | Pixel 7 | `isMobile + hasTouch` |

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

Playwright's high-level `touchscreen` / `locator.tap()` API is **single-touch**.
That's enough for the one-finger paths (tap-to-place, one-finger pan), e.g.:

```ts
await page.locator('#editor').tap()
```

It **cannot** express a two-finger gesture, so **pinch-zoom / two-finger pan**
needs raw CDP `Input.dispatchTouchEvent` with two touch points. Recipe:

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

## Asserting blueprint state

Some specs (e.g. tap-to-place) need to read editor state to assert on it. The
website does **not** expose a window-level blueprint handle yet, so those specs
are currently `test.fixme(...)` and double as a to-do list. The intended fix is
to expose a small read-only handle on `window` from the website boot
(`packages/website/src/index.ts`) so tests can read placed entities. Once that
lands, convert the relevant `fixme` to a real test and tick the box in
`docs/mobile-controls.md` — don't leave the doc stale.

## Open work

See the `test.fixme(...)` blocks in `touch.spec.ts` and the "e2e coverage gaps"
item in `docs/mobile-controls.md`. The two known gaps:

- **tap-to-place assertion** — needs the window-level blueprint handle above.
- **pinch-zoom** — needs the CDP recipe above wired into a spec.
