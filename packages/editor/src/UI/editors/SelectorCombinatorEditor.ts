import { Entity } from '../../core/Entity'
import { SelectorCombinatorOperation } from '../../types'
import { Switch } from '../controls/Switch'
import { Enable } from '../controls/Enable'
import { CycleButton } from '../controls/CycleButton'
import { Editor } from './Editor'

const OPERATIONS: SelectorCombinatorOperation[] = [
    'select',
    'count',
    'random',
    'stack-size',
    'rocket-capacity',
    'quality-filter',
    'quality-transfer',
]

/**
 * Selector combinator editor. Lets you pick the operation; for `select` it also
 * exposes the min/max toggle. The per-operation parameters (index signal,
 * quality, …) are intentionally minimal for now — this keeps the most common
 * knobs editable rather than leaving selectors with no editor at all.
 */
export class SelectorCombinatorEditor extends Editor {
    public constructor(entity: Entity) {
        super(420, 150, entity)

        const x = 140
        this.addLabel(x, 50, 'Operation:')
        const op = new CycleButton<SelectorCombinatorOperation>(
            OPERATIONS,
            (entity.operator as SelectorCombinatorOperation) ?? 'select',
            v => {
                entity.selectorOperation = v
            },
            150
        )
        op.position.set(x, 70)
        this.addChild(op)

        // Min/max toggle (only meaningful for the `select` operation).
        const isMax = entity.selectorCombinatorSelectMax
        const minLabel = new Enable(!isMax, 'Min')
        minLabel.position.set(x, 116)
        this.addChild(minLabel)

        const maxSwitch = new Switch(['min', 'max'], isMax ? 'max' : 'min')
        maxSwitch.position.set(x + 50, 116)
        maxSwitch.on('changed', () => {
            entity.selectorSelectMax = maxSwitch.value === 'max'
            minLabel.active = maxSwitch.value === 'min'
            maxLabel.active = maxSwitch.value === 'max'
        })
        this.addChild(maxSwitch)

        const maxLabel = new Enable(isMax, 'Max')
        maxLabel.position.set(x + 100, 116)
        this.addChild(maxLabel)
    }
}
