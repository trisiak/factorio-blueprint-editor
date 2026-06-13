import { test, expect, type Page } from '@playwright/test'

/**
 * Circuit editing — asserts an editor opens (without throwing) for every
 * circuit-capable entity type the factory routes: the four combinators plus
 * entities with an enable/disable condition (inserter, pump). This exercises
 * each editor's construction + the type-based routing across both projects.
 *
 * Interaction depth (picking signals, persisting edits) is covered manually /
 * by the unit-tested setters; here we guard against routing/construction
 * regressions, which is what most often breaks.
 */
const BP =
    '0eJyVlNuOm0AMht/Fl9WkIlnINqjti6xWaACnsQQz0zmkG0V593qAkhNNFq4YG//2/8nDEcomoLGkPORHII8t5BcxAXu0jrSCPFuvNulmk6Wr5PU1XQtA5ckTOsjfjv3hUKjQlmghXwpQskXWkpb8rkVP1aLSbUlKem1Z12jH1VH4CB+QJ18zAQcuPAmoyWLV5xIBlVbe6qYocSf3xLVccBYtOF13Qi4mtmSdLxz9UrKJ52EIslotTCM9cmd/MF0seuVu2qCVfTf4wmmHUTLqOi8jlhf+JngTJnQrbbh6WpkfccdlNXKpsaKaax9BWc2CMijeELk8vf0XUB9YoKx2Zx97sj7wZ6fYrzXSdlPm8BO6AQY8yyQ5vf9D1DeZKX96n2T1Is6Y+2YPYaUDLN6kT+Fyfd5dv/P0pGr86FZ4S43n9b+JPtspAb/ZFjvhgNK2ZYs3AH90gRDpZWx+2n46dnLY8Hz68a6sZ+3K5dL3k0yNkI0jbKXzC1IOLQO5b/5tJvuKbBXIF6hk2WANubcBxRged/bZldZ24kJfof5+tatZMol6Pfo0oTX39pbz/k5zbPyRPdDBw7YJVD+/cNEGb81f5Oz38w=='

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

const CIRCUIT_ENTITIES = [
    'arithmetic-combinator',
    'decider-combinator',
    'constant-combinator',
    'selector-combinator',
    'fast-inserter',
    'pump',
]

for (const name of CIRCUIT_ENTITIES) {
    test(`opens a circuit editor for ${name}`, async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const opened = await page.evaluate(
            n =>
                (
                    window as unknown as {
                        __FBE_TEST__: { openEntityEditor: (s: string) => boolean }
                    }
                ).__FBE_TEST__.openEntityEditor(n),
            name
        )
        expect(opened).toBe(true)

        const state = await page.evaluate(() =>
            (
                window as unknown as { __FBE_TEST__: { getState: () => { dialogOpen: boolean } } }
            ).__FBE_TEST__.getState()
        )
        expect(state.dialogOpen).toBe(true)
    })
}
