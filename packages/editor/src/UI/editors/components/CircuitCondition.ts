import { Container, Text } from 'pixi.js'
import { Entity } from '../../../core/Entity'
import { ComparatorString, ICondition } from '../../../types'
import { Checkbox } from '../../controls/Checkbox'
import { CycleButton } from '../../controls/CycleButton'
import { styles } from '../../style'
import { Operand } from './Operand'
import { SignalSlot } from './SignalSlot'

const COMPARATORS: ComparatorString[] = ['<', '>', '≤', '≥', '=', '≠']

/**
 * The enable/disable circuit-condition control shared by inserters, pumps,
 * belts, mining drills, etc. A checkbox toggles whether the entity is gated by
 * the circuit network (`circuit_enabled`) and a condition row sets the condition
 * itself (`first <cmp> second|constant`). Self-contained so any editor can drop
 * it in with one line.
 */
export class CircuitCondition extends Container {
    private readonly cond: ICondition

    public constructor(private readonly entity: Entity) {
        super()

        this.cond = { ...(entity.circuitCondition ?? { comparator: '<', constant: 0 }) }

        const enable = new Checkbox(entity.circuitEnabled, 'Enable/disable based on circuit')
        enable.on('changed', () => {
            this.entity.circuitEnabled = enable.checked
        })
        this.addChild(enable)

        const label = new Text({ text: 'Condition:', style: styles.dialog.label })
        label.position.set(0, 30)
        this.addChild(label)

        const first = new SignalSlot(
            this.cond.first_signal,
            signal => {
                this.cond.first_signal = signal
                this.commit()
            },
            false
        )
        first.position.set(0, 50)
        this.addChild(first)

        const cmp = new CycleButton<ComparatorString>(
            COMPARATORS,
            this.cond.comparator ?? '<',
            v => {
                this.cond.comparator = v
                this.commit()
            }
        )
        cmp.position.set(44, 50)
        this.addChild(cmp)

        const second = new Operand(
            { signal: this.cond.second_signal, constant: this.cond.constant },
            v => {
                this.cond.second_signal = v.signal
                this.cond.constant = v.signal ? undefined : v.constant
                this.commit()
            },
            false
        )
        second.position.set(100, 50)
        this.addChild(second)
    }

    private commit(): void {
        this.entity.circuitCondition = { ...this.cond }
    }
}
