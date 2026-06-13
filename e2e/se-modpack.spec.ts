import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'

/**
 * Smoke coverage for the Space Exploration modpack pack (SE 0.7.56 on
 * Factorio 2.0.76, 33 portal mods). Mirrors `sa-modpack.spec.ts`: drive the
 * production build, capture console output, screenshot each scenario for
 * human eyeballing (the PixiJS layer isn't unit-testable).
 *
 * The fixture is a real SE blueprint book (user-provided): print 0 is a
 * "Delivery Chest Station" (aai-warehouse, aai-signal-sender, combinators,
 * requester chests, textplates), print 1 a "Delivery Cannon"
 * (se-delivery-cannon + chest, aai-signal-receiver) — entities that exist
 * ONLY in the space-exploration pack, exercising the portal-mod sprite
 * pipeline end to end.
 */
const SE_BOOK =
    '0eNrtWm1v2zgS/iuEPh5kw5LltwBdIE1dXLBp0m3SBQ5tzqBl2iYik16KStZX5L/fDKkXv9Cx7BS9LW6BNpBlcmY4fGb4zNDfvHGSsaXiQo/GUj54Z9+qN6l39mXtI343YWms+FJzKbwz73Z49/nj2VfxVQRNciHFlM8yxYieM/KFa7Z4k7LGhCX8kalVI6ZCSNGI5yzV9+TyHeHCjNRySRSfzXU+J5Yi1VToRiwXYy6oluq++VWE2xoU+yMDUSTh8GdNVsKmB0S1m2Qo0rqW8pSAHMFizSagYMvm4YePd/8iF/8c3t7h34tfh58IeeJ6TiiZKcYEfFAMlEbGfhSTa6SUN56oYnOZpezeP2CGn89SciyXUoFduSljqbVc2FV/Gv722Rhy8+Hj+afzu5tPhSkKbM8N6TTJLVs3IuUzQZNGysSEqVJuLJVCY+M5mMGSpud7HP1pMGGnICAEXTBAwj67vWeYBnL/9M6CZ98xcceAtRnh873vMaG55szqNR9WI5EtxjDyLPAP6ve9pUy5xes3D4S2u/1mx/dWMLs3aHae0aotsWEpVrM/9TKhmjXSBU2SBjynmscuqa1Caj8Aqb73SBWndkQQOZS0SyUOlLoUBKWCllEw4bg/VgFYDFK0kslozOb0kYMImJfaAenmM/ix3JJ7WL8Hq1oxNdqM7QJLV5e3dxjhiJmVzFQRdwAoRFBK5gxgRd5LhWHyyARnImY+YTSelzEKMbTIEs2XCYd54xXptHySSpIyrbmY5WDkCrbNuNugMCALRkUKaITpxe4ScBVaSJ7AYykOS8FfDATuCvFL+VzjyDAXGLRAe7v4gKYwHTc9xyZF5SbBbur5gsHmH9im9gYKamxSJXkEX094uWNTrlI9KtBhYAmbCENGR4WfXDKVA9H7N1gsM73M9DEy9mLk7eXdh/PbX8nF+dXF5yvMN4iUC4SBws2BNDLPFlQ0FKMTOk4gW3G9oOkDMQAkfELk9HACFnlKsrtisx7sqIJjiUHSAE15+p+wmEOcknQF+Fw0yRWgQBEpNs4Lu/AU0mGSkDHbAqYBG+gDEMuJOSAWlQG59U6odE5JGuFWTK8ljY5DR/cUHe39OoKWQ0nv2MTU2cp83yMx+YD+BDZv++3hdP9HRhNYDgwSUoFvPLRgsaTKmH/mvTEvMgyoFqS//Qnw3fDq8vfhJzjcz6+vb67zM/7yHUL8DlEiGJvYDASpkR6EscWdb09ke8KCFRgJPKYmS+FLMEWAOD6BgXMOKRSEEEXFjJGpgnO+1Wi3mmjCEPNrfjhjFBmI0wmXYJd+kurBzDSBAbY+Ucic2RKZA2kHVTa1JhJjYurEdf8UzHX2Yy4MHEoGpyiJ9ivpOXQErVOUdPcf65EreoIKpFMQ2uAihVzInIHT25DtEha+zuRd54cuLe36JvcPmhzVFzY4KKxKqgs24dmiwRLIFgoO4aVMmENmr3VQZvd17K697dOBS0nvdUrCnUztRHT/eHpSschwM1X3T2InFYvQqyUa8siVzkzWLVK1JfdIB5GN5AymYjUN4F8bHOUfLo5SS/pBLvvh89Xd5cery4uCqpg8XhKAlMAGQcoED2I6zglDajM20sRxBok+Ad66oA8steRAsBlY/sgMn4U3Jqcir7D7YOquPOHTGI03hJXOCjpTkhcBQCHV5jmTcTA4NiDWKEa4p9ppHY+iaAOnayiKfiiKas97u02ETweZv2HzKD9szWKgyPbOtMqY75nS3zubAlrYtr27c8ywchJK2I9lS0Ns2+H95dXdsAIy/KMkpVOmV1jc2A6HJMCSoSzTRMKJb4psAHeTXBrKACMo/hcwA8kyR2acA/JgRwIH2SWRL7nT8lr+TeH3+5JmQ/hMeApFQMF01vs3TXIjkhXhlsaA/NjUjGyx1CvfigDCD1ICH2NUPrmEwAsls9mcZGIhJ3wKjN4ZRGF1RGPBMAGvvIz27j6076O3udgtrK9/+nI89HEHgMuJGWJwi9Jio8TCebs/UycwYrlcjQwbHSHHHHEBggrw7ifIjtZXXv6ZLled3tojp2Zc1Skr2k/GBkCpNmh4wGRLrcycshbwAOxCFYnoyR1gFe/FYw5YgBqvMObGySv7QJ06rDRsv05JtMMUui4t0WuYQvT8P8rqR3Y3ft6kXhCUoqEyvL64eTd0UhTTV4uxE66AApQJsCQZeY/CJyzF3ggkdAiNmbQJ0+ZHIwIjk6BzfBNB04Qvl0VWxe7KVKq8Ss2b7pOD0QyhK4U7lCoiv9vwfbG0s0HkQh/2lEamBTmCdM+wnPe93B2jsnuwv/Hpe5rObGK2VTTW/GxKwdWekyd1N9ZQtu6dVUhhvVPQK4uD3k4h6qrqwpMK92C/lrar0AkHr1tLt1aF2m4deWJXy+g+/8Aj2lYhp57FRSo68TjevfzZPo2LwiM/YjGk7TGLAy+15VkzpkmaLTC3ZMsqrRRlTplw6AItTG32gBECvtGZEqnJHKaQMtcD5txGjlkVSrzJmkRI1DOd8pjDbicrY93Kt+NNcsqvrmybTE5J0DQ8B1kCevZL4Ac+BGVw78Nj6AOtC+GxDY9QGONjBI+9/AmeI/MYdPyOD3VUB5/78B7Ahe+hDApwTNs+G3mRfQaRHaMGvg5wvBnTtc/BPdiE9sIWVFelvpfQcZ5S8lbbBSZJcmuvL2AAvExtp7cbDqLBoNOPWmEr6lf3X6a/9ML1a2Bv8iqitZZbgaMy1Lv3Pq+4Ud3iaq6y8r7YivwKkk0auAml6P3K7WXrppG758e92W+oD8BBGNOwOnthemjiyZfJnUq2gVo+284sbzWqW1QrbDf3oKxunQWCp26uYXBve3Bxm6bytaSFU4ty7OiL12OuXIuNOu3Std79QFT2DAftn/J+4MUbYof/HS4o+czA8nVwAF/uMXRJ4wegRo1YraQAjDSUnHjFlJHD/ILGrIWPPcukmuBnhp9gRiMImr0g6kftHliDdg2a7W477Ach2vQfKdgoX9U1zR6Bdt4oYIKIDUuwAEpilrCGpgpOCSdJah/bn4rKJvig4+5PHV+6rMmMvkeT8y9xBfvilWNtz1Sx2Pm+7d9qBRu4/Q5V3fn1uxPquvc/sKh78abWlW13N6bT3soQP6riuTCeT53BXNUp4yx5eOkqJyov/Aa9Zj1kxVzFGdcjJvCHAeV2FK9LtJ3QT3hvWXQRtK2tDP+L59yyfv3VRj//agf1V1tl027Ndv9fbrVrd78Hl9v9+Td37RJ6i1++fCZ0c3JSL6OcwMHoMs0MDTiChRkSW5BTf99Bc5TIsFX89OOlK/carqvSXv9v1639jqCG66K/Xef81UQN13X/f1232f8J/Sjv+QS+7dDgk20JYcunY77twNPAPPVgRr98CmzjZ1A81u3jFFXe4QZO8OyQ2TC/s68Ev+UzsiWcXDP93cv+Gj/RDk/oF7SP/ll3hF6hMfYCR0Wn6wVvPv8XIM6aHg=='

// A second fixture exercising the entity types that #45/#46 brought from a
// box/partial fallback to a real render: stripes-split (core miner, area drill),
// directional idle (casting machine), idle_animation furnace (big/condenser
// turbine), plain-shape generator/lamp/eei/container (turbine generator,
// elevator lamp, rocket-launch-pad), the storage-tank space pipe, a deep-space
// underground belt, the roboport-shaped aai-signal-receiver, plus the type-
// routed module editors (wide beacon w/ 20 slots, space science lab). One of
// each, so a regression in the shape normalization surfaces here end-to-end.
const SE_RENDER_FIXTURES =
    '0eNqFlLFugzAQQH8FMeckTIBA9q5dOnSoqsrAlVg1BtkmTRTx7z0nC6QGFmyO453x83ELSzlgr4Wy4TG4hcJiS5NJdBeEkpcoXfTtJdCoatTBt7jYQaNxj1FZYQXNj8HH7XF3/VJDW6KmEKMMxVt07xuEGrEH0/MKYXCkRnc0AhWw4Io6YN8ZAnbqvqILXSMKXt04jrvgf4l4XuJB70Xvh7FsnbZfooHsVAMGWOrl7uN1bjLnVp1GaIVCDbUWUnqZSb7OTJ+Y3FhBa2x5dSKyF5kl68hsjixFA2S6XMLlG24Oz19N0pWhj16DFhuK8sU1QoO0o9x2Gl7f/frZhqfC5x8lnu9Uydvez403XLFoDtZd9YOWgIOqTtDz2o9NNnyxpwb7FTXtCHLaaYgXGmDDGfM2lKkEKhrpb+DHHjassWlncY3cHX93XJfPPys2ZLFpV3EuwIhGcQkaKxRnSvFR42ii6pOmlGgeCWkWF0lRpHkSxVGSj+Mf9S+XIA=='

// Errors from blocked external resources (pixi's jsdelivr basis-transcoder CDN
// fallback, a blueprint host's firebase backend, etc.) are environment noise in
// the sandbox, not app bugs — filter them so assertions only see app/page errors.
const isAppError = (line: string): boolean =>
    !/net::ERR_|Failed to load resource|jsdelivr|firebaseio/i.test(line)

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

test.describe('modpack + Space Exploration', () => {
    // Two full data+atlas loads in the book test; the SE atlas is the largest.
    test.describe.configure({ timeout: 120_000 })

    test('space-exploration pack loads its data + atlas cleanly', async ({ page }, testInfo) => {
        const { appErrors } = captureConsole(page)
        const dataResp: string[] = []
        page.on('response', r => {
            if (r.url().includes('/data/') && r.url().endsWith('data.json'))
                dataResp.push(`${r.status()} ${r.url()}`)
        })
        await page.goto('/?pack=space-exploration')
        await waitForReady(page)
        await page.waitForTimeout(1500)
        const shot = await page.screenshot()
        await testInfo.attach('se-empty', { body: shot, contentType: 'image/png' })
        console.log('SE data.json requests:', JSON.stringify(dataResp, null, 2))
        console.log('SE app errors:', JSON.stringify(appErrors, null, 2))
        expect(dataResp.some(r => r.includes('/space-exploration/data.json'))).toBe(true)
        expect(appErrors, appErrors.join('\n')).toHaveLength(0)
    })

    // The inventory crashed twice on SE data (0-255 icon tints; `{}` empty-Lua-
    // table groups) — keep it covered under the pack that surfaced both.
    test('inventory opens under the space-exploration pack', async ({ page }, testInfo) => {
        const { appErrors } = captureConsole(page)
        await page.goto('/?pack=space-exploration')
        await waitForReady(page)
        await page.waitForTimeout(1500)
        await page.keyboard.press('e')
        await page.waitForTimeout(1500)
        const shot = await page.screenshot()
        await testInfo.attach('se-inventory', { body: shot, contentType: 'image/png' })
        console.log('SE-INVENTORY app errors:', JSON.stringify(appErrors, null, 2))
        expect(appErrors, appErrors.join('\n')).toHaveLength(0)
    })

    test('imports the SE blueprint book; both prints render', async ({ page }, testInfo) => {
        const { appErrors } = captureConsole(page)
        await page.goto(`/?pack=space-exploration&source=${encodeURIComponent(SE_BOOK)}`)
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await page.waitForTimeout(2000)
        let shot = await page.screenshot()
        await testInfo.attach('se-book-print0-delivery-chest-station', {
            body: shot,
            contentType: 'image/png',
        })

        // Switch to print 1 (Delivery Cannon) via the dat.gui "BP Book Index"
        // number input — same control the user drives.
        const row = page.locator('.dg li', { hasText: 'BP Book Index' })
        const input = row.locator('input')
        await input.fill('1')
        await input.press('Enter')
        await page.waitForTimeout(2000)
        shot = await page.screenshot()
        await testInfo.attach('se-book-print1-delivery-cannon', {
            body: shot,
            contentType: 'image/png',
        })
        console.log('SE-BOOK app errors:', JSON.stringify(appErrors, null, 2))
        expect(appErrors, appErrors.join('\n')).toHaveLength(0)
    })

    test('renders the SE fixed-entity fixture without errors', async ({ page }, testInfo) => {
        const { appErrors } = captureConsole(page)
        await page.goto(`/?pack=space-exploration&source=${encodeURIComponent(SE_RENDER_FIXTURES)}`)
        await expect(page.getByText(/loaded successfully/i)).toBeVisible({ timeout: 60_000 })
        await waitForReady(page)
        await page.waitForTimeout(2000)
        const shot = await page.screenshot()
        await testInfo.attach('se-fixed-entity-fixture', { body: shot, contentType: 'image/png' })
        console.log('SE-FIXTURE app errors:', JSON.stringify(appErrors, null, 2))
        // All 14 fixed-entity types import and render with no thrown/app errors;
        // the per-entity render guarantee itself is pinned by spriteCensus.test.ts.
        expect(appErrors, appErrors.join('\n')).toHaveLength(0)
    })
})
