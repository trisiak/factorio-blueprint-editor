import { Entity } from '../../core/Entity'
import { Editor } from './Editor'

/** Electric Mining Drill Editor */
export class MiningEditor extends Editor {
    public constructor(entity: Entity) {
        super(402, 300, entity)

        // Add Modules
        this.addLabel(140, 56, 'Modules:')
        this.addModules(208, 45)

        this.addLabel(12, 170, 'Circuit network')
        this.addCircuitCondition(12, 190)
    }
}
