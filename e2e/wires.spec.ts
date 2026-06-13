import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Regression guard for the wire-rendering bugs in `WiresContainer` (issue #37).
 *
 * Originally each wire was baked into its own supersampled `RenderTexture`. That
 * texture pipeline kept failing on the high-DPR / WebGPU path: a *short* circuit
 * (red/green) wire between adjacent entities is a thin ~1.5px stroke, and its
 * tiny texture lost the stroke — first to the mip chain (the wire vanished under
 * minification while long copper *power* wires, with big textures, survived), and
 * then, on a wire-dense blueprint, all wires could drop at once (dozens of small
 * antialiased/multisampled render targets is a lot of texture memory for a mobile
 * GPU). The fix draws each wire as a vector `Graphics` instead — no textures, no
 * mips, no resolution — so there is nothing left to round away or run out of.
 *
 * Headless Chromium here renders through SwiftShader/WebGL and never reproduced
 * the WebGPU vanish, so these specs can't *catch* the original device bug. What
 * they lock in is that every wire colour actually paints pixels — no colour
 * silently drops out of the pipeline — across a trivial blueprint and a dense,
 * real-world combinator blueprint (the one that surfaced the all-wires-gone case),
 * on both the desktop and mobile projects.
 */

const SIMPLE_BLUEPRINT =
    '0eJyd0u9qhDAMAPB3yec4rr1Wpq8iMtQLI2BTqXXbIX33VQfb4Dbh7lP/pb+kpCv040JTYIlQr8CDlxnqZoWZX6Ubtz3pHEEN20nsJBaDdz1LF32AhMByoQ+oVWoRSCJHpi9gX1xfZHE9hRyARxDC5Od818uWMXunJ4tw3ceU8EbT92nqWDs/Vpv+WzOP1faPZr81RxdeXEEjDTHwUEx+pFvOHj+1vJOrfnO5xe8c9v42ChVqVC025zwa1Hlm0WKJts1xHMnlJD+fC+GNwrzDttSVqSprKv1cmlNKn9W808o='

/**
 * A real 58-entity / 96-wire combinator blueprint (decider/arithmetic/selector/
 * constant combinators, poles, roboport, display panel, …) — the blueprint that
 * exposed the "paste a wire-heavy blueprint, get zero wires" case on WebGPU.
 */
const DENSE_BLUEPRINT = fs
    .readFileSync(path.join(__dirname, 'fixtures', 'circuit-wire-blueprint.txt'), 'utf8')
    .trim()

async function waitForReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

async function wireCounts(page: Page): Promise<Record<string, number>> {
    return page.evaluate(() => {
        const w = window as unknown as {
            __FBE_TEST__?: { wireColorPixelCounts: () => Record<string, number> }
        }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.wireColorPixelCounts()
    })
}

test('circuit (red/green) and power (copper) wires all render', async ({ page }) => {
    await page.goto(`/?test&source=${encodeURIComponent(SIMPLE_BLUEPRINT)}`)
    await waitForReady(page)
    await page.waitForTimeout(1500)

    // The pre-#37 symptom was red === green === 0 with copper > 0. Assert every
    // colour paints pixels so a colour silently dropping out fails the test.
    const counts = await wireCounts(page)
    expect(counts.copper, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.red, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.green, JSON.stringify(counts)).toBeGreaterThan(0)
})

test('a wire-dense combinator blueprint renders all its wires', async ({ page }) => {
    await page.goto(`/?test&source=${encodeURIComponent(DENSE_BLUEPRINT)}`)
    await waitForReady(page)
    await page.waitForTimeout(2000)

    // Confirms the 96 mostly-short circuit wires don't all drop out (the WebGPU
    // failure mode) — every colour should be well-represented here.
    const counts = await wireCounts(page)
    expect(counts.copper, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.red, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.green, JSON.stringify(counts)).toBeGreaterThan(0)
})
