import { test, expect, type Page } from '@playwright/test'
import type { EditorTestState } from '@fbe/editor'

/**
 * UI coverage for the mobile-layout work:
 *  - the INFO / shortcuts panel (responsive, openable/closable without a keyboard)
 *  - the dat.gui settings pane (touch layout: closes properly, hides Keybinds)
 *  - the quickbar (canvas-rendered, asserted via the `?test` window hook)
 *
 * The quickbar is drawn in the PixiJS canvas, so the DOM has nothing to query;
 * loading with `?test` installs window.__FBE_TEST__, which exposes its logical
 * bounds/scale (see packages/editor/src/common/testHook.ts).
 */

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

/** Read the opt-in canvas-state probe (only present when the page is loaded with `?test`). */
async function readTestState(page: Page): Promise<EditorTestState> {
    return (await page.evaluate(() => {
        const w = window as unknown as { __FBE_TEST__?: { getState: () => unknown } }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.getState()
    })) as EditorTestState
}

/** Wait for the editor to finish booting (settings pane + handlers are wired then). */
async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
    // attached, not visible: a closed pane has zero height (its open/close bar is hidden)
    await page.locator('.dg.main').waitFor({ state: 'attached' })
}

/** Toggle the dat.gui pane via the top-left Settings button. */
async function toggleSettingsPane(page: Page): Promise<void> {
    await page.locator('#settings-button').click()
}

test.describe('INFO / shortcuts panel', () => {
    test('opens from the corner panel and closes with the ✕ (no keyboard needed)', async ({
        page,
    }) => {
        await page.goto('/')
        await waitForAppReady(page)

        const panel = page.locator('#info-panel')
        await expect(panel).not.toHaveClass(/active/)

        // Touch devices have no keyboard, so the corner hint must toggle the panel.
        await page.locator('#corner-panel').click()
        await expect(panel).toHaveClass(/active/)

        await page.locator('#info-panel-close').click()
        await expect(panel).not.toHaveClass(/active/)
    })

    test('fits within the viewport (no portrait overflow)', async ({ page }) => {
        await page.goto('/')
        await waitForAppReady(page)

        await page.locator('#corner-panel').click()
        const panel = page.locator('#info-panel')
        await expect(panel).toHaveClass(/active/)

        const viewport = page.viewportSize()
        const box = await panel.boundingBox()
        expect(box).not.toBeNull()
        // width: min(640px, 90vw) and a bounded, scrollable height keep it on-screen
        expect(box!.width).toBeLessThanOrEqual(viewport!.width)
        expect(box!.height).toBeLessThanOrEqual(viewport!.height)
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.y).toBeGreaterThanOrEqual(0)
    })
})

test.describe('settings pane (dat.gui)', () => {
    test('toggles from the top-left Settings button; no bottom bar over the quickbar', async ({
        page,
    }) => {
        await page.goto('/')
        await waitForAppReady(page)

        // dat.gui's built-in open/close bar (which overlapped the quickbar) is hidden
        await expect(page.locator('.dg.main .close-button')).toBeHidden()

        const inputPresetRow = page.locator('.dg li.cr', { hasText: 'Input' })
        const openAtStart = await inputPresetRow.isVisible()

        await toggleSettingsPane(page)
        await (openAtStart
            ? expect(inputPresetRow).toBeHidden()
            : expect(inputPresetRow).toBeVisible())

        await toggleSettingsPane(page)
        await (openAtStart
            ? expect(inputPresetRow).toBeVisible()
            : expect(inputPresetRow).toBeHidden())
    })

    test('collapses fully when closed in mobile mode', async ({ page }) => {
        test.skip(!isMobileProject(), 'mobile-only: pane starts closed and uses touch rows')

        await page.goto('/')
        await waitForAppReady(page)

        // mobile mode tags <body> and the pane defaults closed
        await expect(page.locator('body')).toHaveClass(/mobile/)

        // Regression: taller touch rows must not out-rank dat.gui's closed-collapse,
        // otherwise controllers (Input, Debug, …) stay visible when closed.
        // Assert on the row <li> (which collapses to height:0), not its inner
        // label — a clipped child still reports its own bounding box.
        const inputPresetRow = page.locator('.dg li.cr', { hasText: 'Input' })
        await expect(inputPresetRow).not.toBeVisible()

        // opening the pane (the close button toggles it) reveals the controls
        await toggleSettingsPane(page)
        await expect(inputPresetRow).toBeVisible()
    })

    test('hides the keyboard-only Keybinds folder in mobile mode', async ({ page }) => {
        test.skip(!isMobileProject(), 'mobile-only')

        await page.goto('/')
        await waitForAppReady(page)

        // open the pane so visibility reflects our hide, not the closed state
        await toggleSettingsPane(page)

        // a normal folder is shown; the Keybinds folder is hidden
        await expect(
            page.getByText('Oil Outpost Generator Settings', { exact: true })
        ).toBeVisible()
        await expect(page.getByText('Keybinds', { exact: true })).not.toBeVisible()
    })

    test('keeps folders collapsed until tapped in mobile mode', async ({ page }) => {
        test.skip(!isMobileProject(), 'mobile-only')

        await page.goto('/')
        await waitForAppReady(page)
        await toggleSettingsPane(page) // open the pane (folders default collapsed)

        // Regression: the touch row-height override must not leak through a closed
        // folder via the open root <ul>, which left folders stuck expanded.
        const folderRow = page.locator('.dg li.cr', { hasText: 'Pumpjack Modules' })
        await expect(folderRow).not.toBeVisible()

        // tapping the folder title expands it (click the left edge to dodge toasts)
        await page
            .getByText('Oil Outpost Generator Settings', { exact: true })
            .click({ position: { x: 10, y: 5 } })
        await expect(folderRow).toBeVisible()
    })

    test('keeps the Keybinds folder on desktop', async ({ page }) => {
        test.skip(isMobileProject(), 'desktop-only')

        await page.goto('/')
        await waitForAppReady(page)

        await expect(page.locator('body')).not.toHaveClass(/mobile/)
        // desktop pane defaults open, so the folder title is visible
        await expect(page.getByText('Keybinds', { exact: true })).toBeVisible()
    })
})

test.describe('quickbar', () => {
    test('renders on desktop and fits; retired on mobile', async ({ page }) => {
        await page.goto('/?test')
        await waitForAppReady(page)

        const state = await readTestState(page)
        const viewport = page.viewportSize()!

        if (isMobileProject()) {
            // Retired on mobile — touch users build via the action rail's Items
            // (Recents) + Pick instead of a fixed bottom bar.
            expect(state.quickbar.visible).toBe(false)
            return
        }

        // Desktop: rendered full-size, anchored along the bottom, on-screen.
        // (Regression: a NaN scale during super() once left it invisible.)
        expect(state.quickbar.visible).toBe(true)
        expect(state.quickbar.scale).toBe(1)

        // ...and inside the safe area, whose left edge is now the universal
        // action rail's column (#101 Slice 4) rather than the screen edge.
        const b = state.quickbar.bounds
        expect(b.x).toBeGreaterThanOrEqual(state.safeArea.x)
        expect(b.x + b.width).toBeLessThanOrEqual(viewport.width + 1)
        expect(b.y).toBeGreaterThanOrEqual(0)
        expect(b.y).toBeLessThan(viewport.height)
    })
})

test.describe('wires', () => {
    // The Pixi wires panel (beside the desktop quickbar) is **retired** — #101
    // Slice 4. It used to be the desktop half of a split affordance: three rail
    // buttons on touch, a canvas panel on desktop, for the same three paint
    // items. The rail is universal now, so the panel is gone everywhere and with
    // it the geometry ratchet that guarded its anchoring (it used to fall off
    // narrow viewports). What replaces it: the rail carries the three toggles in
    // every layout, asserted per project in actionToolbar.spec.ts.
    test('the Pixi panel is gone; the three toggles live in the rail', async ({ page }) => {
        await page.goto('/?test')
        await waitForAppReady(page)

        // The probe field went with the panel — its absence is the ratchet.
        const hasWiresField = await page.evaluate(() => {
            const w = window as unknown as { __FBE_TEST__: { getState: () => object } }
            return 'wires' in w.__FBE_TEST__.getState()
        })
        expect(hasWiresField).toBe(false)

        const toolbar = page.locator('#action-toolbar')
        for (const title of ['Copper', 'Red wire', 'Green wire']) {
            await expect(toolbar.locator(`button[title="${title}"]`)).toBeVisible()
        }
    })
})

// A self-contained vanilla-2.0 blueprint (a single wooden chest) so the
// top-band spec has an entity whose info panel it can open.
const CHEST_BP =
    '0eJxtjs0OgjAQhN9lztUgoRD6KsYYfjbapGwJLSohfXcX9ODBy2x2M9/MrmjdTONkOcKssJEGmJ+bwoOmYD3D6DKvi7rWRZ5VVVEquKYlJ+5xc4R4iCTS3UUFs53nAHOWTO7pBXNSCPbGjdt6uBlIyKf3PfGXSemiQBxttPQh92W58jy0NO0J/ziF0QeBth9XSFN21ArLPiUzpTfn9ku6'

test.describe('top band (#89 Phase 1)', () => {
    test('canvas stays full-bleed; on mobile the top-anchored panels clear the chrome', async ({
        page,
    }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)

        const pill = await page.locator('#active-project').boundingBox()
        const logo = await page.locator('#corner-panel').boundingBox()
        const canvas = await page.locator('#editor').boundingBox()
        expect(pill).not.toBeNull()
        expect(logo).not.toBeNull()
        expect(canvas).not.toBeNull()

        // The canvas renders full-bleed on every platform — the world shows
        // through the empty parts of the reserved bands ("restrict the panels,
        // not the world"). The reservation lives in G.safeArea, which the Pixi
        // panels anchor within, so the chrome constraint is asserted on the
        // *panel* below, not on the canvas element.
        expect(canvas!.y).toBe(0)
        expect(canvas!.x).toBe(0)

        // The ?source blueprint imports asynchronously after boot — wait for
        // the chest to actually be in the blueprint before selecting it.
        await expect
            .poll(async () => (await readTestState(page)).blueprint.entityCount, {
                timeout: 30_000,
            })
            .toBeGreaterThan(0)

        // Drive the same signal a hover/tap-select produces.
        const shown = await page.evaluate(() => {
            const w = window as unknown as {
                __FBE_TEST__?: { showEntityInfo: (name: string) => boolean }
            }
            return w.__FBE_TEST__.showEntityInfo('wooden-chest')
        })
        expect(shown).toBe(true)
        const sheet = page.locator('#entity-info-sheet')

        // The DOM sheet is **the** entity-info presentation, on every input
        // (#101 Slice 5 — the Pixi panel it used to share the job with on
        // desktop is retired). `infoPanelVisible` is DOM-backed truth now, so
        // it agrees with the element in both projects.
        expect((await readTestState(page)).infoPanelVisible).toBe(true)
        await expect(sheet).toBeVisible()
        await expect(sheet).toContainText('Wooden chest')
        const sb = await sheet.boundingBox()
        const viewport = page.viewportSize()!

        // Either way it must clear the fixed top chrome (the pill) — the top
        // band's whole point.
        expect(sb!.y).toBeGreaterThanOrEqual(pill!.y + pill!.height)

        if (!isMobileProject()) {
            // Wide: a right-edge drawer in the readout stack, the same corner
            // the canvas panel anchored to.
            expect(sb!.x).toBeGreaterThan(viewport.width / 2)
            expect(sb!.x + sb!.width).toBeLessThanOrEqual(viewport.width)
            return
        }

        // Compact portrait: a full-width band at the top, staying out of the
        // bottom reachable band where the user's thumbs (and the contextual
        // EDIT bar) live — the placement rationale, as assertions.
        expect(sb!.y + sb!.height).toBeLessThanOrEqual(viewport.height - 80)
    })
})

// The storyboard's sample blueprint (all-vanilla entities): an assembler with
// the processing-unit recipe — an entity that both feeds the info sheet AND
// routes to an editor dialog, which CHEST_BP's plain wooden chest does not.
const ASSEMBLER_BP =
    '0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx/Ahmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW+SpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM/eMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I+V8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j+GltfMAmGY+eDpPoE5RG5eU1+vk0W75Kbt8nyPrmbpl8tsiv1'

test.describe('modal layering (#89)', () => {
    test('Pixi dialogs eclipse the DOM readouts; both restore on close', async ({ page }) => {
        // Runs on every project since #101 Slice 5: the readouts are DOM for
        // all inputs, so the cross-technology stacking problem this contract
        // solves (DOM always composites above the canvas, so a Pixi dialog
        // can't paint over a readout — the readouts have to yield) is no
        // longer a touch-only concern.
        await page.goto(`/?test&source=${encodeURIComponent(ASSEMBLER_BP)}`)
        await waitForAppReady(page)
        await expect
            .poll(async () => (await readTestState(page)).blueprint.entityCount, {
                timeout: 30_000,
            })
            .toBeGreaterThan(0)

        // Bring up both passive readouts: tap-select info + the rates toggle.
        const hook = (fn: string, arg?: string): Promise<unknown> =>
            page.evaluate(
                ([f, a]) => {
                    const w = window as unknown as {
                        __FBE_TEST__: Record<string, (arg?: string) => unknown>
                    }
                    return w.__FBE_TEST__[f](a)
                },
                [fn, arg]
            )
        expect(await hook('showEntityInfo', 'assembling-machine-3')).toBe(true)
        await hook('toggleRatesPanel')

        const sheet = page.locator('#entity-info-sheet')
        const drawer = page.locator('#rates-drawer')
        await expect(sheet).toBeVisible()
        await expect(drawer).toBeVisible()

        // A dialog opens → both readouts yield (DOM composites above the
        // canvas, so hiding them is the only way the dialog's controls — the
        // recipe/module slots this ratchet exists for — stay reachable).
        expect(await hook('openEntityEditor', 'assembling-machine-3')).toBe(true)
        await expect(sheet).toBeHidden()
        await expect(drawer).toBeHidden()

        // Dialog closes → the readouts restore themselves: selection and the
        // rates toggle live in the editor and were never cleared.
        await hook('closeDialogs')
        await expect(sheet).toBeVisible()
        await expect(drawer).toBeVisible()
    })
})
