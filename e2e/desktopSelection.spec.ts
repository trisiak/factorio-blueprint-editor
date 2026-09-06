import { test, expect, type Page } from '@playwright/test'

/**
 * Desktop held selection (#101 Slice 2) — the mouse/keyboard driver for the
 * selection model the touch arc built (#21/#47).
 *
 * Upstream's desktop area-select committed on release: `Ctrl+LMB` drag turned
 * whatever the box caught into a paste ghost the instant you let go, `Ctrl+RMB`
 * deleted it, and there was no *cut*, no in-place move, no tiles. Now both
 * drivers land in the same `EditorMode.SELECT`: the drag **holds** the
 * selection, and Copy / Cut / Delete / nudge / move-with-the-mouse act on it
 * afterwards — from the on-screen bar on touch (`touchMarquee.spec.ts`, the
 * ratchet this must not disturb) or the keyboard here.
 *
 * Everything on-canvas is asserted through the `?test` hook
 * (`window.__FBE_TEST__`), since the editor is a single <canvas>.
 */

interface SelectionState {
    blueprint: { entityCount: number; tileCount: number }
    paint: {
        active: boolean
        kind: 'entity' | 'blueprint' | null
        tile: { x: number; y: number } | null
        sourceCenter: { x: number; y: number } | null
    }
    marquee: {
        count: number
        tileCount: number
        origin: { x: number; y: number } | null
        direction: number | null
    }
    viewportScale: number
}

interface SelectionHook {
    getState: () => SelectionState
    entityPositions: () => { name: string; x: number; y: number }[]
    wireColorPixelCounts: () => { red: number; green: number; copper: number }
}

/**
 * The multi-entity vanilla blueprint the touch marquee specs use (assemblers +
 * inserters + a belt line); starts with '0' so it decodes locally.
 */
const BLUEPRINT =
    '0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx/Ahmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW+SpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM/eMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I+V8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j+GltfMAmGY+eDpPoE5RG5eU1+vk0W75Kbt8nyPrmbpl8tsiv1'

/**
 * The small wired blueprint from `wires.spec.ts` — red, green *and* copper on a
 * handful of entities. Moving a held selection must keep every one of them
 * (`Blueprint.moveEntitiesBy` relocates the real entities rather than cutting
 * and re-pasting them), which is the whole point of the in-place move.
 */
const WIRED_BLUEPRINT =
    '0eJyd0u9qhDAMAPB3yec4rr1Wpq8iMtQLI2BTqXXbIX33VQfb4Dbh7lP/pb+kpCv040JTYIlQr8CDlxnqZoWZX6Ubtz3pHEEN20nsJBaDdz1LF32AhMByoQ+oVWoRSCJHpi9gX1xfZHE9hRyARxDC5Od818uWMXunJ4tw3ceU8EbT92nqWDs/Vpv+WzOP1faPZr81RxdeXEEjDTHwUEx+pFvOHj+1vJOrfnO5xe8c9v42ChVqVC025zwa1Hlm0WKJts1xHMnlJD+fC+GNwrzDttSVqSprKv1cmlNKn9W808o='

/**
 * Desktop viewport (1280×720) coordinates clear of the DOM/Pixi chrome: the
 * top-left corner stack out to ~x=320, the top-centre project pill, and the
 * bottom-centre quickbar. Only the *press* point has to dodge them (a release
 * is handled window-wide), but keep the whole box inside anyway.
 */
const BOX_FROM = { x: 380, y: 190 }
const BOX_TO = { x: 1100, y: 560 }
/** Empty canvas well clear of the (centred, zoomed-out) blueprint. */
const AWAY = { x: 1150, y: 220 }

const getState = (page: Page): Promise<SelectionState> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: SelectionHook }).__FBE_TEST__.getState()
    )

const entityCount = async (page: Page): Promise<number> =>
    (await getState(page)).blueprint.entityCount

const entityPositions = (page: Page): Promise<{ name: string; x: number; y: number }[]> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: SelectionHook }).__FBE_TEST__.entityPositions()
    )

const wireCounts = (page: Page): Promise<{ red: number; green: number; copper: number }> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: SelectionHook }).__FBE_TEST__.wireColorPixelCounts()
    )

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

/**
 * Load a blueprint, focus the canvas and zoom out a few steps so the whole
 * thing sits inside the box coordinates above with empty canvas around it.
 * Returns the entity count it came in with.
 */
async function gotoWithBlueprint(page: Page, source = BLUEPRINT): Promise<number> {
    await page.goto(`/?test&source=${encodeURIComponent(source)}`)
    await waitForLoaded(page)
    await expect.poll(() => entityCount(page)).toBeGreaterThan(1)
    await page.locator('#editor').focus()
    // Wheel-zoom out: each notch is one zoom step, and the pointer has to be
    // over the canvas for the handler to see it.
    await page.mouse.move(700, 400)
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120)
    return entityCount(page)
}

/**
 * Modifier + drag across the canvas — `Ctrl+LMB` draws a holding selection box,
 * `Ctrl+RMB` the delete flavour. The intermediate move matters: the box grows
 * off the grid cursor, which only updates on real pointer movement.
 */
async function modifierDrag(
    page: Page,
    button: 'left' | 'right' = 'left',
    from = BOX_FROM,
    to = BOX_TO
): Promise<void> {
    await page.keyboard.down('Control')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down({ button })
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2)
    await page.mouse.move(to.x, to.y)
    await page.mouse.up({ button })
    await page.keyboard.up('Control')
}

/** Draw a holding selection over the whole blueprint and confirm it's held. */
async function selectAll(page: Page): Promise<number> {
    await modifierDrag(page)
    await expect.poll(async () => (await getState(page)).marquee.count).toBeGreaterThan(0)
    return (await getState(page)).marquee.count
}

test.describe('desktop held selection', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'desktop-chromium',
            'the mouse/keyboard selection driver runs on the desktop project'
        )
    })

    test('Ctrl+LMB drag holds the selection instead of committing a copy', async ({ page }) => {
        const original = await gotoWithBlueprint(page)

        const count = await selectAll(page)
        expect(count).toBeGreaterThan(1)

        const s = await getState(page)
        // The old behaviour: release spawned a paste ghost there and then. The
        // selection is now *held* — nothing on the cursor, nothing changed.
        expect(s.paint.active).toBe(false)
        expect(s.blueprint.entityCount).toBe(original)
    })

    test('Escape clears a held selection', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await page.keyboard.press('Escape')

        await expect.poll(async () => (await getState(page)).marquee.count).toBe(0)
        expect(await entityCount(page)).toBe(original)
    })

    test('a plain click outside the selection clears it', async ({ page }) => {
        await gotoWithBlueprint(page)
        await selectAll(page)

        // Well outside the blueprint's footprint: the press declines to move the
        // selection, drops it, and falls through to the ordinary pan.
        await page.mouse.click(AWAY.x, AWAY.y)

        await expect.poll(async () => (await getState(page)).marquee.count).toBe(0)
    })

    test('Ctrl+C picks the selection up at its source; a click places it, originals intact', async ({
        page,
    }) => {
        const original = await gotoWithBlueprint(page)
        const selected = await selectAll(page)

        await page.keyboard.press('Control+KeyC')

        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        const held = await getState(page)
        // Previewed *at the source*, not jumped under the cursor.
        expect(held.paint.tile).toEqual(held.paint.sourceCenter)
        expect(held.blueprint.entityCount).toBe(original) // copy leaves the originals
        expect(held.marquee.count).toBe(0) // selection consumed

        // The ghost then follows the mouse like any paste; click to drop it.
        await page.mouse.move(AWAY.x, AWAY.y)
        await page.mouse.click(AWAY.x, AWAY.y)

        await expect.poll(() => entityCount(page)).toBe(original + selected)

        await page.keyboard.press('Escape') // drop what's still on the cursor
        await page.keyboard.press('Control+KeyZ')
        await expect.poll(() => entityCount(page)).toBe(original)
    })

    test('Ctrl+X removes the originals and holds them as a ghost that places back', async ({
        page,
    }) => {
        const original = await gotoWithBlueprint(page)
        const before = await entityPositions(page)
        const selected = await selectAll(page)

        await page.keyboard.press('Control+KeyX')

        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        await expect.poll(() => entityCount(page)).toBe(original - selected)

        // The ghost previews over the source tiles, so confirming it without
        // moving restores the entities exactly where they were — "cut" reads as
        // move-in-place until you actually move it.
        await page.keyboard.press('Enter')
        await expect.poll(() => entityCount(page)).toBe(original)
        const after = await entityPositions(page)
        expect(new Set(after.map(e => `${e.name}@${e.x},${e.y}`))).toEqual(
            new Set(before.map(e => `${e.name}@${e.x},${e.y}`))
        )

        await page.keyboard.press('Escape')
        await page.keyboard.press('Control+KeyZ')
        await expect.poll(() => entityCount(page)).toBe(original - selected)
    })

    test('Delete removes the selection, and undo brings it back', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        const selected = await selectAll(page)

        await page.keyboard.press('Delete')

        await expect.poll(() => entityCount(page)).toBe(original - selected)
        expect((await getState(page)).paint.active).toBe(false) // delete holds nothing

        await page.keyboard.press('Control+KeyZ')
        await expect.poll(() => entityCount(page)).toBe(original)
    })

    test('arrow keys nudge the held selection a tile at a time', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)
        const before = (await getState(page)).marquee.origin
        expect(before).not.toBeNull()

        await page.keyboard.press('ArrowRight')

        const after = await getState(page)
        expect(after.marquee.origin).toEqual({ x: before!.x + 1, y: before!.y })
        expect(after.marquee.count).toBeGreaterThan(0) // still held
        expect(after.paint.active).toBe(false) // moved in place — no ghost
        expect(after.blueprint.entityCount).toBe(original)

        await page.keyboard.press('Control+KeyZ')
        await expect.poll(async () => (await getState(page)).marquee.origin?.x).toBe(before!.x)
    })

    test('a left-drag inside the selection moves the real entities', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)
        const before = (await getState(page)).marquee.origin
        const positionsBefore = await entityPositions(page)

        // Grab inside the selection (the blueprint is centred) and drag.
        await page.mouse.move(700, 400)
        await page.mouse.down()
        await page.mouse.move(760, 440)
        await page.mouse.move(820, 470)
        await page.mouse.up()

        const after = await getState(page)
        expect(after.marquee.origin).not.toEqual(before)
        expect(after.marquee.count).toBeGreaterThan(0) // selection survives the move
        expect(after.paint.active).toBe(false) // the *entities* moved, not a ghost
        expect(after.blueprint.entityCount).toBe(original)

        // Every entity shifted by the same whole-tile delta — a move, not a
        // re-place: the group keeps its internal layout (and its wiring).
        const dx = after.marquee.origin!.x - before!.x
        const dy = after.marquee.origin!.y - before!.y
        expect(dx !== 0 || dy !== 0).toBe(true)
        const positionsAfter = await entityPositions(page)
        expect(positionsAfter.map(e => `${e.name}@${e.x - dx},${e.y - dy}`).sort()).toEqual(
            positionsBefore.map(e => `${e.name}@${e.x},${e.y}`).sort()
        )
    })

    test('moving a wired selection keeps every wire', async ({ page }) => {
        await gotoWithBlueprint(page, WIRED_BLUEPRINT)
        await page.waitForTimeout(1000) // let the wire sprites settle before the baseline
        const before = await wireCounts(page)
        expect(before.red, JSON.stringify(before)).toBeGreaterThan(0)
        expect(before.green, JSON.stringify(before)).toBeGreaterThan(0)
        expect(before.copper, JSON.stringify(before)).toBeGreaterThan(0)
        const original = await entityCount(page)

        await selectAll(page)
        await page.mouse.move(700, 400)
        await page.mouse.down()
        await page.mouse.move(740, 430)
        await page.mouse.move(780, 460)
        await page.mouse.up()

        expect(await entityCount(page)).toBe(original)
        await page.waitForTimeout(500)
        // `moveEntitiesBy` relocates the entities themselves, so the connections
        // ride along; a cut-and-paste implementation would have dropped the ones
        // leaving the group.
        const after = await wireCounts(page)
        expect(after.red, JSON.stringify(after)).toBeGreaterThan(0)
        expect(after.green, JSON.stringify(after)).toBeGreaterThan(0)
        expect(after.copper, JSON.stringify(after)).toBeGreaterThan(0)
    })

    test('Ctrl+RMB drag still deletes what the box covers', async ({ page }) => {
        const original = await gotoWithBlueprint(page)

        await modifierDrag(page, 'right')

        await expect.poll(() => entityCount(page)).toBeLessThan(original)
        const s = await getState(page)
        expect(s.marquee.count).toBe(0) // committed, nothing held
        expect(s.paint.active).toBe(false)

        await page.keyboard.press('Control+KeyZ')
        await expect.poll(() => entityCount(page)).toBe(original)
    })

    test('Ctrl+C with no selection still copies the whole blueprint string', async ({
        page,
        context,
    }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined)
        await gotoWithBlueprint(page)

        // Nothing held: the keybind declines the key, so the browser's `copy`
        // event fires and the document handler copies the whole blueprint — the
        // arbitration that keeps exactly one of the two paths acting.
        await page.locator('#editor').focus()
        await page.keyboard.press('Control+KeyC')

        await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 15_000 })
            .toMatch(/^0e/)
        expect((await getState(page)).paint.active).toBe(false) // no ghost picked up
    })

    test('Ctrl+C with a selection puts *the selection* on the clipboard', async ({
        page,
        context,
    }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined)
        await gotoWithBlueprint(page)
        await page.evaluate(() => navigator.clipboard.writeText('sentinel'))
        await selectAll(page)

        await page.keyboard.press('Control+KeyC')

        // A blueprint string, and specifically *not* the untouched sentinel —
        // proving the selection path wrote it rather than being swallowed.
        await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 15_000 })
            .toMatch(/^0e/)
        expect((await getState(page)).paint.kind).toBe('blueprint') // ghost too
    })
})
