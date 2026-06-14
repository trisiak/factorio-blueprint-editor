import { Entity } from '../../core/Entity'
import { Editor } from './Editor'
import { editorSize } from './editorLayout'

/** Mining Drill Editor (electric-mining-drill + modded drills with modules) */
export class MiningEditor extends Editor {
    public constructor(entity: Entity) {
        // Master's responsive module-grid sizing (width/columns), then reserve
        // space below it for the enable/disable circuit condition.
        const { width, height: moduleHeight, columns } = editorSize(entity.moduleSlots, 45)
        const ccLabelY = Math.max(170, moduleHeight + 2)
        const ccY = ccLabelY + 20
        super(width, ccY + 110, entity)

        // Add Modules
        this.addLabel(140, 56, 'Modules:')
        this.addModules(208, 45, columns)

        this.addLabel(12, ccLabelY, 'Circuit network')
        this.addCircuitCondition(12, ccY)
    }
}
