import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against a production build of the app served from :8080
 * (`build:website && preview:website`), fetching its pack data **live** from the
 * shared data plane (`trisiak.github.io/factorio-pack-data`) — the same URL
 * production and the PR previews use. Nothing pack-related is committed here or
 * baked into `dist/`, so the suite doubles as a canary for the data plane and
 * for format drift in it; a red suite means either our code or the published
 * data broke. The Rust exporter / :8081 are not involved.
 *
 * Touch coverage uses a mobile device descriptor (`hasTouch: true`), which drives
 * the tap-to-place / one-finger-pan path. NOTE: Playwright's high-level
 * `touchscreen` API is single-touch only — pinch-zoom (two-finger) needs raw CDP
 * `Input.dispatchTouchEvent`; see e2e/touch.spec.ts.
 */
const CI = !!process.env.CI

/** Where the build under test fetches packs.json + each pack's data.json/atlas. */
const DATA_URL = process.env.VITE_DATA_URL ?? 'https://trisiak.github.io/factorio-pack-data'

/**
 * Sandboxed hosts route outbound HTTPS through an agent proxy (HTTPS_PROXY); the
 * browser has to use it too or every data fetch fails. Point Chromium at it for
 * `https=` **only**, so the local http://localhost:8080 test server stays direct.
 * CI's network is direct, so the plumbing is conditional — never engaged there.
 */
const proxied = !!process.env.HTTPS_PROXY && !CI
const proxyUse = proxied
    ? { proxy: { server: `https=${process.env.HTTPS_PROXY}` }, ignoreHTTPSErrors: true }
    : {}

/**
 * Chromium launch args, plus an explicit binary when the host stages one outside
 * Playwright's cache (PLAYWRIGHT_CHROMIUM_PATH — e2e/run-e2e.sh covers the other
 * flavours of "the browser isn't where Playwright looks").
 */
const launchOptions = {
    // --enable-unsafe-swiftshader: allow WebGL via SwiftShader in headless
    // Chromium that has no GPU (otherwise it can be blocklisted and the canvas
    // never renders). --disable-dev-shm-usage: write Chromium's shared memory
    // to /tmp instead of a possibly-tiny /dev/shm, avoiding renderer crashes.
    args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
}

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: CI,
    // CI retries twice; locally retry once. With the systematic flakiness fixed
    // (slimmer CDP gestures + the generous budgets below), what's left is the rare
    // hardware-edge jitter of synthesizing touch input against a render loop shared
    // by N parallel workers — a single retry absorbs that without masking real
    // failures (which fail every attempt).
    retries: CI ? 2 : 1,
    // CI runners have no GPU, so PixiJS renders through software WebGL
    // (SwiftShader) — markedly slower than a local GPU. Running two canvas-heavy
    // workers on top of that made them fight over the runner's render loop: input
    // dispatch stalled (the toolbar/touch specs hit the 30s timeout) and, once a
    // renderer ran out of memory, the page crashed outright ("Target page/context/
    // browser has been closed"). Serialize to one worker on CI.
    workers: CI ? 1 : undefined,
    // Generous budgets *everywhere*, not just on CI. The render loop is the
    // bottleneck on both: CI has no GPU, and a local full-suite run has N parallel
    // workers fighting one GPU. Under that contention a CDP touch dispatch or a
    // canvas state read-back that's instant in isolation takes seconds, so the old
    // tight local budgets (30s/5s — set assuming a quiet single-spec run) made the
    // touch specs flaky under `npm run test:e2e` while single-test / sharded-CI
    // runs passed. Matching CI's headroom locally is what makes the parallel suite
    // reliable. (The CDP gestures were also slimmed down — see e2e/touchGestures.ts.)
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:8080',
        trace: 'on-first-retry',
        launchOptions,
        ...proxyUse,
    },
    projects: [
        {
            name: 'desktop-chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'mobile-chromium',
            // Pixel 7 => isMobile + hasTouch; the editor's mobile gate is opt-in
            // (?desktopOnly) so the app loads here.
            use: { ...devices['Pixel 7'] },
        },
        {
            // The hybrid case (#101 Slice 1): a desktop viewport with a *mouse and
            // a touchscreen* on the same page — a touchscreen laptop / Surface.
            // `isMobile` stays false, so Chromium reports a fine primary pointer
            // (`(pointer: coarse)` follows its mobile emulation), which is exactly
            // the configuration the old `maxTouchPoints > 0` detection got wrong:
            // touch-capable hardware that should still boot the mouse UI (B1).
            //
            // Scoped via `testMatch` to the specs that actually have something
            // to say about hybrid hardware: the rest of the suite is already
            // covered by the desktop and mobile projects, and running all of it
            // a third time would triple a render-bound suite for no signal.
            // `domReadouts` and `domQuickbar` are here because #101 Slice 5's
            // whole claim is that these surfaces follow the viewport and the
            // primary pointer, not the presence of a touchscreen — which only
            // this project can falsify.
            name: 'hybrid-chromium',
            testMatch: /(hybridInput|domReadouts|domQuickbar)\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 1280, height: 720 },
                hasTouch: true,
            },
        },
    ],
    webServer: {
        command: 'npm run build:website && npm run preview:website',
        url: 'http://localhost:8080',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        // Pin the data source for the build under test rather than leaning on the
        // vite config's build-time default, so what the suite exercises is
        // explicit here (and overridable: set VITE_DATA_URL to test against a
        // local `npm run serve:data` or a staging data plane).
        env: { VITE_DATA_URL: DATA_URL },
    },
})
