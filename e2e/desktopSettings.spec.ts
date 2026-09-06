import { test, expect, type Page } from '@playwright/test'

/**
 * Desktop copy/paste **entity settings**, across a focus loss (#101 · A14).
 *
 * The bug this ratchets: the action registry learned modifier state from key
 * events only, so anything that made the window lose focus while a modifier was
 * physically held desynced it. `window`'s `blur` handler calls
 * `G.actions.releaseAll()`, which clears `shift` — and because the key is still
 * down, no fresh `keydown` ever re-arms it, so the next `Shift+LMB` matched
 * `pan`/`openEntityGUI` instead of `pasteEntitySettings` until Shift was
 * released and pressed again.
 *
 * In the wild the focus thief is Firefox's own Shift+right-click context menu
 * (it never dispatches `contextmenu` to the page, so the site-wide
 * `preventDefault` can't stop it — Bugzilla 897379). Firefox isn't available to
 * this suite, so the *desync* half is ratcheted here in Chromium by dispatching
 * the `blur` the menu would have caused. The fix is browser-agnostic: every
 * pointer press re-syncs the registry's modifiers from the event's own
 * `ctrlKey/shiftKey/altKey`.
 */

interface SettingsHook {
    getState: () => { blueprint: { entityCount: number } }
    openEditorSlot: (
        name: string,
        kind: 'modules' | 'filters' | 'recipe',
        index: number
    ) => { x: number; y: number } | null
    inventoryFirstItemPos: () => { x: number; y: number } | null
    inventoryOpen: () => boolean
    entityRecipe: (name: string) => string | null
    closeDialogs: () => void
}

const entityCount = (page: Page): Promise<number> =>
    page
        .evaluate(() =>
            (window as unknown as { __FBE_TEST__: SettingsHook }).__FBE_TEST__.getState()
        )
        .then(s => s.blueprint.entityCount)

const readRecipe = (page: Page, entity: string): Promise<string | null> =>
    page.evaluate(
        name =>
            (window as unknown as { __FBE_TEST__: SettingsHook }).__FBE_TEST__.entityRecipe(name),
        entity
    )

const inventoryOpen = (page: Page): Promise<boolean> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: SettingsHook }).__FBE_TEST__.inventoryOpen()
    )

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

/** Canvas offset — probes return canvas-relative coords, input needs page coords. */
async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
    const box = await page.locator('#editor').boundingBox()
    return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

// Two *different* assemblers so the state probes (which look an entity up by
// name) can tell them apart. Both are `type: 'assembling-machine'`, which is
// what `canPasteSettings` requires, and every recipe an AM-1 accepts an AM-2
// accepts too — so whatever the picker offers first is pasteable onto B.
const SOURCE = 'assembling-machine-1'
const TARGET = 'assembling-machine-2'

// Both points are canvas, not DOM: the settings pane's controls overlay the
// left edge out to ~x=310 (a click there hits its <select>, never the editor),
// and the quickbar/wires panels sit along the bottom.
const A = { x: 340, y: 360 }
const B = { x: 560, y: 360 }

/** Hold quickbar slot `key` and left-click at `at` to build there. */
async function build(page: Page, key: string, at: { x: number; y: number }): Promise<void> {
    await page.keyboard.press('Escape') // drop whatever is held -> NONE
    await page.mouse.move(at.x, at.y) // pointer inside so the ghost shows
    await page.keyboard.press(key)
    await page.mouse.click(at.x, at.y)
}

/** Give `entity` a recipe through its editor, and report which one landed. */
async function setSomeRecipe(page: Page, entity: string): Promise<string> {
    const origin = await canvasOrigin(page)
    const slot = await page.evaluate(
        name =>
            (window as unknown as { __FBE_TEST__: SettingsHook }).__FBE_TEST__.openEditorSlot(
                name,
                'recipe',
                0
            ),
        entity
    )
    expect(slot, `${entity} should have a recipe slot`).not.toBeNull()
    await page.mouse.click(origin.x + slot.x, origin.y + slot.y) // opens the picker
    await expect.poll(() => inventoryOpen(page)).toBe(true)

    const item = await page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: SettingsHook }).__FBE_TEST__.inventoryFirstItemPos()
    )
    expect(item, 'the recipe picker should offer at least one recipe').not.toBeNull()
    // Desktop applies a pick immediately (only touch requires ✓ Confirm).
    await page.mouse.click(origin.x + item.x, origin.y + item.y)

    await expect.poll(() => readRecipe(page, entity)).not.toBeNull()
    await page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: SettingsHook }).__FBE_TEST__.closeDialogs()
    )
    return readRecipe(page, entity)
}

test.describe('desktop copy/paste entity settings', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'desktop-chromium',
            'desktop mouse pipeline runs on the desktop project only'
        )
    })

    test('Shift+LMB still pastes settings after a focus loss with Shift held (#101)', async ({
        page,
    }) => {
        await page.addInitScript(() => {
            window.localStorage.setItem(
                'quickbarItemNames',
                JSON.stringify(['assembling-machine-1', 'assembling-machine-2'])
            )
        })
        await page.goto('/?test')
        await waitForLoaded(page)
        await page.locator('#editor').focus()

        await build(page, '1', A)
        await expect.poll(() => entityCount(page)).toBe(1)
        await build(page, '2', B)
        await expect.poll(() => entityCount(page)).toBe(2)
        await page.keyboard.press('Escape') // drop the held cursor -> NONE

        const recipe = await setSomeRecipe(page, SOURCE)
        expect(await readRecipe(page, TARGET), 'target starts unconfigured').toBeNull()

        // Hover A so the container is in EDIT mode over it, then Shift+RMB to
        // copy its settings. (Chromium dispatches this normally; Firefox is the
        // browser that eats it — see the file header.)
        await page.mouse.move(A.x + 60, A.y + 60)
        await page.mouse.move(A.x, A.y)
        await page.keyboard.down('Shift')
        await page.mouse.click(A.x, A.y, { button: 'right' })

        // The context menu Firefox would have opened steals focus: `window`'s
        // blur handler runs `releaseAll()` and forgets the *still-held* Shift.
        await page.evaluate(() => window.dispatchEvent(new Event('blur')))

        // Shift never came up, so no keydown re-arms it — the paste has to work
        // off the click's own `shiftKey`.
        await page.mouse.move(B.x, B.y)
        await page.mouse.click(B.x, B.y)
        await page.keyboard.up('Shift')

        await expect.poll(() => readRecipe(page, TARGET)).toBe(recipe)
    })
})
