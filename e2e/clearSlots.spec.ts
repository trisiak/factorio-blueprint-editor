import { test, expect, type Page } from '@playwright/test'
import { longPressOneFinger } from './touchGestures'

/**
 * Clearing a slot (module / filter / recipe).
 *
 * Desktop has always cleared a slot by right-clicking it, which touch cannot do.
 * There are now two touch-reachable routes to the same action, and this spec
 * guards both plus the desktop path that used to be the only one:
 *
 *  1. **Long-press the slot** — `bindSlotGestures`, now wired into *every* slot
 *     (modules, filters, quickbar) rather than only the circuit ones.
 *  2. **"✕ Clear" in the picker** the slot opens — discoverable, and the only
 *     route that needs no gesture at all.
 *
 * Slots live in the PixiJS canvas, so the DOM has nothing to query: `?test`
 * installs `window.__FBE_TEST__` (packages/editor/src/common/testHook.ts), which
 * opens the editor and reports the slot's on-screen centre to press for real.
 */

// An assembling-machine-2 (recipe + 2 speed modules), a beacon (2 speed modules)
// and a fast-splitter with an iron-plate filter — one of each clearable slot
// kind, pre-filled so a clear has something to remove. Built by hand against the
// 2.0 `items` / `filter` shapes.
const BP =
    '0eNq1kl1qwzAQhK9S9lkqsfPTRlcpIcjyJl0qr4y0DjHGdy+yS9K0pVBIn8SI3ZnRhwaofIdtJBYwA5BgA+bTnQJvK/RgwHm0UScfJD0c6CxdRFBwwpgoMJj1ptyuttv1qnxals8LBeQCJzAvAyQ6svXZXvoWwcwpCtg2WdmUsKk88VE31r0Soy5hVEBc4xlMMe4UIAsJ4ew3iX7PXVNhBFP87qSgDYlkKjlANnxcK+inc1QQ0dFUCj06iYHJaUfRdZQfn5vOoVTn9Y+g1CLWugl153GqOo8NQLwnPiFLiP28dlUrBUmsewOzUOBCl4kX424c1X3di1v3Xfb/gqy8IKvQusDfIW1uIN0TQ/GvGIq/YFheMBxsEp1aTyIYf/gyE4vNxOJAPs9ce1IMrFtvBSHHjO/kmB6J'

// The logistic-container cases, one per behaviour: a **storage** chest carrying a
// request (one slot, no count); a **requester** chest with no `request_filters` key
// at all — the "never configured" shape that used to throw on open; a **passive
// provider**, which requests nothing and so must open no editor; and a **train
// stop** (once the hint's no-slots negative case; its 2.0 circuit pane has slots
// now, so it asserts the hint like the rest — `trainStop.spec.ts` covers it fully).
const CHEST_BP =
    '0eNp9ksFuwjAQRH8F7dmpIIQW/B29VRFywkJXMrbr3SCiyP9eOaERFaUna0fjN+OVB2hshyGSE9ADkOAZ9J2mwJoGLWhoLZpYsPXCi/YTWRZHukoXERRcMDJ5B3rzWu6q3W5TlW/rcrtUQK13DPpjAKaTMzaHSB8Q9JSlwJlznlh8NCcsRjQkBeQOeAW9SrUCdEJCOIHGod+77txgBL16glAQPJOMtQa4gl6+bBT045kURPzqkGV/JCsYOXsY22yfUn7iFcyOX+otk6J3RbBG8hpa3+U1rlKd6pTUQ9VyvnZLx/isbHlX9g/SeiYFw0wXLEL0Fzo8B1b/A6sZKNGQK1h8eIRsR0SVFLCYSYf3/BVGe370N6lYxgY='

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

type SlotKind = 'modules' | 'filters' | 'recipe'

interface ClearHook {
    openEditorSlot: (name: string, kind: SlotKind, index: number) => { x: number; y: number } | null
    inventoryClearButtonPos: () => { x: number; y: number } | null
    inventoryClearButtonLabel: () => string | null
    inventoryConfirmButtonPos: () => { x: number; y: number } | null
    entityModules: (name: string) => (string | null)[] | null
    entityFilters: (name: string) => (string | null)[] | null
    entityRecipe: (name: string) => string | null
    editorClearHint: (name: string) => string | null
    quickbarItems: () => (string | null)[]
    quickbarSlotPos: (index: number) => { x: number; y: number } | null
    inventoryFirstItemPos: () => { x: number; y: number } | null
    inventoryOpen: () => boolean
    openEditorClearHint: () => string | null
    setInputMode: (mode: 'desktop' | 'mobile') => void
}

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

/** Canvas offset — the probe returns canvas-relative coords, input needs page coords. */
async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
    const box = await page.locator('#editor').boundingBox()
    return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

// Each probe call is its own inline `page.evaluate` with its own `window` cast:
// the callback is serialized into the browser, so it can't close over a shared
// helper defined here. Same shape the other canvas specs use.

/** Open `entity`'s editor and return slot `index`'s on-screen centre. */
async function openSlot(
    page: Page,
    entity: string,
    kind: SlotKind,
    index: number
): Promise<{ x: number; y: number }> {
    const pos = await page.evaluate(
        args => {
            const w = window as unknown as { __FBE_TEST__?: ClearHook }
            if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
            return w.__FBE_TEST__.openEditorSlot(args.entity, args.kind, args.index)
        },
        { entity, kind, index }
    )
    expect(pos, `${kind} slot ${index} of ${entity} should be locatable`).not.toBeNull()
    return pos
}

const readModules = (page: Page, entity: string): Promise<(string | null)[] | null> =>
    page.evaluate(
        name => (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.entityModules(name),
        entity
    )

const readFilters = (page: Page, entity: string): Promise<(string | null)[] | null> =>
    page.evaluate(
        name => (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.entityFilters(name),
        entity
    )

const readClearButton = (page: Page): Promise<{ x: number; y: number } | null> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.inventoryClearButtonPos()
    )

const readClearButtonLabel = (page: Page): Promise<string | null> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.inventoryClearButtonLabel()
    )

const readRecipe = (page: Page, entity: string): Promise<string | null> =>
    page.evaluate(
        name => (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.entityRecipe(name),
        entity
    )

const readClearHint = (page: Page, entity: string): Promise<string | null> =>
    page.evaluate(
        name =>
            (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.editorClearHint(name),
        entity
    )

const readQuickbar = (page: Page): Promise<(string | null)[]> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.quickbarItems()
    )

const readConfirmButton = (page: Page): Promise<{ x: number; y: number } | null> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.inventoryConfirmButtonPos()
    )

/**
 * Pick the first item in the open selector.
 *
 * On touch a tap only *previews* — selecting is a deliberate two-step everywhere
 * except the module picker (see `m_commitOnTap`), so anything else needs the
 * ✓ Confirm press to actually commit. Desktop commits on click.
 */
async function pickFirstItem(page: Page, needsConfirm = isMobileProject()): Promise<void> {
    const item = await readFirstItem(page)
    expect(item, 'the selector should show at least one item').not.toBeNull()
    await tap(page, item)
    if (!needsConfirm) return
    const confirm = await readConfirmButton(page)
    expect(confirm, 'a touch tap should have revealed ✓ Confirm').not.toBeNull()
    await tap(page, confirm)
}

const readFirstItem = (page: Page): Promise<{ x: number; y: number } | null> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.inventoryFirstItemPos()
    )

// Note: *not* getState().dialogOpen — that stays true for the entity editor the
// selector was opened from, so it can't tell you the picker itself closed.
const inventoryOpen = (page: Page): Promise<boolean> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.inventoryOpen()
    )

/**
 * Press-and-hold a slot using whichever input the project actually has. The hold
 * is deliberately much longer than the recognizer's 500 ms — see
 * `longPressOneFinger` for why a short hold degrades into a tap rather than
 * failing outright.
 */
async function holdToClear(page: Page, at: { x: number; y: number }): Promise<void> {
    if (isMobileProject()) {
        await longPressOneFinger(page, at)
        return
    }
    const o = await canvasOrigin(page)
    await page.mouse.move(o.x + at.x, o.y + at.y)
    await page.mouse.down()
    await page.waitForTimeout(1_500)
    await page.mouse.up()
}

/** Quick tap / click — the *activate* half of the same slot gesture. */
async function tap(page: Page, at: { x: number; y: number }): Promise<void> {
    const o = await canvasOrigin(page)
    if (isMobileProject()) await page.touchscreen.tap(o.x + at.x, o.y + at.y)
    else await page.mouse.click(o.x + at.x, o.y + at.y)
}

test.describe('clearing a filled slot', () => {
    test('long-press clears a module slot', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        // Guard the fixture: with an empty slot the clear is a no-op and the test
        // would pass vacuously.
        expect(await readModules(page, 'assembling-machine-2')).toEqual([
            'speed-module',
            'speed-module',
        ])

        const slot = await openSlot(page, 'assembling-machine-2', 'modules', 0)
        await holdToClear(page, slot)

        // Slot 0 emptied, slot 1 untouched — a long-press clears the slot it was
        // on, not the whole grid.
        await expect
            .poll(() => readModules(page, 'assembling-machine-2'))
            .toEqual([null, 'speed-module'])
    })

    test('a long-press that clears does not also open the picker', async ({ page }) => {
        // Activate and clear share one pointerdown: a hold that clears must swallow
        // the tap, or you would clear the slot *and* be left in the item selector.
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'beacon', 'modules', 0)
        await holdToClear(page, slot)

        await expect.poll(() => readModules(page, 'beacon')).toEqual([null, 'speed-module'])
        // Only the beacon editor is open — no picker stacked on top, so its
        // ✕ Clear probe finds nothing.
        expect(await readClearButton(page)).toBeNull()
    })

    test('the picker offers ✕ Clear for a filled slot, and it empties the slot', async ({
        page,
    }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'assembling-machine-2', 'modules', 1)
        await tap(page, slot)

        const clearBtn = await readClearButton(page)
        expect(clearBtn, '✕ Clear should be offered for a filled slot').not.toBeNull()
        // Filled ⇒ the destructive label, not the cancel one.
        expect(await readClearButtonLabel(page)).toBe('✕ Clear')

        await tap(page, clearBtn)
        await expect
            .poll(() => readModules(page, 'assembling-machine-2'))
            .toEqual(['speed-module', null])
    })

    test('an empty slot labels the button ✕ Cancel and it backs out harmlessly', async ({
        page,
    }) => {
        // There is nothing to *clear* on an empty slot, but the button is still the
        // way out of the picker — tapping away needs bare canvas, which a picker on
        // a phone barely leaves, and Escape is desktop-only. So it stays, labelled
        // for what it does here: cancel.
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'assembling-machine-2', 'modules', 0)
        await holdToClear(page, slot)
        await expect
            .poll(() => readModules(page, 'assembling-machine-2'))
            .toEqual([null, 'speed-module'])

        await tap(page, slot)
        expect(await readClearButtonLabel(page)).toBe('✕ Cancel')

        const cancel = await readClearButton(page)
        expect(cancel).not.toBeNull()
        await tap(page, cancel)

        // Backed out: picker closed, and the slot is still empty — cancelling
        // must not have set anything.
        await expect.poll(() => inventoryOpen(page)).toBe(false)
        expect(await readModules(page, 'assembling-machine-2')).toEqual([null, 'speed-module'])
    })

    test('a first-time recipe pick can be cancelled out of', async ({ page }) => {
        // The case that prompted this: open a recipe slot that has never been set,
        // change your mind. Before, the picker offered no button at all.
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'assembling-machine-2', 'recipe', 0)
        await holdToClear(page, slot) // start from "never set"
        await expect.poll(() => readRecipe(page, 'assembling-machine-2')).toBeNull()

        await tap(page, slot)
        expect(await readClearButtonLabel(page)).toBe('✕ Cancel')

        await tap(page, await readClearButton(page))
        await expect.poll(() => inventoryOpen(page)).toBe(false)
        expect(await readRecipe(page, 'assembling-machine-2')).toBeNull()
    })

    test('right-click still clears a module slot', async ({ page }) => {
        // The desktop path predates the touch work and is what the refactor onto
        // bindSlotGestures could plausibly have broken.
        test.skip(isMobileProject(), 'desktop-only: touch has no right-click')

        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'assembling-machine-2', 'modules', 0)
        const o = await canvasOrigin(page)
        await page.mouse.click(o.x + slot.x, o.y + slot.y, { button: 'right' })

        await expect
            .poll(() => readModules(page, 'assembling-machine-2'))
            .toEqual([null, 'speed-module'])
    })

    test('clearing a splitter filter empties it instead of throwing', async ({ page }) => {
        // Regression: Entity's splitter setter indexed filters[0] of an array the
        // `filters` setter had already emptied, so clearing the only filter threw a
        // TypeError — leaving the filter in place on desktop and touch alike.
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const errors: string[] = []
        page.on('pageerror', e => errors.push(e.message))

        expect(await readFilters(page, 'fast-splitter')).toEqual(['iron-plate'])

        const slot = await openSlot(page, 'fast-splitter', 'filters', 0)
        await holdToClear(page, slot)

        await expect.poll(() => readFilters(page, 'fast-splitter')).toEqual([])
        expect(errors, 'clearing the filter must not throw').toEqual([])
    })

    test('long-press clears a recipe slot', async ({ page }) => {
        // The recipe slot was already on bindSlotGestures, but it now also feeds
        // the picker a clear callback — and "recipes" is half the point of this
        // change, so it gets its own guard rather than riding on the module tests.
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        expect(await readRecipe(page, 'assembling-machine-2')).toBe('electronic-circuit')

        const slot = await openSlot(page, 'assembling-machine-2', 'recipe', 0)
        await holdToClear(page, slot)

        await expect.poll(() => readRecipe(page, 'assembling-machine-2')).toBeNull()
    })

    test('the picker clears a recipe via ✕ Clear', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'assembling-machine-2', 'recipe', 0)
        await tap(page, slot)

        const clearBtn = await readClearButton(page)
        expect(clearBtn, '✕ Clear should be offered for a set recipe').not.toBeNull()

        await tap(page, clearBtn)
        await expect.poll(() => readRecipe(page, 'assembling-machine-2')).toBeNull()
    })
})

test.describe('the clear-a-slot hint', () => {
    test('names the gesture that matches the input mode', async ({ page }) => {
        // The hint is the only *visible* trace of a gesture that is otherwise
        // undiscoverable, so it has to render and has to name the right gesture:
        // touch has no right-click, and a desktop user has nothing to "hold".
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const hint = await readClearHint(page, 'assembling-machine-2')
        expect(hint).toBe(
            isMobileProject() ? 'Hold a slot to clear it' : 'Right-click a slot to clear it'
        )
    })

    test('is offered on a chest now that its filters are writable', async ({ page }) => {
        // This used to assert the *opposite*: `Entity.logisticChestFilters` was an
        // unimplemented `throw`, so the chest editor (which wasn't even routed)
        // had to stay silent rather than promise a clear it couldn't perform.
        // Both are fixed, so the hint belongs here like any other clearable slot.
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)

        expect(await readClearHint(page, 'storage-chest')).toBe(
            isMobileProject() ? 'Hold a slot to clear it' : 'Right-click a slot to clear it'
        )
    })

    test('is offered on the train stop now that it has signal slots', async ({ page }) => {
        // This used to assert the hint's *negative* case (an editor with no
        // clearable slots at all) — but the train stop grew its 2.0 circuit pane
        // (enable condition + output-signal slots), and with it every routed
        // editor now holds something clearable, so the negative case is extinct.
        // The provider chest keeps covering "opens no editor at all" instead.
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)

        expect(await readClearHint(page, 'train-stop')).toBe(
            isMobileProject() ? 'Hold a slot to clear it' : 'Right-click a slot to clear it'
        )
    })

    test('follows a live input-mode switch while the editor stays open', async ({ page }) => {
        // Input mode switches without a reload and the settings pane is DOM, so
        // toggling it leaves canvas dialogs open — a hint computed once at
        // construction would keep naming the gesture of the mode you just left.
        // The beacon, not the machine: machines present as the DOM editor on
        // mobile (#98), which *closes* on a mode switch by design (presentation
        // follows mode — covered in entityEditor.spec.ts); the live-updating
        // hint is a property of the Pixi editors, which the beacon still is in
        // both modes.
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        // Open the editor once and leave it open across the switch.
        await openSlot(page, 'beacon', 'modules', 0)

        const setMode = (mode: 'desktop' | 'mobile'): Promise<void> =>
            page.evaluate(
                m =>
                    (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.setInputMode(m),
                mode
            )
        const openHint = (): Promise<string | null> =>
            page.evaluate(() =>
                (
                    window as unknown as { __FBE_TEST__: ClearHook }
                ).__FBE_TEST__.openEditorClearHint()
            )

        await setMode('mobile')
        await expect.poll(openHint).toBe('Hold a slot to clear it')

        await setMode('desktop')
        await expect.poll(openHint).toBe('Right-click a slot to clear it')
    })
})

test.describe('module selector: one tap either way', () => {
    // Both exits from the module picker act without confirmation — tap an item to
    // take it, tap ✕ Clear to empty the slot. Filling a machine means reopening
    // this dialog once per slot, so the usual touch tap-to-preview → ✓ Confirm
    // two-step doubles the taps for a choice you have already made.
    test('a tap takes the module and closes, with no Confirm step', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        // Start from an empty slot so "a module got set" is unambiguous.
        const slot = await openSlot(page, 'assembling-machine-2', 'modules', 0)
        await holdToClear(page, slot)
        await expect
            .poll(() => readModules(page, 'assembling-machine-2'))
            .toEqual([null, 'speed-module'])

        await tap(page, slot)
        const item = await readFirstItem(page)
        expect(item, 'the module picker should show at least one item').not.toBeNull()

        await tap(page, item)

        // One tap: the module is set and the picker is gone — no ✓ Confirm needed.
        // (The entity editor underneath stays open, which is why this asserts on
        // the picker rather than on dialogOpen.)
        await expect
            .poll(async () => (await readModules(page, 'assembling-machine-2'))[0])
            .not.toBeNull()
        await expect.poll(() => inventoryOpen(page)).toBe(false)
    })

    test('the recipe selector still requires Confirm on touch', async ({ page }) => {
        // The one-tap shortcut is scoped to modules; everywhere else the deliberate
        // two-step stays, so this guards the scoping rather than the shortcut.
        test.skip(!isMobileProject(), 'desktop commits on click everywhere by design')

        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        const slot = await openSlot(page, 'assembling-machine-2', 'recipe', 0)
        await tap(page, slot) // opens the recipe picker
        const item = await readFirstItem(page)
        expect(item).not.toBeNull()

        await tap(page, item)

        // Still open, still on the old recipe — the tap only previewed.
        expect(await inventoryOpen(page)).toBe(true)
        expect(await readRecipe(page, 'assembling-machine-2')).toBe('electronic-circuit')
    })
})

test.describe('logistic chest requests', () => {
    // The chest editor existed but nothing routed to it, and its filter setter was
    // an unimplemented `throw` — so chest requests had no UI at all. These cover
    // the whole path now that it does: the editor opens, a filter can be set, and
    // it can be cleared by the same gesture every other slot uses.

    test('a chest opens an editor with filter slots', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)

        // openEditorSlot returns null unless an editor opened *and* it has the slot.
        const slot = await openSlot(page, 'storage-chest', 'filters', 0)
        expect(slot).not.toBeNull()
    })

    test('a provider chest opens a circuit-only editor with no clear hint', async ({ page }) => {
        // Providers request nothing but do carry the circuit mode-of-operation,
        // so they open the chest editor now (they used to open none). With no
        // filter slots there is nothing clearable — which also makes this the
        // clear-hint's negative case again (the train stop stopped being one
        // when it grew signal slots).
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)

        expect(await readClearHint(page, 'passive-provider-chest')).toBeNull()

        const opened = await page.evaluate(() =>
            (
                window as unknown as { __FBE_TEST__: { openEntityEditor: (n: string) => boolean } }
            ).__FBE_TEST__.openEntityEditor('passive-provider-chest')
        )
        expect(opened).toBe(true)
    })

    test('long-press clears a chest filter', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)

        // The fixture ships the storage chest with an iron-plate request.
        expect(await readFilters(page, 'storage-chest')).toEqual(['iron-plate'])

        const slot = await openSlot(page, 'storage-chest', 'filters', 0)
        await holdToClear(page, slot)

        await expect.poll(() => readFilters(page, 'storage-chest')).toEqual([])
    })

    test('the picker sets a chest filter and ✕ Clear empties it', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)

        // Start empty so "a filter got set" is unambiguous.
        const slot = await openSlot(page, 'storage-chest', 'filters', 0)
        await holdToClear(page, slot)
        await expect.poll(() => readFilters(page, 'storage-chest')).toEqual([])

        // Tap the slot → picker → pick an item. This is the write path that used
        // to throw before the setter existed. The filter picker keeps the
        // two-step selection on touch, so this goes via ✓ Confirm there.
        await tap(page, slot)
        await pickFirstItem(page)
        await expect.poll(async () => (await readFilters(page, 'storage-chest')).length).toBe(1)

        // ...then clear it again through the picker's button.
        await tap(page, slot)
        expect(await readClearButtonLabel(page)).toBe('✕ Clear')
        await tap(page, await readClearButton(page))
        await expect.poll(() => readFilters(page, 'storage-chest')).toEqual([])
    })

    test('opening a requester chest editor does not throw', async ({ page }) => {
        // Regression: the editor reads `requestFromBufferChest` while building its
        // checkbox, and that getter dereferenced an absent `request_filters`.
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)

        const errors: string[] = []
        page.on('pageerror', e => errors.push(e.message))

        const slot = await openSlot(page, 'requester-chest', 'filters', 0)
        expect(slot).not.toBeNull()
        expect(errors, 'building the requester editor must not throw').toEqual([])
    })
})

test.describe('quickbar slots', () => {
    // The quickbar is retired on mobile (its slots still work, but nothing renders
    // to press), so this is the desktop contract — and the refactor onto
    // bindSlotGestures is exactly the kind of change that could silently break it.
    test.skip(() => isMobileProject(), 'the quickbar is retired on mobile')

    test('long-press unassigns a quickbar slot', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        // Seed slot 0 by picking an item through the (empty-slot) picker path.
        await page.evaluate(() =>
            (
                window as unknown as { __FBE_TEST__: { quickbarAssign: () => void } }
            ).__FBE_TEST__.quickbarAssign()
        )
        await expect.poll(async () => (await readQuickbar(page))[0]).toBe('fast-inserter')

        const slot = await page.evaluate(() =>
            (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.quickbarSlotPos(0)
        )
        expect(slot, 'quickbar slot 0 should be rendered on desktop').not.toBeNull()

        await holdToClear(page, slot)
        await expect.poll(async () => (await readQuickbar(page))[0]).toBeNull()
    })

    test('right-click still unassigns a quickbar slot', async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
        await waitForAppReady(page)

        await page.evaluate(() =>
            (
                window as unknown as { __FBE_TEST__: { quickbarAssign: () => void } }
            ).__FBE_TEST__.quickbarAssign()
        )
        await expect.poll(async () => (await readQuickbar(page))[0]).toBe('fast-inserter')

        const slot = await page.evaluate(() =>
            (window as unknown as { __FBE_TEST__: ClearHook }).__FBE_TEST__.quickbarSlotPos(0)
        )
        const o = await canvasOrigin(page)
        await page.mouse.click(o.x + slot.x, o.y + slot.y, { button: 'right' })

        await expect.poll(async () => (await readQuickbar(page))[0]).toBeNull()
    })
})
