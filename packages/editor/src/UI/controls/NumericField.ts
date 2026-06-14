import { FederatedPointerEvent, Text } from 'pixi.js'
import G from '../../common/globals'
import { Slot } from './Slot'
import { styles } from '../style'

/**
 * A tappable field that shows a number and opens the canvas-rendered
 * `NumericKeypad` to edit it — a touch-safe replacement for a DOM `<input>` for
 * the numeric values circuit editing needs. Works identically on desktop and
 * mobile (no OS keyboard).
 */
export class NumericField extends Slot<undefined> {
    private m_value: number | undefined
    private readonly m_label: Text

    public constructor(
        value: number | undefined,
        private readonly onChange: (value: number) => void,
        private readonly title = 'Enter value',
        width = 64
    ) {
        super(width, 32)
        this.m_value = value
        this.m_label = new Text({ text: this.text(), style: styles.dialog.label })
        this.m_label.anchor.set(0.5)
        this.content = this.m_label
        this.on('pointerdown', this.onPointerDown, this)
    }

    public get value(): number | undefined {
        return this.m_value
    }

    public set value(value: number | undefined) {
        this.m_value = value
        this.m_label.text = this.text()
    }

    private text(): string {
        return this.m_value !== undefined ? String(this.m_value) : '—'
    }

    private onPointerDown(e: FederatedPointerEvent): void {
        e.stopPropagation()
        if (e.button !== 0) return
        G.UI.createNumericKeypad(this.title, this.m_value, v => {
            this.value = v
            this.onChange(v)
        })
    }
}
