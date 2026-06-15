import { test, expect, type Page } from '@playwright/test'

// Basic end-to-end coverage for the in-app blueprint library (issue #50 /
// docs/blueprint-library.md). The library chrome is plain DOM, so these drive it
// through ordinary locators; canvas state (what's actually placed) is read via
// the opt-in `?test` window hook (`window.__FBE_TEST__`), the same probe the
// other specs use. Desktop only — the panel/flows are pack- and input-agnostic,
// and the desktop viewport keeps the centered panel clear of the toast stack.

const CHEST =
    '0eJxtjs0OgjAQhN9lztUgoRD6KsYYfjbapGwJLSohfXcX9ODBy2x2M9/MrmjdTONkOcKssJEGmJ+bwoOmYD3D6DKvi7rWRZ5VVVEquKYlJ+5xc4R4iCTS3UUFs53nAHOWTO7pBXNSCPbGjdt6uBlIyKf3PfGXSemiQBxttPQh92W58jy0NO0J/ziF0QeBth9XSFN21ArLPiUzpTfn9ku6'

type TestHookWindow = { __FBE_TEST__: { getState(): { blueprint: { entityCount: number } } } }
const entityCount = (page: Page): Promise<number> =>
    page.evaluate(
        () => (window as unknown as TestHookWindow).__FBE_TEST__.getState().blueprint.entityCount
    )

async function waitForReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

const panel = (page: Page) => page.locator('#library-panel')
const indicator = (page: Page) => page.locator('#active-project')

async function openPanel(page: Page): Promise<void> {
    await page.locator('#library-button').click()
    await expect(panel(page)).toHaveClass(/active/)
}

test.describe('blueprint library', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'desktop-chromium',
            'library DOM flows run on the desktop project only'
        )
    })

    test('opens the panel and shows the scratchpad as the working context', async ({ page }) => {
        await page.goto('/?test')
        await waitForReady(page)

        // A fresh load defaults the working context to the scratchpad.
        await expect(indicator(page)).toHaveText('Scratchpad')
        await expect(panel(page)).not.toHaveClass(/active/)

        await openPanel(page)
        await expect(panel(page).getByText(/Scratchpad/)).toBeVisible()
        await expect(panel(page).getByText(/No saved blueprints yet/i)).toBeVisible()

        // The close button dismisses the panel.
        await panel(page).locator('.library-close').click()
        await expect(panel(page)).not.toHaveClass(/active/)
    })

    test('saves the canvas as a new project and reopens it', async ({ page }) => {
        // Save As asks for a name via window.prompt — accept it.
        page.on('dialog', dialog => dialog.accept('Chest project'))

        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        await panel(page)
            .getByRole('button', { name: /save as/i })
            .click()

        // The new project becomes the working context and appears in the tree.
        await expect(indicator(page)).toHaveText('Chest project')
        await expect(panel(page).getByText('Chest project').first()).toBeVisible()

        // Start a fresh project (no unsaved changes → no prompt) — canvas clears.
        await panel(page)
            .getByRole('button', { name: /new project/i })
            .click()
        await expect.poll(() => entityCount(page)).toBe(0)
        await expect(indicator(page)).toHaveText('Scratchpad')

        // Reopening the saved project brings its entity back onto the canvas.
        await panel(page)
            .locator('.library-row', { hasText: 'Chest project' })
            .getByRole('button', { name: 'Open', exact: true })
            .first()
            .click()
        await expect.poll(() => entityCount(page)).toBe(1)
        await expect(indicator(page)).toHaveText('Chest project')
    })

    test('imports a ?source= blueprint under the Imported folder', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        // The URL blueprint became an implied entry (named after the blueprint),
        // not a clobbered scratchpad.
        await expect(indicator(page)).not.toHaveText('Scratchpad')

        await openPanel(page)
        await expect(panel(page).locator('.library-folder', { hasText: 'Imported' })).toBeVisible()
    })

    test('new project discards unsaved work after confirming', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        await panel(page)
            .getByRole('button', { name: /new project/i })
            .click()

        // The imported blueprint has unsaved (uncheckpointed) changes, so a sticky
        // confirm toast appears; confirming discards and starts fresh.
        const discard = page.getByRole('button', { name: /discard & start new/i })
        await expect(discard).toBeVisible()
        await discard.click()

        await expect.poll(() => entityCount(page)).toBe(0)
        await expect(indicator(page)).toHaveText('Scratchpad')
    })
})
