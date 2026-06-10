import { test, expect, type Page } from '@playwright/test'

// The on-screen action toolbar (packages/website/src/actionToolbar.ts) is a
// touch affordance: it mirrors the editor's keyboard action registry into DOM
// buttons, shown only in the `mobile` input mode. Its headline job is giving
// touch users a way to exit paint mode, which was otherwise keyboard-only.
// See docs/mobile-controls.md.

// Buttons are located by their `title` (set to the action's label) so the
// assertions don't depend on the decorative unicode glyph in the button text.
const BUTTON_TITLES = ['Items', 'Rotate', 'Flip H', 'Flip V', 'Pick', 'Undo', 'Redo', 'Center']

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    // loadingScreen starts with .active and loses it once data + atlas load.
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

// Enter paint mode deterministically without clipboard or canvas hit-testing:
// seed a quickbar item (the website loads `quickbarItemNames` from localStorage
// on boot), then press the slot-1 key, which spawns the paint cursor for that
// item. The toolbar surfaces PAINT by activating its Cancel button (via
// Editor.onModeChange), so `button[title="Cancel"].active` is our DOM-observable
// proxy for "the cursor is holding something".
async function gotoAndEnterPaint(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.localStorage.setItem('quickbarItemNames', JSON.stringify(['transport-belt']))
    })
    await page.goto('/')
    await waitForLoaded(page)

    const cancel = page.locator('#action-toolbar button[title="Cancel"]')
    await expect(cancel).not.toHaveClass(/active/)

    await page.locator('#editor').focus()
    await page.keyboard.press('1') // code 'Digit1' -> quickbar slot 1 -> paint
    await expect(cancel).toHaveClass(/active/)
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
            // On an empty blueprint these are safe no-ops, but clicking them
            // exercises the EDITOR.callAction(...) seam end to end; nothing should
            // throw (e.g. an unbound action name or a null cursor). Use force
            // clicks: this test is purely about the handler firing, the sibling
            // test already covers visibility/tappability, and the actionability
            // wait on every button is what makes a 7-tap loop blow the test
            // timeout when several specs run in parallel against one render loop.
            for (const title of [
                'Rotate',
                'Flip H',
                'Flip V',
                'Undo',
                'Redo',
                'Center',
                'Place',
                'Cancel',
            ]) {
                await toolbar.locator(`button[title="${title}"]`).click({ force: true })
            }

            expect(fatal.join('\n')).toBe('')
        })

        // The headline behavior: a touch user can get out of paint mode. Cancel
        // routes through closeWindow -> BlueprintContainer.clearCursor().
        test('Cancel button exits paint mode', async ({ page }) => {
            await gotoAndEnterPaint(page)

            const cancel = page.locator('#action-toolbar button[title="Cancel"]')
            await cancel.tap()
            await expect(cancel).not.toHaveClass(/active/)
        })

        // Escape gains the same fall-through (close dialog if open, else clear the
        // cursor), so a physical keyboard on a touch device also bails out.
        test('Escape also exits paint mode', async ({ page }) => {
            await gotoAndEnterPaint(page)

            await page.keyboard.press('Escape')
            await expect(page.locator('#action-toolbar button[title="Cancel"]')).not.toHaveClass(
                /active/
            )
        })
    })
})
