import { Text } from 'pixi.js'
import G from '../../../common/globals'
import { ISignal } from '../../../types'
import { Slot } from '../../controls/Slot'
import { bindSlotGestures } from '../../controls/gestures'
import { styles } from '../../style'
import F from '../../controls/functions'

export interface OperandValue {
    signal?: ISignal
    constant?: number
}

/**
 * One combinator operand as a single slot — it shows either the chosen signal's
 * icon or the constant value. Tapping it opens the signal picker (which carries
 * a Constant field), so a signal and a constant are mutually exclusive by
 * construction, matching Factorio's single-slot operand chooser and how it
 * stores `*_signal` vs `*_constant`. Right-click clears it.
 */
export class Operand extends Slot<undefined> {
    private m_value: OperandValue

    public constructor(
        value: OperandValue,
        private readonly onChange: (value: OperandValue) => void,
        private readonly allowSpecial = true,
        private readonly title = 'Select a signal or enter a constant'
    ) {
        super(36, 36)
        this.m_value = { ...value }
        this.updateContent()
        bindSlotGestures(
            this,
            () => this.openPicker(),
            () => {
                this.m_value = {}
                this.updateContent()
                this.onChange({})
            }
        )
    }

    private updateContent(): void {
        if (this.m_value.signal?.name) {
            try {
                this.content = F.CreateIcon(this.m_value.signal.name)
                return
            } catch {
                // fall through for an iconless signal name
            }
        }
        const text = this.m_value.constant !== undefined ? String(this.m_value.constant) : '+'
        const label = new Text({ text, style: styles.dialog.label })
        label.anchor.set(0.5)
        this.content = label
    }

    private openPicker(): void {
        G.UI.createSignalPicker(
            this.title,
            choice => {
                this.m_value = choice
                this.updateContent()
                this.onChange(choice)
            },
            this.allowSpecial,
            true // operands can be a constant
        )
    }
}
