import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against a self-contained production build: `build:website`
 * bakes the committed vanilla-2.0 atlas into `dist/` (via viteStaticCopy), so
 * `preview:website` serves everything from :8080 with no exporter / :8081 needed.
 *
 * Touch coverage uses a mobile device descriptor (`hasTouch: true`), which drives
 * the tap-to-place / one-finger-pan path. NOTE: Playwright's high-level
 * `touchscreen` API is single-touch only — pinch-zoom (two-finger) needs raw CDP
 * `Input.dispatchTouchEvent`; see e2e/touch.spec.ts.
 */
const CI = !!process.env.CI

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
        // --enable-unsafe-swiftshader: allow WebGL via SwiftShader in headless
        // Chromium that has no GPU (otherwise it can be blocklisted and the canvas
        // never renders). --disable-dev-shm-usage: write Chromium's shared memory
        // to /tmp instead of a possibly-tiny /dev/shm, avoiding renderer crashes.
        launchOptions: {
            args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
        },
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
    ],
    webServer: {
        command: 'npm run build:website && npm run preview:website',
        url: 'http://localhost:8080',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
    },
})
