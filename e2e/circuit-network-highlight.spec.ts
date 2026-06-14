import { test, expect, type Page } from '@playwright/test'

/**
 * #49 — hovering/selecting a wired entity highlights the entities and wires on
 * its circuit network. Drives the real hover (via the `entityScreenPos` test
 * hook, so no guessed coordinates) and checks the highlight-box count.
 *
 * Blueprint: a const→arith→decider chain (the arith shares a network with both
 * neighbours) plus an unrelated const–const red wire. Hovering the arithmetic
 * combinator highlights its two neighbours; the decider only neighbours the
 * arith; moving onto empty space clears the highlight.
 */
const BP =
    '0eJyVU9tugzAM/Rc/TunEtVWRth9BFQqQrpYgYSF0rRD/PgfonXZDeYgv+Njn4LSQFo2oNEoDUQtoRAnRVYzBXugalYQoXHrrYL0OA89ZrYIlAyENGhQ1RHE7OMdENmUqNEQuA8lLQViZkrXh0iwyVaYouVGaUCtVU62FbeEAkfMeMjj2d8cgRy2yIeswC2C0KpJU7PgeqZpK6iFf39o0BspcHPr2WywMjX4XHYdCreSiKrgRNIs5Vn3Mcmfw3fCCmFBAKl3yAuwEZcV1P3kEH32gsXqF3YZO17EH+t65E9dodqUwmL0UwBsFcP9F/wKaUDrHsxZb1LVJavySNDj5f9GlbqoSRK3vBm+UJjkJMjn9Noh8+qYxVTOBm6mKqqeRJ3Xxz7rkIsOcal+JEswSZUS8U+Tai58KNAQWgme7C489akPLYEW62YDPfgNO8riO021OEg1NZsI/2aFg3hNyR7GChyc0gR3Ow/afYxP1H/It8dhlLvOYu2GxvemQ5TGfjo0FlA3JIra/6EeA9A=='

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

type Hook = {
    entityScreenPos: (n: string) => { x: number; y: number } | null
    networkHighlightCount: () => number
}
async function pos(page: Page, name: string): Promise<{ x: number; y: number }> {
    const p = await page.evaluate(
        n => (window as unknown as { __FBE_TEST__: Hook }).__FBE_TEST__.entityScreenPos(n),
        name
    )
    expect(p, `entity ${name} on screen`).not.toBeNull()
    return p as { x: number; y: number }
}
const count = (page: Page) =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: Hook }).__FBE_TEST__.networkHighlightCount()
    )

test('highlights a hovered entity circuit network', async ({ page }, info) => {
    test.skip(
        info.project.name !== 'desktop-chromium',
        'desktop hover only; touch needs the highlight tied to a persistent selection (#49 follow-up)'
    )
    await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
    await waitForAppReady(page)
    await page.waitForTimeout(400)

    const arith = await pos(page, 'arithmetic-combinator')
    const decider = await pos(page, 'decider-combinator')
    // Empty space straight above the chain (the chain is the top row of entities).
    const neutral = { x: arith.x, y: Math.max(2, arith.y - 140) }
    // Hover lands a single move on the target, coming from the neutral point.
    const hover = async (p: { x: number; y: number }) => {
        await page.mouse.move(neutral.x, neutral.y)
        await page.mouse.move(p.x, p.y)
    }

    // Arith shares a network with both neighbours → 2 highlight boxes.
    await hover(arith)
    await expect.poll(() => count(page), { timeout: 4000 }).toBe(2)

    // Empty space → highlight clears.
    await page.mouse.move(neutral.x, neutral.y)
    await expect.poll(() => count(page), { timeout: 4000 }).toBe(0)

    // Decider only neighbours the arith → 1 box.
    await hover(decider)
    await expect.poll(() => count(page), { timeout: 4000 }).toBe(1)
})
