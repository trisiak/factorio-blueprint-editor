import { test, expect } from '@playwright/test'

// The on-screen action toolbar (packages/website/src/actionToolbar.ts) is a
// touch affordance: it mirrors the editor's keyboard action registry into DOM
// buttons, shown only in the `mobile` input mode. Its headline job is giving
// touch users a way to exit paint mode, which was otherwise keyboard-only.
// See docs/mobile-controls.md.

// Buttons are located by their `title` (set to the action's label) so the
// assertions don't depend on the decorative unicode glyph in the button text.
const BUTTON_TITLES = ['Items', 'Rotate', 'Flip H', 'Flip V', 'Pick', 'Undo', 'Redo', 'Center']

async function waitForLoaded(page: import('@playwright/test').Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    // loadingScreen starts with .active and loses it once data + atlas load.
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

test.describe('action toolbar', () => {
    test('is hidden in the desktop input mode', async ({ page }) => {
        test.skip(
            test.info().project.name !== 'desktop-chromium',
            'desktop input mode is auto-detected on the desktop project only'
        )

        await page.goto('/')
        await waitForLoaded(page)

        // The element is always mounted; it's just not shown without `.visible`
        // (the toolbar defaults to display:none).
        const toolbar = page.locator('#action-toolbar')
        await expect(toolbar).toHaveCount(1)
        await expect(toolbar).not.toHaveClass(/visible/)
        await expect(toolbar).toBeHidden()
    })

    test.describe('mobile', () => {
        // Pixel 7 => isMobile + hasTouch, so the input mode auto-detects `mobile`.
        test.beforeEach(() => {
            test.skip(
                test.info().project.name !== 'mobile-chromium',
                'the toolbar only shows in the mobile input mode'
            )
        })

        test('is visible and exposes the action buttons', async ({ page }) => {
            await page.goto('/')
            await waitForLoaded(page)

            const toolbar = page.locator('#action-toolbar')
            await expect(toolbar).toBeVisible()
            await expect(toolbar).toHaveClass(/visible/)

            for (const title of [...BUTTON_TITLES, 'Cancel']) {
                await expect(toolbar.locator(`button[title="${title}"]`)).toBeVisible()
            }
            // Cancel is styled apart so it reads as the "get me out" control.
            await expect(toolbar.locator('button[title="Cancel"]')).toHaveClass(/cancel/)
        })

        test('buttons route through the action registry without throwing', async ({ page }) => {
            const fatal: string[] = []
            page.on('pageerror', err => fatal.push(err.message))

            await page.goto('/')
            await waitForLoaded(page)

            const toolbar = page.locator('#action-toolbar')
            // On an empty blueprint these are safe no-ops, but tapping them
            // exercises the EDITOR.callAction(...) seam end to end; nothing should
            // throw (e.g. an unbound action name or a null cursor).
            for (const title of [
                'Rotate',
                'Flip H',
                'Flip V',
                'Undo',
                'Redo',
                'Center',
                'Cancel',
            ]) {
                await toolbar.locator(`button[title="${title}"]`).tap()
            }

            expect(fatal.join('\n')).toBe('')
        })
    })

    // The headline behavior — Cancel (and Escape) clearing the paint cursor —
    // can't be asserted end to end yet. Both entering paint mode and reading the
    // editor mode back out need a window-level handle into editor state that the
    // website doesn't expose (the same blocker as tap-to-place; see
    // docs/mobile-controls.md). Until then this is verified manually.
    test.fixme('Cancel button exits paint mode', async () => {
        // Needs a test seam to enter PAINT (e.g. appendBlueprint from the
        // clipboard) and to observe editor.mode returning to NONE after tapping
        // the Cancel button.
    })
})
