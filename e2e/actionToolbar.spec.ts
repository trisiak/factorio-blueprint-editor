import { test, expect, type Page } from '@playwright/test'

// The on-screen action toolbar (packages/website/src/actionToolbar.ts) is a
// touch affordance: it mirrors the editor's keyboard action registry into DOM
// buttons, shown only in the `mobile` input mode. The rail is **mode-gated**
// (#33): a button is only in the DOM when its action is useful in the current
// editor mode, so non-live buttons are absent (count 0), not just hidden.
// See docs/mobile-controls.md.

// A self-contained vanilla-2.0 blueprint (a single wooden chest). Starts with
// '0', so the loader decodes it locally — no `/corsproxy` round-trip.
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

// Tap a rail action — directly if it's in the rail, else via the ⋯ overflow.
// (With mode-gating the rail is short enough that the blueprint actions usually
// sit directly in it rather than the overflow.) Force-click: the rail re-flows
// (ResizeObserver / mode changes) so elements aren't "stable".
async function tapRail(page: Page, title: string): Promise<void> {
    const toolbar = page.locator('#action-toolbar')
    const btn = toolbar.locator(`button[title="${title}"]`)
    if (!(await btn.isVisible())) {
        const more = toolbar.locator('button.rail-more')
        if (await more.count()) await more.click({ force: true })
    }
    await btn.click({ force: true })
}

// Enter paint mode deterministically: seed a quickbar item (loaded from
// localStorage on boot), then press the slot-1 key to pick it up. In PAINT the
// rail surfaces the Cancel button, our DOM-observable proxy for "holding a cursor".
async function gotoAndEnterPaint(page: Page, item = 'transport-belt'): Promise<void> {
    await page.addInitScript(seed => {
        window.localStorage.setItem('quickbarItemNames', JSON.stringify([seed]))
    }, item)
    await page.goto('/')
    await waitForLoaded(page)

    // Cancel is mode-gated: absent while idle (NONE).
    const cancel = page.locator('#action-toolbar button[title="Cancel"]')
    await expect(cancel).toHaveCount(0)

    await page.locator('#editor').focus()
    await page.keyboard.press('1') // code 'Digit1' -> quickbar slot 1 -> paint
    await expect(cancel).toBeVisible()
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

        test('shows the global actions and hides mode-specific ones while idle', async ({
            page,
        }) => {
            await page.goto('/')
            await waitForLoaded(page)

            const toolbar = page.locator('#action-toolbar')
            await expect(toolbar).toBeVisible()
            await expect(toolbar).toHaveClass(/visible/)

            // Global actions are always present.
            for (const title of ['Items', 'Undo', 'Redo', 'Center']) {
                await expect(toolbar.locator(`button[title="${title}"]`)).toBeVisible()
            }
            // Cursor/selection actions are no-ops while idle (NONE) → absent.
            for (const title of ['Rotate', 'Flip H', 'Flip V', 'Delete', 'Copy cfg', 'Cancel']) {
                await expect(toolbar.locator(`button[title="${title}"]`)).toHaveCount(0)
            }
            // Select needs something to select — hidden on an empty blueprint.
            await expect(toolbar.locator('button[title="Select"]')).toHaveCount(0)
        })

        test('the Select button appears once the blueprint is non-empty', async ({ page }) => {
            await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
            await waitForLoaded(page)
            await expect.poll(() => entityCount(page)).toBeGreaterThan(0)

            await expect(page.locator('#action-toolbar button[title="Select"]')).toBeVisible()
        })

        test('PAINT surfaces rotate/flip/pick/cancel for a flippable held entity', async ({
            page,
        }) => {
            await gotoAndEnterPaint(page) // a belt — directional, so flippable (#55)

            const toolbar = page.locator('#action-toolbar')
            for (const title of ['Rotate', 'Flip H', 'Flip V', 'Pick', 'Cancel']) {
                await expect(toolbar.locator(`button[title="${title}"]`)).toBeVisible()
            }
            // Delete / Copy cfg only make sense on a selected entity (EDIT).
            for (const title of ['Delete', 'Copy cfg', 'Paste cfg']) {
                await expect(toolbar.locator(`button[title="${title}"]`)).toHaveCount(0)
            }
        })

        test('Flip is cursor-aware: hidden for a non-flippable held entity', async ({ page }) => {
            // A wooden chest has no direction and no fluidboxes → flipping is a
            // no-op, so the Flip buttons stay hidden (rotate is mode-gated, not
            // rotatability-gated, so it can still show — flip is the cursor-aware one).
            await gotoAndEnterPaint(page, 'wooden-chest')

            const toolbar = page.locator('#action-toolbar')
            await expect(toolbar.locator('button[title="Cancel"]')).toBeVisible() // in paint
            await expect(toolbar.locator('button[title="Flip H"]')).toHaveCount(0)
            await expect(toolbar.locator('button[title="Flip V"]')).toHaveCount(0)
        })

        test('Flip buttons appear when holding a pasted-blueprint ghost', async ({ page }) => {
            // A paste ghost (PaintBlueprintContainer) is flippable; spawn one via
            // the test hook from a loaded blueprint.
            await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
            await waitForLoaded(page)
            await expect.poll(() => entityCount(page)).toBeGreaterThan(0)
            await page.evaluate(() =>
                (
                    window as unknown as { __FBE_TEST__: { spawnPasteGhost: () => boolean } }
                ).__FBE_TEST__.spawnPasteGhost()
            )

            const toolbar = page.locator('#action-toolbar')
            await expect(toolbar.locator('button[title="Flip H"]')).toBeVisible()
            await expect(toolbar.locator('button[title="Flip V"]')).toBeVisible()
        })

        test('global + paint buttons route through the registry without throwing', async ({
            page,
        }) => {
            const fatal: string[] = []
            page.on('pageerror', err => fatal.push(err.message))

            await gotoAndEnterPaint(page)

            // PAINT-mode rail actions exist now; exercise the callAction seam.
            const toolbar = page.locator('#action-toolbar')
            for (const title of ['Rotate', 'Pick', 'Undo', 'Redo', 'Center']) {
                await toolbar.locator(`button[title="${title}"]`).click({ force: true })
            }

            expect(fatal.join('\n')).toBe('')
        })

        // Blueprint-level actions (clipboard / new / export) are global and, with
        // the rail mode-gated short, usually sit directly in it. Tapping them
        // routes (copyBlueprint via a handler, the rest via the registry) without
        // throwing on an empty blueprint.
        test('the blueprint actions route without throwing', async ({ page }) => {
            const fatal: string[] = []
            page.on('pageerror', err => fatal.push(err.message))

            await page.goto('/')
            await waitForLoaded(page)

            for (const title of ['Copy BP', 'Paste BP', 'Export', 'New']) {
                await tapRail(page, title)
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

            await tapRail(page, 'New')

            // The confirm toast appears; the blueprint is untouched until confirmed.
            const confirm = page.getByRole('button', { name: /^Clear$/ })
            await expect(confirm).toBeVisible()
            expect(await entityCount(page)).toBeGreaterThan(0)

            await confirm.click()
            await expect.poll(() => entityCount(page)).toBe(0)
        })

        // The headline behavior: a touch user can get out of paint mode. Cancel
        // routes through closeWindow -> BlueprintContainer.clearCursor(). Leaving
        // PAINT also removes Cancel (mode-gated).
        test('Cancel button exits paint mode', async ({ page }) => {
            await gotoAndEnterPaint(page)

            const cancel = page.locator('#action-toolbar button[title="Cancel"]')
            await cancel.tap()
            await expect(cancel).toHaveCount(0)
        })

        // Escape gains the same fall-through (close dialog if open, else clear the
        // cursor), so a physical keyboard on a touch device also bails out.
        test('Escape also exits paint mode', async ({ page }) => {
            await gotoAndEnterPaint(page)

            await page.keyboard.press('Escape')
            await expect(page.locator('#action-toolbar button[title="Cancel"]')).toHaveCount(0)
        })
    })
})
