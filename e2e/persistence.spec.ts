import { test, expect, type Page } from '@playwright/test'

// Two distinct, self-contained vanilla-2.0 blueprint strings (a wooden chest and
// a transport belt). They start with '0', so the loader decodes them locally —
// no `/corsproxy` round-trip, which the preview server doesn't provide. Putting a
// raw base64 string in `?source` means it carries '+', '/' and '=' characters, so
// the tests percent-encode it and rely on the URLSearchParams-based parsing.
const CHEST =
    '0eJxtjs0OgjAQhN9lztUgoRD6KsYYfjbapGwJLSohfXcX9ODBy2x2M9/MrmjdTONkOcKssJEGmJ+bwoOmYD3D6DKvi7rWRZ5VVVEquKYlJ+5xc4R4iCTS3UUFs53nAHOWTO7pBXNSCPbGjdt6uBlIyKf3PfGXSemiQBxttPQh92W58jy0NO0J/ziF0QeBth9XSFN21ArLPiUzpTfn9ku6'
const BELT =
    '0eJxtjt0KwjAMhd8l11Xm2A/rq4hIp0EKXVraTByl7246vfDCm4QczndOMsxuxRAtMegMlnEB/aMpeGJM1hPofminbpr6rm3GsRsUODOjE3eojsQHRhkiVcrePCXQZ4mkO75AnxQk+yDjag2ZBQXkaCgFH79UKRcFSGzZ4ofdj+1K6zJj3DP+kwqCT4LVNzNIW3PsFWz7ltRS3uZDTSw='

/** Wait until the editor has finished loading (data + atlas in, loading screen off). */
async function waitForReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

/** Seed the autosave slot before any app code runs (re-applied on each navigation). */
async function seedSavedBlueprint(page: Page, value: string): Promise<void> {
    await page.addInitScript(v => {
        try {
            window.localStorage.setItem('fbe:blueprint', v as string)
        } catch {
            /* ignore */
        }
    }, value)
}

/** Drive a tab-hidden transition so the `visibilitychange` autosave fires. */
async function hideTab(page: Page): Promise<void> {
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'hidden',
        })
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
        // The real visibilitychange bubbles to window (where the autosave listens),
        // so the synthetic one must too.
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
    })
}

const savedBlueprint = (page: Page): Promise<string | null> =>
    page.evaluate(() => window.localStorage.getItem('fbe:blueprint'))

test.describe('blueprint persistence', () => {
    test('restores a locally saved blueprint when there is no URL source', async ({ page }) => {
        await seedSavedBlueprint(page, CHEST)
        await page.goto('/')

        await expect(page.getByText(/Restored your previous blueprint/i)).toBeVisible({
            timeout: 60_000,
        })
    })

    test('autosaves the blueprint to localStorage when the tab is hidden', async ({ page }) => {
        await page.goto(`/?source=${encodeURIComponent(CHEST)}`)
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)

        // Nothing is persisted yet — the autosave only fires when the tab hides.
        expect(await savedBlueprint(page)).toBeNull()

        await hideTab(page)

        // The encoded string (async encode) lands in the autosave slot.
        await expect.poll(() => savedBlueprint(page), { timeout: 10_000 }).toMatch(/^0/)
    })

    test('offers to restore the saved blueprint when it differs from the URL one', async ({
        page,
    }) => {
        await seedSavedBlueprint(page, CHEST)
        await page.goto(`/?source=${encodeURIComponent(BELT)}`)

        // The URL blueprint is explicit intent, so it wins on load.
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })

        // ...but the mixed state surfaces a prompt to bring the saved one back.
        await expect(page.getByText(/locally saved blueprint that differs/i)).toBeVisible()
        const restoreBtn = page.getByRole('button', { name: /Restore my saved blueprint/i })
        await expect(restoreBtn).toBeVisible()

        await restoreBtn.click()
        await expect(page.getByText(/Restored your saved blueprint/i)).toBeVisible({
            timeout: 30_000,
        })
    })

    test('does not prompt to restore when the saved blueprint matches the URL one', async ({
        page,
    }) => {
        await page.goto(`/?source=${encodeURIComponent(CHEST)}`)
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)

        // Autosave the canonical form of the URL blueprint, then reload the same URL.
        await hideTab(page)
        await expect.poll(() => savedBlueprint(page), { timeout: 10_000 }).toMatch(/^0/)

        await page.reload()
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)

        // saved == URL blueprint, so the restore prompt must not nag. Give the
        // (async) compare a beat before asserting its absence.
        await page.waitForTimeout(1000)
        await expect(page.getByRole('button', { name: /Restore my saved blueprint/i })).toHaveCount(
            0
        )
    })
})
