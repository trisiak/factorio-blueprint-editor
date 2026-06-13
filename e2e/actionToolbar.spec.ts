import { test, expect, type Page } from '@playwright/test'

// The on-screen action toolbar (packages/website/src/actionToolbar.ts) is a
// touch affordance: it mirrors the editor's keyboard action registry into DOM
// buttons, shown only in the `mobile` input mode. Its headline job is giving
// touch users a way to exit paint mode, which was otherwise keyboard-only.
// See docs/mobile-controls.md.

// Buttons are located by their `title` (set to the action's label) so the
// assertions don't depend on the decorative unicode glyph in the button text.
const BUTTON_TITLES = ['Items', 'Rotate', 'Flip H', 'Flip V', 'Pick', 'Undo', 'Redo', 'Center']

// A self-contained vanilla-2.0 blueprint (a single wooden chest). Starts with
// '0', so the loader decodes it locally — no `/corsproxy` round-trip (which the
// preview server doesn't provide). Gives the "New" confirm a non-empty blueprint
// to guard. Mirrors the strings in persistence.spec.ts.
const CHEST =
    '0eJxtjs0OgjAQhN9lztUgoRD6KsYYfjbapGwJLSohfXcX9ODBy2x2M9/MrmjdTONkOcKssJEGmJ+bwoOmYD3D6DKvi7rWRZ5VVVEquKYlJ+5xc4R4iCTS3UUFs53nAHOWTO7pBXNSCPbGjdt6uBlIyKf3PfGXSemiQBxttPQh92W58jy0NO0J/ziF0QeBth9XSFN21ArLPiUzpTfn9ku6'

type TestHookWindow = {
    __FBE_TEST__: { getState(): { blueprint: { entityCount: number } } }
}
const entityCount = (page: Page): Promise<number> =>
    page.evaluate(
        () => (window as unknown as TestHookWindow).__FBE_TEST__.getState().blueprint.entityCount
    )

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

        // Blueprint-level actions (clipboard / new / export) live in the ⋯
        // overflow; they're keyboard-only otherwise, so the rail is the only touch
        // path. Open the sheet, confirm they're there, and that tapping them routes
        // (copyBlueprint via a handler, the rest via the action registry) without
        // throwing on an empty blueprint.
        test('overflow exposes the blueprint actions and they route without throwing', async ({
            page,
        }) => {
            const fatal: string[] = []
            page.on('pageerror', err => fatal.push(err.message))

            await page.goto('/')
            await waitForLoaded(page)

            const toolbar = page.locator('#action-toolbar')

            // Force clicks throughout: the rail re-lays-out (ResizeObserver on the
            // button stack) so elements aren't "stable" for the actionability wait.
            // A button click closes the sheet, so re-open ⋯ before each.
            for (const title of ['Copy BP', 'Paste BP', 'Export', 'New']) {
                await toolbar.locator('button.rail-more').click({ force: true })
                await toolbar.locator(`button[title="${title}"]`).click({ force: true })
            }

            expect(fatal.join('\n')).toBe('')
        })

        // "New" (clear) swaps in a fresh blueprint — it can't be undone — so on a
        // non-empty blueprint it must ask first: the tap surfaces a confirm toast
        // and leaves the blueprint untouched until "Clear" is pressed.
        test('New asks for confirmation before clearing a non-empty blueprint', async ({
            page,
        }) => {
            await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
            await waitForLoaded(page)
            await expect.poll(() => entityCount(page)).toBeGreaterThan(0)

            const toolbar = page.locator('#action-toolbar')
            await toolbar.locator('button.rail-more').click({ force: true })
            await toolbar.locator('button[title="New"]').click({ force: true })

            // The confirm toast appears; the blueprint is untouched until confirmed.
            const confirm = page.getByRole('button', { name: /^Clear$/ })
            await expect(confirm).toBeVisible()
            expect(await entityCount(page)).toBeGreaterThan(0)

            await confirm.click()
            await expect.poll(() => entityCount(page)).toBe(0)
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
