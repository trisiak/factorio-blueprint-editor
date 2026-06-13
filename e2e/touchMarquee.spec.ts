import { test, expect, type Page } from '@playwright/test'

// Touch box-select / marquee (#21). One button (Select) arms the gesture; a
// one-finger drag draws a selection box; releasing holds the selection and shows
// a Copy / Cut / Delete bar. Copy → paste ghost (originals stay); Cut → ghost +
// remove originals; Delete → remove. Everything's on the <canvas>, so assert via
// the `?test` hook (window.__FBE_TEST__). See docs/mobile-controls.md.

interface MarqueeState {
    paint: { active: boolean; kind: 'entity' | 'blueprint' | null }
    blueprint: { entityCount: number }
    marquee: { count: number }
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
async function tapSelect(page: Page): Promise<void> {
    const toolbar = page.locator('#action-toolbar')
    const btn = toolbar.locator('button[title="Select"]')
    if (!(await btn.isVisible())) await toolbar.locator('button.rail-more').click({ force: true })
    await btn.click({ force: true })
}

// Tap a button in the marquee action bar. Force-click: the geometry is fixed and
// unobstructed, but the actionability "stable" wait is flaky under parallel
// render-loop contention (same reason the placement specs force-click).
async function tapMarquee(page: Page, title: string): Promise<void> {
    await page.locator(`#marquee-bar button[title="${title}"]`).click({ force: true })
}

// Tap a button in the paint d-pad (shown after Copy/Cut spawns a ghost).
async function tapDpad(page: Page, title: string): Promise<void> {
    await page.locator(`#paint-dpad button[title="${title}"]`).click({ force: true })
}

// A big box across the open canvas — covers the (centered) blueprint. Start clear
// of the left rail gutter and the top chrome.
const BOX_FROM = { x: 70, y: 180 }
const BOX_TO = { x: 380, y: 700 }

// Draw a marquee over the whole blueprint and assert it's held.
async function selectAll(page: Page): Promise<void> {
    await tapSelect(page)
    await dragOneFinger(page, BOX_FROM, BOX_TO)
    await expect.poll(async () => (await getState(page)).marquee.count).toBeGreaterThan(0)
    await expect(page.locator('#marquee-bar')).toHaveClass(/visible/)
}

test.describe('touch marquee select', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'the marquee is a mobile-only touch gesture'
        )
    })

    test('a drag after Select draws a selection and shows the action bar', async ({ page }) => {
        await gotoWithBlueprint(page)
        await selectAll(page)
        // The action bar exposes the three choices.
        for (const title of ['Copy', 'Cut', 'Delete', 'Cancel']) {
            await expect(page.locator(`#marquee-bar button[title="${title}"]`)).toBeVisible()
        }
        // The box sweeps over entities; the hover/info panel must stay hidden so it
        // doesn't obscure the drawing (the panel is suppressed during select).
        expect((await getState(page)).infoPanelVisible).toBe(false)
    })

    test('Copy picks the selection up as a paste ghost, leaving the originals', async ({
        page,
    }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await tapMarquee(page, 'Copy')

        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        expect(await entityCount(page)).toBe(original) // copy doesn't remove originals
        expect((await getState(page)).marquee.count).toBe(0) // selection consumed
    })

    test('Cut removes the originals and picks them up', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await tapMarquee(page, 'Cut')

        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        await expect.poll(() => entityCount(page)).toBeLessThan(original) // originals removed
    })

    test('Cut previews the ghost in place — placing it restores the originals', async ({
        page,
    }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await tapMarquee(page, 'Cut')
        await expect.poll(() => entityCount(page)).toBeLessThan(original)

        // The ghost spawns over the source tiles, so committing it without moving
        // puts the cut entities back exactly where they were (no collision, since
        // the originals were removed) — the count returns to the original.
        await tapDpad(page, 'Place')
        await expect.poll(() => entityCount(page)).toBe(original)
    })

    test('Delete removes the selected entities', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await tapMarquee(page, 'Delete')

        await expect.poll(() => entityCount(page)).toBeLessThan(original)
        expect((await getState(page)).paint.active).toBe(false) // delete holds nothing
    })

    test('Cancel drops the selection without changing anything', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await tapMarquee(page, 'Cancel')

        await expect.poll(async () => (await getState(page)).marquee.count).toBe(0)
        await expect(page.locator('#marquee-bar')).not.toHaveClass(/visible/)
        expect(await entityCount(page)).toBe(original)
        expect((await getState(page)).paint.active).toBe(false)
    })
})
