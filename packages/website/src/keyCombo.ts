// Pretty-printing for the action registry's key combos (#101 Slice 4).
//
// `Action.keyCombo` is the *storage* form — modifier names joined to a raw
// `KeyboardEvent.code` (`Control+KeyZ`, `Shift+KeyF`), which is what the
// Keybinds folder edits and persists. That form is unreadable in an 8 px badge
// on a 34 px rail cell, so the rail renders this projection of it instead:
// modifiers as their conventional symbols, the trigger stripped of the `Key`/
// `Digit`/`Numpad` prefixes that carry no information for a reader, and the
// mouse triggers (copy/paste entity settings) as LMB/MMB/RMB rather than the
// registry's internal `ClickL`.
//
// Kept free of editor imports so it stays unit-testable in the node
// environment (`keyCombo.test.ts`); the rail's own module pulls in PixiJS.

/** Trigger codes whose readable form isn't just "drop the prefix". */
const KEY_LABELS: Record<string, string> = {
    BracketLeft: '[',
    BracketRight: ']',
    Escape: 'Esc',
    Delete: 'Del',
    Backspace: '⌫',
    Enter: '⏎',
    Space: '␣',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ClickL: 'LMB',
    ClickM: 'MMB',
    ClickR: 'RMB',
}

const MODIFIER_SYMBOLS: Record<string, string> = {
    Control: '⌃',
    Shift: '⇧',
    Alt: '⌥',
}

/** `Control+Shift+KeyR` → `⌃⇧R`; an unknown trigger passes through as-is. */
export function formatKeyCombo(combo: string): string {
    const parts = combo.split('+')
    const trigger = parts.pop() ?? ''
    const mods = parts.map(m => MODIFIER_SYMBOLS[m] ?? m).join('')
    return mods + (KEY_LABELS[trigger] ?? trigger.replace(/^(Key|Digit|Numpad)/, ''))
}
