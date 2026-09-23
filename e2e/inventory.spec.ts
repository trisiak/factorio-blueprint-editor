import { test, expect, type Page } from '@playwright/test'
import type { EditorTestState } from '@fbe/editor'
import { isTouchProject } from './projects'

/**
 * Inventory (item selector) dialog coverage. The dialog is drawn in the PixiJS
 * canvas, so the DOM has nothing to query; loading with `?test` installs
 * window.__FBE_TEST__ (packages/editor/src/common/testHook.ts), which drives
 * the dialog into a known state and reports on-canvas coordinates to click.
 */

/** Read the opt-in canvas-state probe (only present when the page is loaded with `?test`). */
async function readTestState(page: Page): Promise<EditorTestState> {
    return (await page.evaluate(() => {
        const w = window as unknown as { __FBE_TEST__?: { getState: () => unknown } }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.getState()
    })) as EditorTestState
}

/** Wait for the editor to finish booting (settings pane + handlers are wired then). */
async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
    await page.locator('.dg.main').waitFor({ state: 'attached' })
}

test.describe('inventory item grid scrolling', () => {
    // A narrow-but-desktop window: the dialog's responsive body caps at the
    // classic 404px / 10-column layout, so a big group genuinely overflows its
    // 8-row viewport and the scroll path engages. (On the default 1280px
    // viewport the dialog widens to ~16 columns and nothing scrolls.) Input
    // mode is pointer-based, not width-based, so this stays 'desktop'.
    test.use({ viewport: { width: 420, height: 900 } })

    test('the last item row stays clickable at full scroll', async ({ page }) => {
        // Desktop-only: on touch a tap previews (Confirm-to-select) instead of
        // committing, so "click commits and closes" is the desktop contract.
        // The eventMode gating under test is shared by both input modes.
        test.skip(isTouchProject(), 'desktop-only: click-to-commit is the desktop path')

        // Space Age: its logistics group is 10 rows at 10 columns, so the item
        // grid actually scrolls (no vanilla-2.0 group exceeds the 8-row
        // viewport). The scenario needs real overflow — see the scroll assert.
        await page.goto('/?test&pack=space-age')
        await waitForAppReady(page)

        // Open the inventory, scroll its tallest group to the bottom and get the
        // last item button's on-screen position from the hook.
        const target = await page.evaluate(() => {
            const w = window as unknown as {
                __FBE_TEST__: {
                    inventoryScrollToLastItem: () => {
                        x: number
                        y: number
                        scroll: number
                    } | null
                }
            }
            return w.__FBE_TEST__.inventoryScrollToLastItem()
        })
        expect(target).not.toBeNull()
        // The scenario only reproduces when the grid genuinely scrolled: at max
        // scroll the bottom row sits 2px lower (relative to the viewport) than
        // an unscrolled bottom row, which is exactly what the old pitch-based
        // gate rejected.
        expect(target!.scroll).toBeGreaterThan(0)
        expect((await readTestState(page)).dialogOpen).toBe(true)

        // Regression (last-row buttons had eventMode 'none'): clicking the last
        // row must commit the item — the dialog closes and a paint ghost spawns.
        // Assert `active`, not `kind`: the bottom row of SA's logistics group
        // holds tiles (foundations), and `kind` only labels entity/blueprint.
        await page.mouse.click(target!.x, target!.y)
        await expect
            .poll(async () => (await readTestState(page)).dialogOpen, { timeout: 5_000 })
            .toBe(false)
        expect((await readTestState(page)).paint.active).toBe(true)
    })
})
