import { Entity } from '../../core/Entity'
import { Editor } from './Editor'
import { editorSize } from './editorLayout'

/** Mining Drill Editor (electric-mining-drill + modded drills with modules) */
export class MiningEditor extends Editor {
    public constructor(entity: Entity) {
        const { width, height, columns } = editorSize(entity.moduleSlots, 45)
        super(width, height, entity)

        // Add Modules
        this.addLabel(140, 56, 'Modules:')
        this.addModules(208, 45, columns)
    }
}
