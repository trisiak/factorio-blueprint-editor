import { test, expect, type Locator, type Page } from '@playwright/test'
import { dragOneFinger } from './touchGestures'

/**
 * Editor-state-driven contextual clusters (#101 Slice 3).
 *
 * The bottom-band clusters used to be gated `mobile && mode === EditorMode.X`.
 * The mode half was the real condition; the device half was an accident of the
 * clusters having been built for touch. Now:
 *
 * - the **SELECT** cluster shows whenever a selection is *held* — for everyone,
 *   since a mouse can hold one too (Slice 2). Only its *placement* is a device
 *   question: a coarse pointer keeps the bottom band, a fine one gets the same
 *   component anchored to the selection's screen box, with keybind hints;
 * - the **PAINT** d-pad and the **EDIT** bar stay touch affordances, expressed
 *   as `touchRecent` rather than as a device: a mouse user with a keyboard never
 *   sees them, and they appear the moment the screen is touched.
 *
 * Coverage runs on `desktop-chromium` (the fine-pointer placement), on
 * `hybrid-chromium` (both drivers on one page — the appear/disappear behaviour)
 * and on `mobile-chromium` (the ratchet: the bottom band, unchanged).
 */

interface ClusterState {
    signals: { coarse: boolean; keys: boolean; compact: boolean; touchRecent: boolean }
    blueprint: { entityCount: number }
    paint: { active: boolean; kind: 'entity' | 'blueprint' | null }
    marquee: {
        count: number
        origin: { x: number; y: number } | null
        direction: number | null
        screenBounds: { x: number; y: number; width: number; height: number } | null
    }
    infoPanelVisible: boolean
}

interface ClusterHook {
    getState: () => ClusterState
    entityScreenPos: (name: string) => { x: number; y: number } | null
    spawnPasteGhost: () => boolean
    setSignals: (next: { coarse?: boolean; compact?: boolean }) => void
}

/** The multi-entity vanilla blueprint the marquee specs share (decodes locally). */
const BLUEPRINT =
    '0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx/Ahmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW+SpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM/eMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I+V8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j+GltfMAmGY+eDpPoE5RG5eU1+vk0W75Kbt8nyPrmbpl8tsiv1'

const getState = (page: Page): Promise<ClusterState> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: ClusterHook }).__FBE_TEST__.getState()
    )

const entityCount = async (page: Page): Promise<number> =>
    (await getState(page)).blueprint.entityCount

const selectionBounds = async (
    page: Page
): Promise<{ x: number; y: number; width: number; height: number }> => {
    const b = (await getState(page)).marquee.screenBounds
    expect(b).not.toBeNull()
    return b!
}

const entityPos = (page: Page, name: string): Promise<{ x: number; y: number } | null> =>
    page.evaluate(
        n => (window as unknown as { __FBE_TEST__: ClusterHook }).__FBE_TEST__.entityScreenPos(n),
        name
    )

const setSignals = (page: Page, next: { coarse?: boolean; compact?: boolean }): Promise<void> =>
    page.evaluate(
        n => (window as unknown as { __FBE_TEST__: ClusterHook }).__FBE_TEST__.setSignals(n),
        next
    )

/**
 * Pin the *primary pointer* fine while touch stays enabled — the B1 hardware
 * (touchscreen laptop / Surface). Chromium ties `(pointer: coarse)` to its touch
 * emulation and offers no way to separate them, so the signal is pinned through
 * the `?test` override, exactly as `hybridInput.spec.ts` does. Everything
 * downstream (the derived mode, the body classes, the clusters) then runs for
 * real off that signal.
 */
const pinFinePointer = (page: Page): Promise<void> => setSignals(page, { coarse: false })

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

/** Load the shared blueprint, focus the canvas, zoom out so a box can span it. */
async function gotoWithBlueprint(page: Page, zoomOut = 5): Promise<number> {
    await page.goto(`/?test&source=${encodeURIComponent(BLUEPRINT)}`)
    await waitForLoaded(page)
    await expect.poll(() => entityCount(page)).toBeGreaterThan(1)
    await page.locator('#editor').focus()
    if (zoomOut > 0) {
        await page.mouse.move(700, 400)
        for (let i = 0; i < zoomOut; i++) await page.mouse.wheel(0, 120)
    }
    return entityCount(page)
}

/** Desktop viewport coordinates clear of the top-left stack and the quickbar. */
const BOX_FROM = { x: 380, y: 190 }
const BOX_TO = { x: 1100, y: 520 }

/** `Ctrl+LMB` drag — the mouse driver's "hold what this box catches". */
async function ctrlDrag(page: Page, from = BOX_FROM, to = BOX_TO): Promise<void> {
    await page.keyboard.down('Control')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2)
    await page.mouse.move(to.x, to.y)
    await page.mouse.up()
    await page.keyboard.up('Control')
}

/** Hold a selection over the whole blueprint; returns how many entities it caught. */
async function selectAll(page: Page): Promise<number> {
    await ctrlDrag(page)
    await expect.poll(async () => (await getState(page)).marquee.count).toBeGreaterThan(0)
    return (await getState(page)).marquee.count
}

/**
 * Hold *one* entity: a box a few pixels across, centred on a named entity. At
 * the default zoom a 3×3 assembler is ~100px on screen, so a 8px box inside it
 * can't reach its neighbours — which is what makes the single-entity gates
 * (Rotate) deterministic.
 */
async function selectOne(page: Page, name = 'assembling-machine-3'): Promise<void> {
    const pos = await entityPos(page, name)
    expect(pos).not.toBeNull()
    await ctrlDrag(page, { x: pos!.x - 4, y: pos!.y - 4 }, { x: pos!.x + 4, y: pos!.y + 4 })
    await expect.poll(async () => (await getState(page)).marquee.count).toBe(1)
}

const float = (page: Page): Locator => page.locator('#select-float')
const actions = (page: Page): Locator => page.locator('#select-actions')
const dpad = (page: Page): Locator => page.locator('#select-dpad')
const clusterButton = (page: Page, cluster: string, title: string): Locator =>
    page.locator(`#${cluster} button[title="${title}"]`)

/** Click a cluster button. Force: the canvas render loop makes "stable" flaky. */
const clickCluster = (page: Page, cluster: string, title: string): Promise<void> =>
    clusterButton(page, cluster, title).click({ force: true })

const boxOf = async (
    locator: Locator
): Promise<{ x: number; y: number; width: number; height: number }> => {
    const box = await locator.boundingBox()
    expect(box).not.toBeNull()
    return box!
}

test.describe('SELECT cluster on a fine pointer (floating, anchored)', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'desktop-chromium',
            'the fine-pointer placement is the desktop project'
        )
    })

    test('a held selection shows the toolbar anchored to it, clear of the selection', async ({
        page,
    }) => {
        await gotoWithBlueprint(page)
        await selectAll(page)

        // Shown for a mouse user at all — the gate used to be `mobile &&`.
        await expect(actions(page)).toHaveClass(/visible/)
        await expect(dpad(page)).toHaveClass(/visible/)
        // ...in the floating placement, not the bottom band.
        await expect(float(page)).toHaveClass(/floating/)

        const b = await selectionBounds(page)
        const rect = await boxOf(float(page))
        // Anchored to the selection: beside it horizontally (left edges aligned,
        // give or take the viewport clamp) and entirely clear of it vertically,
        // so it never covers what you're about to act on.
        expect(Math.abs(rect.x - b.x)).toBeLessThanOrEqual(16)
        expect(rect.y >= b.y + b.height || rect.y + rect.height <= b.y).toBe(true)
        // ...and fully on screen.
        const vp = page.viewportSize()!
        expect(rect.x).toBeGreaterThanOrEqual(0)
        expect(rect.y).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.width).toBeLessThanOrEqual(vp.width)
        expect(rect.y + rect.height).toBeLessThanOrEqual(vp.height)
    })

    test('the buttons carry the keybinds they mirror', async ({ page }) => {
        await gotoWithBlueprint(page, 0)
        await selectOne(page) // single entity, so Rotate is live too

        const hint = (title: string): Locator =>
            clusterButton(page, 'select-actions', title).locator('.hint')
        await expect(hint('Copy')).toHaveText('Ctrl+C')
        await expect(hint('Cut')).toHaveText('Ctrl+X')
        await expect(hint('Delete')).toHaveText('Del')
        await expect(hint('Rotate')).toHaveText('R')
        await expect(hint('Cancel')).toHaveText('Esc')
        // Visible, not just present: `body.keys` is what shows them.
        await expect(hint('Copy')).toBeVisible()
        // The nudge arrows say the same thing to a screen reader, without
        // touching `title` (which the specs and the pack-icon pass locate by).
        await expect(clusterButton(page, 'select-dpad', 'Up')).toHaveAttribute(
            'aria-keyshortcuts',
            '↑'
        )
    })

    test('Copy picks the selection up with the mouse, leaving the originals', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)

        await clickCluster(page, 'select-actions', 'Copy')

        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        const s = await getState(page)
        expect(s.blueprint.entityCount).toBe(original) // copy leaves the originals
        expect(s.marquee.count).toBe(0) // selection consumed
        await expect(actions(page)).not.toHaveClass(/visible/)
    })

    test('Cut removes the originals and hands them to the cursor', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        const selected = await selectAll(page)

        await clickCluster(page, 'select-actions', 'Cut')

        await expect.poll(async () => (await getState(page)).paint.kind).toBe('blueprint')
        await expect.poll(() => entityCount(page)).toBe(original - selected)
    })

    test('Delete removes the selection outright', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        const selected = await selectAll(page)

        await clickCluster(page, 'select-actions', 'Delete')

        await expect.poll(() => entityCount(page)).toBe(original - selected)
        expect((await getState(page)).paint.active).toBe(false) // deleted, not picked up
        await expect(actions(page)).not.toHaveClass(/visible/)
    })

    test('Rotate turns a single selected entity, and hides for a group', async ({ page }) => {
        await gotoWithBlueprint(page, 0)
        // An inserter rotates freely (an assembler without a fluid recipe won't).
        const pos = await entityPos(page, 'inserter')
        expect(pos).not.toBeNull()
        await ctrlDrag(page, { x: pos!.x - 3, y: pos!.y - 3 }, { x: pos!.x + 3, y: pos!.y + 3 })
        await expect.poll(async () => (await getState(page)).marquee.count).toBe(1)

        const before = (await getState(page)).marquee.direction
        await clickCluster(page, 'select-actions', 'Rotate')
        await expect.poll(async () => (await getState(page)).marquee.direction).not.toBe(before)

        // Group rotation about a pivot is still #52, so the button gates itself
        // off for a multi-entity box rather than offering a no-op.
        await page.keyboard.press('Escape')
        await selectAll(page)
        expect((await getState(page)).marquee.count).toBeGreaterThan(1)
        await expect(clusterButton(page, 'select-actions', 'Rotate')).toBeHidden()
    })

    test('the nudge d-pad moves the selection, and the toolbar follows it', async ({ page }) => {
        const original = await gotoWithBlueprint(page)
        await selectAll(page)
        const originBefore = (await getState(page)).marquee.origin!
        const rectBefore = await boxOf(float(page))

        await clickCluster(page, 'select-dpad', 'Up')

        const s = await getState(page)
        expect(s.marquee.origin).toEqual({ x: originBefore.x, y: originBefore.y - 1 })
        expect(s.paint.active).toBe(false) // moved in place — no paste ghost
        expect(s.blueprint.entityCount).toBe(original)
        // The toolbar is anchored to the selection, so it went up with it.
        await expect.poll(async () => (await boxOf(float(page))).y).toBeLessThan(rectBefore.y)
    })

    test('the toolbar follows the camera (pan and zoom)', async ({ page }) => {
        await gotoWithBlueprint(page)
        await selectAll(page)
        const before = await boxOf(float(page))

        // Pan with the keyboard (a mouse drag would land inside the selection
        // and move it instead — that is Slice 2's drag-to-move).
        await page.keyboard.down('KeyD')
        await page.waitForTimeout(300)
        await page.keyboard.up('KeyD')
        await expect.poll(async () => (await boxOf(float(page))).x).not.toBe(before.x)
        // ...and it is still glued to the selection's box afterwards.
        const panned = await selectionBounds(page)
        expect(Math.abs((await boxOf(float(page))).x - panned.x)).toBeLessThanOrEqual(16)

        // Zoom too, with the pointer over open canvas rather than over the
        // toolbar (the wheel handler is on the canvas). Zooming *out* keeps the
        // whole selection on screen, so the anchor isn't clamped to an edge.
        const zoomedFrom = await selectionBounds(page)
        await page.mouse.move(700, 140)
        await page.mouse.wheel(0, 120)
        await expect
            .poll(async () => (await selectionBounds(page)).width)
            .toBeLessThan(zoomedFrom.width)
        const zoomed = await selectionBounds(page)
        expect(Math.abs((await boxOf(float(page))).x - zoomed.x)).toBeLessThanOrEqual(16)
    })

    test('a drag-to-move still works with the toolbar following underneath', async ({ page }) => {
        await gotoWithBlueprint(page)
        await selectAll(page)
        const before = (await getState(page)).marquee.origin!
        const b = await selectionBounds(page)

        // Grab inside the selection and drag straight down — the toolbar is
        // anchored just below it, so it travels right under the cursor. It has
        // to stay pointer-transparent for the duration or it would start eating
        // the pointermoves the canvas is tracking the drag with.
        const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
        await page.mouse.move(from.x, from.y)
        await page.mouse.down()
        for (let i = 1; i <= 6; i++) await page.mouse.move(from.x, from.y + i * 20)
        await page.mouse.up()

        const after = (await getState(page)).marquee.origin!
        expect(after.y).toBeGreaterThan(before.y) // the entities moved with it
        expect(after.x).toBe(before.x)
        await expect(actions(page)).toHaveClass(/visible/) // still held
    })

    test('Cancel and Escape both put the toolbar away', async ({ page }) => {
        await gotoWithBlueprint(page)
        await selectAll(page)

        await clickCluster(page, 'select-actions', 'Cancel')
        await expect(actions(page)).not.toHaveClass(/visible/)
        await expect(float(page)).not.toHaveClass(/floating/)
        expect((await getState(page)).marquee.count).toBe(0)

        await selectAll(page)
        await expect(actions(page)).toHaveClass(/visible/)
        await page.keyboard.press('Escape')
        await expect(actions(page)).not.toHaveClass(/visible/)
    })

    test('the touch-only clusters stay away from a mouse with a keyboard', async ({ page }) => {
        await gotoWithBlueprint(page)
        expect((await getState(page)).signals).toMatchObject({ coarse: false, keys: true })

        // PAINT with a held ghost: a mouse has hover, the wheel and the arrows,
        // so the d-pad is not offered.
        await page.evaluate(() =>
            (window as unknown as { __FBE_TEST__: ClusterHook }).__FBE_TEST__.spawnPasteGhost()
        )
        await expect.poll(async () => (await getState(page)).paint.active).toBe(true)
        await expect(page.locator('#paint-dpad')).not.toHaveClass(/visible/)
        await page.keyboard.press('Escape')

        // EDIT by hover: transient, and the Select/Edit bar is a tap-select
        // affordance — hovering an entity must not summon it.
        const pos = await entityPos(page, 'assembling-machine-3')
        await page.mouse.move(pos!.x, pos!.y)
        await expect.poll(async () => (await getState(page)).infoPanelVisible).toBe(true)
        await expect(page.locator('#edit-bar')).not.toHaveClass(/visible/)
    })
})

test.describe('clusters on hybrid hardware (mouse + touch on one page)', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'hybrid-chromium',
            'mouse-and-touch-together coverage runs on the hybrid project'
        )
    })

    test('the PAINT d-pad appears on touch and leaves on the next mouse move', async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem('quickbarItemNames', JSON.stringify(['transport-belt']))
        })
        await page.goto('/?test')
        await waitForLoaded(page)
        await pinFinePointer(page)
        await page.locator('#editor').focus()
        await page.keyboard.press('1')
        await expect.poll(async () => (await getState(page)).paint.active).toBe(true)

        // A keyboard is present and the pointer is fine → no on-screen d-pad...
        await expect(page.locator('#paint-dpad')).not.toHaveClass(/visible/)

        // ...until the screen is touched, which is when steering a ghost with a
        // finger becomes the thing that needs buttons.
        await page.locator('#editor').tap({ position: { x: 700, y: 380 } })
        await expect(page.locator('#paint-dpad')).toHaveClass(/visible/)
        expect((await getState(page)).signals.touchRecent).toBe(true)

        // Back on the mouse: hover and the arrow keys are the driver again.
        await page.mouse.move(500, 300)
        await expect(page.locator('#paint-dpad')).not.toHaveClass(/visible/)
    })

    test('the EDIT bar answers a tap, not a hover', async ({ page }) => {
        await gotoWithBlueprint(page, 0)
        await pinFinePointer(page)
        const pos = await entityPos(page, 'assembling-machine-3')
        expect(pos).not.toBeNull()

        // Mouse hover → EDIT, but no bar: a mouse's EDIT is transient hover.
        await page.mouse.move(pos!.x, pos!.y)
        await expect.poll(async () => (await getState(page)).infoPanelVisible).toBe(true)
        await expect(page.locator('#edit-bar')).not.toHaveClass(/visible/)

        // Tap the same entity → the tap-select flow, which needs the bar.
        await page.locator('#editor').tap({ position: pos! })
        await expect(page.locator('#edit-bar')).toHaveClass(/visible/)
    })

    test('a Ctrl-drag floats the SELECT toolbar; a coarse pointer sends it to the band', async ({
        page,
    }) => {
        await gotoWithBlueprint(page)
        await pinFinePointer(page)
        await selectAll(page)

        await expect(actions(page)).toHaveClass(/visible/)
        await expect(float(page)).toHaveClass(/floating/)
        const anchored = await boxOf(float(page))
        const b = await selectionBounds(page)
        expect(Math.abs(anchored.x - b.x)).toBeLessThanOrEqual(16)

        // Same held selection, coarse primary pointer (a detached keyboard, here
        // through the `?test` override): same component, thumb-band placement.
        await setSignals(page, { coarse: true })
        await expect(float(page)).not.toHaveClass(/floating/)
        await expect(actions(page)).toHaveClass(/visible/)
        const banded = await boxOf(actions(page))
        const vp = page.viewportSize()!
        expect(banded.y + banded.height).toBeGreaterThan(vp.height - 80) // bottom band
        expect(Math.abs(banded.x + banded.width / 2 - vp.width / 2)).toBeLessThanOrEqual(4) // centred

        await setSignals(page, { coarse: false })
        await expect(float(page)).toHaveClass(/floating/)
    })
})

test.describe('SELECT cluster on touch (the bottom-band ratchet)', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'mobile-chromium',
            'the coarse placement is the mobile project'
        )
    })

    test('a touch marquee still lands in the bottom band, never floating', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BLUEPRINT)}`)
        await waitForLoaded(page)
        await expect.poll(() => entityCount(page)).toBeGreaterThan(1)

        const toolbar = page.locator('#action-toolbar')
        const select = toolbar.locator('button[title="Select"]')
        if (!(await select.isVisible()))
            await toolbar.locator('button.rail-more').click({ force: true })
        await select.click({ force: true })
        await dragOneFinger(page, { x: 70, y: 180 }, { x: 380, y: 700 })

        await expect.poll(async () => (await getState(page)).marquee.count).toBeGreaterThan(0)
        await expect(actions(page)).toHaveClass(/visible/)
        // Coarse: the anchored placement never engages, and the keybind badges
        // stay out of the thumb-sized buttons.
        await expect(float(page)).not.toHaveClass(/floating/)
        await expect(clusterButton(page, 'select-actions', 'Copy').locator('.hint')).toBeHidden()

        const vp = page.viewportSize()!
        const banded = await boxOf(actions(page))
        expect(banded.y + banded.height).toBeGreaterThan(vp.height - 80)
    })
})
