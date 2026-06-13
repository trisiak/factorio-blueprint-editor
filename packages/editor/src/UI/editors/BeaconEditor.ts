import { Entity } from '../../core/Entity'
import { Editor } from './Editor'
import { editorSize } from './editorLayout'

/** Beacon Editor */
export class BeaconEditor extends Editor {
    public constructor(entity: Entity) {
        // Modules start at y=45; size the dialog to fit the (possibly wrapped)
        // grid — SE's wide beacons have up to 20 slots.
        const { width, height, columns } = editorSize(entity.moduleSlots, 45)
        super(width, height, entity)

        // Add Modules
        this.addLabel(140, 56, 'Modules:')
        this.addModules(208, 45, columns)
    }
}
