import { test, expect, type Page } from '@playwright/test'

// Slice 1 of natural touch placement: on mobile a tap positions/previews the
// held ghost (the touch analogue of desktop hover) and only a *second* tap on
// the same tile — or the on-screen Place (✓) button — commits it. Placement
// happens on the <canvas>, which the DOM can't observe, so these assert against
// the `?test` state hook (window.__FBE_TEST__). See docs/mobile-controls.md.

interface PaintState {
    paint: { active: boolean; visible: boolean; tile: { x: number; y: number } | null }
    blueprint: { entityCount: number }
}

function getState(page: Page): Promise<PaintState> {
    return page.evaluate(() =>
        (
            window as unknown as { __FBE_TEST__: { getState: () => PaintState } }
        ).__FBE_TEST__.getState()
    )
}

const entityCount = async (page: Page): Promise<number> =>
    (await getState(page)).blueprint.entityCount

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

// Boot in mobile mode holding an item: seed transport-belt into quickbar slot 1
// (loaded from localStorage on boot), enable the test hook with `?test`, then
// press the slot key to pick it up (enter paint).
async function gotoHoldingItem(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.localStorage.setItem('quickbarItemNames', JSON.stringify(['transport-belt']))
    })
    await page.goto('/?test')
    await waitForLoaded(page)
    await page.locator('#editor').focus()
    await page.keyboard.press('1')
    await expect.poll(async () => (await getState(page)).paint.active).toBe(true)
}

// Two clearly-separated points in the open canvas (away from the top toolbar,
// the bottom quickbar and the left button stack).
const TILE_A = { x: 180, y: 480 }
const TILE_B = { x: 340, y: 620 }

test.describe('touch placement (deferred)', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'touch placement runs on the mobile project only'
        )
    })

    test('a tap positions and previews the ghost without placing', async ({ page }) => {
        await gotoHoldingItem(page)
        expect(await entityCount(page)).toBe(0)

        await page.locator('#editor').tap({ position: TILE_A })

        const s = await getState(page)
        expect(s.paint.active).toBe(true)
        expect(s.paint.visible).toBe(true) // ghost now shown at the tapped tile
        expect(s.blueprint.entityCount).toBe(0) // ...but a single tap commits nothing
    })

    test('a second tap on the same tile places the entity', async ({ page }) => {
        await gotoHoldingItem(page)

        await page.locator('#editor').tap({ position: TILE_A })
        const previewedTile = (await getState(page)).paint.tile

        await page.locator('#editor').tap({ position: TILE_A })

        await expect.poll(() => entityCount(page)).toBe(1)
        const s = await getState(page)
        expect(s.paint.active).toBe(true) // item stays in hand to place more
        expect(s.paint.tile).toEqual(previewedTile) // landed where it previewed
    })

    test('a tap on a different tile moves the preview instead of placing', async ({ page }) => {
        await gotoHoldingItem(page)

        await page.locator('#editor').tap({ position: TILE_A })
        const first = (await getState(page)).paint.tile

        await page.locator('#editor').tap({ position: TILE_B })
        const second = (await getState(page)).paint.tile

        expect(second).not.toEqual(first) // the ghost followed the tap
        expect(await entityCount(page)).toBe(0) // moving the preview doesn't place
    })

    test('the Place button commits the previewed ghost', async ({ page }) => {
        await gotoHoldingItem(page)

        await page.locator('#editor').tap({ position: TILE_A })
        expect(await entityCount(page)).toBe(0)

        await page.locator('#action-toolbar button[title="Place"]').tap()

        await expect.poll(() => entityCount(page)).toBe(1)
    })
})
