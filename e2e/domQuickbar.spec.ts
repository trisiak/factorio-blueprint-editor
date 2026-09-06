import { test, expect, type Page } from '@playwright/test'
import type { EditorTestState } from '@fbe/editor'
import { longPressOneFinger } from './touchGestures'

/**
 * The DOM quickbar (#101 Slice 5b) — one bar for every input.
 *
 * The quickbar used to be a Pixi panel that was hidden on touch, so touch users
 * had no pinned items at all. It is DOM now, rendering the editor's render-free
 * slot model (`UI/quickbarModel.ts`), and everything device-ish about it is a
 * *signal*: 44 px cells when `coarse`, number-key badges when `keys`, five
 * columns instead of ten when `compact`. The three wire toggles are pinned
 * cells on it, retiring the rail buttons that stood in for the deleted Pixi
 * wires panel — one affordance per action.
 *
 * Runs on all three projects: the same bar has to work under a mouse, under a
 * finger, and on hardware that has both.
 */

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

/** Slots seeded through the persisted key the website restores at boot. */
const SEED = ['transport-belt', 'fast-inserter', 'small-electric-pole']

type HookWindow = {
    __FBE_TEST__: {
        getState: () => EditorTestState
        quickbarItems: () => (string | null)[]
        setSignals: (next: { coarse?: boolean; compact?: boolean }) => void
    }
}

const readState = (page: Page): Promise<EditorTestState> =>
    page.evaluate(() => (window as unknown as HookWindow).__FBE_TEST__.getState())

const readItems = (page: Page): Promise<(string | null)[]> =>
    page.evaluate(() => (window as unknown as HookWindow).__FBE_TEST__.quickbarItems())

async function gotoSeeded(page: Page): Promise<void> {
    await page.addInitScript(seed => {
        window.localStorage.setItem('quickbarItemNames', JSON.stringify(seed))
    }, SEED)
    await page.goto('/?test')
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
    await expect(page.locator('#quickbar')).toBeVisible()
}

/** Activate a cell the way this project's user would. */
async function press(page: Page, cell: ReturnType<Page['locator']>): Promise<void> {
    if (isMobileProject()) await cell.tap()
    else await cell.click()
}

/** The clear gesture: right-click with a mouse, long-press with a finger. */
async function clearCell(page: Page, cell: ReturnType<Page['locator']>): Promise<void> {
    const box = await cell.boundingBox()
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    if (isMobileProject()) {
        await longPressOneFinger(page, at)
        return
    }
    await page.mouse.click(at.x, at.y, { button: 'right' })
}

test.describe('DOM quickbar (#101 Slice 5b)', () => {
    test('renders the seeded slots and the wire cells, sized by `coarse`', async ({ page }) => {
        await gotoSeeded(page)

        const slots = page.locator('#quickbar .qb-slot')
        const state = await readState(page)
        expect(state.quickbar.visible).toBe(true)
        // Every slot the layout shows is a real cell: ten per row when wide,
        // five when compact (the emulated phone).
        expect(state.quickbar.slotCount).toBe(await slots.count())
        expect(state.quickbar.slotCount).toBe(isMobileProject() ? 10 : 20)

        // The persisted items landed in the first slots, in order.
        expect((await readItems(page)).slice(0, SEED.length)).toEqual(SEED)
        await expect(slots.first()).toHaveAttribute('title', SEED[0])

        // Three wire cells ride along — the affordance the rail used to carry.
        for (const label of ['Copper', 'Red wire', 'Green wire']) {
            await expect(page.locator(`#quickbar button[title="${label}"]`)).toBeVisible()
        }

        // Hit-target size follows the primary pointer, not the device: 44 px on
        // the coarse project, 36 px where a mouse is the primary pointer.
        const box = await slots.first().boundingBox()
        expect(Math.round(box.width)).toBe(isMobileProject() ? 44 : 36)

        // Keybind badges only where a keyboard exists (`keys`).
        const badge = slots.first().locator('.qb-key')
        if (isMobileProject()) await expect(badge).toBeHidden()
        else await expect(badge).toHaveText('1')
    })

    test('a click/tap on a slot holds its item; the clear gesture empties it', async ({ page }) => {
        await gotoSeeded(page)
        const slot = page.locator('#quickbar .qb-slot').first()

        await press(page, slot)
        const held = await readState(page)
        expect(held.paint.active).toBe(true)
        expect(held.paint.kind).toBe('entity')

        // On a compact viewport the PAINT cluster owns the bottom band, so the
        // bar yields it rather than overlapping (the band contract) — the rail's
        // Cancel is the way out from there.
        if (isMobileProject()) {
            await expect.poll(async () => (await readState(page)).quickbar.visible).toBe(false)
            await page.locator('#action-toolbar button[title="Cancel"]').tap()
        } else {
            await page.keyboard.press('Escape')
        }
        await expect.poll(async () => (await readState(page)).paint.active).toBe(false)
        await expect(page.locator('#quickbar')).toBeVisible()

        await clearCell(page, slot)
        await expect.poll(async () => (await readItems(page))[0]).toBeNull()
        // Clearing one slot leaves its neighbour alone.
        expect((await readItems(page))[1]).toBe(SEED[1])
    })

    test('the number keys hold the matching slot', async ({ page }) => {
        test.skip(isMobileProject(), 'no keyboard on the emulated phone')
        await gotoSeeded(page)

        await page.locator('#editor').focus()
        await page.keyboard.press('1')
        await expect.poll(async () => (await readState(page)).paint.active).toBe(true)

        // The same key drops it again — a toggle, as in the game.
        await page.keyboard.press('1')
        await expect.poll(async () => (await readState(page)).paint.active).toBe(false)
    })

    test('the wire cells toggle a wire cursor', async ({ page }) => {
        await gotoSeeded(page)
        const red = page.locator('#quickbar button[title="Red wire"]')

        await press(page, red)
        const held = await readState(page)
        expect(held.paint.active).toBe(true)
        // A wire cursor is neither an entity/blueprint ghost nor a tile brush.
        expect(held.paint.kind).toBeNull()
        expect(held.paint.tileSize).toBeNull()

        if (isMobileProject()) {
            // Compact: the bar has yielded the band, so the rail's Cancel is the
            // way out — the wire toggle is not reachable while a cluster is up.
            await expect.poll(async () => (await readState(page)).quickbar.visible).toBe(false)
            await page.locator('#action-toolbar button[title="Cancel"]').tap()
        } else {
            await red.click() // toggle semantics: the same cell drops the wire
        }
        await expect.poll(async () => (await readState(page)).paint.active).toBe(false)
    })

    test('reflows to five columns when `compact`, and 44 px cells when `coarse`', async ({
        page,
    }) => {
        test.skip(isMobileProject(), 'already compact + coarse; the overrides are for wide pages')
        await gotoSeeded(page)

        const wide = await readState(page)
        expect(wide.quickbar.slotCount).toBe(20)

        // Placement and sizing are signals, so a wide page can be *made* to
        // render the phone layout — no input-mode switch involved.
        await page.evaluate(() =>
            (window as unknown as HookWindow).__FBE_TEST__.setSignals({ compact: true })
        )
        await expect.poll(async () => (await readState(page)).quickbar.slotCount).toBe(10)

        await page.evaluate(() =>
            (window as unknown as HookWindow).__FBE_TEST__.setSignals({ coarse: true })
        )
        const cell = await page.locator('#quickbar .qb-slot').first().boundingBox()
        expect(Math.round(cell.width)).toBe(44)

        await page.evaluate(() =>
            (window as unknown as HookWindow).__FBE_TEST__.setSignals({
                compact: undefined,
                coarse: undefined,
            })
        )
        await expect.poll(async () => (await readState(page)).quickbar.slotCount).toBe(20)
    })

    test('keeps clear of the rail, and reserves its band on the canvas', async ({ page }) => {
        await gotoSeeded(page)

        const bar = await page.locator('#quickbar').boundingBox()
        const rail = await page.locator('#action-toolbar').boundingBox()
        // Bounds disjointness: the rail owns the left column, the quickbar the
        // bottom-centre band, and the two must not overlap in any layout.
        const overlaps =
            bar.x < rail.x + rail.width &&
            rail.x < bar.x + bar.width &&
            bar.y < rail.y + rail.height &&
            rail.y < bar.y + bar.height
        expect(overlaps).toBe(false)

        // The band is reserved on `G.safeArea` (the bottom inset), so the Pixi
        // dialogs that centre and clamp within it stay off the bar.
        const state = await readState(page)
        expect(state.safeArea.y + state.safeArea.height).toBeLessThanOrEqual(bar.y + 1)
    })
})
