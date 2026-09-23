import { test, expect, type Page } from '@playwright/test'

/**
 * The status readouts are DOM for **every** input (#101 Slice 5).
 *
 * Entity info and production rates used to be a split affordance: Pixi panels
 * on desktop, DOM sheets on touch, chosen by `inputMode.mode`. Both panels are
 * retired — the editor now only computes (`buildEntityInfo` / `RatesModel`) and
 * the website renders, with placement decided by the `compact` signal and
 * orientation. This spec is the desktop/hybrid half of that ratchet (the touch
 * placements stay asserted in `panels.spec.ts` / `rates.spec.ts`): a mouse
 * hover must fill the sheet, `T` must open the drawer, both must live on the
 * right edge, both must yield to a Pixi dialog, and forcing `compact` must move
 * them to the touch placements without any input-mode switch.
 *
 * The wide placement changed after the Slice 5 review: the two readouts no
 * longer stack in a shared column (which made the drawer jump on every hover)
 * but take opposite corners of the right edge, and the drawer grows into the
 * space it has instead of stopping at half the viewport. The three review
 * findings each own a test below — a *stationary* drawer, a growing one, and a
 * wheel that can't bleed from the drawer into the canvas' zoom.
 *
 * Runs on `desktop-chromium` and `hybrid-chromium` (a fine pointer with a
 * touchscreen — the readouts must not flip presentation just because the
 * hardware can be touched).
 */

// The storyboard's sample blueprint: an assembler with the processing-unit
// recipe — an entity that fills every section of the sheet (stats, recipe rows,
// per-second rows) *and* routes to an editor dialog for the layering case.
const ASSEMBLER_BP =
    '0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx/Ahmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW+SpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM/eMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I+V8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j+GltfMAmGY+eDpPoE5RG5eU1+vk0W75Kbt8nyPrmbpl8tsiv1'

// A rates-heavy blueprint for the "let it grow" case: ten assembler recipes, a
// row of chemical plants and a row of furnaces — ~30 distinct items, so the
// drawer's content is taller than half a 1400 px viewport but still fits the
// space the wide layout now gives it. (Generated, then pinned here like every
// other fixture in this suite.)
const RATES_HEAVY_BP =
    '0eNqdlNlu6yAQQP+FZyPVS1Lbv3JVVWMyddDFgACntaL8e8du1TY1WeiLJaPhHGCWI+vUiNZJHVh7ZDLgwNofaxlT0KGiNQcBPd8jHCZaPaDz0mjWbrZFUzXNpqyKvMyLjElhtGftvyPzstegZmyYLBJioWdMwzD/gfc4dErqng8g9lIjL9mJAHqHb6zNT08ZQx1kkPjBW36mZz0OHToKuE7KmDWeNs+HPDICPmRsoi8ZHAq5HMg6I9D7eeOoZSD7ylIkWqq1BXYH0AJ3XEgnxrimTNTUaw0qFMEZLcU1UZUomlP62yTJwnsEx1/3SMUR0WxSNdu1Rhhr0XEBncKYY5voKCIVgLqfoy9l/zFVUV3KC2XlhqtOdUVqAMZgBpiDuBcSqeq4BfE/pmv+1D7VT5syvfSBbnbLlT/8qYvOZGKPgxSgbsu+B8PXHqtgGWbRLjrTUORypQ5cFF7cDf/snDO6H9XLGAeX94O3a3AHIaCbouTqbnIRS/LYUfHO4TH25n52JKf4ZhVFHWjAx+DfDf7VQ/R6GgRe7IZqNafoOCE6PvLHBPzHw9SR8XSZXyfwqzXfB5qtV/BNAr6O4Q313pxb6qKn0+kdhj+xoA=='

type HookWindow = {
    __FBE_TEST__: {
        getState: () => {
            blueprint: { entityCount: number }
            infoPanelVisible: boolean
            viewportScale: number
        }
        entityScreenPos: (name: string) => { x: number; y: number } | null
        openEntityEditor: (name: string) => boolean
        closeDialogs: () => void
        setSignals: (next: { coarse?: boolean; compact?: boolean }) => void
    }
}

const readState = (page: Page) =>
    page.evaluate(() => (window as unknown as HookWindow).__FBE_TEST__.getState())

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

async function gotoWithAssembler(page: Page): Promise<void> {
    await page.goto(`/?test&source=${encodeURIComponent(ASSEMBLER_BP)}`)
    await waitForAppReady(page)
    await expect
        .poll(async () => (await readState(page)).blueprint.entityCount, { timeout: 30_000 })
        .toBeGreaterThan(0)
}

/** Screen position of an entity, for a real mouse hover (no guessed coordinates). */
async function entityPos(page: Page, name: string): Promise<{ x: number; y: number }> {
    const p = await page.evaluate(
        n => (window as unknown as HookWindow).__FBE_TEST__.entityScreenPos(n),
        name
    )
    expect(p, `entity ${name} on screen`).not.toBeNull()
    return p
}

test.describe('DOM readouts (#101 Slice 5)', () => {
    // Mouse-driven throughout (hover, the T keybind), so the emulated phone has
    // nothing to contribute here — its placements are the compact ones asserted
    // in panels.spec.ts / rates.spec.ts.
    test.beforeEach(() => {
        test.skip(test.info().project.name === 'mobile-chromium', 'mouse + keyboard driven')
    })

    test('a mouse hover fills the entity-info sheet, top-right; hover-out clears it', async ({
        page,
    }) => {
        await gotoWithAssembler(page)

        const sheet = page.locator('#entity-info-sheet')
        await expect(sheet).toBeHidden()

        const machine = await entityPos(page, 'assembling-machine-3')
        // Come from empty space so the move actually crosses onto the entity.
        const empty = { x: machine.x, y: Math.max(2, machine.y - 200) }
        await page.mouse.move(empty.x, empty.y)
        await page.mouse.move(machine.x, machine.y)

        await expect(sheet).toBeVisible()
        // What the retired canvas panel showed: the localised name, the effect
        // stats, and the recipe rows (icons where the pack sheet has them).
        await expect(sheet.locator('.eis-name')).not.toBeEmpty()
        await expect(sheet).toContainText('Crafting speed')
        await expect(sheet).toContainText('Recipe:')
        await expect(sheet).toContainText('Per second:')

        // Right edge, clear of the rail's column on the left.
        const viewport = page.viewportSize()!
        const box = await sheet.boundingBox()
        expect(box.x).toBeGreaterThan(viewport.width / 2)
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)

        // Hover out → the readout clears (it's passive: no state of its own).
        await page.mouse.move(empty.x, empty.y)
        await expect(sheet).toBeHidden()
        expect((await readState(page)).infoPanelVisible).toBe(false)
    })

    // Ratchet rewritten after the Slice 5 review: this used to assert the two
    // readouts *stacked* (sheet above drawer, no overlap, one shared column).
    // That stack was the bug — the sheet's height fed the drawer's offset, so
    // the drawer moved on every hover. The pin below is the opposite claim.
    test('T toggles the rates drawer, pinned to the bottom-right corner', async ({ page }) => {
        await gotoWithAssembler(page)

        const drawer = page.locator('#rates-drawer')
        await expect(drawer).toBeHidden()

        await page.keyboard.press('t')
        await expect(drawer).toBeVisible()
        await expect(drawer).toContainText('machine')

        // Bottom-right: right of centre, and its bottom edge in the lower
        // quarter — above the quickbar's band, which it must not overlap.
        const viewport = page.viewportSize()!
        const drawerBox = await drawer.boundingBox()
        expect(drawerBox.x).toBeGreaterThan(viewport.width / 2)
        expect(drawerBox.x + drawerBox.width).toBeLessThanOrEqual(viewport.width)
        expect(drawerBox.y + drawerBox.height).toBeGreaterThan(viewport.height * 0.75)
        const quickbar = await page.locator('#quickbar').boundingBox()
        if (quickbar) expect(drawerBox.y + drawerBox.height).toBeLessThanOrEqual(quickbar.y + 1)

        // The sheet keeps the *top* of the same edge, so both can be open.
        const machine = await entityPos(page, 'assembling-machine-3')
        await page.mouse.move(machine.x, machine.y - 200)
        await page.mouse.move(machine.x, machine.y)
        const sheetBox = await page.locator('#entity-info-sheet').boundingBox()
        expect(sheetBox.y).toBeLessThan(drawerBox.y)

        await page.keyboard.press('t')
        await expect(drawer).toBeHidden()
    })

    test('the drawer does not move when a hover opens and clears the info sheet', async ({
        page,
    }) => {
        await gotoWithAssembler(page)

        const drawer = page.locator('#rates-drawer')
        const sheet = page.locator('#entity-info-sheet')
        await page.keyboard.press('t')
        await expect(drawer).toBeVisible()
        await expect(sheet).toBeHidden()

        // The review finding, as an assertion: the sheet appears and clears on
        // every hover, and while it was stacked above the drawer each of those
        // shifted the drawer down or up under the mouse aiming at it. Same box
        // before, during and after the hover, to the pixel.
        const before = await drawer.boundingBox()

        const machine = await entityPos(page, 'assembling-machine-3')
        const empty = { x: machine.x, y: Math.max(2, machine.y - 200) }
        await page.mouse.move(empty.x, empty.y)
        await page.mouse.move(machine.x, machine.y)
        await expect(sheet).toBeVisible()
        expect(await drawer.boundingBox()).toEqual(before)

        await page.mouse.move(empty.x, empty.y)
        await expect(sheet).toBeHidden()
        expect(await drawer.boundingBox()).toEqual(before)
    })

    test('on a tall viewport the drawer grows past half the screen instead of scrolling', async ({
        page,
    }) => {
        // 1400 px of height with a rates-heavy blueprint: the old
        // `min(50vh, 420px)` cap would have scrolled ~700 px of content behind
        // a 420 px window for no reason (#101 Slice 5 review).
        await page.setViewportSize({ width: 1280, height: 1400 })
        await page.goto(`/?test&source=${encodeURIComponent(RATES_HEAVY_BP)}`)
        await waitForAppReady(page)
        await expect
            .poll(async () => (await readState(page)).blueprint.entityCount, { timeout: 30_000 })
            .toBeGreaterThan(0)

        const drawer = page.locator('#rates-drawer')
        await page.keyboard.press('t')
        await expect(drawer).toBeVisible()
        await expect(drawer).toContainText('Ingredients')

        const viewport = page.viewportSize()!
        const box = await drawer.boundingBox()
        expect(box.height).toBeGreaterThan(viewport.height / 2)
        // It still starts below the top chrome band and ends above the quickbar.
        expect(box.y).toBeGreaterThanOrEqual(56)
        const quickbar = await page.locator('#quickbar').boundingBox()
        if (quickbar) expect(box.y + box.height).toBeLessThanOrEqual(quickbar.y + 1)

        // ...and it isn't scrolling: the content fits the space it was given.
        const scroll = await drawer.evaluate((el: HTMLElement) => ({
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
        }))
        expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight + 1)

        // Shrink the viewport and the same content *does* scroll — the cap is
        // "the space available", not a fixed height.
        await page.setViewportSize({ width: 1280, height: 600 })
        await expect
            .poll(async () =>
                drawer.evaluate((el: HTMLElement) => el.scrollHeight > el.clientHeight + 1)
            )
            .toBe(true)
    })

    test('a wheel over the drawer never bleeds into the canvas zoom', async ({ page }) => {
        await gotoWithAssembler(page)

        const drawer = page.locator('#rates-drawer')
        await page.keyboard.press('t')
        await expect(drawer).toBeVisible()
        const box = await drawer.boundingBox()

        // Baseline: a real wheel over the canvas, with no overlay involved,
        // zooms exactly as it always did. Zoom *in* — zooming out clamps at the
        // fit-to-viewport scale a small blueprint already starts at — and pick a
        // point the DOM chrome doesn't cover (the settings pane owns the upper
        // left; the readouts and the quickbar own the right and bottom edges).
        const canvas = { x: 640, y: 300 }
        const start = (await readState(page)).viewportScale
        await page.mouse.move(canvas.x, canvas.y)
        await page.mouse.wheel(0, -120)
        await expect.poll(async () => (await readState(page)).viewportScale > start).toBe(true)

        // The bug: macOS keeps emitting `wheel` after the flick ends, so the
        // tail of a drawer scroll lands on the canvas and zooms it. Both events
        // are dispatched from one `evaluate`, which is the only way to *know*
        // the second one falls inside the 300 ms ownership window — a
        // round-tripped `page.mouse.wheel` pair would race the guard.
        const guarded = await page.evaluate(
            ([dx, dy]) => {
                const wheel = (target: EventTarget, x: number, y: number): void => {
                    target.dispatchEvent(
                        new WheelEvent('wheel', {
                            deltaY: -120,
                            clientX: x,
                            clientY: y,
                            bubbles: true,
                            cancelable: true,
                        })
                    )
                }
                wheel(document.getElementById('rates-drawer'), dx, dy)
                // `#editor` *is* the Pixi canvas; a native wheel on it is what
                // Pixi's EventSystem listens for and maps to the container.
                wheel(document.getElementById('editor'), 640, 300)
                return true
            },
            [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)]
        )
        expect(guarded).toBe(true)

        const held = (await readState(page)).viewportScale
        await page.waitForTimeout(150)
        expect((await readState(page)).viewportScale).toBe(held)

        // ...and once the window elapses the very same synthetic wheel zooms —
        // which is what makes the assertion above mean "blocked", not "inert".
        await page.waitForTimeout(400)
        await page.evaluate(() => {
            document.getElementById('editor').dispatchEvent(
                new WheelEvent('wheel', {
                    deltaY: -120,
                    clientX: 640,
                    clientY: 300,
                    bubbles: true,
                    cancelable: true,
                })
            )
        })
        await expect.poll(async () => (await readState(page)).viewportScale > held).toBe(true)
    })

    test('a Pixi dialog eclipses both readouts; closing it restores them', async ({ page }) => {
        await gotoWithAssembler(page)

        const sheet = page.locator('#entity-info-sheet')
        const drawer = page.locator('#rates-drawer')

        const machine = await entityPos(page, 'assembling-machine-3')
        await page.mouse.move(machine.x, machine.y - 200)
        await page.mouse.move(machine.x, machine.y)
        await page.keyboard.press('t')
        await expect(sheet).toBeVisible()
        await expect(drawer).toBeVisible()

        // The layering contract (#89) is no longer touch-only: DOM composites
        // above the canvas on every platform, so the readouts yield while a
        // dialog is open or its controls are unreachable.
        const opened = await page.evaluate(() =>
            (window as unknown as HookWindow).__FBE_TEST__.openEntityEditor('assembling-machine-3')
        )
        expect(opened).toBe(true)
        await expect(sheet).toBeHidden()
        await expect(drawer).toBeHidden()

        await page.evaluate(() => (window as unknown as HookWindow).__FBE_TEST__.closeDialogs())
        await expect(drawer).toBeVisible()
    })

    test('forcing `compact` moves the readouts to the touch placements', async ({ page }) => {
        await gotoWithAssembler(page)

        const sheet = page.locator('#entity-info-sheet')
        const drawer = page.locator('#rates-drawer')
        const machine = await entityPos(page, 'assembling-machine-3')
        await page.mouse.move(machine.x, machine.y - 200)
        await page.mouse.move(machine.x, machine.y)
        await page.keyboard.press('t')
        await expect(sheet).toBeVisible()
        await expect(drawer).toBeVisible()

        const wideSheet = await sheet.boundingBox()
        const wideDrawer = await drawer.boundingBox()
        expect(wideSheet.y).toBeLessThan(wideDrawer.y)

        // Placement is a *signal*, not a device: pinning `compact` (as a narrow
        // window would) swaps them into the compact-landscape layout — the
        // toggled overview takes the top-right, the passive readout the bottom
        // — with no input-mode switch anywhere.
        await page.evaluate(() =>
            (window as unknown as HookWindow).__FBE_TEST__.setSignals({ compact: true })
        )
        await expect(page.locator('body')).toHaveClass(/compact/)

        const compactSheet = await sheet.boundingBox()
        const compactDrawer = await drawer.boundingBox()
        expect(compactDrawer.y).toBeLessThan(compactSheet.y)
        const viewport = page.viewportSize()!
        expect(compactSheet.y + compactSheet.height).toBeGreaterThan(viewport.height / 2)

        // ...and releasing the override restores the wide placement (sheet top,
        // drawer bottom — no longer a stack, see the review note above).
        await page.evaluate(() =>
            (window as unknown as HookWindow).__FBE_TEST__.setSignals({ compact: undefined })
        )
        await expect(page.locator('body')).not.toHaveClass(/compact/)
        expect((await sheet.boundingBox()).y).toBeLessThan((await drawer.boundingBox()).y)
    })
})
