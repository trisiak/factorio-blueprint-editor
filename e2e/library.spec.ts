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

        // The scratchpad is always live — you can't save a version into it.
        await expect(panel(page).getByRole('button', { name: /save version/i })).toBeDisabled()

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
        // A named entry (unlike the scratchpad) can hold versions, so Save is live.
        await expect(panel(page).getByRole('button', { name: /save version/i })).toBeEnabled()

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

    test('new project discards live scratchpad work after confirming', async ({ page }) => {
        // Build an entity straight onto the (empty) scratchpad via the quickbar —
        // the only at-risk work "New project" warns about. Mirrors desktopBuild.
        await page.addInitScript(() => {
            window.localStorage.setItem(
                'quickbarItemNames',
                JSON.stringify(['assembling-machine-2'])
            )
        })
        await page.goto('/?test')
        await waitForReady(page)
        await expect(indicator(page)).toHaveText('Scratchpad')

        const at = { x: 320, y: 360 } // open canvas, clear of corner/side UI
        await page.locator('#editor').focus()
        await page.mouse.move(at.x, at.y)
        await page.keyboard.press('1') // hold assembling-machine-2 (paint)
        await page.mouse.click(at.x, at.y) // build into the scratchpad
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        await panel(page)
            .getByRole('button', { name: /new project/i })
            .click()

        // Live scratchpad content is at risk, so a sticky confirm toast appears;
        // confirming discards it and starts fresh.
        const discard = page.getByRole('button', { name: /discard & start new/i })
        await expect(discard).toBeVisible()
        await discard.click()

        await expect.poll(() => entityCount(page)).toBe(0)
        await expect(indicator(page)).toHaveText('Scratchpad')
    })
})

test.describe('blueprint library — organization & multi-pack (Phase 2)', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'desktop-chromium',
            'library DOM flows run on the desktop project only'
        )
    })

    // Open the ⋯ menu for the first row matching `name`, then click a menu item.
    async function rowAction(page: Page, name: string, item: RegExp): Promise<void> {
        await panel(page)
            .locator('.library-row', { hasText: name })
            .first()
            .getByRole('button', { name: 'More' })
            .click()
        await page.locator('.library-menu').getByRole('button', { name: item }).click()
    }

    test('creates a folder and moves a blueprint into it', async ({ page }) => {
        page.on('dialog', d => d.accept(/folder/i.test(d.message()) ? 'Logistics' : 'Mall'))
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        // A named, root-level entry to move, and a folder to move it into.
        await panel(page)
            .getByRole('button', { name: /save as/i })
            .click()
        await expect(indicator(page)).toHaveText('Mall')
        await panel(page)
            .getByRole('button', { name: /new folder/i })
            .click()
        await expect(panel(page).locator('.library-folder', { hasText: 'Logistics' })).toBeVisible()

        // ⋯ → Move to… → pick the Logistics folder in the destination picker.
        await rowAction(page, 'Mall', /move to/i)
        await panel(page)
            .locator('.library-picker-list button', { hasText: 'Vanilla 2.0 / Logistics' })
            .click()

        // Mall is now nested one level deep (padding-left 24px = 8 + 1×16).
        await expect(
            panel(page).locator('.library-row[style*="padding-left: 24px"]', { hasText: 'Mall' })
        ).toHaveCount(1)
    })

    test('duplicates a blueprint in place', async ({ page }) => {
        page.on('dialog', d => d.accept('Mall'))
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        await panel(page)
            .getByRole('button', { name: /save as/i })
            .click()
        await expect(indicator(page)).toHaveText('Mall')

        await rowAction(page, 'Mall', /duplicate/i)
        await expect(panel(page).getByText('Mall (copy)')).toBeVisible()
    })

    test('copies a blueprint to another pack and browses it there', async ({ page }) => {
        page.on('dialog', d => d.accept('Mall'))
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        await panel(page)
            .getByRole('button', { name: /save as/i })
            .click()
        await expect(indicator(page)).toHaveText('Mall')

        // ⋯ → Copy to… → Space Age root.
        await rowAction(page, 'Mall', /copy to/i)
        await panel(page)
            .locator('.library-picker-list button', { hasText: 'Space Age (2.0) / (root)' })
            .click()

        // Switch the pack drop-down to Space Age and confirm the copy is there.
        await panel(page)
            .locator('.library-packbar select')
            .selectOption({ label: 'Space Age (2.0)' })
        await expect(panel(page).locator('.library-row', { hasText: 'Mall' })).toHaveCount(1)
        // Browsing a non-active pack disables the active-pack save actions.
        await expect(panel(page).getByRole('button', { name: /save as/i })).toBeDisabled()
    })

    test('the ⋯ menu stays on-screen for a bottom-of-list row', async ({ page }) => {
        page.on('dialog', d => d.accept('P0'))
        // A short viewport so a handful of entries push the last row to the bottom.
        await page.setViewportSize({ width: 1000, height: 420 })
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        await panel(page)
            .getByRole('button', { name: /save as/i })
            .click()
        await expect(indicator(page)).toHaveText('P0')
        // Duplicate enough times to overflow the list.
        for (let i = 0; i < 8; i++) await rowAction(page, 'P0', /duplicate/i)

        // Open the ⋯ menu on the very last row (near the screen bottom).
        const last = panel(page).locator('.library-row').last()
        await last.scrollIntoViewIfNeeded()
        await last.getByRole('button', { name: 'More' }).click()

        const menu = page.locator('.library-menu')
        await expect(menu).toBeVisible()
        const box = (await menu.boundingBox())!
        const vh = page.viewportSize()!.height
        // The whole menu — including its last item — sits within the viewport.
        expect(box.y).toBeGreaterThanOrEqual(-1)
        expect(box.y + box.height).toBeLessThanOrEqual(vh + 1)
        await expect(menu.getByRole('button', { name: 'Delete' })).toBeVisible()
    })
})
