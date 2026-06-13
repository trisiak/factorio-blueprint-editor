import { Container } from 'pixi.js'
import G from '../../../common/globals'
import { ISignal } from '../../../types'
import { TextInput } from '../../controls/TextInput'
import { SignalSlot } from './SignalSlot'

export interface OperandValue {
    signal?: ISignal
    constant?: number
}

/**
 * One combinator operand: a signal slot and a numeric (signed) constant field
 * that are mutually exclusive — picking a signal clears the number, typing a
 * number clears the signal — mirroring how Factorio stores `*_signal` vs
 * `*_constant`. Kept side-by-side and compact so two of them plus an operator fit
 * on one row even on a phone.
 */
export class Operand extends Container {
    private readonly slot: SignalSlot
    private readonly input: TextInput

    public constructor(
        value: OperandValue,
        private readonly onChange: (value: OperandValue) => void,
        allowSpecial = true
    ) {
        super()

        this.slot = new SignalSlot(
            value.signal,
            signal => {
                if (signal) {
                    this.input.text = ''
                    this.onChange({ signal })
                } else {
                    this.onChange({ constant: this.parseConstant() })
                }
            },
            allowSpecial
        )
        this.addChild(this.slot)

        this.input = new TextInput(
            G.app.renderer,
            52,
            value.signal ? '' : value.constant !== undefined ? String(value.constant) : '',
            12
        )
        this.input.restrict = /^-?\d*$/
        this.input.position.set(42, 8)
        this.input.on('changed', () => {
            if (this.input.text !== '') {
                this.slot.signal = undefined
            }
            this.onChange({ constant: this.parseConstant() })
        })
        this.addChild(this.input)
    }

    private parseConstant(): number {
        const n = parseInt(this.input.text, 10)
        return Number.isNaN(n) ? 0 : n
    }
}
