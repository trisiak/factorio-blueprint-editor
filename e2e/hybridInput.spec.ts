import { test, expect, type Page } from '@playwright/test'
import { pinch } from './touchGestures'

/**
 * Hybrid input (#101 Slice 1) — a mouse *and* a touchscreen on the same page.
 *
 * The `hybrid-chromium` project is a desktop viewport with `hasTouch: true` and
 * `isMobile: false`, i.e. a touchscreen laptop / Surface: touch-capable hardware
 * whose *primary* pointer is fine. That configuration is what the old detection
 * (`(pointer: coarse) || navigator.maxTouchPoints > 0`) got wrong — it booted
 * the touch UI and dropped every mouse event (#101 B1/B2).
 *
 * These specs pin the replacement end to end: environment *signals* instead of a
 * binary mode, per-pointer-type dispatch in `BlueprintContainer`, and a `preset`
 * that only overrides which pointer kinds are accepted. Everything on-canvas is
 * read through the `?test` hook (`window.__FBE_TEST__`), since the editor is one
 * <canvas> the DOM can't inspect.
 */

interface HybridState {
    inputMode: 'desktop' | 'mobile'
    inputPreset: 'auto' | 'mouse' | 'touch'
    signals: { coarse: boolean; keys: boolean; compact: boolean; touchRecent: boolean }
    quickbar: { visible: boolean }
    blueprint: { entityCount: number }
    paint: { active: boolean; visible: boolean; tile: { x: number; y: number } | null }
    viewportScale: number
}

interface HybridHook {
    getState: () => HybridState
    setInputPreset: (preset: 'auto' | 'mouse' | 'touch') => void
    setSignals: (next: { coarse?: boolean; compact?: boolean }) => void
}

const getState = (page: Page): Promise<HybridState> =>
    page.evaluate(() => (window as unknown as { __FBE_TEST__: HybridHook }).__FBE_TEST__.getState())

const entityCount = async (page: Page): Promise<number> =>
    (await getState(page)).blueprint.entityCount

const setPreset = (page: Page, preset: 'auto' | 'mouse' | 'touch'): Promise<void> =>
    page.evaluate(
        p => (window as unknown as { __FBE_TEST__: HybridHook }).__FBE_TEST__.setInputPreset(p),
        preset
    )

const setSignals = (page: Page, next: { coarse?: boolean; compact?: boolean }): Promise<void> =>
    page.evaluate(
        n => (window as unknown as { __FBE_TEST__: HybridHook }).__FBE_TEST__.setSignals(n),
        next
    )

async function waitForLoaded(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

/** Boot with the test hook and a seeded quickbar slot 1 (loaded on boot). */
async function goto(page: Page, item = 'transport-belt'): Promise<void> {
    await page.addInitScript(seed => {
        window.localStorage.setItem('quickbarItemNames', JSON.stringify([seed]))
    }, item)
    await page.goto('/?test')
    await waitForLoaded(page)
}

/**
 * Boot claiming a **fine primary pointer** while touch stays enabled — the exact
 * B1 hardware (touchscreen laptop / Surface), which Chromium can't emulate:
 * switching touch emulation on forces `(pointer: coarse)` / `(hover: none)`, and
 * CDP `Emulation.setEmulatedMedia` has no pointer/hover feature to undo it. So
 * the *media query* is stubbed at boot, before any app code runs, and everything
 * downstream — `input.ts`'s detection, the derived mode, the body classes, the
 * chrome — then runs for real. `navigator.maxTouchPoints` is deliberately left
 * alone: it stays > 0, and the point of the ratchet is that it no longer decides
 * anything (it used to, and that is what booted this machine into the touch UI).
 */
async function gotoFinePointer(page: Page, item = 'transport-belt'): Promise<void> {
    await page.addInitScript(() => {
        const real = window.matchMedia.bind(window)
        window.matchMedia = (q: string): MediaQueryList => {
            if (/pointer:\s*coarse|hover:\s*none/.test(q)) {
                return {
                    matches: false,
                    media: q,
                    onchange: null,
                    addEventListener: () => undefined,
                    removeEventListener: () => undefined,
                    addListener: () => undefined,
                    removeListener: () => undefined,
                    dispatchEvent: () => false,
                } as unknown as MediaQueryList
            }
            return real(q)
        }
    })
    await goto(page, item)
}

/** Pick up the seeded item (enter PAINT) via its quickbar keybind. */
async function holdItem(page: Page): Promise<void> {
    await page.locator('#editor').focus()
    await page.keyboard.press('1')
    await expect.poll(async () => (await getState(page)).paint.active).toBe(true)
}

// Two well-separated points in open canvas, clear of the top-left column (the
// logo, the corner buttons and the rail below them) and the bottom quickbar.
// Element-relative for `tap({position})`; the canvas is full-bleed — the rail's
// inset restricts the *panels*, not the world — so they double as page
// coordinates.
const AT_A = { x: 420, y: 300 }
const AT_B = { x: 700, y: 380 }

test.describe('hybrid input (mouse + touch on one page)', () => {
    test.beforeEach(() => {
        test.skip(
            test.info().project.name !== 'hybrid-chromium',
            'hybrid mouse+touch coverage runs on the hybrid project only'
        )
    })

    test('a touch-capable fine-pointer page boots the mouse UI (B1)', async ({ page }) => {
        await gotoFinePointer(page)

        // Touch hardware is present and reported — it just doesn't get a vote.
        expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0)

        const s = await getState(page)
        // The primary pointer is fine, nothing is forced → the derived
        // compatibility mode is `desktop`, despite `maxTouchPoints > 0`.
        expect(s.signals.coarse).toBe(false)
        expect(s.inputPreset).toBe('auto')
        expect(s.inputMode).toBe('desktop')
        // ...so the desktop chrome is intact: the quickbar is there, and the
        // action rail — universal since #101 Slice 4, where it used to be the
        // touch-only affordance this assertion guarded the absence of — comes up
        // in its slim, keybind-hinted presentation rather than the touch one.
        expect(s.quickbar.visible).toBe(true)
        const rail = page.locator('#action-toolbar')
        await expect(rail).toBeVisible()
        await expect(rail).toHaveClass(/slim/)
        await expect(rail).toHaveClass(/with-hints/)
        await expect(rail.locator('button[title="Undo"] .hint')).toHaveText('\u2303Z')

        // The signals are mirrored onto <body> for CSS gating.
        const body = page.locator('body')
        await expect(body).toHaveClass(/keys/) // fine pointer ⇒ a keyboard is assumed
        await expect(body).not.toHaveClass(/coarse/)
        await expect(body).not.toHaveClass(/compact/) // 1280px viewport
        await expect(body).not.toHaveClass(/mobile/) // the legacy derived class
    })

    test('mouse click and touch tap both place, on the same page, with no double-fire', async ({
        page,
    }) => {
        await goto(page)
        await holdItem(page)
        expect(await entityCount(page)).toBe(0)

        // --- mouse: the press pipeline places on click, exactly once ---
        await page.mouse.move(AT_A.x, AT_A.y)
        await page.mouse.click(AT_A.x, AT_A.y)
        await expect.poll(() => entityCount(page)).toBe(1)

        // --- touch: a tap previews, a second tap on the same tile commits ---
        await page.locator('#editor').tap({ position: AT_B })
        const previewed = await getState(page)
        expect(previewed.paint.visible).toBe(true)
        // Still 1: the tap positioned the ghost and nothing else. A compatibility
        // mouse event leaking through would have placed a second entity here —
        // this is the double-fire ratchet.
        expect(previewed.blueprint.entityCount).toBe(1)
        expect(previewed.signals.touchRecent).toBe(true)

        await page.locator('#editor').tap({ position: AT_B })
        await expect.poll(() => entityCount(page)).toBe(2)

        // And back to the mouse: a click still places, one entity per click.
        await page.mouse.move(AT_A.x + 96, AT_A.y + 96)
        await page.mouse.click(AT_A.x + 96, AT_A.y + 96)
        await expect.poll(() => entityCount(page)).toBe(3)
    })

    test('touchRecent tracks the last pointer that acted', async ({ page }) => {
        await goto(page)

        expect((await getState(page)).signals.touchRecent).toBe(false)

        await page.locator('#editor').tap({ position: AT_A })
        await expect.poll(async () => (await getState(page)).signals.touchRecent).toBe(true)
        await expect(page.locator('body')).toHaveClass(/touch-recent/)

        await page.mouse.move(AT_B.x, AT_B.y)
        await expect.poll(async () => (await getState(page)).signals.touchRecent).toBe(false)
        await expect(page.locator('body')).not.toHaveClass(/touch-recent/)
    })

    test('keys is earned on a coarse primary pointer, and flips with it', async ({ page }) => {
        // No stub here: with touch emulation on, this project's Chromium really
        // does report a coarse primary pointer — so this is the tablet case,
        // detected for real.
        await goto(page)

        const booted = await getState(page)
        expect(booted.signals.coarse).toBe(true)
        expect(booted.signals.keys).toBe(false) // no keyboard evidence yet
        expect(booted.inputMode).toBe('mobile') // ...and the derived mode follows
        const body = page.locator('body')
        await expect(body).toHaveClass(/coarse/)
        await expect(body).not.toHaveClass(/keys/)

        // The signals are live: pin `coarse` off (a keyboard dock re-attaching,
        // here through the `?test` override) and everything re-derives without a
        // reload — a keyboard is assumed again and the legacy mode goes back.
        await setSignals(page, { coarse: false })
        const fine = await getState(page)
        expect(fine.signals.keys).toBe(true)
        expect(fine.inputMode).toBe('desktop')
        await expect(body).not.toHaveClass(/coarse/)

        // Back to coarse: `keys` is still unearned, until a real keydown lands.
        await setSignals(page, { coarse: true })
        expect((await getState(page)).signals.keys).toBe(false)

        await page.locator('#editor').focus()
        await page.keyboard.press('Shift')
        await expect.poll(async () => (await getState(page)).signals.keys).toBe(true)
        await expect(body).toHaveClass(/keys/)
    })

    test('a forced preset filters pointer types, and persists across a reload', async ({
        page,
    }) => {
        await goto(page)
        await holdItem(page)

        // force mouse: touch is ignored entirely (the old `desktop` behaviour)
        await setPreset(page, 'mouse')
        await page.locator('#editor').tap({ position: AT_A })
        await page.locator('#editor').tap({ position: AT_A })
        expect(await entityCount(page)).toBe(0)
        expect((await getState(page)).inputMode).toBe('desktop')

        // force touch: the mouse is ignored (the old `mobile` behaviour)
        await setPreset(page, 'touch')
        await page.mouse.move(AT_B.x, AT_B.y)
        await page.mouse.click(AT_B.x, AT_B.y)
        expect(await entityCount(page)).toBe(0)
        expect((await getState(page)).inputMode).toBe('mobile')

        // ...but touch still works under it: tap to preview, tap to place.
        await page.locator('#editor').tap({ position: AT_A })
        await page.locator('#editor').tap({ position: AT_A })
        await expect.poll(() => entityCount(page)).toBe(1)

        // The preset is persisted (new key) and survives a reload.
        expect(await page.evaluate(() => window.localStorage.getItem('fbe:inputPreset'))).toBe(
            'touch'
        )
        await page.reload()
        await waitForLoaded(page)
        expect((await getState(page)).inputPreset).toBe('touch')
    })

    test('the pre-#101 fbe:inputMode choice migrates to auto', async ({ page }) => {
        await page.addInitScript(() => {
            // What a hybrid used to persist: auto-detect said "mobile" because the
            // machine reports touch points, and that got written as if chosen.
            window.localStorage.setItem('fbe:inputMode', 'mobile')
        })
        await gotoFinePointer(page)

        const s = await getState(page)
        expect(s.inputPreset).toBe('auto')
        expect(s.inputMode).toBe('desktop') // detection now gets this right
        expect(await page.evaluate(() => window.localStorage.getItem('fbe:inputMode'))).toBeNull()
        expect(await page.evaluate(() => window.localStorage.getItem('fbe:inputPreset'))).toBeNull()
    })

    test('a two-finger pinch still zooms', async ({ page }) => {
        await goto(page)

        const before = (await getState(page)).viewportScale
        await pinch(page, { x: 640, y: 360 }, 60, 220)
        await expect.poll(async () => (await getState(page)).viewportScale > before).toBe(true)
    })
})
