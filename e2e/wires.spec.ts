import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Guards that a blueprint's wires are actually visible — across the two paths
 * that build them. The `?source` loads (first two tests) cover the import/render
 * path; the paste test covers the paint-ghost place path, which regressed
 * separately (see its comment). All assert via `wireColorPixelCounts()`, the
 * `?test` hook that extracts the wires container in isolation (so combinator/pole
 * sprites can't be mistaken for a wire) and counts red/green/copper pixels.
 *
 * Note: these run on headless WebGL (SwiftShader) and confirm every wire colour
 * paints pixels — i.e. no colour silently drops out — over a trivial blueprint
 * and a dense, real-world 96-wire combinator blueprint.
 */

const SIMPLE_BLUEPRINT =
    '0eJyd0u9qhDAMAPB3yec4rr1Wpq8iMtQLI2BTqXXbIX33VQfb4Dbh7lP/pb+kpCv040JTYIlQr8CDlxnqZoWZX6Ubtz3pHEEN20nsJBaDdz1LF32AhMByoQ+oVWoRSCJHpi9gX1xfZHE9hRyARxDC5Od818uWMXunJ4tw3ceU8EbT92nqWDs/Vpv+WzOP1faPZr81RxdeXEEjDTHwUEx+pFvOHj+1vJOrfnO5xe8c9v42ChVqVC025zwa1Hlm0WKJts1xHMnlJD+fC+GNwrzDttSVqSprKv1cmlNKn9W808o='

/**
 * A real 58-entity / 96-wire combinator blueprint (decider/arithmetic/selector/
 * constant combinators, poles, roboport, display panel, …) — the blueprint from
 * the "paste a wire-heavy blueprint, get zero wires" report.
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

    // Assert every colour paints pixels so a colour silently dropping out fails.
    const counts = await wireCounts(page)
    expect(counts.copper, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.red, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.green, JSON.stringify(counts)).toBeGreaterThan(0)
})

test('a wire-dense combinator blueprint renders all its wires', async ({ page }) => {
    await page.goto(`/?test&source=${encodeURIComponent(DENSE_BLUEPRINT)}`)
    await waitForReady(page)
    await page.waitForTimeout(2000)

    // 96 mostly-short circuit wires plus copper — every colour should be present.
    const counts = await wireCounts(page)
    expect(counts.copper, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.red, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.green, JSON.stringify(counts)).toBeGreaterThan(0)
})

/**
 * Distinct from the `?source` loads above: this drives the *paste-as-ghost* path
 * (`Editor.appendBlueprint` → `PaintBlueprintContainer` → place), the touch/drag
 * paste mode from #30. `appendBlueprint` used to rebind the pasted entities to the
 * (empty) target blueprint, so the ghost serialized *zero* wires and a placed
 * paste had no circuit/copper connections at all — even though the same blueprint
 * loaded via `?source` (which keeps the source blueprint) wired up fine. The drop
 * is plain logic (not GPU-dependent), so it reproduces here on WebGL and this
 * guards it directly. Keyboard-driven, so desktop only (touch pastes via the
 * action rail, same `appendBlueprint` seam).
 */
test('pasting a blueprint and placing it keeps its wires', async ({ page, context }) => {
    test.skip(test.info().project.name !== 'desktop-chromium', 'keyboard paste is desktop-only')

    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined)
    await page.goto('/?test')
    await waitForReady(page)
    await page.evaluate(s => navigator.clipboard.writeText(s), DENSE_BLUEPRINT)

    const canvas = page.locator('canvas').first()
    const box = (await canvas.boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    // focus the canvas, then Ctrl+Shift+V => appendBlueprint (spawns a paste ghost)
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } })
    await page.keyboard.press('Control+Shift+KeyV')

    // the async clipboard read + spawn settles into a multi-entity "blueprint" ghost
    await expect
        .poll(async () => page.evaluate(() => (window as any).__FBE_TEST__.getState().paint.kind))
        .toBe('blueprint')

    // place the ghost with a left click (the desktop build action)
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(1000)

    const state = await page.evaluate(() => (window as any).__FBE_TEST__.getState())
    expect(state.blueprint.entityCount, 'paste should place the entities').toBeGreaterThan(0)

    // The bug placed the entities but no wires (red === green === copper === 0).
    const counts = await wireCounts(page)
    expect(counts.copper, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.red, JSON.stringify(counts)).toBeGreaterThan(0)
    expect(counts.green, JSON.stringify(counts)).toBeGreaterThan(0)
})
