import { Text } from 'pixi.js'
import { Entity } from '../../core/Entity'
import { ArithmeticOperation, IArithmeticCondition } from '../../types'
import { CycleButton } from '../controls/CycleButton'
import { styles } from '../style'
import { Editor } from './Editor'
import { Operand } from './components/Operand'
import { SignalSlot } from './components/SignalSlot'

const OPERATIONS: ArithmeticOperation[] = [
    '*',
    '/',
    '+',
    '-',
    '%',
    '^',
    '<<',
    '>>',
    'AND',
    'OR',
    'XOR',
]

/** Arithmetic combinator editor: `output = first  <op>  second`. */
export class ArithmeticCombinatorEditor extends Editor {
    private readonly cond: IArithmeticCondition

    public constructor(entity: Entity) {
        super(480, 196, entity)

        // Local working copy; every control writes the whole condition back
        // through the entity setter (history + undo for free).
        this.cond = { ...entity.arithmeticConditions }

        const x = 140
        this.addLabel(x, 48, 'Input')

        const first = new Operand(
            { signal: this.cond.first_signal, constant: this.cond.first_constant },
            v => {
                this.cond.first_signal = v.signal
                this.cond.first_constant = v.signal ? undefined : v.constant
                this.commit()
            }
        )
        first.position.set(x, 66)
        this.addChild(first)

        const op = new CycleButton<ArithmeticOperation>(
            OPERATIONS,
            this.cond.operation ?? '*',
            v => {
                this.cond.operation = v
                this.commit()
            }
        )
        op.position.set(x + 100, 66)
        this.addChild(op)

        const second = new Operand(
            { signal: this.cond.second_signal, constant: this.cond.second_constant },
            v => {
                this.cond.second_signal = v.signal
                this.cond.second_constant = v.signal ? undefined : v.constant
                this.commit()
            }
        )
        second.position.set(x + 156, 66)
        this.addChild(second)

        this.addLabel(x, 120, 'Output')
        const output = new SignalSlot(
            this.cond.output_signal,
            signal => {
                this.cond.output_signal = signal
                this.commit()
            },
            // arithmetic output can be `each` but not everything/anything
            true
        )
        output.position.set(x, 138)
        this.addChild(output)

        const arrow = new Text({ text: '= result', style: styles.dialog.label })
        arrow.position.set(x + 44, 146)
        this.addChild(arrow)
    }

    private commit(): void {
        this.m_Entity.arithmeticConditions = { ...this.cond }
    }
}
