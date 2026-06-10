import { test, expect, type Page } from '@playwright/test'

// Slice 1 of natural touch placement: on mobile a tap positions/previews the
// held ghost (the touch analogue of desktop hover) and only a *second* tap on
// the same tile — or the on-screen Place (✓) button — commits it. Placement
// happens on the <canvas>, which the DOM can't observe, so these assert against
// the `?test` state hook (window.__FBE_TEST__). See docs/mobile-controls.md.

interface PaintState {
    paint: {
        active: boolean
        visible: boolean
        tile: { x: number; y: number } | null
        direction: number | null
    }
    blueprint: { entityCount: number }
    dialogOpen: boolean
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

// Boot in mobile mode holding an item: seed it into quickbar slot 1 (loaded from
// localStorage on boot), enable the test hook with `?test`, then press the slot
// key to pick it up (enter paint).
async function gotoHoldingItem(page: Page, item = 'transport-belt'): Promise<void> {
    await page.addInitScript(seedItem => {
        window.localStorage.setItem('quickbarItemNames', JSON.stringify([seedItem]))
    }, item)
    await page.goto('/?test')
    await waitForLoaded(page)
    await page.locator('#editor').focus()
    await page.keyboard.press('1')
    await expect.poll(async () => (await getState(page)).paint.active).toBe(true)
}

// Drag a single finger across the canvas (a one-finger pan). Playwright's
// touchscreen API only taps, so synthesize the touch stream over CDP — the same
// raw `Input.dispatchTouchEvent` path the pinch work needs.
async function dragOneFinger(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number }
): Promise<void> {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: from.x, y: from.y }],
    })
    const steps = 8
    for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
                {
                    x: from.x + ((to.x - from.x) * i) / steps,
                    y: from.y + ((to.y - from.y) * i) / steps,
                },
            ],
        })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
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

    test('panning keeps the previewed ghost pinned to its tile', async ({ page }) => {
        await gotoHoldingItem(page)

        await page.locator('#editor').tap({ position: TILE_A })
        const before = (await getState(page)).paint.tile

        // A one-finger drag pans the camera. The ghost must stay on its tapped
        // world tile (the view moves around it) rather than follow the finger.
        await dragOneFinger(page, { x: 120, y: 520 }, { x: 300, y: 560 })

        const after = (await getState(page)).paint.tile
        expect(after).toEqual(before) // pinned to its world tile through the pan
        expect(await entityCount(page)).toBe(0) // panning places nothing
    })

    test('tapping a placed entity shows info first; a second tap opens the editor', async ({
        page,
    }) => {
        // This one does a lot — place (2 taps) + cancel + two edit taps + opening a
        // heavy editor overlay — so its sequential taps can outrun the default
        // 30s budget when specs run in parallel against one render loop.
        test.slow()

        // Place an assembling machine (it has an editor overlay), then drop the
        // held cursor so subsequent taps are edits, not placements.
        await gotoHoldingItem(page, 'assembling-machine-2')
        await page.locator('#editor').tap({ position: TILE_A })
        await page.locator('#editor').tap({ position: TILE_A })
        await expect.poll(() => entityCount(page)).toBe(1)
        await page.locator('#action-toolbar button[title="Cancel"]').tap()
        await expect.poll(async () => (await getState(page)).paint.active).toBe(false)

        // First tap selects/inspects the entity — its info shows, but no overlay.
        await page.locator('#editor').tap({ position: TILE_A })
        expect((await getState(page)).dialogOpen).toBe(false)

        // Second tap on the same entity opens the editor overlay (openEditor runs
        // synchronously within the tap, so read directly rather than polling).
        await page.locator('#editor').tap({ position: TILE_A })
        expect((await getState(page)).dialogOpen).toBe(true)

        // Tapping the canvas outside the editor dismisses it (no stale overlay
        // lingering when you tap away). The editor is centered, so tap low.
        await page.locator('#editor').tap({ position: { x: 206, y: 740 } })
        expect((await getState(page)).dialogOpen).toBe(false)
    })

    test('the Delete button removes the selected entity', async ({ page }) => {
        test.slow()

        // Place an entity, drop the held cursor, then select it.
        await gotoHoldingItem(page, 'assembling-machine-2')
        await page.locator('#editor').tap({ position: TILE_A })
        await page.locator('#editor').tap({ position: TILE_A })
        await expect.poll(() => entityCount(page)).toBe(1)
        await page.locator('#action-toolbar button[title="Cancel"]').tap()
        await page.locator('#editor').tap({ position: TILE_A }) // select (EDIT)

        // Delete mines the selected entity (touch has no right-click to mine).
        await page.locator('#action-toolbar button[title="Delete"]').tap()
        await expect.poll(() => entityCount(page)).toBe(0)
    })

    // Merge-safety: PR #6 (Space Age) reworks entity directions/sizing in the same
    // auto-merging files, so guard that rotating a held entity still changes its
    // facing.
    test('the Rotate button changes the held entity facing', async ({ page }) => {
        await gotoHoldingItem(page, 'inserter')
        const before = (await getState(page)).paint.direction
        expect(typeof before).toBe('number')

        await page.locator('#action-toolbar button[title="Rotate"]').tap()
        expect((await getState(page)).paint.direction).not.toBe(before)
    })
})
