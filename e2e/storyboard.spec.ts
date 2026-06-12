import { test, devices, type Browser, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Layout storyboard sandbox. NOT an assertion test — it's a visual-inspection
 * tool. For each target platform it loads the same sample blueprint, drives the
 * editor through a fixed set of UI states, screenshots each, and composites them
 * into a single labelled strip image (`e2e/storyboards/<platform>.png`).
 *
 * The goal: one glanceable image per platform that shows how the Pixi canvas and
 * the DOM overlays share (and fight over) the screen — input for designing the
 * mobile layout and a reference for spotting regressions. See
 * docs/mobile-layout-inventory.md.
 *
 * States rely on the opt-in `?test` window hook (window.__FBE_TEST__) to drive
 * on-canvas UI deterministically, instead of fragile click-coordinate math.
 *
 * Uses the Space Age data pack (`?pack=space-age`): it adds item groups/rows to
 * the inventory selector that overflow on narrow screens (vanilla doesn't), which
 * is exactly the kind of thing this sandbox should surface.
 */

// Sample blueprint: three assembling-machine-3 (the first holds the complex
// `processing-unit` recipe so its info/editor panels are rich), an inserter,
// a fast-inserter and a short belt line. Generated with pako.deflate→base64.
const BLUEPRINT =
    '0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx/Ahmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW+SpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM/eMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I+V8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j+GltfMAmGY+eDpPoE5RG5eU1+vk0W75Kbt8nyPrmbpl8tsiv1'

const HERO = 'assembling-machine-3'
const PACK = 'space-age'
const BASE = 'http://localhost:8080'
const OUT_DIR = path.resolve('e2e/storyboards')

interface Platform {
    id: string
    label: string
    contextOptions: Parameters<Browser['newContext']>[0]
}

const PLATFORMS: Platform[] = [
    { id: 'pixel7-portrait', label: 'Pixel 7 — portrait', contextOptions: devices['Pixel 7'] },
    {
        id: 'pixel7-landscape',
        label: 'Pixel 7 — landscape',
        contextOptions: devices['Pixel 7 landscape'],
    },
    {
        id: 'desktop-1280',
        label: 'Desktop 1280 (reference)',
        contextOptions: {
            viewport: { width: 1280, height: 800 },
            isMobile: false,
            hasTouch: false,
        },
    },
    {
        id: 'iphone-se',
        label: 'iPhone SE — portrait (small)',
        contextOptions: devices['iPhone SE'],
    },
]

interface Shot {
    label: string
    buf: Buffer
}

/**
 * The opt-in canvas-driving hook (window.__FBE_TEST__). NOTE: type annotations
 * are erased at runtime, so referencing `Hook` inside a `page.evaluate` cast is
 * compile-time only — the serialized browser code is just `window.__FBE_TEST__`.
 */
type Hook = {
    getState: () => { blueprint: { entityCount: number } }
    showEntityInfo: (name: string | null) => boolean
    openEntityEditor: (name: string) => boolean
    openInventory: () => void
    previewInventoryItem: (name: string) => void
    closeDialogs: () => void
    centerView: () => void
}
type WinWithHook = Window & { __FBE_TEST__?: Hook }

async function waitReady(page: Page): Promise<void> {
    await page.locator('#editor').waitFor({ state: 'visible' })
    await page.waitForFunction(
        () => {
            const h = (window as WinWithHook).__FBE_TEST__
            return !!h && h.getState().blueprint.entityCount > 0
        },
        { timeout: 60_000 }
    )
    // let the atlas textures transcode + paint, and the camera settle
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.evaluate(() => (window as WinWithHook).__FBE_TEST__!.centerView())
    await page.waitForTimeout(1200)
}

async function capture(page: Page): Promise<Shot[]> {
    const shots: Shot[] = []
    const shot = async (label: string): Promise<void> => {
        await page.waitForTimeout(350)
        shots.push({ label, buf: await page.screenshot() })
    }

    // 1) base — clear view, blueprint on the canvas, nothing open
    await shot('base')

    // 2) settings pane (dat.gui) open
    await page.locator('#settings-button').click()
    await shot('settings open')
    await page.locator('#settings-button').click() // close again

    // 3) an assembler with a complex recipe selected → entity info panel
    await page.evaluate(name => (window as WinWithHook).__FBE_TEST__!.showEntityInfo(name), HERO)
    await shot('entity info')
    await page.evaluate(() => (window as WinWithHook).__FBE_TEST__!.showEntityInfo(null))

    // 4) the inventory / items view
    await page.evaluate(() => (window as WinWithHook).__FBE_TEST__!.openInventory())
    await shot('inventory')
    await page.evaluate(() => (window as WinWithHook).__FBE_TEST__!.closeDialogs())

    // 4b) long-press preview: details + Confirm / Pin bar (touch-first selection)
    await page.evaluate(
        name => (window as WinWithHook).__FBE_TEST__!.previewInventoryItem(name),
        HERO
    )
    await shot('item preview')
    await page.evaluate(() => (window as WinWithHook).__FBE_TEST__!.closeDialogs())

    // 5) the assembler's editor (recipe + modules) open
    await page.evaluate(name => (window as WinWithHook).__FBE_TEST__!.openEntityEditor(name), HERO)
    await shot('entity editor')
    await page.evaluate(() => (window as WinWithHook).__FBE_TEST__!.closeDialogs())

    // 6) realistic worst case: the editor open WITH its info panel. These co-occur
    //    in normal use (selecting an entity shows the info panel, opening its
    //    editor doesn't dismiss it), so this is the true overlap stress state.
    await page.evaluate(name => {
        const h = (window as WinWithHook).__FBE_TEST__!
        h.showEntityInfo(name)
        h.openEntityEditor(name)
    }, HERO)
    await shot('editor + info')
    await page.evaluate(() => {
        const h = (window as WinWithHook).__FBE_TEST__!
        h.closeDialogs()
        h.showEntityInfo(null)
    })

    return shots
}

async function composite(
    browser: Browser,
    platform: Platform,
    size: { width: number; height: number },
    shots: Shot[],
    outFile: string
): Promise<void> {
    const figures = shots
        .map(
            s => `<figure style="margin:0">
                <img src="data:image/png;base64,${s.buf.toString('base64')}"
                     style="display:block;border:1px solid #555;max-width:320px;max-height:700px;width:auto;height:auto"/>
                <figcaption style="color:#ddd;font:13px sans-serif;text-align:center;margin-top:6px">${s.label}</figcaption>
            </figure>`
        )
        .join('')
    const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#181818">
        <div class="board" style="display:inline-block;padding:20px">
            <div style="color:#fff;font:600 18px sans-serif;margin-bottom:14px">${platform.label} — ${size.width}×${size.height}px</div>
            <div style="display:flex;gap:14px;align-items:flex-start">${figures}</div>
        </div></body>`

    const page = await browser.newPage()
    await page.setContent(html)
    await page.locator('.board').screenshot({ path: outFile })
    await page.close()
}

test.describe('layout storyboard (visual sandbox)', () => {
    test('generate per-platform storyboards', async ({ browser }, testInfo) => {
        // Opt-in: this writes image files and takes minutes, so it's excluded
        // from the normal suite. Run it explicitly to (re)generate storyboards:
        //   STORYBOARD=1 npx playwright test storyboard.spec.ts
        test.skip(!process.env.STORYBOARD, 'set STORYBOARD=1 to (re)generate storyboards')
        test.skip(
            testInfo.project.name !== 'desktop-chromium',
            'runs once; manages its own per-platform contexts'
        )
        test.setTimeout(240_000)

        fs.mkdirSync(OUT_DIR, { recursive: true })
        const generated: string[] = []

        for (const platform of PLATFORMS) {
            const context = await browser.newContext(platform.contextOptions)
            // Keep states clean: suppress the once-only touch toast + welcome
            // message, force the settings pane to start closed everywhere, and
            // hide transient toasts (they're not steady-state chrome).
            await context.addInitScript(() => {
                localStorage.setItem('fbe:touchToastSeen', 'true')
                localStorage.setItem('firstRun', 'false')
                localStorage.setItem('dat.gui.closed', 'true')
                // Seed the quickbar + recents so the inventory's Recents tab shows
                // all three sources (recent / quickbar / on-blueprint) distinctly.
                localStorage.setItem('quickbarItemNames', JSON.stringify(['transport-belt']))
                localStorage.setItem(
                    'fbe:recent:items',
                    JSON.stringify(['assembling-machine-3', 'fast-inserter'])
                )
            })

            const page = await context.newPage()
            await page.goto(`${BASE}/?test&pack=${PACK}&source=${encodeURIComponent(BLUEPRINT)}`)
            await waitReady(page)
            await page.addStyleTag({ content: '.toasts-container{display:none !important}' })

            const size = page.viewportSize()!
            const shots = await capture(page)

            const outFile = path.join(OUT_DIR, `${platform.id}.png`)
            await composite(browser, platform, size, shots, outFile)
            generated.push(outFile)

            await context.close()
        }

        // Surface the artifacts in the report and on disk for inspection.
        for (const f of generated) {
            await testInfo.attach(path.basename(f), { path: f, contentType: 'image/png' })
        }
        console.log('\nStoryboards written:\n' + generated.map(f => '  ' + f).join('\n'))
    })
})
