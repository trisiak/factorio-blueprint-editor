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
    retries: CI ? 2 : 0,
    // CI runners have no GPU, so PixiJS renders through software WebGL
    // (SwiftShader) — markedly slower than a local GPU. Running two canvas-heavy
    // workers on top of that made them fight over the runner's render loop: input
    // dispatch stalled (the toolbar/touch specs hit the 30s timeout) and, once a
    // renderer ran out of memory, the page crashed outright ("Target page/context/
    // browser has been closed"). Serialize to one worker on CI and widen the
    // per-test/assert budgets; local runs keep the fast parallel defaults.
    workers: CI ? 1 : undefined,
    timeout: CI ? 60_000 : 30_000,
    expect: { timeout: CI ? 10_000 : 5_000 },
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
