import EventEmitter from 'eventemitter3'
import G from '../../../common/globals'
import { Entity, EntityEvents } from '../../../core/Entity'
import { Slot } from '../../controls/Slot'
import { bindSlotGestures } from '../../controls/gestures'
import F from '../../controls/functions'

/** Module Slots for Entity */
export class Recipe extends Slot<undefined> {
    /** Blueprint Editor Entity reference */
    private readonly m_Entity: Entity

    public constructor(entity: Entity) {
        super()

        this.m_Entity = entity
        this.updateContent(this.m_Entity.recipe)
        bindSlotGestures(
            this,
            () =>
                G.UI.createInventory(
                    'Select Recipe',
                    this.m_Entity.acceptedRecipes,
                    name => {
                        this.m_Entity.recipe = name
                    },
                    'recipes'
                ),
            () => {
                this.m_Entity.recipe = undefined
            }
        )

        this.onEntityChange('recipe', recipe => this.updateContent(recipe))
    }

    private onEntityChange<T extends EventEmitter.EventNames<EntityEvents>>(
        event: T,
        fn: EventEmitter.EventListener<EntityEvents, T>
    ): void {
        this.m_Entity.on(event, fn)
        this.once('destroyed', () => this.m_Entity.off(event, fn))
    }

    /** Update Content Icon */
    private updateContent(recipe: string): void {
        if (recipe === undefined) {
            if (this.content !== undefined) {
                this.content = undefined
            }
        } else {
            this.content = F.CreateIcon(recipe)
        }
        this.emit('changed')
    }
}
