import { test, expect, type Page } from '@playwright/test'

// Touch box-select / marquee (#21) + the SELECT-mode polish (#33-adjacent): one
// button (Select) arms a box-select; releasing holds the selection and shows the
// SELECT controls — a nudge d-pad (move the real entities in place, preserving
// wiring) with a green Done centre, plus a Copy / Cut / Delete row. EDIT mode (a
// single tapped entity) shows a Select / Edit bar. All on the <canvas>, so assert
// via the `?test` hook (window.__FBE_TEST__). See docs/mobile-controls.md.

interface MarqueeState {
    paint: { active: boolean; kind: 'entity' | 'blueprint' | null }
    blueprint: { entityCount: number }
    marquee: { count: number; origin: { x: number; y: number } | null }
    infoPanelVisible: boolean
}

// A small multi-entity vanilla blueprint (assemblers + inserters + a belt line);
// starts with '0' so it decodes locally.
const BLUEPRINT =
    '0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx/Ahmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW+SpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM/eMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I+V8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j+GltfMAmGY+eDpPoE5RG5eU1+vk0W75Kbt8nyPrmbpl8tsiv1'

function getState(page: Page): Promise<MarqueeState> {
    return page.evaluate(() =>
        (
            window as unknown as { __FBE_TEST__: { getState: () => MarqueeState } }
        ).__FBE_TEST__.getState()
    )
}
const entityCount = async (page: Page): Promise<number> =>
    (await getState(page)).blueprint.entityCount

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

// Load the blueprint and confirm it's in. Returns the original entity count.
async function gotoWithBlueprint(page: Page): Promise<number> {
    await page.goto(`/?test&source=${encodeURIComponent(BLUEPRINT)}`)
    await waitForLoaded(page)
    await expect.poll(() => entityCount(page)).toBeGreaterThan(1)
    return entityCount(page)
}

// One-finger CDP drag. Coords are element-relative (same frame as
// locator.tap({position})): the canvas is inset by the rail, so add the #editor
// box offset. (Mirrors the placement specs' helper.)
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
    const steps = 10
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

// Tap the rail's Select button (open the ⋯ overflow first if it spilled there).
async function tapRailSelect(page: Page): Promise<void> {
    const toolbar = page.locator('#action-toolbar')
    const btn = toolbar.locator('button[title="Select"]')
    if (!(await btn.isVisible())) await toolbar.locator('button.rail-more').click({ force: true })
    await btn.click({ force: true })
}

// Force-click a button in a contextual bottom cluster. Force: the geometry is
// fixed/unobstructed, but the actionability "stable" wait is flaky under parallel
// render-loop contention (same reason the placement specs force-click).
const tapIn = (page: Page, cluster: string, title: string): Promise<void> =>
    page.locator(`#${cluster} button[title="${title}"]`).click({ force: true })

// A big box across the open canvas — covers the (centered) blueprint. Start clear
// of the left rail gutter and the top chrome.
const BOX_FROM = { x: 70, y: 180 }
const BOX_TO = { x: 380, y: 700 }

// Draw a marquee over the whole blueprint and assert it's held.
async function selectAll(page: Page): Promise<void> {
    await tapRailSelect(page)
    await dragOneFinger(page, BOX_FROM, BOX_TO)
    await expect.poll(async () => (await getState(page)).marquee.count).toBeGreaterThan(0)
    await expect(page.locator('#select-actions')).toHaveClass(/visible/)
}

test.describe('touch marquee select', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'the marquee is a mobile-only touch gesture'
        )
    })

    test('a drag after Select draws a selection and shows the controls', async ({ page }) => {
        await gotoWithBlueprint(page)
        await selectAll(page)
        // The action row offers Copy/Cut/Delete; the d-pad offers nudge + Done.
        for (const title of ['Copy', 'Cut', 'Delete']) {
            await expect(page.locator(`#select-actions button[title="${title}"]`)).toBeVisible()
        }
        for (const title of ['Up', 'Down', 'Left', 'Right', 'Done']) {
            await expect(page.locator(`#select-dpad button[title="${title}"]`)).toBeVisible()
        }
        // The box sweeps over entities; the hover/info panel must stay hidden so it
        // doesn't obscure the drawing (the panel is suppressed during select).
        expect((await getState(page)).infoPanelVisible).toBe(false)
    })

    test('the nudge d-pad moves the selection in place (entities, not a ghost)', async ({
        page,
    }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)
        const before = (await getState(page)).marquee.origin
        expect(before).not.toBeNull()

        await tapIn(page, 'select-dpad', 'Up')

        const after = await getState(page)
        expect(after.marquee.origin).toEqual({ x: before!.x, y: before!.y - 1 }) // shifted a tile
        expect(after.marquee.count).toBeGreaterThan(0) // still held
        expect(after.paint.active).toBe(false) // moved in place — no paste ghost
        expect(after.blueprint.entityCount).toBe(original) // nothing added/removed
    })

    test('Copy picks the selection up as a paste ghost, leaving the originals', async ({
        page,
    }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await tapIn(page, 'select-actions', 'Copy')

        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        expect(await entityCount(page)).toBe(original) // copy doesn't remove originals
        expect((await getState(page)).marquee.count).toBe(0) // selection consumed
    })

    test('Cut previews the ghost in place — placing it restores the originals', async ({
        page,
    }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await tapIn(page, 'select-actions', 'Cut')
        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        await expect.poll(() => entityCount(page)).toBeLessThan(original) // originals removed

        // The ghost spawns over the source tiles, so committing it without moving
        // restores the entities exactly (no collision — the originals were removed).
        await tapIn(page, 'paint-dpad', 'Place')
        await expect.poll(() => entityCount(page)).toBe(original)
    })

    test('Delete removes the selected entities', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await tapIn(page, 'select-actions', 'Delete')

        await expect.poll(() => entityCount(page)).toBeLessThan(original)
        expect((await getState(page)).paint.active).toBe(false) // delete holds nothing
    })

    test('Done drops the selection without changing anything', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await tapIn(page, 'select-dpad', 'Done')

        await expect.poll(async () => (await getState(page)).marquee.count).toBe(0)
        await expect(page.locator('#select-actions')).not.toHaveClass(/visible/)
        expect(await entityCount(page)).toBe(original)
        expect((await getState(page)).paint.active).toBe(false)
    })
})

test.describe('touch edit bar', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'the edit bar is a mobile-only touch affordance'
        )
    })

    // Tap a named entity to enter EDIT mode (its screen pos comes from the hook so
    // we don't guess coordinates).
    async function tapEntity(page: Page, name: string): Promise<void> {
        const pos = await page.evaluate(
            n =>
                (
                    window as unknown as {
                        __FBE_TEST__: { entityScreenPos: (s: string) => { x: number; y: number } }
                    }
                ).__FBE_TEST__.entityScreenPos(n),
            name
        )
        expect(pos).not.toBeNull()
        await page.locator('#editor').tap({ position: pos })
    }

    test('tapping an entity shows the Select / Edit bar', async ({ page }) => {
        await gotoWithBlueprint(page)
        await tapEntity(page, 'assembling-machine-3')

        await expect(page.locator('#edit-bar')).toHaveClass(/visible/)
        await expect(page.locator('#edit-bar button[title="Select"]')).toBeVisible()
        await expect(page.locator('#edit-bar button[title="Edit"]')).toBeVisible()
    })

    test('"Select" promotes the entity to a one-entity held selection', async ({ page }) => {
        await gotoWithBlueprint(page)
        await tapEntity(page, 'assembling-machine-3')

        await tapIn(page, 'edit-bar', 'Select')

        await expect.poll(async () => (await getState(page)).marquee.count).toBe(1)
        await expect(page.locator('#select-dpad')).toHaveClass(/visible/) // nudge applies now
    })

    test('"Edit" opens the entity editor', async ({ page }) => {
        await gotoWithBlueprint(page)
        await tapEntity(page, 'assembling-machine-3')

        await tapIn(page, 'edit-bar', 'Edit')

        await expect.poll(async () => (await getState(page)).dialogOpen).toBe(true)
    })
})
