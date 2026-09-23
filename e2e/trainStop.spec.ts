import { test, expect, type Page, type Locator } from '@playwright/test'
import { isTouchProject } from './projects'

/**
 * Train-stop editor text entry (#56).
 *
 * The station-name and trains-limit fields are DOM `<input>`s overlaid on the
 * canvas (`UI/controls/TextInput.ts`) — the one editor UI that is *not* drawn
 * by PixiJS, because free text needs the OS keyboard. That overlay used to be
 * broken everywhere DPR > 1: the CSS transform double-applied the device pixel
 * ratio (pixi-text-input math predating PixiJS v8's logical `renderer.width`),
 * landing the input off-screen — a tap focused <body>, so no caret and no
 * virtual keyboard — and it inherited `user-select: none` from <html>.
 *
 * These specs guard the fix on both projects: the inputs must sit inside the
 * viewport (the off-screen regression), a real tap/click must focus them, and
 * typed text must round-trip into the blueprint entity (read back through
 * `?test`'s `entityTrainStop`, so it has to have been committed, not merely
 * rendered in the DOM).
 */

// The clearSlots fixture: storage/requester/provider chests + a train stop
// (station "Test stop", no trains limit).
const CHEST_BP =
    '0eNp9ksFuwjAQRH8F7dmpIIQW/B29VRFywkJXMrbr3SCiyP9eOaERFaUna0fjN+OVB2hshyGSE9ADkOAZ9J2mwJoGLWhoLZpYsPXCi/YTWRZHukoXERRcMDJ5B3rzWu6q3W5TlW/rcrtUQK13DPpjAKaTMzaHSB8Q9JSlwJlznlh8NCcsRjQkBeQOeAW9SrUCdEJCOIHGod+77txgBL16glAQPJOMtQa4gl6+bBT045kURPzqkGV/JCsYOXsY22yfUn7iFcyOX+otk6J3RbBG8hpa3+U1rlKd6pTUQ9VyvnZLx/isbHlX9g/SeiYFw0wXLEL0Fzo8B1b/A6sZKNGQK1h8eIRsR0SVFLCYSYf3/BVGe370N6lYxgY='

interface TrainStopState {
    station: string
    manualTrainsLimit: number | null
    priority: number
    color: { r: number; g: number; b: number; a: number } | null
    sendToTrain: boolean
    readFromTrain: boolean
    readStoppedTrain: boolean
    trainStoppedSignal: string | null
    setTrainsLimit: boolean
    trainsLimitSignal: string | null
    readTrainsCount: boolean
    trainsCountSignal: string | null
    setPriority: boolean
    prioritySignal: string | null
}

interface TrainStopHook {
    openEntityEditor: (name: string) => boolean
    entityTrainStop: (name: string) => TrainStopState | null
    editorControlPos: (control: string) => { x: number; y: number } | null
}

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

async function openTrainStopEditor(page: Page): Promise<void> {
    const opened = await page.evaluate(() => {
        const w = window as unknown as { __FBE_TEST__?: TrainStopHook }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.openEntityEditor('train-stop')
    })
    expect(opened, 'the train-stop editor should open').toBe(true)
}

const readTrainStop = (page: Page): Promise<TrainStopState | null> =>
    page.evaluate(() =>
        (window as unknown as { __FBE_TEST__: TrainStopHook }).__FBE_TEST__.entityTrainStop(
            'train-stop'
        )
    )

/** Canvas offset — the probe returns canvas-relative coords, input needs page coords. */
async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
    const box = await page.locator('#editor').boundingBox()
    return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

/** Tap/click an on-canvas control located by the `editorControlPos` probe. */
async function tapControl(page: Page, control: string): Promise<void> {
    const pos = await page.evaluate(
        name =>
            (window as unknown as { __FBE_TEST__: TrainStopHook }).__FBE_TEST__.editorControlPos(
                name
            ),
        control
    )
    expect(pos, `control "${control}" should be locatable in the open editor`).not.toBeNull()
    const o = await canvasOrigin(page)
    if (isTouchProject()) await page.touchscreen.tap(o.x + pos.x, o.y + pos.y)
    else await page.mouse.click(o.x + pos.x, o.y + pos.y)
}

/** Tap (mobile project) / click (desktop) the input where it actually renders. */
async function tapInput(page: Page, input: Locator): Promise<void> {
    const box = await input.boundingBox()
    expect(box, 'the input should render on-screen').not.toBeNull()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    if (isTouchProject()) await page.touchscreen.tap(x, y)
    else await page.mouse.click(x, y)
}

// The two fields are told apart by shape: the station name allows 100 chars,
// the trains limit 3 (and is digit-only / numeric-keyboard).
const stationInput = (page: Page): Locator => page.locator('input[maxlength="100"]')
const limitInput = (page: Page): Locator => page.locator('input[maxlength="3"]')

test.describe('train-stop editor text fields', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)
        await openTrainStopEditor(page)
    })

    test('the DOM inputs land inside the viewport, over the dialog', async ({ page }) => {
        // The regression this pins: at DPR > 1 the overlay transform pushed the
        // input below the canvas (top ≈ 1054px on an 839px viewport), so any
        // in-viewport assertion failed the moment the double-scale came back.
        const viewport = page.viewportSize()
        for (const input of [stationInput(page), limitInput(page)]) {
            await expect(input).toBeVisible()
            const box = await input.boundingBox()
            expect(box).not.toBeNull()
            expect(box.x).toBeGreaterThanOrEqual(0)
            expect(box.y).toBeGreaterThanOrEqual(0)
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
            expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
        }
    })

    test('the inputs are selectable despite the app-wide user-select: none', async ({ page }) => {
        // <html> sets user-select: none (canvas app); an input inheriting it has
        // no caret — and on some mobile browsers taps won't focus it at all.
        for (const input of [stationInput(page), limitInput(page)]) {
            expect(await input.evaluate(el => getComputedStyle(el).userSelect || 'text')).toBe(
                'text'
            )
        }
    })

    test('tapping the station name focuses it and typing renames the station', async ({ page }) => {
        const input = stationInput(page)
        await expect(input).toHaveValue('Test stop')

        await tapInput(page, input)
        await expect(input, 'a tap on the field must focus it (#56)').toBeFocused()

        // Replace rather than append — the caret lands wherever the tap hit.
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.type('Iron Pickup')

        await expect(input).toHaveValue('Iron Pickup')
        expect((await readTrainStop(page)).station).toBe('Iron Pickup')
    })

    test('the trains-limit field takes digits and requests the numeric keyboard', async ({
        page,
    }) => {
        const input = limitInput(page)
        // `inputmode=numeric` is what pops the digit keyboard on touch.
        await expect(input).toHaveAttribute('inputmode', 'numeric')

        await tapInput(page, input)
        await expect(input).toBeFocused()
        await page.keyboard.type('12')

        await expect(input).toHaveValue('12')
        const state = await readTrainStop(page)
        expect(state.manualTrainsLimit).toBe(12)

        // The digit-restriction still applies: letters must not get through.
        await page.keyboard.type('x')
        await expect(input).toHaveValue('12')
    })
})

test.describe('train-stop 2.0 circuit settings', () => {
    // The circuit pane is canvas-drawn (unlike the DOM text fields above), so
    // these press the real checkboxes via the `editorControlPos` probe and
    // read the result back through the entity — the same construction-plus-
    // committed-state depth the other circuit editors get; the serialized
    // shapes themselves are pinned by core/trainStopSettings.test.ts.
    test.beforeEach(async ({ page }) => {
        await page.goto(`/?test&source=${encodeURIComponent(CHEST_BP)}`)
        await waitForAppReady(page)
        await openTrainStopEditor(page)
    })

    test('the editor opens with the game defaults and no errors', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', e => errors.push(e.message))

        const state = await readTrainStop(page)
        expect(state.priority).toBe(50)
        expect(state.sendToTrain).toBe(true) // ON by default, like the game
        expect(state.readFromTrain).toBe(false)
        expect(state.setPriority).toBe(false)
        expect(errors).toEqual([])
    })

    /**
     * Tap a flag checkbox until the entity reflects `expected` — two flake
     * sources make a bare tap-then-assert unreliable here:
     *  - The load-time toasts stack bottom-right with `pointer-events: auto`
     *    (tap-to-dismiss); on a phone the stack reaches the centred dialog's
     *    lower rows, and a toast that slides in before the tap swallows it.
     *    They're cleared before each attempt (they're not what's under test).
     *  - A synthesized touch travels Chromium's async compositor path, so
     *    under full-suite contention the pointerdown can land after an
     *    immediately-following evaluate; polling + retapping absorbs that.
     * Retapping is safe because the target state is absolute: a tap that did
     * land flips the poll to `expected` within the window, and a genuinely
     * lost tap leaves the state untouched for the next attempt.
     */
    async function tapFlag<K extends keyof TrainStopState>(
        page: Page,
        control: string,
        key: K,
        expected: TrainStopState[K]
    ): Promise<void> {
        for (let attempt = 0; ; attempt++) {
            await page.evaluate(() =>
                document.querySelectorAll('.toasts-toast').forEach(t => t.remove())
            )
            await tapControl(page, control)
            try {
                await expect
                    .poll(async () => (await readTrainStop(page))[key], { timeout: 2_000 })
                    .toEqual(expected)
                return
            } catch (e) {
                if (attempt >= 2) throw e
            }
        }
    }

    test('tapping a flag checkbox commits it to the blueprint', async ({ page }) => {
        await tapFlag(page, 'readFromTrain', 'readFromTrain', true)

        // send-to-train is the inverted flag: a tap turns the default OFF.
        await tapFlag(page, 'sendToTrain', 'sendToTrain', false)
    })

    test('enabling an output seeds its game-default signal', async ({ page }) => {
        await tapFlag(page, 'readStoppedTrain', 'readStoppedTrain', true)
        // The signal is seeded in the same control_behavior write as the flag.
        expect((await readTrainStop(page)).trainStoppedSignal).toBe('signal-T')

        // The 2.0-only pair: set priority from circuit, defaulting to signal-P.
        await tapFlag(page, 'setPriority', 'setPriority', true)
        expect((await readTrainStop(page)).prioritySignal).toBe('signal-P')
    })

    test('a colour swatch commits the sign colour, and ✕ resets it', async ({ page }) => {
        expect((await readTrainStop(page)).color).toBeNull()

        // First swatch = the red preset; the committed value is exactly what
        // the swatch declares (a: 0.5, matching game serialization).
        await tapFlag(page, 'colorRed', 'color', { r: 1, g: 0, b: 0, a: 0.5 })

        // Reset removes the field — back to the prototype-default sign.
        await tapFlag(page, 'colorReset', 'color', null)
    })
})
