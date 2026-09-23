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
 * Runs on `desktop-chromium` and `hybrid-chromium` (a fine pointer with a
 * touchscreen — the readouts must not flip presentation just because the
 * hardware can be touched).
 */

// The storyboard's sample blueprint: an assembler with the processing-unit
// recipe — an entity that fills every section of the sheet (stats, recipe rows,
// per-second rows) *and* routes to an editor dialog for the layering case.
const ASSEMBLER_BP =
    '0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx/Ahmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW+SpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM/eMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I+V8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j+GltfMAmGY+eDpPoE5RG5eU1+vk0W75Kbt8nyPrmbpl8tsiv1'

type HookWindow = {
    __FBE_TEST__: {
        getState: () => { blueprint: { entityCount: number }; infoPanelVisible: boolean }
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

    test('T toggles the rates drawer, below the info sheet on the right edge', async ({ page }) => {
        await gotoWithAssembler(page)

        const drawer = page.locator('#rates-drawer')
        await expect(drawer).toBeHidden()

        await page.keyboard.press('t')
        await expect(drawer).toBeVisible()
        await expect(drawer).toContainText('machine')

        const viewport = page.viewportSize()!
        const drawerBox = await drawer.boundingBox()
        expect(drawerBox.x).toBeGreaterThan(viewport.width / 2)

        // With both readouts open they stack the way the two canvas panels did:
        // info above, rates below, no overlap (the shared readout column).
        const machine = await entityPos(page, 'assembling-machine-3')
        await page.mouse.move(machine.x, machine.y - 200)
        await page.mouse.move(machine.x, machine.y)
        const sheetBox = await page.locator('#entity-info-sheet').boundingBox()
        expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual((await drawer.boundingBox()).y + 1)

        await page.keyboard.press('t')
        await expect(drawer).toBeHidden()
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

        // ...and releasing the override restores the wide stack.
        await page.evaluate(() =>
            (window as unknown as HookWindow).__FBE_TEST__.setSignals({ compact: undefined })
        )
        await expect(page.locator('body')).not.toHaveClass(/compact/)
        expect((await sheet.boundingBox()).y).toBeLessThan((await drawer.boundingBox()).y)
    })
})
