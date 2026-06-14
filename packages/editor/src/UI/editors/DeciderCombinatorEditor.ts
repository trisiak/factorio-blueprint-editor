import { Text } from 'pixi.js'
import { Entity } from '../../core/Entity'
import { ComparatorString, DeciderCombinatorCondition, DeciderCombinatorOutput } from '../../types'
import { CycleButton } from '../controls/CycleButton'
import { Checkbox } from '../controls/Checkbox'
import { styles } from '../style'
import { Editor } from './Editor'
import { Operand } from './components/Operand'
import { SignalSlot } from './components/SignalSlot'

const COMPARATORS: ComparatorString[] = ['<', '>', '≤', '≥', '=', '≠']

/**
 * Decider combinator editor — single condition + single output (the common
 * case). `if first <cmp> second  then output := input-count | 1`. The 2.0
 * multi-condition/multi-output form is intentionally deferred; this reads/writes
 * the first entry so such blueprints stay editable for their primary clause.
 */
export class DeciderCombinatorEditor extends Editor {
    private cond: DeciderCombinatorCondition
    private out: DeciderCombinatorOutput

    public constructor(entity: Entity) {
        super(360, 210, entity)

        const dc = entity.deciderConditions
        this.cond = { ...(dc.conditions?.[0] ?? {}) }
        this.out = { ...(dc.outputs?.[0] ?? { signal: undefined }) }

        const x = 140
        this.addLabel(x, 48, 'If')

        const first = new SignalSlot(this.cond.first_signal, signal => {
            this.cond.first_signal = signal
            this.commit()
        })
        first.position.set(x, 66)
        this.addChild(first)

        const cmp = new CycleButton<ComparatorString>(
            COMPARATORS,
            this.cond.comparator ?? '<',
            v => {
                this.cond.comparator = v
                this.commit()
            }
        )
        cmp.position.set(x + 44, 66)
        this.addChild(cmp)

        const second = new Operand(
            { signal: this.cond.second_signal, constant: this.cond.constant },
            v => {
                this.cond.second_signal = v.signal
                this.cond.constant = v.signal ? undefined : v.constant
                this.commit()
            }
        )
        second.position.set(x + 100, 66)
        this.addChild(second)

        this.addLabel(x, 120, 'Output')
        const output = new SignalSlot(this.out.signal, signal => {
            this.out.signal = signal
            this.commit()
        })
        output.position.set(x, 138)
        this.addChild(output)

        const copyCount = new Checkbox(
            this.out.copy_count_from_input ?? true,
            'Copy count from input'
        )
        copyCount.position.set(x + 50, 144)
        copyCount.on('changed', () => {
            this.out.copy_count_from_input = copyCount.checked
            this.commit()
        })
        this.addChild(copyCount)

        const hint = new Text({
            text: 'unchecked → output value 1',
            style: styles.dialog.label,
        })
        hint.position.set(x, 178)
        this.addChild(hint)
    }

    private commit(): void {
        this.m_Entity.deciderConditions = {
            conditions: [{ ...this.cond }],
            outputs: [{ ...this.out }],
        }
    }
}
