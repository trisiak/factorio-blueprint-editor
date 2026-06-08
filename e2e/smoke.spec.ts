import { test, expect } from '@playwright/test'

test.describe('app loads (desktop)', () => {
    test('renders the editor canvas and finishes loading', async ({ page }) => {
        const fatal: string[] = []
        page.on('pageerror', err => fatal.push(err.message))

        await page.goto('/')

        await expect(page.locator('#editor')).toBeVisible()

        // loadingScreen starts with .active and loses it once data + atlas load
        await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, {
            timeout: 60_000,
        })

        // the old hard mobile block threw MOBILE_DEVICE_NOT_SUPPORTED; desktop
        // must never hit it
        expect(fatal.join('\n')).not.toContain('MOBILE_DEVICE_NOT_SUPPORTED')
    })
})
