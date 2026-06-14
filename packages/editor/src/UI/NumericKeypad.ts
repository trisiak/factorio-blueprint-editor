import { Container, Graphics, Text } from 'pixi.js'
import { Button } from './controls/Button'
import { Dialog } from './controls/Dialog'
import { styles } from './style'

/**
 * A PixiJS-native numeric keypad dialog. The editor's text fields use a DOM
 * `<input>` overlaid on the canvas, which is unreliable on touch / high-DPI
 * devices (mis-positioned, and no on-screen keyboard pops up). For the numeric
 * values circuit editing needs (constants, signal counts) this keypad is fully
 * canvas-rendered, so it works the same on desktop and mobile with big tap
 * targets and no OS keyboard required.
 */
export class NumericKeypad extends Dialog {
    private static readonly W = 216
    private static readonly H = 344
    private value: string
    private readonly display: Text

    public constructor(
        title: string,
        initial: number | undefined,
        private readonly onConfirm: (value: number) => void
    ) {
        super(NumericKeypad.W, NumericKeypad.H, title)
        this.value = initial !== undefined ? String(initial) : ''

        // Value display — dark field, light text (matches the dialog theme).
        const box = new Graphics().roundRect(12, 40, NumericKeypad.W - 24, 36, 2).fill(0x2b2b2b)
        this.addChild(box)
        this.display = new Text({ text: this.value || '0', style: styles.dialog.title })
        this.display.anchor.set(1, 0.5)
        this.display.position.set(NumericKeypad.W - 20, 58)
        this.addChild(this.display)

        // Keypad — respond on pointerdown so presses register instantly.
        const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '±', '0', '⌫']
        keys.forEach((k, i) => {
            const col = i % 3
            const row = Math.floor(i / 3)
            const b = this.key(k, 60, 44)
            b.position.set(12 + col * 64, 88 + row * 48)
            b.on('pointerdown', e => {
                e.stopPropagation()
                this.press(k)
            })
            this.addChild(b)
        })

        // Clear + Confirm
        const clear = this.key('C', 92, 30)
        clear.position.set(12, 88 + 4 * 48 + 4)
        clear.on('pointerdown', e => {
            e.stopPropagation()
            this.value = ''
            this.refresh()
        })
        this.addChild(clear)

        const confirm = this.barButton('✓ OK', 0x2f7d32)
        confirm.position.set(NumericKeypad.W - 12 - 92, 88 + 4 * 48 + 4)
        confirm.on('pointerdown', e => {
            e.stopPropagation()
            this.onConfirm(this.parsed())
            this.close()
        })
        this.addChild(confirm)
    }

    private key(label: string, w: number, h: number): Button {
        const b = new Button(w, h)
        const t = new Text({ text: label, style: styles.dialog.title })
        t.anchor.set(0.5)
        b.content = t
        return b
    }

    private barButton(label: string, color: number): Container {
        const c = new Container()
        c.addChild(new Graphics().roundRect(0, 0, 92, 30, 4).fill(color))
        const t = new Text({
            text: label,
            style: {
                fontFamily: "'Roboto', sans-serif",
                fontSize: 14,
                fontWeight: 'bold',
                fill: 0xffffff,
            },
        })
        t.anchor.set(0.5)
        t.position.set(46, 15)
        c.addChild(t)
        c.eventMode = 'static'
        c.cursor = 'pointer'
        return c
    }

    private press(k: string): void {
        if (k === '⌫') this.value = this.value.slice(0, -1)
        else if (k === '±')
            this.value = this.value.startsWith('-') ? this.value.slice(1) : `-${this.value}`
        else this.value += k
        this.refresh()
    }

    private parsed(): number {
        const n = parseInt(this.value, 10)
        return Number.isNaN(n) ? 0 : n
    }

    private refresh(): void {
        this.display.text = this.value === '' || this.value === '-' ? '0' : this.value
    }
}
