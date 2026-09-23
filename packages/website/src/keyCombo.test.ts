import { describe, it, expect } from 'vitest'
import { formatKeyCombo } from './keyCombo'

// The rail's keybind badges (#101 Slice 4) are the registry's own `keyCombo`
// strings, projected for a tiny cell. The projection is the only logic in that
// path, so it's the part worth pinning here — the rest is DOM.
describe('formatKeyCombo', () => {
    it('drops the code prefixes a reader gains nothing from', () => {
        expect(formatKeyCombo('KeyR')).toBe('R')
        expect(formatKeyCombo('Digit1')).toBe('1')
        expect(formatKeyCombo('Numpad5')).toBe('5')
    })

    it('renders modifiers as symbols, in registry order', () => {
        expect(formatKeyCombo('Control+KeyZ')).toBe('⌃Z')
        expect(formatKeyCombo('Shift+KeyF')).toBe('⇧F')
        expect(formatKeyCombo('Control+Shift+KeyR')).toBe('⌃⇧R')
        expect(formatKeyCombo('Alt+KeyQ')).toBe('⌥Q')
    })

    it('names the mouse triggers the way a user would', () => {
        // `mine` (delete) and the copy/paste-settings actions are mouse-bound.
        expect(formatKeyCombo('ClickR')).toBe('RMB')
        expect(formatKeyCombo('Shift+ClickL')).toBe('⇧LMB')
    })

    it('spells out the keys with no printable glyph', () => {
        expect(formatKeyCombo('Escape')).toBe('Esc')
        expect(formatKeyCombo('BracketLeft')).toBe('[')
        expect(formatKeyCombo('ArrowUp')).toBe('↑')
    })

    it('passes an unrecognised trigger through unchanged', () => {
        // A rebind can name any code; a badge showing it verbatim beats a blank.
        expect(formatKeyCombo('F5')).toBe('F5')
        expect(formatKeyCombo('')).toBe('')
    })
})
