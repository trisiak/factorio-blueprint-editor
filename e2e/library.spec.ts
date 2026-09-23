import { test, expect, type Page } from '@playwright/test'
import pako from 'pako'
import { Buffer } from 'buffer'
import { isChromiumProject, isDesktopProject } from './projects'

// Basic end-to-end coverage for the in-app blueprint library (issue #50 /
// docs/blueprint-library.md). The library chrome is plain DOM, so these drive it
// through ordinary locators; canvas state (what's actually placed) is read via
// the opt-in `?test` window hook (`window.__FBE_TEST__`), the same probe the
// other specs use. Desktop only — the panel/flows are pack- and input-agnostic,
// and the desktop viewport keeps the centered panel clear of the toast stack.

const CHEST =
    '0eJxtjs0OgjAQhN9lztUgoRD6KsYYfjbapGwJLSohfXcX9ODBy2x2M9/MrmjdTONkOcKssJEGmJ+bwoOmYD3D6DKvi7rWRZ5VVVEquKYlJ+5xc4R4iCTS3UUFs53nAHOWTO7pBXNSCPbGjdt6uBlIyKf3PfGXSemiQBxttPQh92W58jy0NO0J/ziF0QeBth9XSFN21ArLPiUzpTfn9ku6'
const BELT =
    '0eJxtjt0KwjAMhd8l11Xm2A/rq4hIp0EKXVraTByl7246vfDCm4QczndOMsxuxRAtMegMlnEB/aMpeGJM1hPofminbpr6rm3GsRsUODOjE3eojsQHRhkiVcrePCXQZ4mkO75AnxQk+yDjag2ZBQXkaCgFH79UKRcFSGzZ4ofdj+1K6zJj3DP+kwqCT4LVNzNIW3PsFWz7ltRS3uZDTSw='

// Raw blueprint-string codec (same `0`+base64(deflate(JSON)) wire format the app
// uses) — lets the tests build a known book fixture and decode an export to
// compare *content* (byte-for-byte equality won't hold: re-encode restamps
// version / renumbers indices / normalises labels). `dec` returns `any` (JSON).
const dec = (s: string) =>
    JSON.parse(pako.inflate(Buffer.from(s.slice(1), 'base64'), { to: 'string' }))
const enc = (o: unknown): string =>
    `0${Buffer.from(pako.deflate(JSON.stringify(o))).toString('base64')}`

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

// Import via the textarea modal (blueprint strings are too long for window.prompt).
async function pasteImport(page: Page, str: string): Promise<void> {
    await panel(page).getByRole('button', { name: 'Import…', exact: true }).click()
    await panel(page).locator('.library-textarea').fill(str)
    await panel(page)
        .locator('.library-dialog')
        .getByRole('button', { name: 'Import', exact: true })
        .click()
}

test.describe('blueprint library', () => {
    test.beforeEach(() => {
        test.skip(!isDesktopProject(), 'library DOM flows run on the desktop projects only')
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

    test('local-only fallback: no sign-in control, and the library still works', async ({
        page,
    }) => {
        // The e2e build ships without VITE_FIREBASE_* config, so cloud sync is
        // "unconfigured" — firebaseConfigured() is false and the panel renders no
        // sync chrome (pixel-identical to the pre-Phase-6 local-only editor).
        page.on('dialog', dialog => dialog.accept('Local project'))
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        // No cloud-sync UI at all: the sync bar is hidden and there's no sign-in.
        await expect(panel(page).locator('.library-sync')).toBeHidden()
        await expect(panel(page).getByRole('button', { name: /sign in/i })).toHaveCount(0)

        // …and the library is fully functional: a Save As round-trips through the
        // local store — reopen after a New project brings the entity back.
        await panel(page)
            .getByRole('button', { name: /save as/i })
            .click()
        await expect(indicator(page)).toHaveText('Local project')
        await panel(page)
            .getByRole('button', { name: /new project/i })
            .click()
        await expect.poll(() => entityCount(page)).toBe(0)
        await panel(page)
            .locator('.library-row', { hasText: 'Local project' })
            .getByRole('button', { name: 'Open', exact: true })
            .first()
            .click()
        await expect.poll(() => entityCount(page)).toBe(1)
        await expect(indicator(page)).toHaveText('Local project')
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
        test.skip(!isDesktopProject(), 'library DOM flows run on the desktop projects only')
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

        // Opening from a non-active pack asks to switch via a modal *inside the
        // panel* (not a toast, which would sit behind it). Cancel keeps us put.
        await panel(page)
            .locator('.library-row', { hasText: 'Mall' })
            .getByRole('button', { name: 'Open', exact: true })
            .click()
        const dialog = panel(page).locator('.library-dialog')
        await expect(dialog.getByRole('button', { name: /switch & open/i })).toBeVisible()
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await expect(panel(page).locator('.library-dialog')).toHaveCount(0)
        await expect(panel(page)).toHaveClass(/active/)
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

    test('restores an older saved version onto the canvas', async ({ page }) => {
        page.on('dialog', d => d.accept('Proj'))
        await page.addInitScript(() => {
            window.localStorage.setItem(
                'quickbarItemNames',
                JSON.stringify(['assembling-machine-2'])
            )
        })
        // Start from a 1-entity blueprint and save it as version 1.
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)
        await openPanel(page)
        await panel(page)
            .getByRole('button', { name: /save as/i })
            .click()
        await expect(indicator(page)).toHaveText('Proj')

        // Close the panel to reach the canvas, add a 2nd entity, reopen and save
        // that as version 2 (now 2 entities).
        await panel(page).locator('.library-close').click()
        await expect(panel(page)).not.toHaveClass(/active/)
        const at = { x: 360, y: 380 }
        await page.locator('#editor').focus()
        await page.mouse.move(at.x, at.y)
        await page.keyboard.press('1')
        await page.mouse.click(at.x, at.y)
        await expect.poll(() => entityCount(page)).toBe(2)
        await openPanel(page)
        await panel(page)
            .getByRole('button', { name: /save version/i })
            .click()
        await expect(
            panel(page).locator('.library-row', { hasText: 'Proj' }).first()
        ).toContainText('v2')

        // Open Versions… and restore the older version (the last row) → back to 1 entity.
        await rowAction(page, 'Proj', /versions/i)
        const versions = panel(page).locator('.library-version')
        await expect(versions).toHaveCount(2)
        await versions.last().getByRole('button', { name: 'Restore' }).click()
        await expect.poll(() => entityCount(page)).toBe(1)

        // Delete the latest version from the still-open viewer → one version left.
        await versions.first().getByRole('button', { name: 'Delete' }).click()
        await page.locator('.library-dialog').getByRole('button', { name: 'Delete' }).click()
        await expect(panel(page).locator('.library-version')).toHaveCount(1)
    })

    test('exports a folder as a native book and imports the string back', async ({ page }) => {
        // Chromium-only, not just desktop: reading back what the app put on the
        // clipboard needs `grantPermissions('clipboard-read')` +
        // `navigator.clipboard.readText()`, neither of which Firefox exposes to a
        // page. The rest of the library flows above do run on both desktop browsers.
        test.skip(!isChromiumProject(), 'clipboard read-back is Chromium-only')
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        // The ?source import left an "Imported" folder holding the blueprint.
        await expect(panel(page).locator('.library-folder', { hasText: 'Imported' })).toHaveCount(1)

        // Export it as a book → the native string lands on the clipboard.
        await rowAction(page, 'Imported', /export as book/i)
        const exported = await page.evaluate(() => navigator.clipboard.readText())
        expect(exported.startsWith('0')).toBe(true)

        // Import that string back → it decomposes into a second "Imported" folder.
        await pasteImport(page, exported)
        await expect(panel(page).locator('.library-folder', { hasText: 'Imported' })).toHaveCount(2)
    })

    test('collapses and expands a folder', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        const folderName = panel(page)
            .locator('.library-folder', { hasText: 'Imported' })
            .locator('.library-row-name')
        // Folders start open (📂); their children are shown.
        await expect(folderName).toContainText('📂')
        const rows = panel(page).locator('.library-row')
        const open = await rows.count()

        // Click the folder → collapses (📁) and hides its child row(s).
        await folderName.click()
        await expect(folderName).toContainText('📁')
        expect(await rows.count()).toBeLessThan(open)

        // Click again → expands back to the original rows.
        await folderName.click()
        await expect(folderName).toContainText('📂')
        expect(await rows.count()).toBe(open)
    })

    test('edits a folder/book description and persists it across reload', async ({ page }) => {
        page.on('dialog', d => d.accept('My book desc'))
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)

        await openPanel(page)
        await rowAction(page, 'Imported', /edit description/i)

        // The folder is a book now — its description shows on hover (title) + a ⓘ hint.
        const folder = panel(page).locator('.library-folder', { hasText: 'Imported' })
        await expect(folder).toHaveAttribute('title', 'My book desc')
        await expect(folder.locator('.library-row-name')).toContainText('ⓘ')

        // It's stored in the rich document → survives a reload.
        await page.goto('/?test')
        await waitForReady(page)
        await openPanel(page)
        await expect(
            panel(page).locator('.library-folder', { hasText: 'Imported' })
        ).toHaveAttribute('title', 'My book desc')
    })

    test('importing a known book then exporting it preserves content + metadata', async ({
        page,
    }) => {
        // Chromium-only, not just desktop: reading back what the app put on the
        // clipboard needs `grantPermissions('clipboard-read')` +
        // `navigator.clipboard.readText()`, neither of which Firefox exposes to a
        // page. The rest of the library flows above do run on both desktop browsers.
        test.skip(!isChromiumProject(), 'clipboard read-back is Chromium-only')
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
        // A known-good vanilla book: two real blueprints (chest, belt) wrapped in a
        // book with a label / description / icons.
        const chest = dec(CHEST).blueprint
        const belt = dec(BELT).blueprint
        const icons = [{ signal: { type: 'item', name: 'wooden-chest' }, index: 1 }]
        const BOOK = enc({
            blueprint_book: {
                item: 'blueprint-book',
                active_index: 0,
                version: chest.version,
                label: 'My Book',
                description: 'hello world',
                icons,
                blueprints: [
                    { index: 0, blueprint: chest },
                    { index: 1, blueprint: belt },
                ],
            },
        })

        await page.goto('/?test')
        await waitForReady(page)
        await openPanel(page)

        // Import (decomposes into a folder named after the book)…
        await pasteImport(page, BOOK)
        await expect(panel(page).locator('.library-folder', { hasText: 'My Book' })).toBeVisible()

        // …then export it back and decode (content survives; bytes won't match).
        await rowAction(page, 'My Book', /export as book/i)
        const out = dec(await page.evaluate(() => navigator.clipboard.readText())).blueprint_book

        // Book-level metadata is intact (Phase 5a)…
        expect(out.label).toBe('My Book')
        expect(out.description).toBe('hello world')
        expect(out.icons).toEqual(icons)
        // …and each blueprint's content (entities) round-trips, in order.
        expect(
            out.blueprints.map((e: { blueprint: { entities: unknown } }) => e.blueprint.entities)
        ).toEqual([chest.entities, belt.entities])
    })

    test('opens a folder as a navigable book, then exits the view on a leaf open', async ({
        page,
    }) => {
        const chest = dec(CHEST).blueprint
        const belt = dec(BELT).blueprint
        const BOOK = enc({
            blueprint_book: {
                item: 'blueprint-book',
                active_index: 0,
                version: chest.version,
                label: 'Nav Book',
                blueprints: [
                    { index: 0, blueprint: chest },
                    { index: 1, blueprint: belt },
                ],
            },
        })

        await page.goto('/?test')
        await waitForReady(page)
        await openPanel(page)
        await pasteImport(page, BOOK)
        await expect(panel(page).locator('.library-folder', { hasText: 'Nav Book' })).toBeVisible()

        // Open the folder as a book — it loads onto the canvas (first blueprint =
        // the chest, 1 entity) and the indicator flips to book-view.
        await panel(page)
            .locator('.library-row', { hasText: 'Nav Book' })
            .getByRole('button', { name: 'Open as book', exact: true })
            .click()
        await expect.poll(() => entityCount(page)).toBe(1)
        await expect(indicator(page)).toHaveText('📖 Nav Book')

        // While viewing a book there's no leaf to save to — Save is suspended.
        await openPanel(page)
        await expect(panel(page).getByRole('button', { name: /save version/i })).toBeDisabled()

        // Opening a blueprint leaf exits the book-view (back to a normal project).
        await panel(page)
            .locator('.library-row', { hasText: 'persist-test-chest' })
            .first()
            .getByRole('button', { name: 'Open', exact: true })
            .click()
        await expect(indicator(page)).not.toContainText('📖')
        await expect.poll(() => entityCount(page)).toBe(1)
    })
})
