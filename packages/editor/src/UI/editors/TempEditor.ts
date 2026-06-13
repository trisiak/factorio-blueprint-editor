import { Entity } from '../../core/Entity'
import { Editor } from './Editor'
import { editorSize } from './editorLayout'

export class TempEditor extends Editor {
    public constructor(entity: Entity) {
        // Furnaces and rocket silos auto-select their recipe from the input, so
        // they get no recipe picker. Guard by type rather than by name so modded
        // machines of those types (e.g. Space Age's recycler furnace) are covered
        // too, while assembling-machine-type buildings keep their recipe slot.
        const hasRecipe =
            entity.acceptedRecipes.length > 0 &&
            !(entity.type === 'furnace' || entity.type === 'rocket-silo')
        const i = hasRecipe ? 38 : 0
        // Modules (if any) sit below the optional recipe row; size to fit a
        // wrapped grid for high-slot modded machines (e.g. SE labs/factories).
        const { width, height, columns } = editorSize(entity.moduleSlots, 45 + i)
        super(width, height, entity)

        if (hasRecipe) {
            this.addLabel(140, 56, 'Recipe:')
            this.addRecipe(208, 45)
        }

        if (entity.moduleSlots !== 0) {
            this.addLabel(140, 56 + i, 'Modules:')
            this.addModules(208, 45 + i, columns)
        }
    }
}
