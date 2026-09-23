import { describe, expect, it } from 'vitest'
import { keypadKeyAction } from './keypadInput'

/**
 * Keyboard driver for the canvas keypad (#101 A7). The keypad itself is PixiJS
 * (untestable in the node env), but its whole key behaviour is the pure
 * transition below — so the desktop regression it fixes ("a 10-digit constant
 * is 10 clicks") is guarded here, and the dialog only has to apply the result.
 */
describe('keypadKeyAction', () => {
    it('appends main-row digits to the buffer', () => {
        expect(keypadKeyAction('', { key: '4', code: 'Digit4' })).toEqual({
            type: 'value',
            value: '4',
        })
        expect(keypadKeyAction('12', { key: '3', code: 'Digit3' })).toEqual({
            type: 'value',
            value: '123',
        })
    })

    it('appends numpad digits by code, even when NumLock reports a nav key', () => {
        expect(keypadKeyAction('1', { key: '7', code: 'Numpad7' })).toEqual({
            type: 'value',
            value: '17',
        })
        // NumLock off: the key name is the navigation function, the code isn't.
        expect(keypadKeyAction('1', { key: 'ArrowLeft', code: 'Numpad4' })).toEqual({
            type: 'value',
            value: '14',
        })
    })

    it('does not type a digit for a shifted number row', () => {
        expect(keypadKeyAction('', { key: '!', code: 'Digit1' })).toEqual({ type: 'ignore' })
    })

    it('rubs out with Backspace and clears with Delete', () => {
        expect(keypadKeyAction('123', { key: 'Backspace' })).toEqual({ type: 'value', value: '12' })
        expect(keypadKeyAction('', { key: 'Backspace' })).toEqual({ type: 'value', value: '' })
        expect(keypadKeyAction('123', { key: 'Delete' })).toEqual({ type: 'value', value: '' })
    })

    it('toggles the sign with `-` where negatives are allowed', () => {
        expect(keypadKeyAction('12', { key: '-' })).toEqual({ type: 'value', value: '-12' })
        expect(keypadKeyAction('-12', { key: '-' })).toEqual({ type: 'value', value: '12' })
        // A lone '-' is a legal intermediate buffer (the display reads 0).
        expect(keypadKeyAction('', { key: '-' })).toEqual({ type: 'value', value: '-' })
    })

    it('refuses `-` on a field that has no sign key', () => {
        expect(keypadKeyAction('12', { key: '-' }, false)).toEqual({ type: 'ignore' })
    })

    it('confirms on Enter and cancels on Escape', () => {
        expect(keypadKeyAction('7', { key: 'Enter', code: 'NumpadEnter' })).toEqual({
            type: 'confirm',
        })
        expect(keypadKeyAction('7', { key: 'Escape' })).toEqual({ type: 'cancel' })
    })

    it('ignores everything else, so it falls through to the editor actions', () => {
        for (const key of ['s', 'R', 'Tab', 'ArrowUp', 'F5', ' ']) {
            expect(keypadKeyAction('1', { key })).toEqual({ type: 'ignore' })
        }
    })
})
