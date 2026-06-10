import { test, expect, type Page } from '@playwright/test'

// Desktop merge-safety net. All the placement/mine coverage in
// touchPlacement.spec.ts drives the *touch* path; PR #6 (Space Age) reworks the
// build/paint pipeline and merges the input dispatch in the same auto-merging
// BlueprintContainer.ts, affecting the *desktop* (mouse) path too. This exercises
// desktop left-click-to-build and right-click-to-mine end to end so a merge that
// breaks them (without a git conflict) fails a test.

interface BuildState {
    blueprint: { entityCount: number }
}

const entityCount = (page: Page): Promise<number> =>
    page
        .evaluate(() =>
            (
                window as unknown as { __FBE_TEST__: { getState: () => BuildState } }
            ).__FBE_TEST__.getState()
        )
        .then(s => s.blueprint.entityCount)

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

test.describe('desktop build / mine', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'desktop-chromium',
            'desktop mouse pipeline runs on the desktop project only'
        )
    })

    test('left-click places an entity and right-click mines it', async ({ page }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem(
                'quickbarItemNames',
                JSON.stringify(['assembling-machine-2'])
            )
        })
        await page.goto('/?test')
        await waitForLoaded(page)

        const at = { x: 320, y: 360 } // open canvas, clear of corner/side UI

        await page.locator('#editor').focus()
        await page.mouse.move(at.x, at.y) // pointer inside so the ghost shows
        await page.keyboard.press('1') // hold assembling-machine-2 (paint)

        await page.mouse.click(at.x, at.y) // build
        await expect.poll(() => entityCount(page)).toBe(1)

        await page.keyboard.press('Escape') // drop the held cursor -> NONE
        // Re-enter the tile so hover updates to the placed entity (EDIT).
        await page.mouse.move(at.x + 80, at.y + 80)
        await page.mouse.move(at.x, at.y)
        await page.mouse.click(at.x, at.y, { button: 'right' }) // mine
        await expect.poll(() => entityCount(page)).toBe(0)
    })
})
