import { Entity } from '../../core/Entity'
import { Editor } from './Editor'

/**
 * Minimal editor for entities whose only circuit configuration is an
 * enable/disable condition (pumps, transport belts, …) and which otherwise have
 * no editor. Just the shared circuit-condition control next to the preview.
 */
export class CircuitConditionEditor extends Editor {
    public constructor(entity: Entity) {
        super(360, 220, entity)

        this.addLabel(140, 50, 'Circuit network')
        this.addCircuitCondition(140, 72)
    }
}
