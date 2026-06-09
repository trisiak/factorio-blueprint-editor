import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

/**
 * Smoke coverage for the modpack data layer + Space Age rendering. Drives the
 * production build (which bakes both `vanilla-2.0` and `space-age` packs into
 * `dist/data/`), captures console output, and screenshots each scenario so a
 * human can eyeball the canvas (the PixiJS layer isn't unit-testable).
 *
 * The fixture is a real Space Age space-platform blueprint (asteroid collectors,
 * space platform hub, crusher) — entities that exist ONLY in the space-age pack.
 */
const SA_BLUEPRINT =
    '0eJzdXMtu4zYU/ZWCy4IqRFKyE6NddV2gQJcDw6BpOiFGojwU5U4a+N8LirblhzyRfJpiJjtF0rnkPffFK9J5Jcui0RtnrCezV2JUZWsy+/RKavNkZRHuWVlqMiP1Riqd1Mpoq3Sykeoz2VFi7Ep/JTO2m1OirTfe6Ihv/3hZ2KZcakdmjB7lVIV0yUZaXRBKNlVtvKlsGOgrmSWTX3JKXuLFbkev5PCjHFnXulwWxj4lpVTPxuqE9wgUpwIpcVqZzQ11Dk8XXxpZGP9CZsRWrpRhnsbrMipmViek6PXatCJekrJaNYVuOYnvvhJjF8ZutfWVe4nY7q+MktqHUWdpULP3CdvNd7t5DwtiLAvpR2QhO2HBa1eZVaKqotDKV+6aA35Ogaqsd1WxWOpnuTWVC28p41Rj/KLWfrE2hdeuJjPvGt1SVjeFT05maJui6JlVPszT33L0yVGMsbV2Xveo1Dl39qZO2sploVdRH3q8rSq7OopcG1f7xcDID5nCy5A2sjRNw9/lRjoZuJ+RX8muT6npEKX4uVIr47SKzx96RD4MEclGiXwcIjL9wahn6QCtznjqE8JGhVyXzcUl74y/YwiykyrhjH8utTcqUVW5NFb2zzQ7an7hH/3T7MR2Zqz77Ohf2jy7Nc43bQo9GLZ9I9FSPQeL1jqIWXSGTRgl1UY7GadBfiaUVI3fNKOF93uDGOLjR1L4tfn6hJ4kZKWasin6yZ4cmO6TkY8tbUcfSz9QaWOD0n92rvqJfbI+mV32PfjZwJhgV1mzPyrq+Lw+v25piatESo4xfXZ3P61Se1kURiVdcnlubLBbj8HOkt5v7Y0mRA7b093K7hKBkm5Z2f9SdhdC1Vez0qjgefCFPrMNqXC3TZX9CLVpSMW97ey9yYinIxPJ5JzCj5FHOBuTRwYyy8fIvHLIfpldMEW+N4X068qVyXOzvJaexum2ZvrS6PpkrXAj84T+9Piuq8rFslmvzxcX8WFp6trYp1iKXdOKWpTSa2dkcXz9WoFshAv3cPJuUWqUvgzLnqCkpNpq58xKL1qXWtTmHx1o69G0q9BrWYfl2FvqXlen99PWVTap3IXKrDcRjdG5K8fKNfVzn7aH/MGGmTYscA85JupprCqalV4Yu1BOrr2xT2S2lkWtd99dWpneu0rjHym5Duo9szPN31ij8TGVcJBEkY5q2Q52umrY3ohZqF8Tg6rU4bvAoB5eDCpS6ZnI98xJoZ5dZKWH/qT0zRXyMb8NWV2GmtfU+tIu11wNagbZTfr/d+ZCCRqyrhTZuI4nvaXiDedH+51R1ux6hW/0N/dLOvEBNXpCt3oXkQ/wrFPH6pMxpBW+nRt+gPZHdNV02ObIjU/G4mFUqj9+PZ6MJA3L9V2F02Fmzqhk3TgrW6+7laDjFL+v8p+N7TD5mTIfYw2UDdzYO3PdOSW1etZhllGTolJVWXmzbf/m4uSFgHdaVW6135f0h0+i66Z4qpwklPwtT2M2vrf/NmqsVN5sA4eHYNSL/TNpV4QSb9TnmsymeZpGDbsRrGy2pv72APug6Jd+KXDbFEraBhQ5bxn827iWrU8ZZZQxyua0vRRpexnuUMapOFyLh3ifU0a5OFwLyqaH64yKjPI5/RQeUxHf4RPKD/eD6ChnHng7WO8yaB/id5SH3a2efl01dhU5Cfxc4qcgfgLicxCfgXgB4jmIZxg+xeAg+6DxUd/b+/4U9P278RMQn4P4DMQLEM9BPMPwKQYHZw+SB9oedD3U8/eRNwEj7278BMTnID4D8QLEcxDPMHyKwcHZg+SBtgddD/X8PT4HI+dufA7iMxAvQDwH8QzDpxgcHB00Huo70+7UD+K7d+NzEJ+BeAHiOYhnGD7F4ODooPIg96DroJ67jxwBRs7d+BzEZyBegHgO4hmGTzE4ODqoPMg96Dqg56KBs290OBi4d+MnID4H8RmIFyCeg3iG4VMMDo4OKg9yD5oe9DzQ8dG428c9A+P+bvwExOcgPgPxAsRzEM8wfIrBwdFB5UHuQdODngc6Php3Me5TLOzvhk8weI7BMwwuMDjH4AyCpxAaGxtTHGMdMznmb5izg5EW4xws72B1B4s7WNvB0g5WdrCwY3UdK+tYVceKOlbTsZKOVXSsoIP1HGzfwe4dbN7B3h1s3cHOHWzcsb4da9uxrh1r2rGeHWvZsY4d7Ljv/lA3xeATDJ5hcIHBOQZnEDyF0NjYmOIY6zmEBv0tTh3cSAT3EbFtRGwXEdtExDYBsT3Au0mP+RHcewePjYCnRsBDI+CZEfDICHhiBDswgp0XuReNKY6xjnkM5q5grMRIBU94gUcjwZOR4MFI8FwkeCwSPBWJHYq8F42NjSmOsY55DOauYKzESAV/PwD+fAA8fQ8evsfO3t+LxsbGFBcQOofQmMXHuNs8/h6RzE7+5SglhVzqgszI7+GnbsrTnx7Tv/78g1Cy1a5uB8on/DF7fMynIhfZlO92/wI6oKLe'

// Errors from blocked external resources (the doorbell.io feedback widget, the
// jsdelivr basis transcoder CDN, etc.) are environment noise in the sandbox, not
// app bugs — filter them so assertions only see app/page errors.
const isAppError = (line: string): boolean =>
    !/net::ERR_|Failed to load resource|doorbell|jsdelivr|firebaseio|googleapis/i.test(line)

/** Collect console messages + uncaught page errors for assertions/reporting. */
function captureConsole(page: Page): { messages: string[]; appErrors: string[] } {
    const messages: string[] = []
    const appErrors: string[] = []
    page.on('console', (m: ConsoleMessage) => {
        const line = `[${m.type()}] ${m.text()}`
        messages.push(line)
        if (m.type() === 'error' && isAppError(line)) appErrors.push(line)
    })
    page.on('pageerror', e => appErrors.push(`[pageerror] ${e.message}`))
    return { messages, appErrors }
}

async function waitForReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

test.describe('modpack + Space Age', () => {
    test('vanilla-2.0 pack loads cleanly (baseline)', async ({ page }, testInfo) => {
        const { appErrors } = captureConsole(page)
        await page.goto('/?pack=vanilla-2.0')
        await waitForReady(page)
        await page.waitForTimeout(1500)
        const shot = await page.screenshot()
        await testInfo.attach('vanilla-empty', { body: shot, contentType: 'image/png' })
        console.log('VANILLA app errors:', JSON.stringify(appErrors, null, 2))
        expect(appErrors, appErrors.join('\n')).toHaveLength(0)
    })

    test('space-age pack loads its data + atlas cleanly', async ({ page }, testInfo) => {
        const { appErrors } = captureConsole(page)
        const dataResp: string[] = []
        page.on('response', r => {
            if (r.url().includes('/data/') && r.url().endsWith('data.json'))
                dataResp.push(`${r.status()} ${r.url()}`)
        })
        await page.goto('/?pack=space-age')
        await waitForReady(page)
        await page.waitForTimeout(1500)
        const shot = await page.screenshot()
        await testInfo.attach('spaceage-empty', { body: shot, contentType: 'image/png' })
        console.log('SA data.json requests:', JSON.stringify(dataResp, null, 2))
        console.log('SA app errors:', JSON.stringify(appErrors, null, 2))
        // confirm it fetched the space-age dump, not vanilla
        expect(dataResp.some(r => r.includes('/space-age/data.json'))).toBe(true)
        expect(appErrors, appErrors.join('\n')).toHaveLength(0)
    })

    test('imports a Space Age blueprint under the space-age pack', async ({ page }, testInfo) => {
        const { appErrors } = captureConsole(page)
        await page.goto(`/?pack=space-age&source=${encodeURIComponent(SA_BLUEPRINT)}`)
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await page.waitForTimeout(2000)
        const shot = await page.screenshot()
        await testInfo.attach('spaceage-blueprint', { body: shot, contentType: 'image/png' })
        console.log('SA-BLUEPRINT app errors:', JSON.stringify(appErrors, null, 2))
        expect(appErrors, appErrors.join('\n')).toHaveLength(0)
    })

    // Cross-pack robustness: pasting a Space Age blueprint while on the vanilla
    // pack references prototype data the vanilla dump lacks, so rendering throws.
    // The boot guard in index.ts (loadBp) must catch that, surface an error
    // toast, and fall back to a blank canvas — NOT strand the user on the
    // loading screen (which it used to: the throw escaped before hide()).
    test('vanilla-2.0 degrades (not hang) on a Space Age blueprint', async ({ page }, testInfo) => {
        captureConsole(page)
        await page.goto(`/?pack=vanilla-2.0&source=${encodeURIComponent(SA_BLUEPRINT)}`)

        // The error toast appears and the loading screen clears (no permanent hang).
        await expect(
            page.getByText(/could not be rendered with the current data pack/i)
        ).toBeVisible({ timeout: 60_000 })
        await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
        await page.waitForTimeout(500)
        const shot = await page.screenshot()
        await testInfo.attach('vanilla-sa-blueprint', { body: shot, contentType: 'image/png' })

        // App stays usable (canvas mounted) on a blank fallback.
        await expect(page.locator('#editor')).toBeVisible()
    })
})

/**
 * Pack switching through the settings UI. The "Data Pack" dropdown lives in the
 * dat.gui settings pane (open by default on desktop); selecting an option calls
 * `setDataPack(id)` which persists to localStorage (`fbe:dataPack`) and reloads
 * so the new atlas + data.json are fetched. These cover that path plus the
 * persisted-choice and `?pack=` query precedence in `resolveDataPack`.
 */
test.describe('data pack switching (UI)', () => {
    // Each test does up to two full loads (initial + reload after a switch), and
    // the space-age atlas is large, so give them more than the default 30s.
    test.describe.configure({ timeout: 120_000 })

    /** The dropdown <select> — uniquely identified by its Space Age option. */
    const packSelect = (page: Page) =>
        page
            .locator('select')
            .filter({ has: page.locator('option', { hasText: 'Space Age (2.0)' }) })

    /** Record which pack's data.json gets fetched (after any reload). */
    function watchDataFetch(page: Page): string[] {
        const fetched: string[] = []
        page.on('response', r => {
            const m = r.url().match(/\/data\/([^/]+)\/data\.json/)
            if (m) fetched.push(m[1])
        })
        return fetched
    }

    const dataPack = (page: Page) =>
        page.evaluate(() => window.localStorage.getItem('fbe:dataPack'))

    test('switching to space-age via the dropdown persists + reloads', async ({ page }, ti) => {
        const { appErrors } = captureConsole(page)
        const fetched = watchDataFetch(page)
        await page.goto('/') // no ?pack → default vanilla-2.0
        await waitForReady(page)
        expect(await dataPack(page)).toBeNull() // nothing persisted yet
        expect(await packSelect(page).inputValue()).toBe('vanilla-2.0')

        // Pick Space Age — this triggers setDataPack() → reload. Tolerate the
        // navigation interrupting the action; assert on the post-reload state.
        await Promise.all([
            page.waitForResponse(r => /\/data\/space-age\/data\.json/.test(r.url()), {
                timeout: 60_000,
            }),
            packSelect(page)
                .selectOption({ label: 'Space Age (2.0)' })
                .catch(() => undefined),
        ])
        await waitForReady(page)

        expect(await dataPack(page)).toBe('space-age')
        expect(await packSelect(page).inputValue()).toBe('space-age')
        expect(fetched).toContain('space-age')
        const shot = await page.screenshot()
        await ti.attach('switched-to-space-age', { body: shot, contentType: 'image/png' })
        expect(appErrors, appErrors.join('\n')).toHaveLength(0)
    })

    test('remembers the persisted pack across a plain reload (no ?pack)', async ({ page }) => {
        const fetched = watchDataFetch(page)
        // Persist the choice before any app code runs, then load without ?pack.
        await page.addInitScript(() => window.localStorage.setItem('fbe:dataPack', 'space-age'))
        await page.goto('/')
        await waitForReady(page)
        expect(fetched).toContain('space-age')
        expect(fetched).not.toContain('vanilla-2.0')
        expect(await packSelect(page).inputValue()).toBe('space-age')
    })

    test('round-trips vanilla → space-age → vanilla via the dropdown', async ({ page }) => {
        const fetched = watchDataFetch(page)
        await page.goto('/') // fresh: default vanilla, nothing persisted
        await waitForReady(page)

        // → space-age
        await Promise.all([
            page.waitForResponse(r => /\/data\/space-age\/data\.json/.test(r.url()), {
                timeout: 60_000,
            }),
            packSelect(page)
                .selectOption({ label: 'Space Age (2.0)' })
                .catch(() => undefined),
        ])
        await waitForReady(page)
        expect(await packSelect(page).inputValue()).toBe('space-age')

        // → back to vanilla
        await Promise.all([
            page.waitForResponse(r => /\/data\/vanilla-2\.0\/data\.json/.test(r.url()), {
                timeout: 60_000,
            }),
            packSelect(page)
                .selectOption({ label: 'Vanilla 2.0' })
                .catch(() => undefined),
        ])
        await waitForReady(page)

        expect(await dataPack(page)).toBe('vanilla-2.0')
        expect(await packSelect(page).inputValue()).toBe('vanilla-2.0')
        expect(fetched).toContain('vanilla-2.0')
    })

    test('?pack= query overrides the persisted pack', async ({ page }) => {
        const fetched = watchDataFetch(page)
        // Persisted choice is space-age, but the URL explicitly asks for vanilla.
        await page.addInitScript(() => window.localStorage.setItem('fbe:dataPack', 'space-age'))
        await page.goto('/?pack=vanilla-2.0')
        await waitForReady(page)
        // Query wins for what's loaded/shown…
        expect(fetched).toContain('vanilla-2.0')
        expect(fetched).not.toContain('space-age')
        expect(await packSelect(page).inputValue()).toBe('vanilla-2.0')
        // …but it doesn't rewrite the persisted preference.
        expect(await dataPack(page)).toBe('space-age')
    })
})
