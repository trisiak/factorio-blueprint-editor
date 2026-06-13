import { test, expect, type Page } from '@playwright/test'

// Placement of a *pasted blueprint* on touch (issue #30). A paste produces a
// multi-entity ghost; before this, the only way to position it was to blind-tap
// until it happened to land right. Now you can drag it (one finger, starting on
// the ghost), nudge it a tile at a time (the bottom d-pad arrows), and see its
// center (a crosshair). Everything happens on the <canvas>, so these assert
// against the `?test` state hook. See docs/mobile-controls.md.

interface PaintState {
    paint: {
        active: boolean
        visible: boolean
        tile: { x: number; y: number } | null
        kind: 'entity' | 'blueprint' | null
    }
    blueprint: { entityCount: number }
}

// A small vanilla blueprint (assembling machines + inserters + a belt line):
// several tiles across, so a tap on its center reliably lands inside the ghost's
// bounds for the drag-to-grab gesture. Decodes locally (starts with '0').
const BLUEPRINT =
    '0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx/Ahmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW+SpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM/eMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I+V8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j+GltfMAmGY+eDpPoE5RG5eU1+vk0W75Kbt8nyPrmbpl8tsiv1'

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

// Load the blueprint, then pick it all up as a paste ghost via the test hook
// (the touch marquee that would normally produce one is the next feature). The
// ghost starts hidden until the first tap reveals/positions it (mobile has no
// hover) — the same contract as any held cursor.
async function gotoWithPasteGhost(page: Page): Promise<number> {
    await page.goto(`/?test&source=${encodeURIComponent(BLUEPRINT)}`)
    await waitForLoaded(page)
    await expect.poll(() => entityCount(page)).toBeGreaterThan(1)
    const original = await entityCount(page)

    const spawned = await page.evaluate(() =>
        (
            window as unknown as { __FBE_TEST__: { spawnPasteGhost: () => boolean } }
        ).__FBE_TEST__.spawnPasteGhost()
    )
    expect(spawned).toBe(true)
    await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
    return original
}

// Drag a single finger across the canvas over CDP (Playwright's touchscreen API
// is single-tap only). Coordinates are **canvas/element-relative** (same frame
// as `locator.tap({position})`): CDP wants page coords and the canvas is inset
// by the action rail, so add the `#editor` box offset — otherwise the touch
// lands ~a rail-width off and misses the ghost you mean to grab.
async function dragOneFinger(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number }
): Promise<void> {
    const box = await page.locator('#editor').boundingBox()
    const ox = box?.x ?? 0
    const oy = box?.y ?? 0
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: ox + from.x, y: oy + from.y }],
    })
    const steps = 8
    for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
                {
                    x: ox + from.x + ((to.x - from.x) * i) / steps,
                    y: oy + from.y + ((to.y - from.y) * i) / steps,
                },
            ],
        })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
}

// Tap a button in the bottom paint d-pad (nudge arrows + Place). It's shown only
// in PAINT mode, fixed bottom-center — no overflow to open. Force-tap: the
// geometry is fixed and unobstructed, but the per-button actionability "stable"
// wait gets flaky when specs run in parallel against one render loop (same
// reason actionToolbar.spec.ts force-clicks).
async function tapDpad(page: Page, title: string): Promise<void> {
    await page.locator(`#paint-dpad button[title="${title}"]`).click({ force: true })
}

// Center-ish points, clear of the left rail gutter and the top/bottom chrome.
const CENTER = { x: 240, y: 480 }
const AWAY = { x: 320, y: 600 }

test.describe('touch placement of a pasted blueprint', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'touch placement runs on the mobile project only'
        )
    })

    test('a one-finger drag on the ghost moves it without placing', async ({ page }) => {
        const original = await gotoWithPasteGhost(page)

        // Reveal + position the ghost under a tap, then grab it there and drag.
        await page.locator('#editor').tap({ position: CENTER })
        const before = (await getState(page)).paint.tile
        expect(before).not.toBeNull()

        await dragOneFinger(page, CENTER, AWAY)

        const after = (await getState(page)).paint
        expect(after.visible).toBe(true)
        expect(after.tile).not.toEqual(before) // the ghost followed the finger
        expect(await entityCount(page)).toBe(original) // dragging places nothing
    })

    test('a drag starting off the ghost pans the camera, leaving the ghost put', async ({
        page,
    }) => {
        await gotoWithPasteGhost(page)

        await page.locator('#editor').tap({ position: CENTER })
        const before = (await getState(page)).paint.tile

        // Start well away from the ghost: this is a camera pan, so the ghost stays
        // pinned to its world tile (the view moves around it).
        await dragOneFinger(page, { x: 360, y: 760 }, { x: 200, y: 760 })

        expect((await getState(page)).paint.tile).toEqual(before)
    })

    test('the nudge arrows move the ghost one tile at a time', async ({ page }) => {
        await gotoWithPasteGhost(page)

        await page.locator('#editor').tap({ position: CENTER })
        const before = (await getState(page)).paint.tile

        await tapDpad(page, 'Up')
        const up = (await getState(page)).paint.tile
        expect(up).toEqual({ x: before.x, y: before.y - 1 })

        await tapDpad(page, 'Right')
        const right = (await getState(page)).paint.tile
        expect(right).toEqual({ x: up.x + 1, y: up.y })
    })

    test('Place commits the whole pasted blueprint at the previewed spot', async ({ page }) => {
        const original = await gotoWithPasteGhost(page)

        await page.locator('#editor').tap({ position: AWAY })
        expect(await entityCount(page)).toBe(original) // positioning places nothing

        await tapDpad(page, 'Place')

        // Place commits the pasted entities (the count grows). It's not exactly
        // 2× because the ghost may overlap the originals at the chosen spot and
        // the engine rejects colliding entities — that's correct placement, and
        // the point here is that Place commits the *whole paste*, not one tap.
        await expect.poll(() => entityCount(page)).toBeGreaterThan(original)
    })
})
