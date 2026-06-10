import { Entity } from '../../core/Entity'
import { Editor } from './Editor'

export class TempEditor extends Editor {
    public constructor(entity: Entity) {
        super(402, 171, entity)

        let i = 0
        // Furnaces and rocket silos auto-select their recipe from the input, so
        // they get no recipe picker. Guard by type rather than by name so modded
        // machines of those types (e.g. Space Age's recycler furnace) are covered
        // too, while assembling-machine-type buildings keep their recipe slot.
        if (
            entity.acceptedRecipes.length > 0 &&
            !(entity.type === 'furnace' || entity.type === 'rocket-silo')
        ) {
            this.addLabel(140, 56, 'Recipe:')
            this.addRecipe(208, 45)
            i += 38
        }

        if (entity.moduleSlots !== 0) {
            this.addLabel(140, 56 + i, 'Modules:')
            this.addModules(208, 45 + i)
        }
    }
}
