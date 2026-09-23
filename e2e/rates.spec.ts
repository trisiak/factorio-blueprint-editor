import { test, expect, type Page } from '@playwright/test'
import type { EditorTestState } from '@fbe/editor'
import { isTouchProject } from './projects'

/**
 * Blueprint-wide production rates panel (RateCalculator-style readout; see
 * docs/rate-calculator.md and packages/editor/src/core/craftingRates.ts).
 *
 * The panel is canvas-drawn, so the DOM has nothing to query: `?test` installs
 * window.__FBE_TEST__ whose `ratesPanelLines()` reports the rendered text lines
 * (and `getState().ratesPanelVisible` the visibility). Desktop toggles with the
 * real T keybind; mobile — which has no keyboard — goes through the hook (the
 * action rail's Rates button routes to the same `showRates` action).
 */

// The clearSlots blueprint: an assembling-machine-2 with a recipe + 2 speed
// modules, a beacon with 2 speed modules and a fast-splitter — exactly one
// rateable machine, so the footer must say "1 machine counted".
const BP =
    '0eNq1kl1qwzAQhK9S9lkqsfPTRlcpIcjyJl0qr4y0DjHGdy+yS9K0pVBIn8SI3ZnRhwaofIdtJBYwA5BgA+bTnQJvK/RgwHm0UScfJD0c6CxdRFBwwpgoMJj1ptyuttv1qnxals8LBeQCJzAvAyQ6svXZXvoWwcwpCtg2WdmUsKk88VE31r0Soy5hVEBc4xlMMe4UIAsJ4ew3iX7PXVNhBFP87qSgDYlkKjlANnxcK+inc1QQ0dFUCj06iYHJaUfRdZQfn5vOoVTn9Y+g1CLWugl153GqOo8NQLwnPiFLiP28dlUrBUmsewOzUOBCl4kX424c1X3di1v3Xfb/gqy8IKvQusDfIW1uIN0TQ/GvGIq/YFheMBxsEp1aTyIYf/gyE4vNxOJAPs9ce1IMrFtvBSHHjO/kmB6J'

async function readTestState(page: Page): Promise<EditorTestState> {
    return (await page.evaluate(() => {
        const w = window as unknown as { __FBE_TEST__?: { getState: () => unknown } }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.getState()
    })) as EditorTestState
}

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

interface RatesHook {
    toggleRatesPanel: () => void
    ratesPanelLines: () => string[]
    ratesPanelClosePos: () => { x: number; y: number } | null
}

test.describe('rates panel', () => {
    test('toggles and reports blueprint-wide rates', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)
        await expect
            .poll(async () => (await readTestState(page)).blueprint.entityCount)
            .toBeGreaterThan(0)

        expect((await readTestState(page)).ratesPanelVisible).toBe(false)

        // Toggle on: real keybind on desktop, the hook (= the rail's Rates
        // button's action) on touch.
        if (isTouchProject()) {
            await page.evaluate(() =>
                (window as unknown as { __FBE_TEST__: RatesHook }).__FBE_TEST__.toggleRatesPanel()
            )
        } else {
            await page.keyboard.press('t')
        }
        await expect.poll(async () => (await readTestState(page)).ratesPanelVisible).toBe(true)

        // The blueprint holds exactly one rateable machine (the beacon and the
        // splitter don't count), and its recipe yields at least one product row
        // between the section headers and the footer.
        const lines = await page.evaluate(() =>
            (window as unknown as { __FBE_TEST__: RatesHook }).__FBE_TEST__.ratesPanelLines()
        )
        expect(lines.some(l => l.includes('1 machine counted'))).toBe(true)
        expect(lines.some(l => l === 'Ingredients')).toBe(true)
        expect(lines.some(l => /\/s/.test(l))).toBe(true)
        // Machine counts render as a bare ×N next to the (dominant) machine's
        // icon — "× 1" glued to the rate read as a rate multiplier.
        expect(lines.some(l => /^×\d+$/.test(l))).toBe(true)

        // Dismiss with the readout's own ✕ (the only route that needs neither a
        // keyboard nor re-finding the toggle in the rail's ⋯ overflow). The
        // presentation differs per mode (#89 Phase 2): mobile shows the DOM
        // drawer (tap its ✕ directly, and assert it rendered the same footer
        // the canvas rows carry); desktop shows the canvas panel (click its ✕
        // via the hook coordinates — which also pins the right-edge anchor).
        if (isTouchProject()) {
            const drawer = page.locator('#rates-drawer')
            await expect(drawer).toBeVisible()
            await expect(drawer).toContainText('1 machine counted')
            await drawer.locator('.rates-close').tap()
        } else {
            await expect(page.locator('#rates-drawer')).toBeHidden()
            const closePos = await page.evaluate(() =>
                (window as unknown as { __FBE_TEST__: RatesHook }).__FBE_TEST__.ratesPanelClosePos()
            )
            expect(closePos).not.toBeNull()
            const viewport = page.viewportSize()
            expect(closePos.x).toBeGreaterThan(viewport.width / 2)
            expect(closePos.y).toBeGreaterThan(100)
            await page.mouse.click(closePos.x, closePos.y)
        }
        await expect.poll(async () => (await readTestState(page)).ratesPanelVisible).toBe(false)
    })
})
