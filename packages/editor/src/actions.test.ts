import { describe, expect, it } from 'vitest'
import { ActionRegistry, MouseButton } from './actions'

/**
 * `ActionRegistry` is framework-free: it matches DOM-ish events against the
 * registered triggers and never touches Pixi, so it can be driven with plain
 * objects. `triggerMatches` distinguishes mouse from keyboard purely by
 * `'button' in e`, and modifier state is read off `ctrlKey/shiftKey/altKey` —
 * that is the whole contract these fakes have to satisfy.
 */
interface FakeMouseEvent {
    button: MouseButton
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
}

const click = (
    button: MouseButton,
    mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}
): FakeMouseEvent => ({
    button,
    ctrlKey: !!mods.ctrl,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
})

const pressButton = (registry: ActionRegistry, e: FakeMouseEvent): void =>
    registry.pressButton(e as unknown as PointerEvent)
const releaseButton = (registry: ActionRegistry, e: FakeMouseEvent): void =>
    registry.releaseButton(e as unknown as PointerEvent)

/** A `Shift` key event, as the window keydown/keyup handlers deliver it. */
const shiftKey = (): KeyboardEvent => ({ key: 'Shift', code: 'ShiftLeft' }) as KeyboardEvent

describe('ActionRegistry modifier sync', () => {
    /**
     * Registry mirroring the real Shift+LMB / plain-LMB pair: `pasteSettings`
     * sorts first (one modifier) and `pan` is the unmodified fallback.
     */
    function makeRegistry() {
        const log: string[] = []
        const registry = new ActionRegistry({
            pasteSettings: {
                trigger: { button: MouseButton.Left },
                modifiers: { shift: true },
                callbacks: {
                    onPress: () => {
                        log.push('paste:press')
                        return true
                    },
                    onRelease: () => log.push('paste:release'),
                },
                modifierCallbacks: {
                    onPress: () => {
                        log.push('mod:press')
                        return true
                    },
                    onRelease: () => log.push('mod:release'),
                },
            },
            pan: {
                trigger: { button: MouseButton.Left },
                callbacks: {
                    onPress: () => {
                        log.push('pan:press')
                        return true
                    },
                    onRelease: () => log.push('pan:release'),
                },
            },
        })
        return { registry, log }
    }

    it('still matches a shift-modified action after a blur wiped the held modifier (#101)', () => {
        const { registry, log } = makeRegistry()

        registry.pressKey(shiftKey())
        expect(log).toEqual(['mod:press'])

        // Firefox's Shift+right-click menu steals focus -> window blur ->
        // releaseAll(). Shift is still physically down, so no keydown re-arms it.
        registry.releaseAll()
        log.length = 0

        const e = click(MouseButton.Left, { shift: true })
        pressButton(registry, e)
        releaseButton(registry, e)

        // The event's own shiftKey re-armed the modifier, so the shift action
        // ran — before the fix this fell through to `pan`.
        expect(log).toEqual(['mod:press', 'paste:press', 'paste:release'])
    })

    it('fires modifier callbacks when the re-sync turns a modifier on, and releases them when it turns off', () => {
        const { registry, log } = makeRegistry()

        // Modifier held according to the event, but never seen as a keydown.
        pressButton(registry, click(MouseButton.Left, { shift: true }))
        expect(log).toEqual(['mod:press', 'paste:press'])
        log.length = 0

        // ...and a subsequent event without Shift retracts the affordance.
        releaseButton(registry, click(MouseButton.Left))
        expect(log).toEqual(['mod:release', 'paste:release'])
    })

    it('does not re-fire modifier callbacks when the state already agrees', () => {
        const { registry, log } = makeRegistry()

        registry.pressKey(shiftKey())
        expect(log).toEqual(['mod:press'])
        log.length = 0

        pressButton(registry, click(MouseButton.Left, { shift: true }))
        expect(log).toEqual(['paste:press'])
    })

    it('falls back to the unmodified action when the event carries no modifiers', () => {
        const { registry, log } = makeRegistry()

        // A stale modifier (e.g. an eaten keyup) must not keep matching either.
        registry.pressKey(shiftKey())
        log.length = 0

        const e = click(MouseButton.Left)
        pressButton(registry, e)
        releaseButton(registry, e)

        expect(log).toEqual(['mod:release', 'pan:press', 'pan:release'])
    })

    it('sorts two-modifier actions ahead of one-modifier ones (the Firefox Ctrl+Shift+LMB default)', () => {
        const log: string[] = []
        const registry = new ActionRegistry({
            // Registration order deliberately puts the two-modifier action last;
            // the registry sorts by modifier count, not by declaration order.
            copySelection: {
                trigger: { button: MouseButton.Left },
                modifiers: { control: true },
                callbacks: {
                    onPress: () => {
                        log.push('copySelection')
                        return true
                    },
                },
            },
            copyEntitySettings: {
                trigger: { button: MouseButton.Left },
                modifiers: { control: true, shift: true },
                // Mirrors the real action: only succeeds in EDIT mode. Here it
                // reports failure, so the press must fall through.
                callbacks: {
                    onPress: () => {
                        log.push('copyEntitySettings')
                        return false
                    },
                },
            },
        })

        pressButton(registry, click(MouseButton.Left, { ctrl: true, shift: true }))
        expect(log).toEqual(['copyEntitySettings', 'copySelection'])
    })

    it('ignores events that carry no modifier flags rather than treating them as released', () => {
        const { registry, log } = makeRegistry()

        registry.pressKey(shiftKey())
        log.length = 0

        // A synthetic event with only `button` (as some Pixi/CDP paths produce).
        registry.pressButton({ button: MouseButton.Left } as unknown as PointerEvent)
        expect(log).toEqual(['paste:press'])
    })
})
