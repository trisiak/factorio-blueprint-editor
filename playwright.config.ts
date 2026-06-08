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
export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:8080',
        trace: 'on-first-retry',
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
