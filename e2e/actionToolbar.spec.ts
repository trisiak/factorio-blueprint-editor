import { test, expect, type Page } from '@playwright/test'

// The on-screen action toolbar (packages/website/src/actionToolbar.ts) mirrors
// the editor's action registry into DOM buttons. Since #101 Slice 4 it is the
// **universal left column** — every layout gets it, sized by the input signals:
// 44 px captioned cells when `coarse`, a slim 34 px strip otherwise, with a
// keybind badge on each button when `keys`. The rail is **mode-gated** (#33): a
// button is only in the DOM when its action is useful in the current editor
// mode, so non-live buttons are absent (count 0), not just hidden.
// See docs/mobile-controls.md and docs/mobile-layout-inventory.md.

// A self-contained vanilla-2.0 blueprint (a single wooden chest). Starts with
// '0', so the loader decodes it locally — no `/corsproxy` round-trip.
const CHEST =
    '0eJxtjs0OgjAQhN9lztUgoRD6KsYYfjbapGwJLSohfXcX9ODBy2x2M9/MrmjdTONkOcKssJEGmJ+bwoOmYD3D6DKvi7rWRZ5VVVEquKYlJ+5xc4R4iCTS3UUFs53nAHOWTO7pBXNSCPbGjdt6uBlIyKf3PfGXSemiQBxttPQh92W58jy0NO0J/ziF0QeBth9XSFN21ArLPiUzpTfn9ku6'

type RailState = {
    blueprint: { entityCount: number }
    safeArea: { x: number; y: number; width: number; height: number }
    quickbar: { visible: boolean; bounds: { x: number; y: number } }
    paint: {
        active: boolean
        direction: number | null
        kind: 'entity' | 'blueprint' | null
        tileSize: number | null
    }
}

type TestHookWindow = {
    __FBE_TEST__: {
        getState(): RailState
    }
}

const readState = (page: Page): Promise<RailState> =>
    page.evaluate(() => (window as unknown as TestHookWindow).__FBE_TEST__.getState())
const entityCount = (page: Page): Promise<number> =>
    page.evaluate(
        () => (window as unknown as TestHookWindow).__FBE_TEST__.getState().blueprint.entityCount
    )

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    // loadingScreen starts with .active and loses it once data + atlas load.
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

// Tap a rail action — directly if it's in the rail, else via the ⋯ overflow.
// (With mode-gating the rail is short enough that the blueprint actions usually
// sit directly in it rather than the overflow.) Force-click: the rail re-flows
// (ResizeObserver / mode changes) so elements aren't "stable".
async function tapRail(page: Page, title: string): Promise<void> {
    const toolbar = page.locator('#action-toolbar')
    const btn = toolbar.locator(`button[title="${title}"]`)
    if (!(await btn.isVisible())) {
        const more = toolbar.locator('button.rail-more')
        if (await more.count()) await more.click({ force: true })
    }
    await btn.click({ force: true })
}

// Enter paint mode deterministically: seed a quickbar item (loaded from
// localStorage on boot), then press the slot-1 key to pick it up. In PAINT the
// rail surfaces the Cancel button, our DOM-observable proxy for "holding a cursor".
async function gotoAndEnterPaint(page: Page, url = '/'): Promise<void> {
    await page.addInitScript(() => {
        window.localStorage.setItem('quickbarItemNames', JSON.stringify(['transport-belt']))
    })
    await page.goto(url)
    await waitForLoaded(page)

    // Cancel is mode-gated: absent while idle (NONE).
    const cancel = page.locator('#action-toolbar button[title="Cancel"]')
    await expect(cancel).toHaveCount(0)

    await page.locator('#editor').focus()
    await page.keyboard.press('1') // code 'Digit1' -> quickbar slot 1 -> paint
    await expect(cancel).toBeVisible()
}

test.describe('action toolbar', () => {
    // The desktop contract flipped with #101 Slice 4: the rail used to be
    // mobile-only ("is hidden in the desktop input mode"), which left a
    // mouse+keyboard user with no on-screen mirror of the registry at all and
    // desktop with the old three-tall top-left stack. It is now the one left
    // column for every layout — slim cells, keybind badges, and the same
    // reserved gutter mobile already had.
    test.describe('desktop', () => {
        test.beforeEach(() => {
            test.skip(
                test.info().project.name !== 'desktop-chromium',
                'the slim/keyboard presentation is what the desktop project boots'
            )
        })

        test('renders as a slim, keybind-hinted strip', async ({ page }) => {
            await page.goto('/')
            await waitForLoaded(page)

            const toolbar = page.locator('#action-toolbar')
            await expect(toolbar).toBeVisible()
            // `slim` = fine primary pointer (no 44 px touch cells, no captions);
            // `with-hints` = a keyboard is present, so the badges show.
            await expect(toolbar).toHaveClass(/slim/)
            await expect(toolbar).toHaveClass(/with-hints/)

            const undo = toolbar.locator('button[title="Undo"]')
            await expect(undo).toBeVisible()
            const box = await undo.boundingBox()
            // Slim cells: smaller than the 44 px touch target, big enough to hit.
            expect(box.width).toBeLessThan(44)
            expect(box.width).toBeGreaterThanOrEqual(28)
            // The caption is dropped in the strip; the keybind badge replaces it,
            // carrying the registry's own combo (Control+KeyZ -> the badge below).
            await expect(undo.locator('.label')).toBeHidden()
            await expect(undo.locator('.hint')).toHaveText('\u2303Z')
            await expect(undo).toHaveAttribute('aria-keyshortcuts', 'Control+KeyZ')
            await expect(toolbar.locator('button[title="Items"] .hint')).toHaveText('E')
        })

        test('reserves the left inset, and the on-canvas panels keep out of it', async ({
            page,
        }) => {
            await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
            await waitForLoaded(page)
            await expect.poll(() => entityCount(page)).toBeGreaterThan(0)

            const rail = await page.locator('#action-toolbar').boundingBox()
            const state = await readState(page)
            // The gutter reached the editor: G.safeArea starts at the rail's
            // right edge (the canvas itself stays full-bleed — the world shows
            // through under the column).
            expect(state.safeArea.x).toBeGreaterThanOrEqual(rail.width)
            expect(state.safeArea.width).toBe(page.viewportSize().width - state.safeArea.x)

            // ...so the Pixi quickbar anchored within it clears the rail.
            expect(state.quickbar.visible).toBe(true)
            expect(state.quickbar.bounds.x).toBeGreaterThanOrEqual(state.safeArea.x)

            // The entity-info readout is DOM since #101 Slice 5 (the Pixi panel
            // and its `infoPanelBounds` probe are retired), so the same
            // keep-out is asserted on the element: it anchors to the right edge
            // and never reaches back into the rail's column.
            await page.evaluate(() => {
                const w = window as unknown as {
                    __FBE_TEST__: { showEntityInfo: (n: string) => boolean }
                }
                w.__FBE_TEST__.showEntityInfo('wooden-chest')
            })
            const info = await page.locator('#entity-info-sheet').boundingBox()
            expect(info).not.toBeNull()
            expect(info.x).toBeGreaterThanOrEqual(state.safeArea.x)
        })

        test('the rail rotates a held ghost', async ({ page }) => {
            await gotoAndEnterPaint(page, '/?test')

            const before = (await readState(page)).paint.direction
            expect(before).not.toBeNull()
            await page.locator('#action-toolbar button[title="Rotate"]').click({ force: true })
            // Same registry action the R key fires — the rail is a mirror of it,
            // not a parallel implementation.
            await expect.poll(async () => (await readState(page)).paint.direction).not.toBe(before)
        })

        test('the wire buttons hold a wire cursor; the Pixi wires panel is gone', async ({
            page,
        }) => {
            await page.goto('/?test')
            await waitForLoaded(page)

            // The desktop-only Pixi wires panel beside the quickbar is retired
            // (#101 Slice 4) — two affordances for one action was the problem;
            // the rail's three toggles are the survivor. Its probe field went
            // with it, so its absence is the ratchet.
            const hasWiresField = await page.evaluate(
                () => 'wires' in (window as unknown as TestHookWindow).__FBE_TEST__.getState()
            )
            expect(hasWiresField).toBe(false)

            await tapRail(page, 'Red wire')
            const held = await readState(page)
            expect(held.paint.active).toBe(true)
            // A wire cursor is neither an entity/blueprint ghost nor a tile brush.
            expect(held.paint.kind).toBeNull()
            expect(held.paint.tileSize).toBeNull()

            // Toggle semantics, exactly as the retired panel's slots had.
            await tapRail(page, 'Red wire')
            await expect.poll(async () => (await readState(page)).paint.active).toBe(false)
        })

        test('Settings opens the pane beside the column, not over it', async ({ page }) => {
            await page.goto('/')
            await waitForLoaded(page)
            await page.locator('.dg.main').waitFor({ state: 'attached' })

            const rail = await page.locator('#action-toolbar').boundingBox()
            const pane = await page.locator('.dg.main').boundingBox()
            // The pane defaults open on a fine pointer and is anchored under the
            // corner buttons; it must step right of the rail instead of covering
            // the actions it shares the left edge with.
            expect(pane.x).toBeGreaterThanOrEqual(rail.x + rail.width)
            expect(pane.y).toBeGreaterThanOrEqual(rail.y - 8)
        })
    })

    test.describe('mobile', () => {
        // Pixel 7 => isMobile + hasTouch, so the input mode auto-detects `mobile`.
        test.beforeEach(() => {
            test.skip(
                test.info().project.name !== 'mobile-chromium',
                'the toolbar only shows in the mobile input mode'
            )
        })

        test('shows the global actions and hides mode-specific ones while idle', async ({
            page,
        }) => {
            await page.goto('/')
            await waitForLoaded(page)

            const toolbar = page.locator('#action-toolbar')
            await expect(toolbar).toBeVisible()
            await expect(toolbar).toHaveClass(/visible/)

            // Global actions are always present.
            for (const title of ['Items', 'Undo', 'Redo', 'Center']) {
                await expect(toolbar.locator(`button[title="${title}"]`)).toBeVisible()
            }
            // Cursor/selection actions are no-ops while idle (NONE) → absent.
            for (const title of ['Rotate', 'Flip H', 'Flip V', 'Delete', 'Copy cfg', 'Cancel']) {
                await expect(toolbar.locator(`button[title="${title}"]`)).toHaveCount(0)
            }
            // Select needs something to select — hidden on an empty blueprint.
            await expect(toolbar.locator('button[title="Select"]')).toHaveCount(0)

            // Management actions are permanently parked in the ⋯ overflow —
            // never rail cells — so the everyday rail stays short and its
            // cells stable across modes.
            for (const title of ['Copy BP', 'Paste BP', 'Export', 'New']) {
                await expect(toolbar.locator(`.rail-primary button[title="${title}"]`)).toHaveCount(
                    0
                )
                await expect(
                    toolbar.locator(`.rail-overflow button[title="${title}"]`)
                ).toHaveCount(1)
            }
            await expect(toolbar.locator('button.rail-more')).toBeVisible()
        })

        test('wire buttons toggle a wire cursor', async ({ page }) => {
            await page.goto('/?test')
            await waitForLoaded(page)

            // Tap → the wire lands on the cursor (PAINT); tap again → dropped
            // (the same toggle the retired Pixi panel's slots implemented).
            await tapRail(page, 'Red wire')
            await expect.poll(async () => (await readState(page)).paint.active).toBe(true)
            await tapRail(page, 'Red wire')
            await expect.poll(async () => (await readState(page)).paint.active).toBe(false)

            // Phase 3 (#89): the wire glyphs upgrade to real game icons from
            // the pack's browser/ sheet on the data plane (progressive — poll;
            // also a live canary for the sheet being published per pack).
            await expect
                .poll(
                    () =>
                        page.evaluate(() => {
                            const glyph = document.querySelector(
                                '#action-toolbar button[title="Red wire"] .glyph'
                            )
                            return glyph ? getComputedStyle(glyph).backgroundImage : ''
                        }),
                    { timeout: 15_000 }
                )
                .toContain('icons.webp')
        })

        test('pack icons resolve to the canonical pack on a slim graphics variant', async ({
            page,
        }) => {
            // Slim variants publish no browser/ tier of their own — the sheet
            // must come from the canonical pack. Regression: loadPackIcons read
            // getCanonicalDataPack() before the packs.json manifest resolved,
            // so a persisted slim pack 404'd and every icon stayed a text
            // fallback — precisely on the devices slim is for.
            await page.goto('/?test&pack=vanilla-2.0-slim')
            await waitForLoaded(page)

            await expect
                .poll(
                    () =>
                        page.evaluate(() => {
                            const glyph = document.querySelector(
                                '#action-toolbar button[title="Red wire"] .glyph'
                            )
                            return glyph ? getComputedStyle(glyph).backgroundImage : ''
                        }),
                    { timeout: 15_000 }
                )
                .toContain('vanilla-2.0/browser/icons.webp')
        })

        test('the Select button appears once the blueprint is non-empty', async ({ page }) => {
            await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
            await waitForLoaded(page)
            await expect.poll(() => entityCount(page)).toBeGreaterThan(0)

            await expect(page.locator('#action-toolbar button[title="Select"]')).toBeVisible()
        })

        test('PAINT mode surfaces rotate/pick/cancel; flip is cursor-aware', async ({ page }) => {
            await gotoAndEnterPaint(page) // holding a single item (transport-belt)

            const toolbar = page.locator('#action-toolbar')
            for (const title of ['Rotate', 'Pick', 'Cancel']) {
                await expect(toolbar.locator(`button[title="${title}"]`)).toBeVisible()
            }
            // Flip only works on a pasted-blueprint ghost, not a single held item,
            // so it's hidden here; EDIT-only actions are hidden too.
            for (const title of ['Flip H', 'Flip V', 'Delete', 'Copy cfg', 'Paste cfg']) {
                await expect(toolbar.locator(`button[title="${title}"]`)).toHaveCount(0)
            }
        })

        test('Flip buttons appear when holding a pasted-blueprint ghost', async ({ page }) => {
            // A paste ghost (PaintBlueprintContainer) is flippable; spawn one via
            // the test hook from a loaded blueprint.
            await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
            await waitForLoaded(page)
            await expect.poll(() => entityCount(page)).toBeGreaterThan(0)
            await page.evaluate(() =>
                (
                    window as unknown as { __FBE_TEST__: { spawnPasteGhost: () => boolean } }
                ).__FBE_TEST__.spawnPasteGhost()
            )

            const toolbar = page.locator('#action-toolbar')
            await expect(toolbar.locator('button[title="Flip H"]')).toBeVisible()
            await expect(toolbar.locator('button[title="Flip V"]')).toBeVisible()
        })

        test('global + paint buttons route through the registry without throwing', async ({
            page,
        }) => {
            const fatal: string[] = []
            page.on('pageerror', err => fatal.push(err.message))

            await gotoAndEnterPaint(page)

            // PAINT-mode rail actions exist now; exercise the callAction seam.
            const toolbar = page.locator('#action-toolbar')
            for (const title of ['Rotate', 'Pick', 'Undo', 'Redo', 'Center']) {
                await toolbar.locator(`button[title="${title}"]`).click({ force: true })
            }

            expect(fatal.join('\n')).toBe('')
        })

        // Blueprint-level actions (clipboard / new / export) are global and, with
        // the rail mode-gated short, usually sit directly in it. Tapping them
        // routes (copyBlueprint via a handler, the rest via the registry) without
        // throwing on an empty blueprint.
        test('the blueprint actions route without throwing', async ({ page }) => {
            const fatal: string[] = []
            page.on('pageerror', err => fatal.push(err.message))

            await page.goto('/')
            await waitForLoaded(page)

            for (const title of ['Copy BP', 'Paste BP', 'Export', 'New']) {
                await tapRail(page, title)
            }

            expect(fatal.join('\n')).toBe('')
        })

        // "New" (clear) swaps in a fresh blueprint — it can't be undone — so on a
        // non-empty blueprint it must ask first: the tap surfaces a confirm toast
        // and leaves the blueprint untouched until "Clear" is pressed.
        test('New asks for confirmation before clearing a non-empty blueprint', async ({
            page,
        }) => {
            await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
            await waitForLoaded(page)
            await expect.poll(() => entityCount(page)).toBeGreaterThan(0)

            await tapRail(page, 'New')

            // The confirm toast appears; the blueprint is untouched until confirmed.
            const confirm = page.getByRole('button', { name: /^Clear$/ })
            await expect(confirm).toBeVisible()
            expect(await entityCount(page)).toBeGreaterThan(0)

            await confirm.click()
            await expect.poll(() => entityCount(page)).toBe(0)
        })

        // The headline behavior: a touch user can get out of paint mode. Cancel
        // routes through closeWindow -> BlueprintContainer.clearCursor(). Leaving
        // PAINT also removes Cancel (mode-gated).
        test('Cancel button exits paint mode', async ({ page }) => {
            await gotoAndEnterPaint(page)

            const cancel = page.locator('#action-toolbar button[title="Cancel"]')
            await cancel.tap()
            await expect(cancel).toHaveCount(0)
        })

        // Escape gains the same fall-through (close dialog if open, else clear the
        // cursor), so a physical keyboard on a touch device also bails out.
        test('Escape also exits paint mode', async ({ page }) => {
            await gotoAndEnterPaint(page)

            await page.keyboard.press('Escape')
            await expect(page.locator('#action-toolbar button[title="Cancel"]')).toHaveCount(0)
        })
    })
})
