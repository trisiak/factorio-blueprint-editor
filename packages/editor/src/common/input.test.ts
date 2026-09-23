import { describe, expect, it } from 'vitest'
import {
    COMPACT_MAX_WIDTH,
    acceptsPointerType,
    deriveKeys,
    deriveMode,
    isCompactWidth,
    isMousePipeline,
    isRealKeydown,
    migratePreset,
    presetForMode,
    reduceTouchRecent,
} from './input'

// The decision logic behind the input signals (#101 Slice 1). The controller
// itself is browser-bound (media queries, window listeners), so the parts worth
// pinning are factored out as pure functions and tested here in the node env.

describe('migratePreset', () => {
    it('keeps a valid persisted preset', () => {
        for (const p of ['auto', 'mouse', 'touch'] as const) {
            expect(migratePreset(p, null).preset).toBe(p)
        }
    })

    it('falls back to auto for a missing or junk value', () => {
        expect(migratePreset(null, null).preset).toBe('auto')
        expect(migratePreset('desktop', null).preset).toBe('auto')
        expect(migratePreset('', null).preset).toBe('auto')
    })

    it('migrates the pre-#101 fbe:inputMode choice to auto and drops the key', () => {
        // The old key mostly held an auto-detected value that was persisted as if
        // it were a choice — carrying it over would re-freeze the hybrid bug (B1).
        for (const legacy of ['desktop', 'mobile']) {
            const r = migratePreset(null, legacy)
            expect(r.preset).toBe('auto')
            expect(r.clearLegacy).toBe(true)
        }
    })

    it('drops the legacy key even when a new preset already exists', () => {
        expect(migratePreset('touch', 'desktop')).toEqual({ preset: 'touch', clearLegacy: true })
    })

    it('leaves storage alone when there is nothing to migrate', () => {
        expect(migratePreset('auto', null).clearLegacy).toBe(false)
    })
})

describe('deriveMode', () => {
    it('follows the primary pointer under auto', () => {
        expect(deriveMode('auto', false)).toBe('desktop')
        expect(deriveMode('auto', true)).toBe('mobile')
    })

    it('lets a forced preset win over detection', () => {
        expect(deriveMode('mouse', true)).toBe('desktop')
        expect(deriveMode('touch', false)).toBe('mobile')
    })

    it('round-trips through presetForMode', () => {
        for (const mode of ['desktop', 'mobile'] as const) {
            expect(deriveMode(presetForMode(mode), false)).toBe(mode)
            expect(deriveMode(presetForMode(mode), true)).toBe(mode)
        }
    })
})

describe('deriveKeys', () => {
    it('assumes a keyboard on a fine pointer', () => {
        expect(deriveKeys(false, false)).toBe(true)
    })

    it('waits for evidence on a coarse pointer', () => {
        expect(deriveKeys(true, false)).toBe(false)
        expect(deriveKeys(true, true)).toBe(true)
    })
})

describe('isCompactWidth', () => {
    it('splits at the portrait-tablet edge', () => {
        expect(isCompactWidth(390)).toBe(true) // phone portrait
        expect(isCompactWidth(COMPACT_MAX_WIDTH)).toBe(true)
        expect(isCompactWidth(COMPACT_MAX_WIDTH + 1)).toBe(false)
        expect(isCompactWidth(1280)).toBe(false) // the hybrid laptop case
    })
})

describe('reduceTouchRecent', () => {
    it('is set by touch and cleared by mouse/pen', () => {
        expect(reduceTouchRecent(false, 'touch')).toBe(true)
        expect(reduceTouchRecent(true, 'mouse')).toBe(false)
        expect(reduceTouchRecent(true, 'pen')).toBe(false)
    })

    it('holds its value for anything else', () => {
        expect(reduceTouchRecent(true, undefined)).toBe(true)
        expect(reduceTouchRecent(false, '')).toBe(false)
    })
})

describe('isRealKeydown', () => {
    it('accepts an ordinary physical key', () => {
        expect(isRealKeydown({ isTrusted: true, key: 'r', keyCode: 82 })).toBe(true)
    })

    it('rejects synthetic events and IME/virtual-keyboard composition', () => {
        expect(isRealKeydown({ isTrusted: false, key: 'r', keyCode: 82 })).toBe(false)
        expect(isRealKeydown({ isTrusted: true, key: 'Unidentified', keyCode: 229 })).toBe(false)
        expect(isRealKeydown({ isTrusted: true, key: 'a', keyCode: 229 })).toBe(false)
    })

    it('ignores typing into a field on a coarse device (on-screen keyboard)', () => {
        expect(isRealKeydown({ isTrusted: true, key: 'a', intoEditable: true, coarse: true })).toBe(
            false
        )
        // ...but the same keystroke on a fine pointer is a real keyboard.
        expect(
            isRealKeydown({ isTrusted: true, key: 'a', intoEditable: true, coarse: false })
        ).toBe(true)
    })
})

describe('acceptsPointerType', () => {
    it('accepts everything under auto — per-event routing decides', () => {
        for (const t of ['mouse', 'touch', 'pen']) expect(acceptsPointerType('auto', t)).toBe(true)
    })

    it('reproduces the old desktop/mobile filtering when forced', () => {
        expect(acceptsPointerType('mouse', 'touch')).toBe(false)
        expect(acceptsPointerType('mouse', 'mouse')).toBe(true)
        expect(acceptsPointerType('mouse', 'pen')).toBe(true) // pen passed on desktop
        expect(acceptsPointerType('touch', 'mouse')).toBe(false)
        expect(acceptsPointerType('touch', 'touch')).toBe(true)
        expect(acceptsPointerType('touch', 'pen')).toBe(true) // ...and on mobile
    })
})

describe('isMousePipeline', () => {
    it('routes mouse and pen to the mouse/keyboard pipeline, touch to gestures', () => {
        expect(isMousePipeline('mouse')).toBe(true)
        expect(isMousePipeline('pen')).toBe(true)
        expect(isMousePipeline('touch')).toBe(false)
    })
})
