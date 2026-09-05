import { test, expect, type Page } from '@playwright/test'
import { dragOneFinger } from './touchGestures'
import { isChromiumProject, isTouchProject } from './projects'

// Tile-brush controls on touch: the PAINT d-pad's corners carry Size − / +
// (the keyboard's [ / ] ratchet — the brush was stuck at 2×2 on mobile) and
// Erase (desktop's right-click mine — laid tiles were unremovable on touch),
// shown only while the cursor is a *tile* brush. Plus the marquee's tile side:
// the regular Select resolves game-like (entities win, tiles only when the box
// holds none) and the rail's "Select tiles" collects tiles even under
// entities. Tiles render on the <canvas>, so these assert against the `?test`
// state hook (`paint.tileSize`, `blueprint.tileCount`, `marquee.tileCount`).
// See docs/mobile-controls.md.

interface TilesState {
    paint: {
        active: boolean
        visible: boolean
        kind: 'entity' | 'blueprint' | null
        tile: { x: number; y: number } | null
        /** Non-null exactly while a tile brush is held. */
        tileSize: number | null
    }
    blueprint: { entityCount: number; tileCount: number }
    /** Either/or: entities win, so count and tileCount are never both non-zero. */
    marquee: { count: number; tileCount: number }
}

function getState(page: Page): Promise<TilesState> {
    return page.evaluate(() =>
        (
            window as unknown as { __FBE_TEST__: { getState: () => TilesState } }
        ).__FBE_TEST__.getState()
    )
}

const tileCount = async (page: Page): Promise<number> => (await getState(page)).blueprint.tileCount

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

// Boot in mobile mode with items seeded into the quickbar (loaded from
// localStorage on boot); pressing a slot key picks one up (enters paint).
// Slot 1 = landfill (the tile brush under test), slot 2 = a plain entity for
// the gating comparison.
async function gotoWithQuickbar(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.localStorage.setItem(
            'quickbarItemNames',
            JSON.stringify(['landfill', 'transport-belt'])
        )
    })
    await page.goto('/?test')
    await waitForLoaded(page)
    await page.locator('#editor').focus()
}

async function holdSlot(page: Page, slot: '1' | '2'): Promise<void> {
    await page.keyboard.press(slot)
    await expect.poll(async () => (await getState(page)).paint.active).toBe(true)
}

// Two clearly-separated points in the open canvas (away from the top chrome,
// the left rail and the bottom d-pad) — far enough apart that two 2×2 brush
// footprints can't overlap.
const TILE_A = { x: 180, y: 480 }
const TILE_B = { x: 340, y: 620 }

// The d-pad's geometry is fixed/unobstructed, but the actionability wait is
// flaky under parallel render-loop contention (see actionToolbar.spec), so
// d-pad taps force-click like touchPlacement's Place test does.
const dpad = (page: Page, title: string) => page.locator(`#paint-dpad button[title="${title}"]`)

test.describe('touch tile brush (size + erase)', () => {
    // Touch + Chromium, not just touch: the gestures are synthesized with raw CDP
    // (`Input.dispatchTouchEvent`), which only Chromium exposes.
    test.beforeEach(() => {
        test.skip(
            !isTouchProject() || !isChromiumProject(),
            'the tile d-pad controls exist on the mobile project only'
        )
    })

    test('Size and Erase show for a tile brush only — and re-gate on a live cursor swap', async ({
        page,
    }) => {
        await gotoWithQuickbar(page)

        // Entity brush: the d-pad shows, but the tile-only corners are gated off.
        await holdSlot(page, '2')
        await expect(page.locator('#paint-dpad')).toHaveClass(/visible/)
        await expect(dpad(page, 'Size +')).toBeHidden()
        await expect(dpad(page, 'Size -')).toBeHidden()
        await expect(dpad(page, 'Erase')).toBeHidden()
        expect((await getState(page)).paint.tileSize).toBeNull()

        // Swap to the tile brush without leaving PAINT (spawnPaintContainer
        // re-emits the mode) — the corners must appear live.
        await holdSlot(page, '1')
        await expect(dpad(page, 'Size +')).toBeVisible()
        await expect(dpad(page, 'Size -')).toBeVisible()
        await expect(dpad(page, 'Erase')).toBeVisible()
        expect((await getState(page)).paint.tileSize).toBe(2)
    })

    test('Size + grows the brush; placing paints the larger square', async ({ page }) => {
        await gotoWithQuickbar(page)
        await holdSlot(page, '1')

        // Position/preview the ghost (first tap never commits).
        await page.locator('#editor').tap({ position: TILE_A })
        expect(await tileCount(page)).toBe(0)

        await dpad(page, 'Size +').click({ force: true })
        await expect.poll(async () => (await getState(page)).paint.tileSize).toBe(3)

        await dpad(page, 'Place').click({ force: true })
        await expect.poll(() => tileCount(page)).toBe(9)
        expect((await getState(page)).blueprint.entityCount).toBe(0) // tiles aren't entities
    })

    test('Size - shrinks the brush down to a single tile', async ({ page }) => {
        await gotoWithQuickbar(page)
        await holdSlot(page, '1')
        await page.locator('#editor').tap({ position: TILE_A })

        await dpad(page, 'Size -').click({ force: true })
        await expect.poll(async () => (await getState(page)).paint.tileSize).toBe(1)
        // The ratchet clamps at 1 — another tap must not underflow.
        await dpad(page, 'Size -').click({ force: true })
        await expect.poll(async () => (await getState(page)).paint.tileSize).toBe(1)

        await dpad(page, 'Place').click({ force: true })
        await expect.poll(() => tileCount(page)).toBe(1)
    })

    test('Erase removes the tiles under the ghost footprint — and only those', async ({ page }) => {
        test.slow() // several sequential taps against one render loop

        await gotoWithQuickbar(page)
        await holdSlot(page, '1')

        // Place a 2×2 patch at A (tap to position, tap again to commit).
        await page.locator('#editor').tap({ position: TILE_A })
        await page.locator('#editor').tap({ position: TILE_A })
        await expect.poll(() => tileCount(page)).toBe(4)

        // Move the preview elsewhere: erasing there hits nothing — the eraser
        // only clears the brush footprint, not the whole blueprint.
        await page.locator('#editor').tap({ position: TILE_B })
        await dpad(page, 'Erase').click({ force: true })
        expect(await tileCount(page)).toBe(4)

        // Back over the patch: Erase collects it, and the brush stays in hand.
        await page.locator('#editor').tap({ position: TILE_A })
        await dpad(page, 'Erase').click({ force: true })
        await expect.poll(() => tileCount(page)).toBe(0)
        expect((await getState(page)).paint.active).toBe(true)
    })
})

// --- Marquee: tiles in selections -----------------------------------------

// Tap a rail button by title (open the ⋯ overflow first if it spilled there).
// Force-click: fixed geometry, but the actionability wait is flaky under
// parallel render-loop contention (see actionToolbar.spec).
async function tapRail(page: Page, title: string): Promise<void> {
    const toolbar = page.locator('#action-toolbar')
    const btn = toolbar.locator(`button[title="${title}"]`)
    if (!(await btn.isVisible())) await toolbar.locator('button.rail-more').click({ force: true })
    await btn.click({ force: true })
}

const tapIn = (page: Page, cluster: string, title: string): Promise<void> =>
    page.locator(`#${cluster} button[title="${title}"]`).click({ force: true })

// Pixel counts of the marquee's overlay visuals (blue drag rectangle / green
// tile highlight), via the `?test` probe — the canvas is opaque to the DOM.
const overlayPixels = (page: Page): Promise<{ box: number; highlight: number }> =>
    page.evaluate(() =>
        (
            window as unknown as {
                __FBE_TEST__: { marqueeOverlayPixels: () => { box: number; highlight: number } }
            }
        ).__FBE_TEST__.marqueeOverlayPixels()
    )

// Lay a 2×2 landfill patch at `at` with the slot-1 brush, then drop the cursor
// (rail Cancel) so the marquee buttons (modes NONE/EDIT) come back.
async function layPatch(page: Page, at: { x: number; y: number }): Promise<void> {
    await holdSlot(page, '1')
    await page.locator('#editor').tap({ position: at })
    await page.locator('#editor').tap({ position: at })
    await expect.poll(() => tileCount(page)).toBeGreaterThan(0)
    await tapRail(page, 'Cancel')
    await expect.poll(async () => (await getState(page)).paint.active).toBe(false)
}

// Place the slot-2 belt at `at` (tap to preview, tap to commit), then drop the cursor.
async function placeBelt(page: Page, at: { x: number; y: number }): Promise<void> {
    await holdSlot(page, '2')
    await page.locator('#editor').tap({ position: at })
    await page.locator('#editor').tap({ position: at })
    await expect.poll(async () => (await getState(page)).blueprint.entityCount).toBe(1)
    await tapRail(page, 'Cancel')
    await expect.poll(async () => (await getState(page)).paint.active).toBe(false)
}

// Boxes: one tight around the TILE_A patch (clear of TILE_B), one over both.
const BOX_A_FROM = { x: 120, y: 420 }
const BOX_A_TO = { x: 240, y: 540 }
const BOX_BOTH_FROM = { x: 120, y: 420 }
const BOX_BOTH_TO = { x: 400, y: 700 }

test.describe('touch marquee: tiles in selections', () => {
    // Touch + Chromium, not just touch: the gestures are synthesized with raw CDP
    // (`Input.dispatchTouchEvent`), which only Chromium exposes.
    test.beforeEach(() => {
        test.skip(
            !isTouchProject() || !isChromiumProject(),
            'the marquee is a mobile-only touch gesture'
        )
    })

    test('regular Select prefers entities; a box with none falls back to tiles', async ({
        page,
    }) => {
        test.slow() // several place/select rounds against one render loop

        await gotoWithQuickbar(page)
        await layPatch(page, TILE_A)
        await placeBelt(page, TILE_B)

        // A box over both: game-like resolution — the entity wins, tiles ignored.
        await tapRail(page, 'Select')
        await dragOneFinger(page, BOX_BOTH_FROM, BOX_BOTH_TO)
        await expect.poll(async () => (await getState(page)).marquee.count).toBe(1)
        expect((await getState(page)).marquee.tileCount).toBe(0)
        // The blue rectangle is drag feedback only — once the selection is held
        // it must be gone (it used to linger frozen over the canvas).
        expect((await overlayPixels(page)).box).toBe(0)
        await tapIn(page, 'select-actions', 'Cancel')

        // A box over the patch only: no entities inside → the tiles are selected,
        // and the entity-only nudge d-pad hides (Copy/Cut/Delete still offered).
        await tapRail(page, 'Select')
        await dragOneFinger(page, BOX_A_FROM, BOX_A_TO)
        await expect.poll(async () => (await getState(page)).marquee.tileCount).toBe(4)
        expect((await getState(page)).marquee.count).toBe(0)
        await expect(page.locator('#select-dpad button[title="Up"]')).toBeHidden()
        await expect(page.locator('#select-actions button[title="Delete"]')).toBeVisible()
        // A held tile selection shows its per-tile highlight, not the rectangle.
        const held = await overlayPixels(page)
        expect(held.box).toBe(0)
        expect(held.highlight).toBeGreaterThan(0)

        // Delete removes the selected tiles and nothing else — highlight included.
        await tapIn(page, 'select-actions', 'Delete')
        await expect.poll(() => tileCount(page)).toBe(0)
        expect((await getState(page)).blueprint.entityCount).toBe(1)
        expect((await overlayPixels(page)).highlight).toBe(0)
    })

    test('Select tiles collects the tiles even under an entity', async ({ page }) => {
        test.slow()

        await gotoWithQuickbar(page)
        // No tiles yet → the tiles-flavoured Select isn't offered (rail or overflow).
        await expect(page.locator('#action-toolbar button[title="Select tiles"]')).toBeHidden()

        // A patch with a belt sitting on top of it (layers coexist).
        await layPatch(page, TILE_A)
        await placeBelt(page, TILE_A)
        await expect(page.locator('#action-toolbar button[title="Select tiles"]')).toBeVisible()

        // Regular Select over the spot picks the belt (entities win)...
        await tapRail(page, 'Select')
        await dragOneFinger(page, BOX_A_FROM, BOX_A_TO)
        await expect.poll(async () => (await getState(page)).marquee.count).toBe(1)
        await tapIn(page, 'select-actions', 'Cancel')

        // ...Select tiles reaches the tiles underneath it.
        await tapRail(page, 'Select tiles')
        await dragOneFinger(page, BOX_A_FROM, BOX_A_TO)
        await expect.poll(async () => (await getState(page)).marquee.tileCount).toBe(4)
        expect((await getState(page)).marquee.count).toBe(0)
        expect((await overlayPixels(page)).highlight).toBeGreaterThan(0)

        // Deleting the tile selection leaves the belt alone.
        await tapIn(page, 'select-actions', 'Delete')
        await expect.poll(() => tileCount(page)).toBe(0)
        expect((await getState(page)).blueprint.entityCount).toBe(1)
    })

    test('Copy on a tile selection spawns a placeable ghost — nudge + Place duplicates', async ({
        page,
    }) => {
        test.slow()

        await gotoWithQuickbar(page)
        await layPatch(page, TILE_A)

        await tapRail(page, 'Select')
        await dragOneFinger(page, BOX_A_FROM, BOX_A_TO)
        await expect.poll(async () => (await getState(page)).marquee.tileCount).toBe(4)

        // Copy → a blueprint ghost carrying the tiles, previewed over the source.
        await tapIn(page, 'select-actions', 'Copy')
        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        expect(await tileCount(page)).toBe(4) // originals stay

        // Nudge it clear of the source patch and commit — the patch duplicates.
        for (let i = 0; i < 3; i++) await tapIn(page, 'paint-dpad', 'Right')
        await tapIn(page, 'paint-dpad', 'Place')
        await expect.poll(() => tileCount(page)).toBe(8)
    })

    test('Cut on a tile selection previews in place — Place restores the patch', async ({
        page,
    }) => {
        test.slow()

        await gotoWithQuickbar(page)
        await layPatch(page, TILE_A)

        await tapRail(page, 'Select')
        await dragOneFinger(page, BOX_A_FROM, BOX_A_TO)
        await expect.poll(async () => (await getState(page)).marquee.tileCount).toBe(4)

        // Cut removes the originals and holds them as a ghost over the source
        // tiles — committing without moving lays them right back.
        await tapIn(page, 'select-actions', 'Cut')
        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        await expect.poll(() => tileCount(page)).toBe(0)

        await tapIn(page, 'paint-dpad', 'Place')
        await expect.poll(() => tileCount(page)).toBe(4)
    })
})
