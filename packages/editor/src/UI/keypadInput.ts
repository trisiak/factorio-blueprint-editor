// Keyboard driver for the canvas numeric keypad (#101 A7), kept framework-free
// (no PixiJS) so it is unit-testable in the node env — the dialog in
// NumericKeypad.ts only applies what this decides.

/**
 * What a key does to the keypad's value buffer — the whole keyboard behaviour
 * of the keypad, as a pure transition so it can be unit-tested without PixiJS
 * (see keypadInput.test.ts). `value` is the raw buffer (possibly `''` or a
 * lone `'-'`), not the parsed number.
 */
export type KeypadKeyAction =
    | { type: 'value'; value: string }
    | { type: 'confirm' }
    | { type: 'cancel' }
    | { type: 'ignore' }

/** The keyboard-event fields the transition reads. */
export interface KeypadKey {
    key: string
    code?: string
}

/**
 * Keyboard → keypad transition (#101 A7). Typing a number is the desktop
 * primitive, so while the keypad is open it takes: digits (main row and, via
 * `code`, the numpad even with NumLock off), `Backspace` (rub out), `Delete`
 * (the `C` button), `-` (the `±` button — only where the field allows
 * negatives), `Enter` (`✓ OK`) and `Escape` (dismiss). Everything else is
 * `ignore`, which the caller passes on to the editor's action registry.
 */
export function keypadKeyAction(
    value: string,
    key: KeypadKey,
    allowNegative = true
): KeypadKeyAction {
    // Numpad digits report `key` as an arrow/nav name when NumLock is off, so
    // the physical `code` decides them; the main row goes by `key`, which keeps
    // Shift+1 ('!') from typing a 1.
    const numpad = /^Numpad([0-9])$/.exec(key.code ?? '')
    const digit = numpad ? numpad[1] : /^[0-9]$/.test(key.key) ? key.key : undefined
    if (digit !== undefined) return { type: 'value', value: value + digit }

    switch (key.key) {
        case 'Backspace':
            return { type: 'value', value: value.slice(0, -1) }
        case 'Delete':
            return { type: 'value', value: '' }
        case '-':
            if (!allowNegative) return { type: 'ignore' }
            return {
                type: 'value',
                value: value.startsWith('-') ? value.slice(1) : `-${value}`,
            }
        case 'Enter':
            return { type: 'confirm' }
        case 'Escape':
            return { type: 'cancel' }
        default:
            return { type: 'ignore' }
    }
}
