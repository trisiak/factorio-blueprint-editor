import { test, expect, type Page } from '@playwright/test'
import type { EditorTestState } from '@fbe/editor'

/**
 * Blueprint-wide production rates readout (RateCalculator-style; see
 * docs/rate-calculator.md and packages/editor/src/core/craftingRates.ts).
 *
 * Since #101 Slice 5 the readout is **DOM for every input** — `#rates-drawer`,
 * fed by the editor's render-free `RatesModel` over `fbe:rates` — so its
 * contents are asserted straight off the element rather than through the canvas
 * probes the retired Pixi panel needed. `getState().ratesPanelVisible` is
 * DOM-backed truth for the same reason. Desktop toggles with the real T
 * keybind; mobile — which has no keyboard — goes through the hook (the action
 * rail's Rates button routes to the same `showRates` action).
 */

// The clearSlots blueprint: an assembling-machine-2 with a recipe + 2 speed
// modules, a beacon with 2 speed modules and a fast-splitter — exactly one
// rateable machine, so the footer must say "1 machine counted".
const BP =
    '0eNq1kl1qwzAQhK9S9lkqsfPTRlcpIcjyJl0qr4y0DjHGdy+yS9K0pVBIn8SI3ZnRhwaofIdtJBYwA5BgA+bTnQJvK/RgwHm0UScfJD0c6CxdRFBwwpgoMJj1ptyuttv1qnxals8LBeQCJzAvAyQ6svXZXvoWwcwpCtg2WdmUsKk88VE31r0Soy5hVEBc4xlMMe4UIAsJ4ew3iX7PXVNhBFP87qSgDYlkKjlANnxcK+inc1QQ0dFUCj06iYHJaUfRdZQfn5vOoVTn9Y+g1CLWugl153GqOo8NQLwnPiFLiP28dlUrBUmsewOzUOBCl4kX424c1X3di1v3Xfb/gqy8IKvQusDfIW1uIN0TQ/GvGIq/YFheMBxsEp1aTyIYf/gyE4vNxOJAPs9ce1IMrFtvBSHHjO/kmB6J'

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

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
        if (isMobileProject()) {
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
        const drawer = page.locator('#rates-drawer')
        await expect(drawer).toBeVisible()
        await expect(drawer).toContainText('1 machine counted')
        await expect(drawer).toContainText('Ingredients')
        await expect(drawer).toContainText(/\/s/)
        // Machine counts render as a bare ×N next to the (dominant) machine's
        // icon — "× 1" glued to the rate read as a rate multiplier.
        await expect(drawer.locator('.rd-machines').first()).toContainText(/×\d+/)

        // The drawer anchors to the **right edge** in every layout (top-right
        // in the readout stack when wide, bottom- or top-right when compact) —
        // its width varies with the layout, its right margin doesn't.
        const box = await drawer.boundingBox()
        const viewport = page.viewportSize()!
        expect(viewport.width - (box!.x + box!.width)).toBeLessThanOrEqual(12)

        // Dismiss with the readout's own ✕ — the only route that needs neither
        // a keyboard nor re-finding the toggle in the rail's ⋯ overflow.
        const close = drawer.locator('.rates-close')
        await (isMobileProject() ? close.tap() : close.click())
        await expect.poll(async () => (await readTestState(page)).ratesPanelVisible).toBe(false)
    })
})
