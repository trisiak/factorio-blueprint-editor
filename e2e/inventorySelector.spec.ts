import { test, expect, type Page } from '@playwright/test'
import type { EditorTestState } from '@fbe/editor'

/**
 * The DOM item selector (#98 Slice 1) — the mobile presentation of the main
 * inventory (rail "Items" / E). Ratchets:
 *  - per-mode presentation: mobile gets the DOM dialog and NOT the Pixi one,
 *    desktop the reverse (the seam is UIContainer.openMainInventory);
 *  - search → two-step select (tap previews, ✓ commits) → the pick lands on
 *    the cursor as a paint ghost;
 *  - a repeat "Items" press toggles the selector closed;
 *  - the modal tier holds: readouts hide while it's open (layering contract);
 *  - a commit is recorded and resurfaces in the ★ Recents tab.
 */

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

async function readTestState(page: Page): Promise<EditorTestState> {
    return (await page.evaluate(() => {
        const w = window as unknown as { __FBE_TEST__?: { getState: () => unknown } }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.getState()
    })) as EditorTestState
}

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
    await page.locator('.dg.main').waitFor({ state: 'attached' })
}

const pixiInventoryOpen = (page: Page): Promise<boolean> =>
    page.evaluate(() =>
        (
            window as unknown as { __FBE_TEST__: { pixiInventoryOpen: () => boolean } }
        ).__FBE_TEST__.pixiInventoryOpen()
    )

// One wooden chest, so the blueprint is non-empty and Recents' "On blueprint"
// section has something to show.
const CHEST_BP =
    '0eJxtjs0OgjAQhN9lztUgoRD6KsYYfjbapGwJLSohfXcX9ODBy2x2M9/MrmjdTONkOcKssJEGmJ+bwoOmYD3D6DKvi7rWRZ5VVVEquKYlJ+5xc4R4iCTS3UUFs53nAHOWTO7pBXNSCPbGjdt6uBlIyKf3PfGXSemiQBxttPQh92W58jy0NO0J/ziF0QeBth9XSFN21ArLPiUzpTfn9ku6'

test.describe('DOM item selector (#98)', () => {
    test('mobile: rail Items opens the DOM selector, not the Pixi dialog; backdrop and E close it', async ({
        page,
    }) => {
        test.skip(!isMobileProject(), 'mobile-only: the DOM selector only presents on touch')

        await page.goto('/?test')
        await waitForAppReady(page)

        const selector = page.locator('.fbe-dialog.item-picker')
        await expect(selector).toBeHidden()

        await page.locator('#action-toolbar button[title="Items"]').click()
        await expect(selector).toBeVisible()
        expect(await pixiInventoryOpen(page)).toBe(false)
        // The modal tier holds: the layering class is set while it's open.
        await expect(page.locator('body')).toHaveClass(/fbe-dialog-open/)

        // Group tabs come from the live pack's inventory layout.
        await expect(page.locator('.is-tab').first()).toHaveText('★')
        expect(await page.locator('.is-tab').count()).toBeGreaterThan(3)

        // The backdrop covers everything below the modal tier (the rail
        // included — a second rail press isn't physically possible), so
        // tapping away IS the close gesture.
        await page.locator('.fbe-dialog-backdrop').click({ position: { x: 5, y: 5 } })
        await expect(selector).toBeHidden()
        await expect(page.locator('body')).not.toHaveClass(/fbe-dialog-open/)

        // The E keybind is a true toggle: open, then close on repeat.
        await page.keyboard.press('e')
        await expect(selector).toBeVisible()
        await page.keyboard.press('e')
        await expect(selector).toBeHidden()
    })

    test('desktop: the Pixi dialog presents; the DOM selector stays out', async ({ page }) => {
        test.skip(isMobileProject(), 'desktop-only')

        await page.goto('/?test')
        await waitForAppReady(page)

        await page.evaluate(() =>
            (
                window as unknown as { __FBE_TEST__: { openInventory: () => void } }
            ).__FBE_TEST__.openInventory()
        )
        expect(await pixiInventoryOpen(page)).toBe(true)
        await expect(page.locator('.fbe-dialog.item-picker')).toBeHidden()
    })

    test('mobile: search → preview → ✓ Confirm puts the pick on the cursor and records a recent', async ({
        page,
    }) => {
        test.skip(!isMobileProject(), 'mobile-only')

        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)
        await expect
            .poll(async () => (await readTestState(page)).blueprint.entityCount, {
                timeout: 30_000,
            })
            .toBeGreaterThan(0)

        await page.locator('#action-toolbar button[title="Items"]').click()
        const selector = page.locator('.fbe-dialog.item-picker')
        await expect(selector).toBeVisible()

        // The search box is the DOM selector's headline win (#56): typing
        // narrows the grid to matches across every group.
        await page.locator('.is-search').fill('transport belt')
        const cell = page.locator('.is-cell[data-item="transport-belt"]')
        await expect(cell).toBeVisible()
        expect(await page.locator('.is-cell').count()).toBeLessThan(10)

        // Two-step select: the first tap previews (footer shows the item),
        // nothing is on the cursor yet.
        await cell.click()
        // Display name when the pack's localisation is a plain string, the
        // prototype id otherwise — both spell the item.
        await expect(page.locator('.is-footer-name')).toHaveText(/transport[- ]belt/i)
        expect((await readTestState(page)).paint.active).toBe(false)

        // ✓ commits: dialog closes, the pick is the paint cursor.
        await page.locator('.is-confirm').click()
        await expect(selector).toBeHidden()
        await expect.poll(async () => (await readTestState(page)).paint.active).toBe(true)

        // Drop the ghost, reopen: the pick resurfaces under ★ Recents.
        await page.keyboard.press('Escape')
        await page.locator('#action-toolbar button[title="Items"]').click()
        await expect(selector).toBeVisible()
        await expect(page.locator('.is-section.is-recent')).toBeVisible()
        await expect(page.locator('.is-cell[data-item="transport-belt"]').first()).toBeVisible()
        // The chest on the blueprint feeds the third section.
        await expect(page.locator('.is-section.is-onbp')).toBeVisible()
        await expect(page.locator('.is-cell[data-item="wooden-chest"]')).toBeVisible()
    })

    test('mobile: readouts yield while the selector is open and restore on close', async ({
        page,
    }) => {
        test.skip(!isMobileProject(), 'mobile-only')

        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)
        await expect
            .poll(async () => (await readTestState(page)).blueprint.entityCount, {
                timeout: 30_000,
            })
            .toBeGreaterThan(0)

        // Bring up the entity-info sheet, then open the selector over it.
        await page.evaluate(() =>
            (
                window as unknown as {
                    __FBE_TEST__: { showEntityInfo: (n: string) => boolean }
                }
            ).__FBE_TEST__.showEntityInfo('wooden-chest')
        )
        const sheet = page.locator('#entity-info-sheet')
        await expect(sheet).toBeVisible()

        await page.locator('#action-toolbar button[title="Items"]').click()
        await expect(page.locator('.fbe-dialog.item-picker')).toBeVisible()
        await expect(sheet).toBeHidden()

        // The header ✕ closes; the sheet restores itself (state never left
        // the editor).
        await page.locator('.fbe-dialog-close').click()
        await expect(page.locator('.fbe-dialog.item-picker')).toBeHidden()
        await expect(sheet).toBeVisible()
    })
})
