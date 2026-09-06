import { test, expect, type Page } from '@playwright/test'

/**
 * Desktop (mouse + keyboard) editing ratchets — #101 Slice 0.
 *
 * The touch arc grew a deep spec suite while desktop kept only the
 * build/mine safety net in `desktopBuild.spec.ts`, so the mouse pipeline could
 * (and did) drift without a test noticing. These are the desktop equivalents of
 * what the touch specs assert: hover → info, the Ctrl-drag copy/delete pair, the
 * held ghost following the mouse, arrow nudging, Escape/undo, click-to-open, the
 * inventory and the rates panel — plus the keypad's new keyboard entry (A7).
 *
 * Everything on-canvas is asserted through the `?test` hook (window.__FBE_TEST__)
 * because the editor renders into a single <canvas>; page errors are collected
 * per test, since a silent exception in a pointer handler is exactly how this
 * pipeline breaks.
 *
 * Screen-space caution: DOM chrome overlays the canvas top-left (logo, buttons,
 * settings pane out to ~x=320) and top-centre (the active-project pill), and the
 * Pixi quickbar sits bottom-centre — so all the coordinates below stay in the
 * open middle-right of a 1280x720 desktop viewport.
 */

// The touchMarquee fixture: 3 assembling-machine-3, 2 inserters and a 3-tile
// belt line — 8 entities spanning ~8x10 tiles. Starts with '0' so it decodes
// locally (no /corsproxy round-trip, which the preview server doesn't provide).
const BLUEPRINT =
    '0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx/Ahmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW+SpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM/eMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I+V8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j+GltfMAmGY+eDpPoE5RG5eU1+vk0W75Kbt8nyPrmbpl8tsiv1'

// The clearSlots/trainStop fixture: chests + a train stop (for the keypad test —
// the station priority is a NumericField, i.e. a keypad field).
const TRAIN_STOP_BP =
    '0eNp9ksFuwjAQRH8F7dmpIIQW/B29VRFywkJXMrbr3SCiyP9eOaERFaUna0fjN+OVB2hshyGSE9ADkOAZ9J2mwJoGLWhoLZpYsPXCi/YTWRZHukoXERRcMDJ5B3rzWu6q3W5TlW/rcrtUQK13DPpjAKaTMzaHSB8Q9JSlwJlznlh8NCcsRjQkBeQOeAW9SrUCdEJCOIHGod+77txgBL16glAQPJOMtQa4gl6+bBT045kURPzqkGV/JCsYOXsY22yfUn7iFcyOX+otk6J3RbBG8hpa3+U1rlKd6pTUQ9VyvnZLx/isbHlX9g/SeiYFw0wXLEL0Fzo8B1b/A6sZKNGQK1h8eIRsR0SVFLCYSYf3/BVGe370N6lYxgY='

interface DesktopState {
    blueprint: { entityCount: number }
    paint: {
        active: boolean
        visible: boolean
        tile: { x: number; y: number } | null
        kind: 'entity' | 'blueprint' | null
    }
    dialogOpen: boolean
    infoPanelVisible: boolean
    ratesPanelVisible: boolean
}

interface Point {
    x: number
    y: number
}

interface DesktopHook {
    getState: () => DesktopState
    entityScreenPos: (name: string) => Point | null
    centerView: () => void
    openEntityEditor: (name: string) => boolean
    editorControlPos: (control: string) => Point | null
    entityTrainStop: (name: string) => { priority: number } | null
    inventoryFirstItemPos: () => Point | null
}

// NOTE: type annotations are erased at runtime, so the `HookWindow` cast inside
// each `page.evaluate` is compile-time only — the serialized browser code is
// just `window.__FBE_TEST__`.
type HookWindow = { __FBE_TEST__: DesktopHook }

const getState = (page: Page): Promise<DesktopState> =>
    page.evaluate(() => (window as unknown as HookWindow).__FBE_TEST__.getState())

const entityScreenPos = (page: Page, name: string): Promise<Point | null> =>
    page.evaluate(n => (window as unknown as HookWindow).__FBE_TEST__.entityScreenPos(n), name)
const entityCount = async (page: Page): Promise<number> =>
    (await getState(page)).blueprint.entityCount

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

/** Canvas offset — the probe returns canvas-relative coords, the mouse needs page ones. */
async function canvasOrigin(page: Page): Promise<Point> {
    const box = await page.locator('#editor').boundingBox()
    return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

/**
 * Load the fixture, centre it and zoom out so the whole blueprint sits well
 * inside BOX_FROM..BOX_TO — a marquee is drawn in screen space, so it can only
 * cover what the viewport shows.
 */
async function gotoWithBlueprint(page: Page): Promise<number> {
    await page.goto(`/?test&source=${encodeURIComponent(BLUEPRINT)}`)
    await waitForLoaded(page)
    await expect.poll(() => entityCount(page), { timeout: 30_000 }).toBe(8)
    await page.evaluate(() => (window as unknown as HookWindow).__FBE_TEST__.centerView())
    await page.mouse.move(CENTER.x, CENTER.y)
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 200)
    return entityCount(page)
}

const CENTER = { x: 700, y: 340 }
// A box across the open canvas: right of the top-left chrome, above the
// bottom-centre quickbar.
const BOX_FROM = { x: 380, y: 130 }
const BOX_TO = { x: 1120, y: 600 }
// Far enough right of the (centred) blueprint that a placed copy can't collide
// with the originals.
const AWAY = { x: 1000, y: 300 }

/** Ctrl+drag with `button` — the copy (left) / delete (right) selection pair. */
async function ctrlDrag(page: Page, button: 'left' | 'right'): Promise<void> {
    await page.keyboard.down('Control')
    await page.mouse.move(BOX_FROM.x, BOX_FROM.y)
    await page.mouse.down({ button })
    await page.mouse.move(BOX_TO.x, BOX_TO.y, { steps: 12 })
    await page.mouse.up({ button })
    await page.keyboard.up('Control')
}

test.describe('desktop editing', () => {
    const pageErrors: string[] = []

    test.beforeEach(({ page }) => {
        test.skip(
            test.info().project.name !== 'desktop-chromium',
            'the mouse + keyboard pipeline runs on the desktop project only'
        )
        pageErrors.length = 0
        page.on('pageerror', error => pageErrors.push(String(error)))
    })

    // A silent throw in a pointer/keyboard handler leaves the canvas looking
    // fine while the editor is dead — assert on every test, not just one.
    test.afterEach(() => {
        expect(pageErrors, 'the page must not throw').toEqual([])
    })

    test('hovering an entity shows the info panel, leaving it hides it', async ({ page }) => {
        await gotoWithBlueprint(page)
        const origin = await canvasOrigin(page)
        const pos = await entityScreenPos(page, 'assembling-machine-3')
        expect(pos, 'the fixture holds an assembling machine').not.toBeNull()

        await page.mouse.move(origin.x + pos.x, origin.y + pos.y)
        await expect.poll(async () => (await getState(page)).infoPanelVisible).toBe(true)

        // Off the entity (still open canvas) — EDIT ends and the panel goes.
        await page.mouse.move(BOX_TO.x, BOX_TO.y)
        await expect.poll(async () => (await getState(page)).infoPanelVisible).toBe(false)
    })

    test('Ctrl+LMB drag holds a blueprint ghost that follows the mouse and nudges', async ({
        page,
    }) => {
        await gotoWithBlueprint(page)
        await ctrlDrag(page, 'left')

        // Releasing the copy drag hands the covered entities back as a ghost.
        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        expect((await getState(page)).paint.visible).toBe(true)

        // It tracks the pointer: moving lands it on a different tile.
        const before = (await getState(page)).paint.tile
        await page.mouse.move(AWAY.x, AWAY.y, { steps: 8 })
        await expect.poll(async () => (await getState(page)).paint.tile?.x).not.toBe(before?.x)

        // Arrow keys nudge the held ghost a tile at a time (A4).
        const nudgeFrom = (await getState(page)).paint.tile
        await page.keyboard.press('ArrowRight')
        await expect.poll(async () => (await getState(page)).paint.tile?.x).toBe(nudgeFrom.x + 1)

        // Escape drops the cursor with nothing placed (A1).
        await page.keyboard.press('Escape')
        await expect.poll(async () => (await getState(page)).paint.active).toBe(false)
        expect(await entityCount(page)).toBe(8)
    })

    test('a copy places every entity away from the originals, and Ctrl+Z undoes it', async ({
        page,
    }) => {
        const original = await gotoWithBlueprint(page)
        await ctrlDrag(page, 'left')
        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')

        // Clear of the originals, so nothing is dropped for colliding: all 8 land.
        await page.mouse.move(AWAY.x, AWAY.y, { steps: 8 })
        await page.mouse.click(AWAY.x, AWAY.y)
        await expect.poll(() => entityCount(page)).toBe(original * 2)

        await page.keyboard.press('Control+KeyZ')
        await expect.poll(() => entityCount(page)).toBe(original)
    })

    test('Ctrl+RMB drag deletes everything in the box', async ({ page }) => {
        await gotoWithBlueprint(page)
        await ctrlDrag(page, 'right')
        await expect.poll(() => entityCount(page)).toBe(0)

        await page.keyboard.press('Control+KeyZ')
        await expect.poll(() => entityCount(page)).toBe(8)
    })

    test('Enter with nothing held is a no-op', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        // `confirmPlacement` is bound globally (A2); with no cursor it must do
        // nothing at all rather than throw or place a phantom.
        await page.mouse.move(AWAY.x, AWAY.y)
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        expect(await entityCount(page)).toBe(original)
        expect((await getState(page)).paint.active).toBe(false)
    })

    test('clicking an entity opens its editor', async ({ page }) => {
        await gotoWithBlueprint(page)
        const origin = await canvasOrigin(page)
        const pos = await entityScreenPos(page, 'assembling-machine-3')
        expect(pos).not.toBeNull()

        // Hover first (EDIT mode), then a single click opens — no tap-select
        // intermediate step on desktop.
        await page.mouse.move(origin.x + pos.x, origin.y + pos.y)
        await page.mouse.click(origin.x + pos.x, origin.y + pos.y)
        await expect.poll(async () => (await getState(page)).dialogOpen).toBe(true)

        await page.keyboard.press('Escape')
        await expect.poll(async () => (await getState(page)).dialogOpen).toBe(false)
    })

    test('E opens the inventory and a click commits an item to the cursor', async ({ page }) => {
        await gotoWithBlueprint(page)
        await page.mouse.move(AWAY.x, AWAY.y)
        await page.keyboard.press('KeyE')
        await expect.poll(async () => (await getState(page)).dialogOpen).toBe(true)

        const origin = await canvasOrigin(page)
        const item = await page.evaluate(() =>
            (window as unknown as HookWindow).__FBE_TEST__.inventoryFirstItemPos()
        )
        expect(item, 'the inventory shows an item group').not.toBeNull()
        await page.mouse.click(origin.x + item.x, origin.y + item.y)

        // One click both closes the picker and puts the item on the cursor.
        await expect.poll(async () => (await getState(page)).paint.active).toBe(true)
        expect((await getState(page)).dialogOpen).toBe(false)
    })

    test('T toggles the rates panel', async ({ page }) => {
        await gotoWithBlueprint(page)
        expect((await getState(page)).ratesPanelVisible).toBe(false)
        await page.keyboard.press('KeyT')
        await expect.poll(async () => (await getState(page)).ratesPanelVisible).toBe(true)
        await page.keyboard.press('KeyT')
        await expect.poll(async () => (await getState(page)).ratesPanelVisible).toBe(false)
    })

    test('the numeric keypad takes typed digits and Enter commits them (#101 A7)', async ({
        page,
    }) => {
        await page.goto(`/?test&source=${encodeURIComponent(TRAIN_STOP_BP)}`)
        await waitForLoaded(page)
        await expect.poll(() => entityCount(page), { timeout: 30_000 }).toBeGreaterThan(0)

        const opened = await page.evaluate(() =>
            (window as unknown as HookWindow).__FBE_TEST__.openEntityEditor('train-stop')
        )
        expect(opened, 'the train-stop editor should open').toBe(true)

        const origin = await canvasOrigin(page)
        const field = await page.evaluate(() =>
            (window as unknown as HookWindow).__FBE_TEST__.editorControlPos('priority')
        )
        expect(field, 'the editor exposes the priority NumericField').not.toBeNull()
        await page.mouse.click(origin.x + field.x, origin.y + field.y)

        // Digits append to the buffer, exactly as the on-screen keys do, so a
        // prefilled field is cleared first — `Delete` is the `C` button.
        await page.keyboard.press('Delete')
        await page.keyboard.type('123')
        // Digits must not leak past the keypad: `1` is also quickbar slot 1, so a
        // paint cursor here would mean the keypad failed to swallow the key.
        expect((await getState(page)).paint.active).toBe(false)

        await page.keyboard.press('Enter')
        await expect
            .poll(
                async () =>
                    (
                        await page.evaluate(() =>
                            (window as unknown as HookWindow).__FBE_TEST__.entityTrainStop(
                                'train-stop'
                            )
                        )
                    )?.priority
            )
            .toBe(123)
    })
})
