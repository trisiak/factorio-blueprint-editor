import { test, expect, type Page } from '@playwright/test'

/**
 * UI-panel coverage for the mobile-layout work:
 *  - the INFO / shortcuts panel (responsive, openable/closable without a keyboard)
 *  - the dat.gui settings pane (touch layout: closes properly, hides Keybinds)
 *
 * The quickbar is rendered in the PixiJS canvas (no DOM to query), so its
 * scale-to-fit behaviour is covered by a unit test (quickbarLayout.test.ts)
 * rather than here — same reason touch.spec defers canvas-state assertions.
 */

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

/** Wait for the editor to finish booting (settings pane + handlers are wired then). */
async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
    await expect(page.locator('.dg.main')).toBeVisible()
}

/**
 * Toggle the dat.gui pane via its close/open button. The bottom-right toasts
 * overlap the button's right end, so click its left edge to avoid interception.
 */
async function toggleSettingsPane(page: Page): Promise<void> {
    await page.locator('.dg.main .close-button').click({ position: { x: 20, y: 10 } })
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
    test('collapses fully when closed in mobile mode', async ({ page }) => {
        test.skip(!isMobileProject(), 'mobile-only: pane starts closed and uses touch rows')

        await page.goto('/')
        await waitForAppReady(page)

        // mobile mode tags <body> and the pane defaults closed
        await expect(page.locator('body')).toHaveClass(/mobile/)

        // Regression: taller touch rows must not out-rank dat.gui's closed-collapse,
        // otherwise controllers (Input Mode, Debug, …) stay visible when closed.
        // Assert on the row <li> (which collapses to height:0), not its inner
        // label — a clipped child still reports its own bounding box.
        const inputModeRow = page.locator('.dg li.cr', { hasText: 'Input Mode' })
        await expect(inputModeRow).not.toBeVisible()

        // opening the pane (the close button toggles it) reveals the controls
        await toggleSettingsPane(page)
        await expect(inputModeRow).toBeVisible()
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

    test('keeps the Keybinds folder on desktop', async ({ page }) => {
        test.skip(isMobileProject(), 'desktop-only')

        await page.goto('/')
        await waitForAppReady(page)

        await expect(page.locator('body')).not.toHaveClass(/mobile/)
        // desktop pane defaults open, so the folder title is visible
        await expect(page.getByText('Keybinds', { exact: true })).toBeVisible()
    })
})
