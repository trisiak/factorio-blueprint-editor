import { test, expect, type Page } from '@playwright/test'

// Single-entity flip + the Factorio 2.0 `mirror` property (#55). Flipping a held
// *chiral* building (fluidboxes — oil refinery) toggles its `mirror` flag in
// place (direction unchanged); a *directional* entity (belt) flips via direction
// and never gets `mirror` (so it isn't double-transformed when rendered). The
// flag rides through placement → serialize (export-correctness). Asserted via the
// `?test` hook. See docs/mobile-controls.md.

interface PaintState {
    paint: { active: boolean; direction: number | null; mirror: boolean | null }
    blueprint: { entityCount: number }
}

function getState(page: Page): Promise<PaintState> {
    return page.evaluate(() =>
        (
            window as unknown as { __FBE_TEST__: { getState: () => PaintState } }
        ).__FBE_TEST__.getState()
    )
}
const entityMirror = (page: Page, name: string): Promise<boolean | null> =>
    page.evaluate(
        n =>
            (
                window as unknown as {
                    __FBE_TEST__: { entityMirror: (s: string) => boolean | null }
                }
            ).__FBE_TEST__.entityMirror(n),
        name
    )

// Tap a placed entity to enter EDIT mode (hover + edit-bar), the editor's touch
// select. Uses the test hook for a deterministic screen position.
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

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

// Boot in mobile mode holding `item` (quickbar slot 1 → paint).
async function gotoHolding(page: Page, item: string): Promise<void> {
    await page.addInitScript(seed => {
        window.localStorage.setItem('quickbarItemNames', JSON.stringify([seed]))
    }, item)
    await page.goto('/?test')
    await waitForLoaded(page)
    await page.locator('#editor').focus()
    await page.keyboard.press('1')
    await expect.poll(async () => (await getState(page)).paint.active).toBe(true)
}

const flipH = (page: Page): Promise<void> =>
    page.locator('#action-toolbar button[title="Flip H"]').click({ force: true })

test.describe('single-entity flip + mirror', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'driven through the mobile action rail'
        )
    })

    test('flipping a held refinery toggles mirror in place (chiral)', async ({ page }) => {
        await gotoHolding(page, 'oil-refinery')

        // Flip is offered for a chiral building.
        await expect(page.locator('#action-toolbar button[title="Flip H"]')).toBeVisible()
        const before = await getState(page)
        expect(before.paint.mirror).toBe(false)

        await flipH(page)
        const after = await getState(page)
        expect(after.paint.mirror).toBe(true) // chirality toggled
        expect(after.paint.direction).toBe(before.paint.direction) // not a rotation

        await flipH(page)
        expect((await getState(page)).paint.mirror).toBe(false) // toggles back
    })

    test('flipping a held belt uses direction, never mirror (directional)', async ({ page }) => {
        await gotoHolding(page, 'transport-belt')
        // Rotate to a horizontal orientation so a horizontal flip actually changes
        // the facing (a vertical belt is symmetric under flip-H).
        await page.locator('#action-toolbar button[title="Rotate"]').click({ force: true })
        const before = await getState(page)

        await flipH(page)
        const after = await getState(page)
        expect(after.paint.mirror).toBe(false) // belts never get a mirror flag
        expect(after.paint.direction).not.toBe(before.paint.direction) // flipped via direction
    })

    test('a flipped refinery keeps its mirror flag once placed (round-trips)', async ({ page }) => {
        await gotoHolding(page, 'oil-refinery')
        await flipH(page)
        expect((await getState(page)).paint.mirror).toBe(true)

        // Place it (tap to preview, tap same tile to commit), then read the placed
        // entity's mirror — serialize spreads the raw entity, so this is the
        // export-correctness signal.
        const TILE = { x: 240, y: 480 }
        await page.locator('#editor').tap({ position: TILE })
        await page.locator('#editor').tap({ position: TILE })
        await expect.poll(() => entityMirror(page, 'oil-refinery')).toBe(true)
    })

    test('flipping a *placed* refinery in EDIT mirrors it in place (#55)', async ({ page }) => {
        // Place an un-flipped refinery, then drop the cursor so a tap edits it.
        await gotoHolding(page, 'oil-refinery')
        const TILE = { x: 240, y: 480 }
        await page.locator('#editor').tap({ position: TILE })
        await page.locator('#editor').tap({ position: TILE })
        await expect.poll(() => entityMirror(page, 'oil-refinery')).toBe(false)
        await page.keyboard.press('Escape')
        await expect.poll(async () => (await getState(page)).paint.active).toBe(false)

        // Tap it → EDIT mode → the rail offers Flip for the chiral building.
        await tapEntity(page, 'oil-refinery')
        await expect(page.locator('#action-toolbar button[title="Flip H"]')).toBeVisible()

        await flipH(page)
        // The placed entity is mirrored in place (same entity, wires preserved).
        await expect.poll(() => entityMirror(page, 'oil-refinery')).toBe(true)
    })
})
