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

/**
 * #79 leak guard: blueprint swaps must not grow the renderer's GPU texture
 * pool. Every `Editor.loadBlueprint` (library open, book page-flip, import)
 * used to orphan the outgoing container's RenderTextures — one per wire plus
 * the grid pair — in the renderer's managed-texture hash, where nothing ever
 * frees them; on Firefox/macOS that ended in GPU-memory exhaustion and a dead
 * white page. This cycles the library between a wire-dense and a trivial
 * project and asserts the managed-texture count settles instead of climbing.
 * (Library DOM flows are desktop-only, like library.spec.ts.)
 */
test('blueprint swaps do not leak GPU textures', async ({ page }) => {
    test.skip(
        test.info().project.name !== 'desktop-chromium',
        'library DOM flows run on the desktop project only'
    )

    await page.goto('/?test')
    await waitForReady(page)

    const panel = page.locator('#library-panel')
    const textureCount = (): Promise<number> =>
        page.evaluate(() => {
            const w = window as unknown as { __FBE_TEST__?: { gpuTextureCount: () => number } }
            if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
            return w.__FBE_TEST__.gpuTextureCount()
        })
    const entityCount = (): Promise<number> =>
        page.evaluate(() => (window as any).__FBE_TEST__.getState().blueprint.entityCount as number)

    // Import both fixtures via the library's paste modal.
    await page.locator('#library-button').click()
    await expect(panel).toHaveClass(/active/)
    for (const str of [DENSE_BLUEPRINT, SIMPLE_BLUEPRINT]) {
        await panel.getByRole('button', { name: 'Import…', exact: true }).click()
        await panel.locator('.library-textarea').fill(str)
        await panel
            .locator('.library-dialog')
            .getByRole('button', { name: 'Import', exact: true })
            .click()
    }
    // Imports land as leaves under an "Imported" folder row; pick the leaves by
    // name (the dense fixture is labelled "…The AutoMall.", the unlabelled one
    // gets the "Imported blueprint" default).
    const denseRow = panel.locator('.library-row', { hasText: 'AutoMall' })
    const simpleRow = panel.locator('.library-row', { hasText: 'Imported blueprint' })
    await expect(denseRow).toHaveCount(1)
    await expect(simpleRow).toHaveCount(1)

    // `expect.poll` on the entity count is the "swap finished" signal — the two
    // fixtures differ in size, so each open lands on a distinct value. Opening a
    // project closes the panel, so re-open it before each click.
    const open = async (row: typeof denseRow, expectedEntities: number): Promise<void> => {
        if (!/active/.test((await panel.getAttribute('class')) ?? '')) {
            await page.locator('#library-button').click()
            await expect(panel).toHaveClass(/active/)
        }
        // After a project has been opened once it's also listed under Recents —
        // both rows point at the same node, so any Open button will do.
        await row.getByRole('button', { name: 'Open', exact: true }).first().click()
        await expect.poll(entityCount).toBe(expectedEntities)
        await page.waitForTimeout(300)
    }

    // Fixture entity counts (SIMPLE has 6, DENSE 58 — decoded from the strings).
    const dense = 58
    const simple = 6

    // Warm both blueprints once so lazily-uploaded atlas pages are all resident
    // before the baseline is taken.
    await open(denseRow, dense)
    await open(simpleRow, simple)
    await open(denseRow, dense)
    const baseline = await textureCount()

    for (let i = 0; i < 3; i++) {
        await open(simpleRow, simple)
        await open(denseRow, dense)
    }

    // Same blueprint showing as at baseline ⇒ same texture set. The pre-fix
    // code grew by 2 (grid + chunk grid) per swap — 12 over these 6 swaps —
    // and by ~100 per swap when wires were per-wire RenderTextures.
    const after = await textureCount()
    expect(after, `baseline ${baseline}, after cycles ${after}`).toBeLessThanOrEqual(baseline + 6)
})
