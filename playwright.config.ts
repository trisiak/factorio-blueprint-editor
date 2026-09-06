import { defineConfig, devices } from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * End-to-end tests run against a production build of the app served from :8080
 * (`build:website && preview:website`), fetching its pack data **live** from the
 * shared data plane (`trisiak.github.io/factorio-pack-data`) — the same URL
 * production and the PR previews use. Nothing pack-related is committed here or
 * baked into `dist/`, so the suite doubles as a canary for the data plane and
 * for format drift in it; a red suite means either our code or the published
 * data broke. The Rust exporter / :8081 are not involved.
 *
 * The browser matrix is Chromium (a desktop profile and a Pixel 7 touch profile)
 * plus a desktop **Firefox** project, so browser-specific input behaviour
 * (context-menu rules, pointer quirks, `user-select`, focus handling) is covered
 * by the suite rather than by the maintainer's own Firefox — see #103. Firefox is
 * included only when one is actually runnable; see `firefoxAvailable` below.
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
 * browser has to use it too or every data fetch fails. Point the browser at it for
 * `https=` **only**, so the local http://localhost:8080 test server stays direct.
 * CI's network is direct, so the plumbing is conditional — never engaged there.
 * It lives on the top-level `use`, so every project (Chromium and Firefox alike)
 * inherits it.
 */
const proxied = !!process.env.HTTPS_PROXY && !CI
const proxyUse = proxied
    ? { proxy: { server: `https=${process.env.HTTPS_PROXY}` }, ignoreHTTPSErrors: true }
    : {}

/**
 * Chromium launch args, plus an explicit binary when the host stages one outside
 * Playwright's cache (PLAYWRIGHT_CHROMIUM_PATH — e2e/run-e2e.sh covers the other
 * flavours of "the browser isn't where Playwright looks").
 *
 * These hang off each *project* rather than the top-level `use`: the args below
 * are Chromium-only, and Firefox must not be handed them.
 */
const chromiumLaunchOptions = {
    // --enable-unsafe-swiftshader: allow WebGL via SwiftShader in headless
    // Chromium that has no GPU (otherwise it can be blocklisted and the canvas
    // never renders). --disable-dev-shm-usage: write Chromium's shared memory
    // to /tmp instead of a possibly-tiny /dev/shm, avoiding renderer crashes.
    args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
}

/**
 * Firefox's equivalent. No CLI args — the knobs that matter are `firefoxUserPrefs`,
 * and the ones below are the moral equivalent of `--enable-unsafe-swiftshader`:
 * the whole app is a single WebGL canvas, so a GPU-less runner still has to hand
 * out a (software) WebGL context or every spec fails as "nothing rendered".
 *
 * These prefs are necessary but **not sufficient** on a headless Linux box, and
 * the failure is worth knowing because it doesn't look like a WebGL failure:
 * headless Firefox gives out no WebGL context at all, so Pixi's
 * `isWebGLSupported()` probe fails, `autoDetectRenderer` falls past webgl to its
 * **Canvas** renderer, and the app then throws on every frame with
 * "this._renderer.filter is undefined" — the Canvas renderer registers
 * `FilterPipe` but no `FilterSystem`. The cure is a real X server: CI runs this
 * project headed under `xvfb-run` (see ci.yml), which is Firefox's SwiftShader.
 *
 * `headless` is deliberately *not* pinned here — Playwright already defaults to
 * headless, and pinning it would break `--headed` / `npm run test:e2e:ui`, which
 * is exactly the flag CI relies on.
 */
const firefoxLaunchOptions = {
    firefoxUserPrefs: {
        // Don't let the GPU blocklist switch WebGL off on a headless/GPU-less box…
        'webgl.force-enabled': true,
        'webgl.disabled': false,
        // …and don't refuse the context merely because it's software-backed
        // (the `failIfMajorPerformanceCaveat` path; PixiJS doesn't ask for it, but
        // the driver can still trip over it).
        'webgl.disable-fail-if-major-performance-caveat': true,
        // Take the software WebRender path straight away instead of probing for a
        // GPU one that isn't there.
        'gfx.webrender.software': true,
        'gfx.canvas.accelerated': false,
    },
    ...(process.env.PLAYWRIGHT_FIREFOX_PATH
        ? { executablePath: process.env.PLAYWRIGHT_FIREFOX_PATH }
        : {}),
}

/** Playwright's browser cache for this host, or undefined if it keeps them in-package. */
function playwrightBrowsersDir(): string | undefined {
    const explicit = process.env.PLAYWRIGHT_BROWSERS_PATH
    // "0" is Playwright's "store browsers inside the package" sentinel, not a path.
    if (explicit === '0') return undefined
    if (explicit) return explicit
    const home = os.homedir()
    if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright')
    if (process.platform === 'win32')
        return path.join(process.env.LOCALAPPDATA ?? home, 'ms-playwright')
    return path.join(home, '.cache', 'ms-playwright')
}

/** Does the browser cache hold a `firefox-<build>` directory? */
function hasFirefoxBuild(): boolean {
    const dir = playwrightBrowsersDir()
    if (!dir) return false
    try {
        return fs.readdirSync(dir).some(entry => entry.startsWith('firefox-'))
    } catch {
        // No cache directory at all — same answer as an empty one.
        return false
    }
}

/**
 * Is there a Firefox this run could actually launch?
 *
 * Some environments stage Chromium only — notably the agent sandbox, which sets
 * PLAYWRIGHT_BROWSERS_PATH and forbids `playwright install` — and a project whose
 * browser is missing fails the *whole* run at launch. So the Firefox project is
 * included only when it's runnable:
 *
 *   - on CI, where ci.yml installs it (`playwright install --with-deps firefox`);
 *   - when PLAYWRIGHT_FIREFOX_PATH names a binary (mirror of the Chromium one);
 *   - when a `firefox-*` build exists in Playwright's browser cache, i.e. under
 *     PLAYWRIGHT_BROWSERS_PATH or the per-OS default.
 *
 * Otherwise it's omitted with a one-line note, so a local `npm run test:e2e` runs
 * the Chromium matrix instead of dying on a browser that was never installed.
 */
const firefoxAvailable = CI || !!process.env.PLAYWRIGHT_FIREFOX_PATH || hasFirefoxBuild()
if (!firefoxAvailable) {
    console.info(
        '[playwright.config] no Firefox available (not CI, no PLAYWRIGHT_FIREFOX_PATH, no firefox-* build in the Playwright browser cache) — omitting the desktop-firefox project'
    )
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
        ...proxyUse,
    },
    projects: [
        {
            name: 'desktop-chromium',
            use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunchOptions },
        },
        // Firefox runs the same desktop specs as desktop-chromium: the specs key
        // their skips off *capabilities* rather than a browser name (see
        // e2e/projects.ts), so "desktop-only" means both desktop projects. Pinned
        // to the Chromium desktop viewport so layout-sensitive assertions compare
        // like with like.
        ...(firefoxAvailable
            ? [
                  {
                      name: 'desktop-firefox',
                      use: {
                          ...devices['Desktop Firefox'],
                          viewport: devices['Desktop Chrome'].viewport,
                          launchOptions: firefoxLaunchOptions,
                      },
                  },
              ]
            : []),
        {
            name: 'mobile-chromium',
            // Pixel 7 => isMobile + hasTouch; the editor's mobile gate is opt-in
            // (?desktopOnly) so the app loads here.
            use: { ...devices['Pixel 7'], launchOptions: chromiumLaunchOptions },
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
