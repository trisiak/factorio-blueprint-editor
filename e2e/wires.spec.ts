import { test, expect, type Page } from '@playwright/test'

/**
 * Regression guard for issue #37: on touch / high-DPR the red & green *circuit*
 * wires went missing while copper *power* wires still rendered. The cause lived
 * in `WiresContainer.createWire` — each wire is baked into its own supersampled
 * `RenderTexture`, and `autoGenerateMipmaps` + a `devicePixelRatio * 2`
 * resolution reduced the thin 1.5px stroke of a *short* (adjacent-entity) circuit
 * wire to nothing in the upper mips, so it vanished under minification. Long
 * copper wires span far-apart poles, so their texture stayed big enough to
 * survive — which is exactly why only red/green disappeared.
 *
 * The real-device failure is on the WebGPU path; headless Chromium here renders
 * through SwiftShader/WebGL and doesn't reproduce the vanish, so this can't
 * *catch* the original WebGPU bug. What it does lock in is that all three wire
 * colours actually paint pixels (no colour silently drops out of the pipeline),
 * on both the desktop and mobile projects.
 *
 * The blueprint is two constant-combinator pairs (one red-wired, one green-wired)
 * plus two medium electric poles (copper-wired) — one of every wire colour.
 */
const WIRES_BLUEPRINT =
    '0eJyd0u9qhDAMAPB3yec4rr1Wpq8iMtQLI2BTqXXbIX33VQfb4Dbh7lP/pb+kpCv040JTYIlQr8CDlxnqZoWZX6Ubtz3pHEEN20nsJBaDdz1LF32AhMByoQ+oVWoRSCJHpi9gX1xfZHE9hRyARxDC5Od818uWMXunJ4tw3ceU8EbT92nqWDs/Vpv+WzOP1faPZr81RxdeXEEjDTHwUEx+pFvOHj+1vJOrfnO5xe8c9v42ChVqVC025zwa1Hlm0WKJts1xHMnlJD+fC+GNwrzDttSVqSprKv1cmlNKn9W808o='

async function waitForReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

test('circuit (red/green) and power (copper) wires all render', async ({ page }) => {
    await page.goto(`/?test&source=${encodeURIComponent(WIRES_BLUEPRINT)}`)
    await waitForReady(page)
    // wires are rendered into textures after import settles
    await page.waitForTimeout(1500)

    const counts = await page.evaluate(() => {
        const w = window as unknown as {
            __FBE_TEST__?: { wireColorPixelCounts: () => Record<string, number> }
        }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.wireColorPixelCounts()
    })

    // The pre-#37 symptom was red === green === 0 with copper > 0. Assert every
    // colour paints pixels so a colour silently dropping out fails the test.
    expect(counts.copper, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.red, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.green, JSON.stringify(counts)).toBeGreaterThan(0)
})
