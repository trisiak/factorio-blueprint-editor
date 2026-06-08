import { test, expect } from '@playwright/test'

test.describe('touch', () => {
    // These run on the touch-capable (mobile-chromium) project only.
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'touch tests run on the mobile project only'
        )
    })

    test('mobile loads (gate lifted) and shows the experimental toast once', async ({ page }) => {
        const fatal: string[] = []
        page.on('pageerror', err => fatal.push(err.message))

        await page.goto('/')

        await expect(page.locator('#editor')).toBeVisible()
        expect(fatal.join('\n')).not.toContain('MOBILE_DEVICE_NOT_SUPPORTED')

        // Slice 0: touch devices get an experimental-support info toast on the
        // first visit...
        await expect(page.getByText(/Touch support is experimental/i)).toBeVisible({
            timeout: 15_000,
        })

        // ...but a `fbe:touchToastSeen` flag is persisted, so it must not nag on
        // every reload (reloading is normal now that blueprints persist).
        await page.reload()
        await expect(page.locator('#editor')).toBeVisible()
        await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
        await expect(page.getByText(/Touch support is experimental/i)).toHaveCount(0)
    })

    test('?desktopOnly restores the hard mobile block', async ({ page }) => {
        await page.goto('/?desktopOnly')
        await expect(page.locator('#loadingScreen')).toHaveClass(/error/, { timeout: 15_000 })
    })

    // TODO(slice 2): tap-to-place. `page.locator('#editor').tap()` drives the
    // one-finger touch path (deferred press/release in BlueprintContainer).
    // Asserting the placement needs a window-level handle to read blueprint
    // state, which the website does not expose yet — left as fixme.
    test.fixme('single-finger tap places the held entity', async ({ page }) => {
        await page.goto('/')
        await page.locator('#editor').tap()
    })

    // Slice 1 pinch-zoom is two-finger. Playwright's high-level touchscreen API
    // is single-touch only, so verifying pinch needs CDP
    // Input.dispatchTouchEvent with two touch points. Entry point for that work.
    test.fixme('two-finger pinch zooms the viewport (needs CDP multitouch)', async () => {
        // Drive two touch points via CDP Input.dispatchTouchEvent; the
        // high-level touchscreen API cannot express a pinch.
    })
})
