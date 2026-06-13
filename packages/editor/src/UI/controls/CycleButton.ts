import { Text } from 'pixi.js'
import { Button } from './Button'
import { styles } from '../style'

/**
 * A compact button that cycles through a fixed list of string values on each tap
 * (right-click cycles backwards). Used for combinator operators/comparators where
 * a dropdown would be fiddly on touch — one big tap target that advances the
 * value, which reads well in the tight space a combinator editor has.
 */
export class CycleButton<T extends string> extends Button {
    private m_index: number
    private readonly m_label: Text

    public constructor(
        private readonly values: T[],
        value: T,
        private readonly onChange: (value: T) => void,
        width = 48,
        height = 36
    ) {
        super(width, height)
        this.m_index = Math.max(0, values.indexOf(value))

        this.m_label = new Text({ text: this.values[this.m_index], style: styles.dialog.title })
        this.m_label.anchor.set(0.5)
        this.content = this.m_label

        this.on('pointerdown', e => {
            e.stopPropagation()
            this.cycle(e.button === 2 ? -1 : 1)
        })
    }

    public get value(): T {
        return this.values[this.m_index]
    }

    public set value(value: T) {
        const i = this.values.indexOf(value)
        if (i !== -1 && i !== this.m_index) {
            this.m_index = i
            this.m_label.text = this.value
        }
    }

    private cycle(dir: number): void {
        this.m_index = (this.m_index + dir + this.values.length) % this.values.length
        this.m_label.text = this.value
        this.onChange(this.value)
    }
}
