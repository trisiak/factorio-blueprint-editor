import { test, expect, type Page } from '@playwright/test'

// A self-contained vanilla-2.0 blueprint string (a wooden chest). It starts with
// '0', so the loader decodes it locally — no `/corsproxy` round-trip (which the
// preview server doesn't provide).
const CHEST =
    '0eJxtjs0OgjAQhN9lztUgoRD6KsYYfjbapGwJLSohfXcX9ODBy2x2M9/MrmjdTONkOcKssJEGmJ+bwoOmYD3D6DKvi7rWRZ5VVVEquKYlJ+5xc4R4iCTS3UUFs53nAHOWTO7pBXNSCPbGjdt6uBlIyKf3PfGXSemiQBxttPQh92W58jy0NO0J/ziF0QeBth9XSFN21ArLPiUzpTfn9ku6'

/** Wait until the editor has finished loading (data + atlas in, loading screen off). */
async function waitForReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

/** Seed the legacy autosave slot before any app code runs (re-applied per navigation). */
async function seedLegacyAutosave(page: Page, value: string): Promise<void> {
    await page.addInitScript(v => {
        try {
            window.localStorage.setItem('fbe:blueprint', v as string)
        } catch {
            /* ignore */
        }
    }, value)
}

const legacySlot = (page: Page): Promise<string | null> =>
    page.evaluate(() => window.localStorage.getItem('fbe:blueprint'))

// The opt-in canvas-state probe (present only with `?test`).
type TestHookWindow = { __FBE_TEST__: { getState(): { blueprint: { entityCount: number } } } }
const entityCount = (page: Page): Promise<number> =>
    page.evaluate(
        () => (window as unknown as TestHookWindow).__FBE_TEST__.getState().blueprint.entityCount
    )

const indicator = (page: Page) => page.locator('#active-project')

// The blueprint is now persisted by the in-app library (a rich document in
// IndexedDB), which replaced the single-slot `fbe:blueprint` localStorage
// autosave. These cover the two seams that matters at boot: migrating the legacy
// slot, and reopening the active project across a reload.
test.describe('blueprint persistence (library-backed)', () => {
    test('migrates a legacy single-slot autosave into the scratchpad', async ({ page }) => {
        await seedLegacyAutosave(page, CHEST)
        await page.goto('/')

        // The legacy blueprint comes back as the scratchpad's content...
        await expect(page.getByText(/Restored your scratchpad/i)).toBeVisible({ timeout: 60_000 })
        // ...and the migration consumes the old localStorage slot.
        await expect.poll(() => legacySlot(page)).toBeNull()
    })

    test('reopens the active blueprint across a reload', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST)}`)
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await expect.poll(() => entityCount(page)).toBe(1)
        const name = ((await indicator(page).textContent()) ?? '').trim()
        expect(name).not.toBe('')

        // Reload with no `?source` — the library should reopen the active project
        // it persisted (the imported blueprint), not start blank.
        await page.goto('/?test')
        await waitForReady(page)
        await expect.poll(() => entityCount(page), { timeout: 30_000 }).toBe(1)
        await expect(indicator(page)).toHaveText(name)
    })
})
