import EventEmitter from 'eventemitter3'
import {
    IEntity,
    IPoint,
    FilterPriority,
    FilterMode,
    DirectionType,
    ComparatorString,
    ArithmeticOperation,
    ISignal,
    ICondition,
    IArithmeticCondition,
    IDeciderCondition,
    LogisticFilter,
    SelectorCombinatorOperation,
} from '../types'
import util from '../common/util'
import { IllegalFlipError } from '../containers/PaintContainer'
import G from '../common/globals'
import FD, {
    ColorWithAlpha,
    getCircuitConnector,
    getWireConnectionPoint,
    getEntitySize,
    getModule,
    getPossibleRotations,
    isCraftingMachine,
    isInserter,
    mapBoundingBox,
    getMaxWireDistance,
    hasModuleFunctionality,
    recipeSupportsModule,
    getModuleInventoryIndex,
} from './factorioData'
import { Blueprint } from './Blueprint'
import { getBeltWireConnectionIndex } from './spriteDataBuilder'
import U from './generators/util'
import {
    EntityWithOwnerPrototype,
    CombinatorPrototype,
    InserterPrototype,
    LogisticContainerPrototype,
    UndergroundBeltPrototype,
} from 'factorio:prototype'

/** The roboport's five robot-stat output-signal fields, by raw name. */
export type RoboportStatSignalKey =
    | 'available_logistic_output_signal'
    | 'total_logistic_output_signal'
    | 'available_construction_output_signal'
    | 'total_construction_output_signal'
    | 'roboport_count_output_signal'

export interface IFilter {
    /** Slot index (1 based ... not 0 like arrays) */
    index: number
    /** Name of entity to be filtered */
    name: string
    /** If stacking is allowed, how many shall be stacked */
    count?: number
}

// TODO: Handle the modules within the class differently so that modules would stay in the same place during editing the blueprint

export interface EntityEvents {
    destroy: []
    position: [newValue: IPoint, oldValue: IPoint]
    direction: []
    directionType: []
    recipe: [recipe: string]
    modules: [modules: (string | undefined)[]]
    splitterInputPriority: [priority: FilterPriority]
    splitterOutputPriority: [priority: FilterPriority]
    splitterFilter: []
    filters: []
    inserterFilters: []
    filterMode: [mode: FilterMode]
    logisticChestFilters: []
    requestFromBufferChest: []
    station: []
    manualTrainsLimit: []
    trainStopPriority: []
    /** The entity's root-level `color` changed (train stop sign / lamp / locomotive). */
    color: []
    /** The lamp's root-level `always_on` changed. */
    alwaysOn: []
    /** The inserter's root-level `use_filters` changed. */
    useFilters: []
    /** A display panel's root-level text/icon/flags changed (icon renders on the sprite). */
    displayPanel: []
    /** The entity's circuit/control_behavior config changed wholesale (e.g. paste settings). */
    controlBehavior: []
}

/** Entity Base Class */
export class Entity extends EventEmitter<EntityEvents> {
    /** Field to hold raw entity */
    private readonly m_rawEntity: IEntity

    /** Field to hold reference to blueprint */
    private readonly m_BP: Blueprint

    /**
     * Construct Entity Base Class
     * @param rawEntity Raw entity object
     * @param blueprint Reference to blueprint
     */
    public constructor(rawEntity: IEntity, blueprint: Blueprint) {
        super()
        this.m_BP = blueprint
        this.m_rawEntity = rawEntity
    }

    public get rawEntity(): IEntity {
        return this.m_rawEntity
    }

    public static getItemName(name: string): string {
        return FD.entities[name].minable.result
    }

    public destroy(): void {
        this.emit('destroy')
        this.removeAllListeners()
    }

    /** Return reference to blueprint */
    public get Blueprint(): Blueprint {
        return this.m_BP
    }

    /** Entity Number */
    public get entityNumber(): number {
        return this.m_rawEntity.entity_number
    }

    /** Entity Name */
    public get name(): string {
        return this.m_rawEntity.name
    }

    /** Entity Type */
    public get type(): EntityWithOwnerPrototype['type'] {
        return FD.entities[this.name].type
    }

    /** Direct access to entity meta data from core */
    public get entityData(): EntityWithOwnerPrototype {
        return FD.entities[this.name]
    }

    /** Entity size */
    public get size(): IPoint {
        return getEntitySize(this.entityData, this.direction)
    }

    /** Entity position */
    public get position(): IPoint {
        return this.m_rawEntity.position
    }

    public set position(position: IPoint) {
        if (util.areObjectsEquivalent(this.m_rawEntity.position, position)) return

        if (!this.m_BP.entityPositionGrid.canMoveTo(this, position)) return

        // Check if the new position breaks any valid entity connections
        const connectionsBreak = this.m_BP.wireConnections
            .getEntityConnections(this.entityNumber)
            .map(c =>
                c.cps[0].entityNumber === this.entityNumber
                    ? c.cps[1].entityNumber
                    : c.cps[0].entityNumber
            )
            .map(otherEntityNumer => this.m_BP.entities.get(otherEntityNumer))
            .some(
                e =>
                    // Make sure that a reaching connection is not broken
                    U.pointInCircle(
                        e.position,
                        this.position,
                        Math.min(e.maxWireDistance, this.maxWireDistance)
                    ) &&
                    !U.pointInCircle(
                        e.position,
                        position,
                        Math.min(e.maxWireDistance, this.maxWireDistance)
                    )
            )
        if (G.BPC.limitWireReach && connectionsBreak) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'position', position, 'Change position')
            .onDone((newValue, oldValue) => {
                this.m_BP.entityPositionGrid.removeTileData(this, oldValue)
                this.m_BP.entityPositionGrid.setTileData(this, newValue)
                this.emit('position', newValue, oldValue)
            })
            .commit()
    }

    public get maxWireDistance(): number {
        return getMaxWireDistance(this.entityData)
    }

    public connectionsReach(position?: IPoint): boolean {
        return this.m_BP.wireConnections
            .getEntityConnections(this.entityNumber)
            .map(c =>
                c.cps[0].entityNumber === this.entityNumber
                    ? c.cps[1].entityNumber
                    : c.cps[0].entityNumber
            )
            .map(otherEntityNumer => this.m_BP.entities.get(otherEntityNumer))
            .every(e =>
                U.pointInCircle(
                    e.position,
                    position ?? this.position,
                    Math.min(e.maxWireDistance, this.maxWireDistance)
                )
            )
    }

    public moveBy(offset: IPoint): void {
        this.position = util.sumprod(this.position, offset)
    }

    /**
     * Move without the single-entity collision / wire-reach guards, updating
     * history + the position grid + emitting like the normal setter. Used by
     * group moves (`Blueprint.moveEntitiesBy`): the whole group shifts by one
     * offset, so the caller validates the group as a unit up-front and the
     * relative layout (and intra-group wires) is preserved — the per-entity
     * guards would otherwise block on the group's own tiles or on stretched
     * external wires.
     */
    public forceMoveBy(offset: IPoint): void {
        const position = util.sumprod(this.position, offset)
        if (util.areObjectsEquivalent(this.m_rawEntity.position, position)) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'position', position, 'Move entities')
            .onDone((newValue, oldValue) => {
                this.m_BP.entityPositionGrid.removeTileData(this, oldValue)
                this.m_BP.entityPositionGrid.setTileData(this, newValue)
                this.emit('position', newValue, oldValue)
            })
            .commit()
    }

    /** Entity direction */
    public get direction(): number {
        if (this.type === 'electric-pole') {
            return this.m_BP.wireConnections.getPowerPoleDirection(this.entityNumber)
        }
        return this.m_rawEntity.direction === undefined ? 0 : this.m_rawEntity.direction
    }
    public set direction(direction: number) {
        if (this.m_rawEntity.direction === direction) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'direction', direction, 'Change direction')
            .onDone(() => this.emit('direction'))
            .commit()
    }

    /** Rail layer (elevated) for rail signals on raised rails */
    public get railLayer(): string | undefined {
        return this.m_rawEntity.rail_layer
    }

    /** Direction Type (input|output) for underground belts */
    public get directionType(): DirectionType {
        return this.m_rawEntity.type
    }
    public set directionType(type: DirectionType) {
        if (this.m_rawEntity.type === type) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'type', type, 'Change direction type')
            .onDone(() => this.emit('directionType'))
            .commit()
    }

    /** Entity recipe */
    public get recipe(): string {
        return this.m_rawEntity.recipe
    }
    public set recipe(recipe: string) {
        if (this.m_rawEntity.recipe === recipe) return

        this.m_BP.history.startTransaction()

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'recipe', recipe, 'Change recipe')
            .onDone(r => this.emit('recipe', r))
            .commit()

        // Some modules on the entity may not be compatible with the new selected recipe, filter those out
        if (recipe !== undefined) {
            this.modules = this.modules.map(m => {
                if (!m) return
                const module = getModule(m)
                if (!recipeSupportsModule(recipe, module)) return
                return m
            })
        }

        this.m_BP.history.commitTransaction()
    }

    /** Recipes this entity can accept */
    public get acceptedRecipes(): string[] {
        const e = this.entityData
        if (!isCraftingMachine(e)) return []

        return (
            Object.keys(FD.recipes)
                .map(k => FD.recipes[k])
                // `hidden` recipes never appear in a crafting menu in-game (the
                // `recipe-unknown` placeholder, removed-item recipes like `pistol`,
                // and all auto-generated `*-recycling` recipes). Offering them would
                // just be noise. `hide_from_player_crafting` is deliberately *not*
                // filtered — those are craftable in machines, just not by hand.
                .filter(recipe => !recipe.hidden)
                .filter(recipe => e.crafting_categories.includes(recipe.category || 'crafting'))
                .map(recipe => recipe.name)
        )
    }

    /**
     * Whether this machine's recipe is user-pickable, i.e. its editor gets a
     * recipe slot. Furnaces and rocket silos auto-select their recipe from the
     * input, so they get none — by type rather than by name, so modded
     * machines of those types (e.g. Space Age's recycler furnace) are covered
     * too. The one rule shared by editor routing, the Pixi TempEditor and the
     * DOM entity editor (#98).
     */
    public get hasRecipeSlot(): boolean {
        return (
            this.acceptedRecipes.length > 0 &&
            this.type !== 'furnace' &&
            this.type !== 'rocket-silo'
        )
    }

    /** Count of module slots */
    public get moduleSlots(): number {
        const e = this.entityData
        if (hasModuleFunctionality(e)) return e.module_slots || 0
        return 0
    }

    /** Modules this entity can accept */
    public get acceptedModules(): string[] {
        const e = this.entityData
        if (!hasModuleFunctionality(e)) return []

        return (
            FD.getModulesFor(this.name)
                // filter modules based on recipe
                .filter(module => !this.recipe || recipeSupportsModule(this.recipe, module))
                .map(module => module.name)
        )
    }

    /** Filters this entity can accept (only splitters, inserters and logistic chests) */
    public get acceptedFilters(): string[] {
        if (this.filterSlots === 0) return []

        return Object.keys(FD.items)
            .map(k => FD.items[k])
            .map(item => item.name)
    }

    /** List of all modules. Slots that are undefined don't have a populated module. */
    public get modules(): (string | undefined)[] {
        const items = this.m_rawEntity.items
        const out = new Array(this.moduleSlots)
        if (!items) return out
        if (!Array.isArray(items)) {
            throw new Error('Old format for items!')
        }
        const inventory = getModuleInventoryIndex(this.entityData)
        for (const item of items) {
            if (item.items.in_inventory) {
                for (const inv of item.items.in_inventory) {
                    if (inv.inventory === inventory) {
                        out[inv.stack] = item.id.name
                    }
                }
            }
        }
        return out
    }
    /** The given list can be shorter than the one returned by the getter. */
    public set modules(_modules: (string | undefined)[]) {
        const modules = _modules || []
        if (this.modules.entries().every(([i, m]) => m === modules[i])) return

        let items = util.duplicate(this.m_rawEntity.items || [])
        if (!Array.isArray(items)) {
            throw new Error('Old format for items!')
        }
        const inventory = getModuleInventoryIndex(this.entityData)
        items = items.filter(item => {
            if (item.items.in_inventory) {
                item.items.in_inventory = item.items.in_inventory.filter(
                    inv => inv.inventory !== inventory
                )
                if (item.items.in_inventory.length === 0) {
                    delete item.items.in_inventory
                }
            }
            return Object.keys(item.items).length !== 0
        })

        for (const [i, module] of modules.entries()) {
            if (!module) continue

            let found_module_entry = false
            const inv_entry = { inventory, stack: i }
            for (const item of items) {
                if (item.id.name === module) {
                    found_module_entry = true

                    if (item.items.in_inventory) {
                        item.items.in_inventory.push(inv_entry)
                    } else {
                        item.items.in_inventory = [inv_entry]
                    }
                }
            }
            if (!found_module_entry) {
                items.push({
                    id: { name: module },
                    items: { in_inventory: [inv_entry] },
                })
            }
        }

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'items', items, 'Change modules')
            .onDone(() => this.emit('modules', this.modules))
            .commit()
    }

    /** Count of filter slots */
    /**
     * A logistic container's role — `storage` / `requester` / `buffer` /
     * `passive-provider` / `active-provider`; undefined for anything else. Lets
     * the chest editor branch on behaviour instead of the vanilla chest names, so
     * modded logistic containers get the right form.
     */
    public get logisticMode(): string | undefined {
        if (this.type !== 'logistic-container') return undefined
        return (this.entityData as LogisticContainerPrototype).logistic_mode
    }

    public get filterSlots(): number {
        if (this.type === 'splitter') return 1
        const filterCount = (this.entityData as InserterPrototype).filter_count
        if (filterCount !== undefined) return filterCount
        const maxLogisticSlots = (this.entityData as LogisticContainerPrototype).max_logistic_slots
        if (maxLogisticSlots !== undefined) {
            return maxLogisticSlots
        }
        // Requester/buffer containers declare no `max_logistic_slots`, so fall back
        // to a fixed grid big enough for the usual case. Keyed off `logistic_mode`
        // rather than the vanilla names so modded requesters/buffers work too;
        // providers fall through to 0 (they request nothing) and get no filter UI.
        const mode = (this.entityData as LogisticContainerPrototype).logistic_mode
        if (mode === 'buffer' || mode === 'requester') {
            return this.logisticChestFilters.reduce(
                (max, filter) => Math.max(max, filter.index),
                30 // TODO: find a way to fix this properly
            )
        }
        return 0
    }

    /** List of all filter(s) for splitters, inserters and logistic chests */
    public get filters(): IFilter[] {
        // Logistic chests route off *type*, so a modded logistic container gets the
        // same requests UI as the vanilla three (the mod-safety rule in CLAUDE.md).
        // Providers are logistic containers too but request nothing — they report
        // `filterSlots === 0`, so this returns an empty list and no UI is built.
        if (this.type === 'logistic-container') return this.logisticChestFilters
        switch (this.name) {
            case 'splitter':
            case 'fast-splitter':
            case 'express-splitter':
            case 'turbo-splitter': {
                return this.splitterFilter
            }
            case 'burner-inserter':
            case 'inserter':
            case 'long-handed-inserter':
            case 'fast-inserter':
            case 'bulk-inserter':
            case 'stack-inserter': {
                return this.inserterFilters
            }
            case 'infinity-chest':
                return this.infinityChestFilters
            case 'infinity-pipe':
                return this.infinityPipeFilters
            default: {
                return undefined
            }
        }
    }
    /**
     * Whether the `filters` setter can actually write this entity's filter slots.
     *
     * Splitters, inserters and the logistic chests can. The infinity chest/pipe
     * still can't — they have getters but fall through the `filters` setter's
     * switch unhandled. The editor uses this so it doesn't advertise a clear
     * gesture for slots that can't be written.
     */
    public get canEditFilters(): boolean {
        if (this.type === 'logistic-container') return true
        switch (this.name) {
            case 'splitter':
            case 'fast-splitter':
            case 'express-splitter':
            case 'turbo-splitter':
            case 'burner-inserter':
            case 'inserter':
            case 'long-handed-inserter':
            case 'fast-inserter':
            case 'bulk-inserter':
            case 'stack-inserter':
                return true
            default:
                return false
        }
    }

    public set filters(list: IFilter[]) {
        const FILTERS =
            list === undefined || list.length === 0 ? undefined : list.filter(f => !!f.name)
        // Mirrors the getter — logistic chests by type, everything else by name.
        if (this.type === 'logistic-container') {
            this.logisticChestFilters = FILTERS
            return
        }
        switch (this.name) {
            case 'splitter':
            case 'fast-splitter':
            case 'express-splitter':
            case 'turbo-splitter': {
                this.splitterFilter = FILTERS
                return
            }
            case 'burner-inserter':
            case 'inserter':
            case 'long-handed-inserter':
            case 'fast-inserter':
            case 'bulk-inserter':
            case 'stack-inserter': {
                this.inserterFilters = FILTERS
                return
            }
        }
    }

    /** Splitter input priority */
    public get splitterInputPriority(): FilterPriority {
        return this.m_rawEntity.input_priority
    }
    public set splitterInputPriority(priority: FilterPriority) {
        if (this.m_rawEntity.input_priority === priority) return

        this.m_BP.history
            .updateValue(
                this.m_rawEntity,
                'input_priority',
                priority,
                'Change splitter input priority'
            )
            .onDone(() => this.emit('splitterInputPriority', this.splitterInputPriority))
            .commit()
    }

    /** Splitter output priority */
    public get splitterOutputPriority(): FilterPriority {
        return this.m_rawEntity.output_priority
    }
    public set splitterOutputPriority(priority: FilterPriority) {
        if (this.m_rawEntity.output_priority === priority) return

        this.m_BP.history.startTransaction()

        this.m_BP.history
            .updateValue(
                this.m_rawEntity,
                'output_priority',
                priority,
                'Change splitter output priority'
            )
            .onDone(() => this.emit('splitterOutputPriority', this.splitterOutputPriority))
            .commit()

        if (priority === undefined) {
            this.filters = undefined
        }

        this.m_BP.history.commitTransaction()
    }

    /** Splitter filter */
    private get splitterFilter(): IFilter[] {
        if (!this.m_rawEntity.filter) return []
        if (typeof this.m_rawEntity.filter === 'string') {
            throw new Error('pre 2.0 format!')
        }
        if (this.m_rawEntity.filter.name) {
            return [{ index: 1, name: this.m_rawEntity.filter.name }]
        }
        return []
    }
    private set splitterFilter(filters: IFilter[]) {
        // `filters` arrives already stripped of nameless entries by the `filters`
        // setter, so clearing the (single) splitter filter hands us an empty array
        // — indexing it unguarded used to throw. Compare against the raw entity's
        // *name*, not the `{ name }` wrapper object, so an unchanged filter really
        // does short-circuit instead of writing a redundant history entry.
        const filter = filters?.[0]?.name
        const current =
            typeof this.m_rawEntity.filter === 'string' ? undefined : this.m_rawEntity.filter?.name
        if (current === filter) return

        this.m_BP.history.startTransaction()

        // Clear by removing the key outright rather than storing `{ name: undefined }`,
        // which would serialize an empty `filter: {}` into the exported blueprint.
        const f = filter === undefined ? undefined : { name: filter }

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'filter', f, 'Change splitter filter')
            .onDone(() => this.emit('splitterFilter'))
            .onDone(() => this.emit('filters'))
            .commit()

        if (filter !== undefined) {
            if (this.splitterOutputPriority === undefined) {
                this.splitterOutputPriority = 'left'
            }
        }

        this.m_BP.history.commitTransaction()
    }

    public get filterMode(): FilterMode {
        return this.m_rawEntity.filter_mode === 'blacklist' ? 'blacklist' : 'whitelist'
    }

    public set filterMode(filterMode: FilterMode) {
        const mode = filterMode === 'blacklist' ? 'blacklist' : undefined

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'filter_mode', mode, 'Change filter mode')
            .onDone(() => this.emit('filterMode', this.filterMode))
            .commit()
    }

    /** Inserter filter */
    private get inserterFilters(): IFilter[] {
        return this.m_rawEntity.filters
    }
    private set inserterFilters(filters: IFilter[]) {
        if (filters === undefined && this.m_rawEntity.filters === undefined) return
        if (util.areArraysEquivalent(filters, this.m_rawEntity.filters)) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'filters', filters, 'Change inserter filter')
            .onDone(() => this.emit('inserterFilters'))
            .onDone(() => this.emit('filters'))
            .commit()
    }

    /** Logistic chest filters */
    private get logisticChestFilters(): IFilter[] {
        if (!this.m_rawEntity.request_filters) return []
        if (Array.isArray(this.m_rawEntity.request_filters)) {
            throw new Error('pre 2.0 format!')
        }
        const sections = this.m_rawEntity.request_filters.sections
        if (!sections || !sections[0] || !sections[0].filters) return []

        const out = []
        for (const filter of sections[0].filters) {
            if (!filter.name) continue
            out.push(filter)
        }
        return out
    }
    /**
     * Write the chest's requests into the 2.0 `request_filters.sections` shape.
     *
     * Like the getter, this maps the editor's flat slot list onto **section 0**;
     * multi-section requests (groups, per-section multipliers) are read and
     * written back untouched but aren't editable here.
     *
     * Two kinds of data have to survive a write:
     *   - **Siblings on `request_filters`** — `request_from_buffers`,
     *     `trash_not_requested`, and any further sections. Hence duplicate-then-
     *     mutate rather than replacing the object wholesale.
     *   - **Attributes the UI doesn't model** — `quality`, `comparator`,
     *     `max_count`, `minimum_delivery_count`, `import_from`. `Filters` rebuilds
     *     its slots as bare `{index, name, count}`, so those would be dropped on
     *     any edit; merging each entry onto the existing raw filter of the same
     *     index keeps an imported blueprint's fidelity through a count change.
     */
    private set logisticChestFilters(filters: IFilter[]) {
        const next = (filters ?? []).filter(f => !!f.name)
        const current = this.logisticChestFilters
        // Cheap identity check first: same slots, names and counts ⇒ no history entry.
        if (
            current.length === next.length &&
            current.every((f, i) => {
                const n = next[i]
                return f.index === n.index && f.name === n.name && f.count === n.count
            })
        ) {
            return
        }

        // `util.duplicate` is JSON round-tripping, which throws on undefined — and
        // a chest that has never been configured has no `request_filters` at all.
        const obj = this.m_rawEntity.request_filters
            ? util.duplicate(this.m_rawEntity.request_filters)
            : {}
        if (Array.isArray(obj)) {
            throw new Error('pre 2.0 format!')
        }
        if (!obj.sections) obj.sections = []
        if (!obj.sections[0]) obj.sections[0] = { index: 1 }

        const existing = new Map(current.map(f => [f.index, f]))
        obj.sections[0].filters =
            next.length > 0
                ? next.map(f => ({
                      ...existing.get(f.index),
                      index: f.index,
                      name: f.name,
                      // `count` is required by LogisticFilter. The UI leaves it
                      // undefined for a storage chest (one filter, no amount), so
                      // fall back the same way the pre-2.0 import does.
                      count: f.count ?? existing.get(f.index)?.count ?? 1,
                  }))
                : undefined

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'request_filters', obj, 'Change chest filter')
            .onDone(() => this.emit('logisticChestFilters'))
            .onDone(() => this.emit('filters'))
            .commit()
    }

    private get infinityChestFilters(): IFilter[] {
        if (!this.m_rawEntity.infinity_settings) return []
        return this.m_rawEntity.infinity_settings.filters
    }

    private get infinityPipeFilters(): IFilter[] {
        if (!this.m_rawEntity.infinity_settings) return []
        return [{ name: this.m_rawEntity.infinity_settings.name, index: 1 }]
    }

    /** Requester chest - request from buffer chest */
    public get requestFromBufferChest(): boolean {
        if (
            this.m_rawEntity.request_from_buffers ||
            Array.isArray(this.m_rawEntity.request_filters)
        ) {
            throw new Error('pre 2.0 format!')
        }
        // A chest that has never been configured (freshly placed, or imported with
        // no requests) carries no `request_filters` at all — reading through it
        // threw a TypeError, which took the whole editor down with it.
        return this.m_rawEntity.request_filters?.request_from_buffers ?? false
    }
    public set requestFromBufferChest(request: boolean) {
        if (this.requestFromBufferChest === request) return

        // Same undefined guard as the filters setter — `util.duplicate` JSON
        // round-trips, so `|| {}` never got a chance to run on a fresh chest.
        const obj = this.m_rawEntity.request_filters
            ? util.duplicate(this.m_rawEntity.request_filters)
            : {}
        if (Array.isArray(obj)) {
            throw new Error('pre 2.0 format!')
        }
        obj.request_from_buffers = request

        this.m_BP.history
            .updateValue(
                this.m_rawEntity,
                'request_filters',
                obj,
                'Change request from buffer chest'
            )
            .onDone(() => this.emit('requestFromBufferChest'))
            .commit()
    }

    public get inserterStackSize(): null | number {
        if (this.m_rawEntity.override_stack_size) return this.m_rawEntity.override_stack_size
        if (isInserter(this.entityData)) {
            if (this.entityData.bulk) {
                return 12
            } else {
                return 3
            }
        }
        return null
    }

    public get constantCombinatorFilters(): string[] {
        return (this.m_rawEntity.control_behavior?.sections?.sections || [])
            .flatMap(f => f.filters)
            .filter(f => f?.name)
            .map(f => f.name)
    }

    public get combinatorConditions(): {
        first_signal?: ISignal
        second_signal?: ISignal
        output_signal?: ISignal
    } {
        if (this.type === 'decider-combinator') {
            const decider_conditions = this.m_rawEntity.control_behavior?.decider_conditions
            return {
                first_signal: decider_conditions?.conditions?.[0].first_signal,
                second_signal: decider_conditions?.conditions?.[0].second_signal,
                output_signal: decider_conditions?.outputs?.[0].signal,
            }
        }
        if (this.type === 'arithmetic-combinator') {
            const arithmetic_conditions = this.m_rawEntity.control_behavior?.arithmetic_conditions
            return {
                first_signal: arithmetic_conditions?.first_signal,
                second_signal: arithmetic_conditions?.second_signal,
                output_signal: arithmetic_conditions?.output_signal,
            }
        }
        if (
            this.type === 'selector-combinator' &&
            this.m_rawEntity.control_behavior?.index_signal
        ) {
            return {
                first_signal: this.m_rawEntity.control_behavior?.index_signal,
            }
        }
    }

    /**
     * Read-only: the second operand of an arithmetic/decider combinator when it
     * is a constant rather than a signal (the signals are exposed by
     * `combinatorConditions`). Used by the info panel to render e.g. `[each] > 100`.
     *
     * Note the format quirk: arithmetic combinators store the second-operand
     * constant as `second_constant` (with a separate `first_constant` for the
     * first operand), whereas deciders store it as the condition's `constant`.
     */
    public get combinatorConstant(): number | undefined {
        if (this.type === 'arithmetic-combinator') {
            return this.m_rawEntity.control_behavior?.arithmetic_conditions?.second_constant
        }
        if (this.type === 'decider-combinator') {
            return this.m_rawEntity.control_behavior?.decider_conditions?.conditions?.[0]?.constant
        }
        return undefined
    }

    /**
     * Read-only: the first operand of an arithmetic combinator when it is a
     * constant rather than a signal (`first_constant`). Deciders always compare a
     * signal, so this only applies to arithmetic combinators.
     */
    public get combinatorFirstConstant(): number | undefined {
        if (this.type === 'arithmetic-combinator') {
            return this.m_rawEntity.control_behavior?.arithmetic_conditions?.first_constant
        }
        return undefined
    }

    /**
     * Read-only: the enable/disable circuit condition (post-2.0 `circuit_condition`),
     * present on inserters, belts, pumps, mining drills, lamps, power switches, etc.
     * The `second_signal`/`constant` split mirrors the combinator conditions.
     */
    public get circuitCondition(): ICondition | undefined {
        return this.m_rawEntity.control_behavior?.circuit_condition
    }

    /** Read-only: whether the entity is set to enable/disable based on the circuit network. */
    public get circuitEnabled(): boolean {
        return !!this.m_rawEntity.control_behavior?.circuit_enabled
    }

    /**
     * Read-only: constant-combinator contents in the post-2.0 `sections` format,
     * flattened to `{ name, count, quality }` across every section. Unlike
     * `constantCombinatorFilters` (names only) this keeps the counts so the info
     * panel can render each signal with its value.
     */
    public get constantCombinatorSignals(): { name: string; count: number; quality?: string }[] {
        return (this.m_rawEntity.control_behavior?.sections?.sections || [])
            .flatMap(s => s.filters || [])
            .filter(f => f?.name)
            .map(f => ({ name: f.name, count: f.count, quality: f.quality }))
    }

    /**
     * Read-only: human-readable lines describing the boolean/mode `control_behavior`
     * flags that aren't conditions or signal lists — e.g. an inserter reading its
     * hand contents, an assembler reading its recipe, a roboport reading logistics.
     * Returns `[]` when the entity has none set. Type-keyed (mod-safe); only flags
     * that are actually enabled produce a line, so most entities yield nothing.
     */
    public get circuitModeSummary(): string[] {
        const cb = this.m_rawEntity.control_behavior
        if (!cb) return []
        const lines: string[] = []
        // NB: the two read-mode defines are numbered oppositely — belt
        // content_read_mode is pulse=0/hold=1, inserter hand_read_mode is
        // hold=0/pulse=1 (this used to share the belt mapping, reporting
        // inserters inverted).
        const mode = (m: number | undefined): string => (m === 1 ? 'hold' : 'pulse')
        const handMode = (m: number | undefined): string => (m === 1 ? 'pulse' : 'hold')
        switch (this.type) {
            case 'inserter':
                if (cb.circuit_read_hand_contents)
                    lines.push(`Reads hand contents (${handMode(cb.circuit_hand_read_mode)})`)
                if (cb.circuit_set_filters) lines.push('Sets filters from circuit')
                if (cb.circuit_set_stack_size)
                    lines.push(
                        `Sets stack size${
                            cb.stack_control_input_signal?.name
                                ? ` from ${cb.stack_control_input_signal.name}`
                                : ''
                        }`
                    )
                break
            case 'transport-belt':
                if (cb.circuit_read_hand_contents)
                    lines.push(`Reads belt contents (${mode(cb.circuit_contents_read_mode)})`)
                break
            case 'assembling-machine':
                if (cb.set_recipe) lines.push('Sets recipe from circuit')
                if (cb.read_ingredients) lines.push('Reads ingredients')
                if (cb.read_contents) lines.push('Reads contents')
                if (cb.read_recipe_finished)
                    lines.push(
                        `Reads recipe finished${
                            cb.recipe_finished_signal?.name
                                ? ` → ${cb.recipe_finished_signal.name}`
                                : ''
                        }`
                    )
                if (cb.working_signal?.name)
                    lines.push(`Outputs ${cb.working_signal.name} while working`)
                break
            case 'mining-drill':
                if (cb.circuit_read_resources) lines.push('Reads resources')
                break
            case 'roboport':
                // read_logistics is the pre-2.0 flag; read_items_mode replaces it.
                if (cb.read_logistics || cb.read_items_mode === 1)
                    lines.push('Reads logistics contents')
                if (cb.read_items_mode === 2) lines.push('Reads missing requests')
                if (cb.read_robot_stats) lines.push('Reads robot stats')
                break
            case 'accumulator':
                if (cb.read_charge)
                    lines.push(
                        `Reads charge${cb.output_signal?.name ? ` → ${cb.output_signal.name}` : ''}`
                    )
                break
            case 'train-stop':
                // send_to_train defaults ON, so the game only serializes `false` —
                // a plain truthiness check would never fire on a native export.
                if (cb.send_to_train !== false) lines.push('Sends to train')
                if (cb.read_from_train) lines.push('Reads from train')
                if (cb.read_stopped_train)
                    lines.push(
                        `Reads stopped train${
                            cb.train_stopped_signal?.name
                                ? ` → ${cb.train_stopped_signal.name}`
                                : ''
                        }`
                    )
                if (cb.set_trains_limit)
                    lines.push(
                        `Sets trains limit from circuit${
                            cb.trains_limit_signal?.name ? ` ← ${cb.trains_limit_signal.name}` : ''
                        }`
                    )
                if (cb.read_trains_count)
                    lines.push(
                        `Reads trains count${
                            cb.trains_count_signal?.name ? ` → ${cb.trains_count_signal.name}` : ''
                        }`
                    )
                if (cb.set_priority)
                    lines.push(
                        `Sets priority from circuit${
                            cb.priority_signal?.name ? ` ← ${cb.priority_signal.name}` : ''
                        }`
                    )
                break
            case 'rail-signal':
            case 'rail-chain-signal':
                if (cb.circuit_read_signal) lines.push('Reads signal state')
                if (cb.circuit_close_signal) lines.push('Closes signal from circuit')
                break
            case 'lamp':
                if (cb.use_colors) lines.push('Uses circuit colours')
                break
        }
        return lines
    }

    // ── Circuit / control_behavior mutators (used by the combinator editors) ──
    // Every edit clones the whole control_behavior, mutates the clone and writes
    // it back through history (so undo/redo and the blueprint-string round-trip
    // come for free) and emits `controlBehavior` so the overlay/info panel and
    // any open editor refresh. control_behavior is created on demand.

    private mutateControlBehavior(
        mutate: (cb: NonNullable<IEntity['control_behavior']>) => void,
        label: string
    ): void {
        const cb = (
            this.m_rawEntity.control_behavior
                ? util.duplicate(this.m_rawEntity.control_behavior)
                : {}
        ) as NonNullable<IEntity['control_behavior']>
        mutate(cb)
        this.m_BP.history
            .updateValue(this.m_rawEntity, 'control_behavior', cb, label)
            .onDone(() => this.emit('controlBehavior'))
            .commit()
    }

    /** Arithmetic combinator condition (post-2.0 single condition object). */
    public get arithmeticConditions(): IArithmeticCondition {
        return this.m_rawEntity.control_behavior?.arithmetic_conditions ?? {}
    }
    public set arithmeticConditions(c: IArithmeticCondition) {
        this.mutateControlBehavior(cb => {
            cb.arithmetic_conditions = c
        }, 'Edit arithmetic combinator')
    }

    /** Decider combinator conditions (post-2.0 conditions[]/outputs[] object). */
    public get deciderConditions(): IDeciderCondition {
        return this.m_rawEntity.control_behavior?.decider_conditions ?? {}
    }
    public set deciderConditions(c: IDeciderCondition) {
        this.mutateControlBehavior(cb => {
            cb.decider_conditions = c
        }, 'Edit decider combinator')
    }

    /** Selector combinator operation + its parameters (post-2.0). */
    public set selectorOperation(op: SelectorCombinatorOperation) {
        this.mutateControlBehavior(cb => {
            cb.operation = op
        }, 'Edit selector combinator')
    }
    public set selectorSelectMax(selectMax: boolean) {
        this.mutateControlBehavior(cb => {
            cb.select_max = selectMax
        }, 'Edit selector combinator')
    }

    /** Constant combinator first-section filters (post-2.0 `sections`). */
    public get constantCombinatorSection(): LogisticFilter[] {
        return this.m_rawEntity.control_behavior?.sections?.sections?.[0]?.filters ?? []
    }
    public set constantCombinatorSection(filters: LogisticFilter[]) {
        this.mutateControlBehavior(cb => {
            if (!cb.sections) cb.sections = { sections: [] }
            if (!cb.sections.sections) cb.sections.sections = []
            if (!cb.sections.sections[0]) cb.sections.sections[0] = { index: 1 }
            cb.sections.sections[0].filters = filters.length > 0 ? filters : undefined
        }, 'Edit constant combinator')
    }

    /** Whether the entity is enabled/disabled by its circuit condition. */
    public set circuitEnabled(enabled: boolean) {
        this.mutateControlBehavior(
            cb => {
                cb.circuit_enabled = enabled || undefined
            },
            enabled ? 'Enable circuit condition' : 'Disable circuit condition'
        )
    }

    /** The enable/disable circuit condition itself. */
    public set circuitCondition(cond: ICondition) {
        this.mutateControlBehavior(cb => {
            cb.circuit_condition = cond
        }, 'Edit enable condition')
    }

    /**
     * The red/green circuit network ids this entity's connection points belong
     * to (combinator input = side 1, output = side 2). Empty when not wired into
     * a circuit network. Used to surface the network id in the info panel/editor.
     */
    public get circuitNetworks(): { color: 'red' | 'green'; side: number; id: number }[] {
        return this.m_BP.wireConnections.getEntityCircuitNetworks(this.entityNumber)
    }

    public get generateConnector(): boolean {
        return this.hasConnections || this.connectToLogisticNetwork
    }

    private get connectToLogisticNetwork(): boolean {
        return !!this.m_rawEntity.control_behavior?.connect_to_logistic_network
    }

    private get hasConnections(): boolean {
        return this.m_BP.wireConnections.getEntityConnections(this.entityNumber).length > 0
    }

    /**
     * The entity's root-level `color` (train-stop sign, lamp, locomotive) —
     * undefined = the prototype default (the renderer falls back to `e.color`
     * when tinting, and the game omits the field entirely when untouched).
     * Named for its first consumer; the lamp editor writes through it too.
     */
    public get trainStopColor(): ColorWithAlpha | undefined {
        return this.m_rawEntity.color
    }

    public set trainStopColor(color: ColorWithAlpha | undefined) {
        const current = this.m_rawEntity.color
        const same =
            (!current && !color) ||
            (current &&
                color &&
                current.r === color.r &&
                current.g === color.g &&
                current.b === color.b &&
                current.a === color.a)
        if (same) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'color', color, 'Change station color')
            .onDone(() => this.emit('color'))
            .commit()
    }

    /** Entity Train Stop Station name */
    public get station(): string {
        return this.m_rawEntity.station
    }

    public set station(station: string) {
        if (this.m_rawEntity.station === station) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'station', station, 'Change station name')
            .onDone(() => this.emit('station'))
            .commit()
    }

    /** Entity Train Stop Trains Limit */
    public get manualTrainsLimit(): number | undefined {
        return this.m_rawEntity.manual_trains_limit
    }

    public set manualTrainsLimit(limit: number | undefined) {
        if (this.m_rawEntity.manual_trains_limit === limit) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'manual_trains_limit', limit, 'Change trains limit')
            .onDone(() => this.emit('manualTrainsLimit'))
            .commit()
    }

    // ── Train stop (post-2.0) ────────────────────────────────────────────────
    // Root-level priority plus the circuit flags. Each output/input flag pairs
    // with a signal the game defaults to a letter virtual signal (T/L/C/P);
    // enabling a flag seeds that default so the serialized shape matches a
    // native export. Flags store `undefined` rather than `false` (the game
    // omits defaults) — except `send_to_train`, whose default is ON, so only
    // an explicit `false` is ever written.

    /** Train stop priority (0–255, 50 = the game default, omitted when 50). */
    public get trainStopPriority(): number {
        return this.m_rawEntity.priority ?? 50
    }

    public set trainStopPriority(priority: number) {
        const clamped = Math.max(0, Math.min(255, Math.round(priority)))
        const value = clamped === 50 ? undefined : clamped
        if (this.m_rawEntity.priority === value) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'priority', value, 'Change station priority')
            .onDone(() => this.emit('trainStopPriority'))
            .commit()
    }

    /** Send circuit signals to the stopped train (the game defaults this ON). */
    public get sendToTrain(): boolean {
        return this.m_rawEntity.control_behavior?.send_to_train !== false
    }

    public set sendToTrain(send: boolean) {
        this.mutateControlBehavior(cb => {
            cb.send_to_train = send ? undefined : false
        }, 'Toggle send to train')
    }

    /** Read the stopped train's contents onto the circuit network. */
    public get readFromTrain(): boolean {
        return !!this.m_rawEntity.control_behavior?.read_from_train
    }

    public set readFromTrain(read: boolean) {
        this.mutateControlBehavior(cb => {
            cb.read_from_train = read || undefined
        }, 'Toggle read from train')
    }

    /**
     * Shared shape of the four flag+signal outputs: toggling the flag on seeds
     * the game's default signal if none is chosen yet; an explicit choice is
     * left alone in both directions (disabling keeps it for a later re-enable —
     * a stray signal next to an unset flag is inert and Factorio accepts it).
     */
    private setTrainStopFlag(
        flag: 'read_stopped_train' | 'set_trains_limit' | 'read_trains_count' | 'set_priority',
        signal:
            | 'train_stopped_signal'
            | 'trains_limit_signal'
            | 'trains_count_signal'
            | 'priority_signal',
        defaultSignal: string,
        enabled: boolean,
        label: string
    ): void {
        this.mutateControlBehavior(cb => {
            cb[flag] = enabled || undefined
            if (enabled && !cb[signal]) {
                cb[signal] = { type: 'virtual', name: defaultSignal }
            }
        }, label)
    }

    /** Output the stopped train's id (default signal-T). */
    public get readStoppedTrain(): boolean {
        return !!this.m_rawEntity.control_behavior?.read_stopped_train
    }

    public set readStoppedTrain(read: boolean) {
        this.setTrainStopFlag(
            'read_stopped_train',
            'train_stopped_signal',
            'signal-T',
            read,
            'Toggle read stopped train'
        )
    }

    public get trainStoppedSignal(): ISignal | undefined {
        return this.m_rawEntity.control_behavior?.train_stopped_signal
    }

    public set trainStoppedSignal(signal: ISignal | undefined) {
        this.mutateControlBehavior(cb => {
            cb.train_stopped_signal = signal
        }, 'Change stopped train signal')
    }

    /** Set the trains limit from the circuit network (default signal-L). */
    public get setTrainsLimit(): boolean {
        return !!this.m_rawEntity.control_behavior?.set_trains_limit
    }

    public set setTrainsLimit(set: boolean) {
        this.setTrainStopFlag(
            'set_trains_limit',
            'trains_limit_signal',
            'signal-L',
            set,
            'Toggle set trains limit'
        )
    }

    public get trainsLimitSignal(): ISignal | undefined {
        return this.m_rawEntity.control_behavior?.trains_limit_signal
    }

    public set trainsLimitSignal(signal: ISignal | undefined) {
        this.mutateControlBehavior(cb => {
            cb.trains_limit_signal = signal
        }, 'Change trains limit signal')
    }

    /** Output the number of trains heading to this stop (default signal-C). */
    public get readTrainsCount(): boolean {
        return !!this.m_rawEntity.control_behavior?.read_trains_count
    }

    public set readTrainsCount(read: boolean) {
        this.setTrainStopFlag(
            'read_trains_count',
            'trains_count_signal',
            'signal-C',
            read,
            'Toggle read trains count'
        )
    }

    public get trainsCountSignal(): ISignal | undefined {
        return this.m_rawEntity.control_behavior?.trains_count_signal
    }

    public set trainsCountSignal(signal: ISignal | undefined) {
        this.mutateControlBehavior(cb => {
            cb.trains_count_signal = signal
        }, 'Change trains count signal')
    }

    /** Set the stop's priority from the circuit network (default signal-P, post 2.0). */
    public get setPriority(): boolean {
        return !!this.m_rawEntity.control_behavior?.set_priority
    }

    public set setPriority(set: boolean) {
        this.setTrainStopFlag(
            'set_priority',
            'priority_signal',
            'signal-P',
            set,
            'Toggle set priority'
        )
    }

    public get prioritySignal(): ISignal | undefined {
        return this.m_rawEntity.control_behavior?.priority_signal
    }

    public set prioritySignal(signal: ISignal | undefined) {
        this.mutateControlBehavior(cb => {
            cb.priority_signal = signal
        }, 'Change priority signal')
    }

    // ── Lamp (post-2.0) ─────────────────────────────────────────────────────
    // Root-level `always_on` plus the circuit colour config. Like everywhere
    // else, defaults store `undefined` so the export matches the game's
    // omit-the-default convention (`always_on` false, `use_colors` false,
    // `color_mode` 0 = colour mapping).

    public get lampAlwaysOn(): boolean {
        return !!this.m_rawEntity.always_on
    }

    public set lampAlwaysOn(on: boolean) {
        const value = on || undefined
        if (this.m_rawEntity.always_on === value) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'always_on', value, 'Toggle always on')
            .onDone(() => this.emit('alwaysOn'))
            .commit()
    }

    /** Let the circuit network drive the lamp's colour. */
    public get lampUseColors(): boolean {
        return !!this.m_rawEntity.control_behavior?.use_colors
    }

    public set lampUseColors(use: boolean) {
        this.mutateControlBehavior(cb => {
            cb.use_colors = use || undefined
        }, 'Toggle use colors')
    }

    /** 0 = colour mapping (default, omitted), 1 = RGB components, 2 = packed RGB. */
    public get lampColorMode(): number {
        return this.m_rawEntity.control_behavior?.color_mode ?? 0
    }

    public set lampColorMode(mode: number) {
        this.mutateControlBehavior(cb => {
            cb.color_mode = mode || undefined
        }, 'Change lamp color mode')
    }

    public get lampRedSignal(): ISignal | undefined {
        return this.m_rawEntity.control_behavior?.red_signal
    }

    public set lampRedSignal(signal: ISignal | undefined) {
        this.mutateControlBehavior(cb => {
            cb.red_signal = signal
        }, 'Change red signal')
    }

    public get lampGreenSignal(): ISignal | undefined {
        return this.m_rawEntity.control_behavior?.green_signal
    }

    public set lampGreenSignal(signal: ISignal | undefined) {
        this.mutateControlBehavior(cb => {
            cb.green_signal = signal
        }, 'Change green signal')
    }

    public get lampBlueSignal(): ISignal | undefined {
        return this.m_rawEntity.control_behavior?.blue_signal
    }

    public set lampBlueSignal(signal: ISignal | undefined) {
        this.mutateControlBehavior(cb => {
            cb.blue_signal = signal
        }, 'Change blue signal')
    }

    public get lampRgbSignal(): ISignal | undefined {
        return this.m_rawEntity.control_behavior?.rgb_signal
    }

    public set lampRgbSignal(signal: ISignal | undefined) {
        this.mutateControlBehavior(cb => {
            cb.rgb_signal = signal
        }, 'Change RGB signal')
    }

    /**
     * Post-2.0, every inserter carries filter slots (`filter_count` on the
     * prototype) but only actually filters while root-level `use_filters` is
     * on — filters exported without it are inert in the game. The editor's
     * "Use filters" checkbox writes this; false stores as absent.
     */
    public get inserterUseFilters(): boolean {
        return !!this.m_rawEntity.use_filters
    }

    public set inserterUseFilters(use: boolean) {
        const value = use || undefined
        if (this.m_rawEntity.use_filters === value) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'use_filters', value, 'Toggle use filters')
            .onDone(() => this.emit('useFilters'))
            .commit()
    }

    // ── Inserter circuit read mode ──────────────────────────────────────────
    // NB: the inserter's `hand_read_mode` define is hold=0 / pulse=1 — the
    // *opposite* of the belt's `content_read_mode` (pulse=0 / hold=1). The
    // game's UI defaults to pulse, so an export with reading enabled usually
    // carries an explicit `circuit_hand_read_mode: 1`.

    public get inserterReadHandContents(): boolean {
        return !!this.m_rawEntity.control_behavior?.circuit_read_hand_contents
    }

    public set inserterReadHandContents(read: boolean) {
        this.mutateControlBehavior(cb => {
            cb.circuit_read_hand_contents = read || undefined
            // Enabling seeds the game's UI default (pulse = 1); hold (0) is the
            // define default and stays omitted.
            if (read && cb.circuit_hand_read_mode === undefined) {
                cb.circuit_hand_read_mode = 1
            }
        }, 'Toggle read hand contents')
    }

    /** 0 = hold (define default, omitted), 1 = pulse. */
    public get inserterHandReadMode(): number {
        return this.m_rawEntity.control_behavior?.circuit_hand_read_mode ?? 0
    }

    public set inserterHandReadMode(mode: number) {
        this.mutateControlBehavior(cb => {
            cb.circuit_hand_read_mode = mode || undefined
        }, 'Change hand read mode')
    }

    // ── Roboport (post-2.0) ─────────────────────────────────────────────────

    /** 0 = none (default, omitted), 1 = logistics, 2 = missing requests. */
    public get roboportReadItemsMode(): number {
        return this.m_rawEntity.control_behavior?.read_items_mode ?? 0
    }

    public set roboportReadItemsMode(mode: number) {
        this.mutateControlBehavior(cb => {
            cb.read_items_mode = mode || undefined
        }, 'Change roboport read mode')
    }

    public get roboportReadRobotStats(): boolean {
        return !!this.m_rawEntity.control_behavior?.read_robot_stats
    }

    public set roboportReadRobotStats(read: boolean) {
        this.mutateControlBehavior(cb => {
            cb.read_robot_stats = read || undefined
        }, 'Toggle read robot stats')
    }

    /**
     * The five robot-stat output signals, addressed by their raw field name.
     * No defaults are seeded on enable — unlike the train stop's letter
     * signals, the game keeps these implicit until the user picks one, and an
     * absent field means "the built-in default" at import time.
     */
    public getRoboportStatSignal(key: RoboportStatSignalKey): ISignal | undefined {
        return this.m_rawEntity.control_behavior?.[key]
    }

    public setRoboportStatSignal(key: RoboportStatSignalKey, signal: ISignal | undefined): void {
        this.mutateControlBehavior(cb => {
            cb[key] = signal
        }, 'Change roboport signal')
    }

    // ── Display panel (post-2.0) ────────────────────────────────────────────
    // Root-level text/icon/flags. The per-condition message list
    // (`control_behavior.parameters[]`) is deferred — the static message is
    // the common case.

    public get displayPanelText(): string {
        return this.m_rawEntity.text ?? ''
    }

    public set displayPanelText(text: string) {
        const value = text || undefined
        if (this.m_rawEntity.text === value) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'text', value, 'Change panel text')
            .onDone(() => this.emit('displayPanel'))
            .commit()
    }

    public set displayPanelIcon(icon: ISignal | undefined) {
        this.m_BP.history
            .updateValue(this.m_rawEntity, 'icon', icon, 'Change panel icon')
            .onDone(() => this.emit('displayPanel'))
            .commit()
    }

    public get displayPanelAlwaysShow(): boolean {
        return !!this.m_rawEntity.always_show
    }

    public set displayPanelAlwaysShow(show: boolean) {
        const value = show || undefined
        if (this.m_rawEntity.always_show === value) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'always_show', value, 'Toggle always show')
            .onDone(() => this.emit('displayPanel'))
            .commit()
    }

    public get displayPanelShowInChart(): boolean {
        return !!this.m_rawEntity.show_in_chart
    }

    public set displayPanelShowInChart(show: boolean) {
        const value = show || undefined
        if (this.m_rawEntity.show_in_chart === value) return

        this.m_BP.history
            .updateValue(this.m_rawEntity, 'show_in_chart', value, 'Toggle show in chart')
            .onDone(() => this.emit('displayPanel'))
            .commit()
    }

    // ── Logistic container circuit mode ─────────────────────────────────────

    /** 0 = send contents (default, omitted), 1 = set requests, 2 = none. */
    public get chestCircuitMode(): number {
        return this.m_rawEntity.control_behavior?.circuit_mode_of_operation ?? 0
    }

    public set chestCircuitMode(mode: number) {
        this.mutateControlBehavior(cb => {
            cb.circuit_mode_of_operation = mode || undefined
        }, 'Change chest circuit mode')
    }

    public get selectorCombinatorSelectMax(): boolean {
        if (this.type !== 'selector-combinator') return false
        if (this.m_rawEntity.control_behavior?.operation === 'select') {
            const select_max = this.m_rawEntity.control_behavior?.select_max
            return select_max === undefined ? true : select_max
        }
        return false
    }

    public get operator():
        | undefined
        | ComparatorString
        | ArithmeticOperation
        | SelectorCombinatorOperation {
        if (this.type === 'decider-combinator') {
            return (
                this.m_rawEntity.control_behavior?.decider_conditions?.conditions?.[0].comparator ||
                '<'
            )
        }
        if (this.type === 'arithmetic-combinator') {
            return this.m_rawEntity.control_behavior?.arithmetic_conditions?.operation || '*'
        }
        if (this.type === 'selector-combinator') {
            return this.m_rawEntity.control_behavior?.operation || 'select'
        }
        return undefined
    }

    private get possibleRotations(): number[] {
        return getPossibleRotations(
            this.entityData,
            this.assemblerHasFluidInputs || this.assemblerHasFluidOutputs
        )
    }

    private get canBeRotated(): boolean {
        return (
            this.possibleRotations.length !== 0 &&
            !this.m_BP.entityPositionGrid.sharesCell({
                x: this.position.x,
                y: this.position.y,
                w: this.size.x,
                h: this.size.y,
            })
        )
    }

    public getRotatedCopy(ccw = false): Entity {
        const position = ccw
            ? { x: this.m_rawEntity.position.y, y: -this.m_rawEntity.position.x }
            : { x: -this.m_rawEntity.position.y, y: this.m_rawEntity.position.x }
        const direction = this.constrainDirection((this.direction + (ccw ? 12 : 4)) % 16)
        const updatedRawEntity = { ...this.m_rawEntity, position, direction }
        if (direction === 0) delete updatedRawEntity.direction

        return new Entity(updatedRawEntity, this.m_BP)
    }

    private constrainDirection(direction: number): number {
        const pr = this.possibleRotations
        const canRotate = pr.length !== 0

        if (canRotate) {
            if (!pr.includes(direction)) {
                if (direction === 8 && pr.includes(0)) {
                    return 0
                } else if (direction === 12 && pr.includes(4)) {
                    return 4
                } else {
                    return this.direction
                }
            }
        } else {
            return 0
        }
        return direction
    }

    private changePriority(priority?: FilterPriority): FilterPriority | undefined {
        if (priority === 'left') return 'right'
        else if (priority === 'right') return 'left'
        return priority
    }

    public getFlippedCopy(vertical: boolean): Entity {
        const non_flip_entities: EntityWithOwnerPrototype['type'][] = [
            'train-stop',
            'rail-chain-signal',
            'rail-signal',
        ]

        if (non_flip_entities.includes(this.type))
            throw new IllegalFlipError(`${this.name} cannot be flipped`)

        const axisDir = vertical ? 12 : 8
        const direction = this.constrainDirection((axisDir * 2 - this.direction) % 16)

        let input_priority = this.m_rawEntity.input_priority
        let output_priority = this.m_rawEntity.output_priority

        if (
            (vertical && (direction === 4 || direction === 8)) ||
            (!vertical && (direction === 0 || direction === 12))
        ) {
            input_priority = this.changePriority(input_priority)
            output_priority = this.changePriority(output_priority)
        }

        const position = vertical
            ? { x: this.m_rawEntity.position.x, y: -this.m_rawEntity.position.y }
            : { x: -this.m_rawEntity.position.x, y: this.m_rawEntity.position.y }
        const updatedRawEntity = {
            ...this.m_rawEntity,
            direction,
            position,
            input_priority,
            output_priority,
        }
        if (direction === 0) delete updatedRawEntity.direction

        return new Entity(updatedRawEntity, this.m_BP)
    }

    private rotateDir(ccw: boolean): number {
        if (!this.canBeRotated) return this.direction
        const pr = this.possibleRotations
        return pr[
            (pr.indexOf(this.direction) +
                (this.size.x !== this.size.y || this.type === 'underground-belt' ? 2 : 1) *
                    (ccw ? 3 : 1)) %
                pr.length
        ]
    }

    public rotate(ccw = false, rotateOpposingUB = false): void {
        const newDir = this.rotateDir(ccw)

        if (newDir === this.direction) return

        this.m_BP.history.startTransaction('Rotate entity')

        if (this.type === 'underground-belt' || this.type === 'loader') {
            if (rotateOpposingUB) {
                const otherEntity = this.m_BP.entities.get(
                    this.m_BP.entityPositionGrid.getOpposingEntity(
                        this.name,
                        this.direction,
                        this.position,
                        this.directionType === 'input' ? this.direction : (this.direction + 8) % 16,
                        (this.entityData as UndergroundBeltPrototype).max_distance
                    )
                )
                if (otherEntity) {
                    otherEntity.rotate()
                }
            }

            this.directionType = this.directionType === 'input' ? 'output' : 'input'
        }

        this.direction = newDir

        this.m_BP.history.commitTransaction()
    }

    public canPasteSettings(sourceEntity: Entity): boolean {
        return sourceEntity !== this && sourceEntity.type === this.type
    }

    /** Paste relevant data from source entity */
    public pasteSettings(sourceEntity: Entity): void {
        if (!this.canPasteSettings(sourceEntity)) return

        this.m_BP.history.startTransaction('Paste settings to entity')

        // PASTE RECIPE
        let tRecipe = this.recipe
        const aR = this.acceptedRecipes
        if (aR.length > 0 && sourceEntity.acceptedRecipes) {
            tRecipe =
                sourceEntity.recipe !== undefined && aR.includes(sourceEntity.recipe)
                    ? sourceEntity.recipe
                    : undefined
            this.recipe = tRecipe
        }

        // PASTE DIRECTION (only for type assembling_machine)
        if (
            this.type === 'assembling-machine' &&
            this.name !== 'assembling-machine' &&
            tRecipe &&
            FD.recipes[tRecipe].category === 'crafting-with-fluid'
        ) {
            this.direction = sourceEntity.direction
        }

        // PASTE MODULES
        const aM = this.acceptedModules
        if (aM.length > 0 && sourceEntity.acceptedModules) {
            if (sourceEntity.modules && sourceEntity.modules.length > 0) {
                this.modules = sourceEntity.modules
                    .filter(m => aM.includes(m))
                    .slice(0, this.moduleSlots)
            } else {
                this.modules = []
            }
        }

        // PASTE SPLITTER SETTINGS (Has to be before filters as otherwise business logic will overwrite)
        if (this.type === 'splitter' && sourceEntity.type === 'splitter') {
            this.splitterInputPriority = sourceEntity.splitterInputPriority
            this.splitterOutputPriority = sourceEntity.splitterOutputPriority
        }

        // PASTE FILTERS
        const aF = this.acceptedFilters
        if (aF.length > 0 && sourceEntity.acceptedFilters) {
            if (sourceEntity.filters && sourceEntity.filters.length > 0) {
                this.filters = sourceEntity.filters
                    .filter(f => aF.includes(f.name))
                    .slice(0, this.filterSlots)
            } else {
                this.filters = []
            }
        }

        // PASTE REQUESTER CHEST SETTINGS
        if (this.name === 'requester-chest' && sourceEntity.name === 'requester-chest') {
            this.requestFromBufferChest = sourceEntity.requestFromBufferChest
        }

        // PASTE USE FILTERS (inserters; the flag that makes the filters above
        // actually apply in-game, post 2.0)
        if (this.type === 'inserter' && sourceEntity.type === 'inserter') {
            this.inserterUseFilters = sourceEntity.inserterUseFilters
        }

        // PASTE CIRCUIT / CONTROL_BEHAVIOR (combinator conditions, constant-combinator
        // signals, enable conditions, read/set modes, …). canPasteSettings guarantees
        // source and target share a type, so the whole object is safe to copy; deep-
        // clone it so the two entities don't alias the same control_behavior.
        const srcCB = sourceEntity.m_rawEntity.control_behavior
        if (srcCB || this.m_rawEntity.control_behavior) {
            this.m_BP.history
                .updateValue(
                    this.m_rawEntity,
                    'control_behavior',
                    srcCB ? util.duplicate(srcCB) : undefined,
                    'Paste circuit settings'
                )
                .onDone(() => this.emit('controlBehavior'))
                .commit()
        }

        // PASTE ROOT-LEVEL SETTINGS — the fields the editors write *outside*
        // control_behavior (which the block above can't carry). Routed through
        // the setters so the events fire and e.g. a pasted colour re-tints the
        // sprite immediately. canPasteSettings guarantees a shared type.
        if (this.type === 'lamp' || this.type === 'train-stop') {
            this.trainStopColor = sourceEntity.trainStopColor
        }
        if (this.type === 'lamp') {
            this.lampAlwaysOn = sourceEntity.lampAlwaysOn
        }
        if (this.type === 'train-stop') {
            this.station = sourceEntity.station
            this.manualTrainsLimit = sourceEntity.manualTrainsLimit
            this.trainStopPriority = sourceEntity.trainStopPriority
        }
        if (this.type === 'display-panel') {
            this.displayPanelText = sourceEntity.displayPanelText
            this.displayPanelIcon = sourceEntity.displayPanelIcon
            this.displayPanelAlwaysShow = sourceEntity.displayPanelAlwaysShow
            this.displayPanelShowInChart = sourceEntity.displayPanelShowInChart
        }

        this.m_BP.history.commitTransaction()

        /*
            TODO:

            assembling machines -> filter inserters:
                filters

            assembling machines -> requester chest:
                filters
                request amount formula: Math.min(ingredientAmount, Math.ceil((ingredientAmount * newCraftingSpeed) / recipe.energy_required))

            Locomotive:
                Schedule
                Color

            TrainStop<->Locomotive:
                Color

            ProgrammableSpeaker:
                Parameters
                AlertParameters

            RocketSilo:
                LaunchWhenRocketHasItems

            CargoWagon:
            ContainerEntity:
                Bar
                Filters

            CREATIVE ENTITIES:
                ElectricEnergyInterface:
                    ElectricBufferSize
                    PowerProduction
                    PowerUsage

                HeatInterface:
                    temperature
                    mode

                InfinityContainer:
                    Filters
                    RemoveUnfilteredItems

                InfinityPipe:
                    Filter

                Loader:
                    Filters
        */
    }

    public get displayPanelIcon(): ISignal {
        if (this.type !== 'display-panel') return undefined
        return this.m_rawEntity.icon || this.m_rawEntity.control_behavior?.parameters?.[0]?.icon
    }

    public get mayCraftWithFluid(): boolean {
        const e = this.entityData
        if (!isCraftingMachine(e)) return false
        return e.crafting_categories && e.crafting_categories.includes('crafting-with-fluid')
    }

    public get assemblerHasFluidInputs(): boolean {
        if (!this.recipe) return false
        const recipe = FD.recipes[this.recipe]
        // A recipe with no ingredients serializes the empty Lua table as `{}`
        // (object, not array) — guard the shape, not just nullishness, or
        // `.find` throws and aborts rendering the entity (#35).
        if (!recipe || !Array.isArray(recipe.ingredients)) return false
        return !!recipe.ingredients.find(ingredient => ingredient.type === 'fluid')
    }

    public get assemblerHasFluidOutputs(): boolean {
        if (!this.recipe) return false
        const recipe = FD.recipes[this.recipe]
        if (!recipe || !Array.isArray(recipe.results)) return false
        return !!recipe.results.find(result => result.type === 'fluid')
    }

    public getWireConnectionPoint(
        color: string,
        side: number,
        direction = this.direction
    ): undefined | number[] {
        const e = this.entityData

        const getCombinatorSide = () => (side === 1 ? 'input' : 'output')
        const getPowerSwitchSide = () =>
            color === 'copper' ? (side === 1 ? 'left' : 'right') : 'circuit'
        const wcp = getWireConnectionPoint(e, direction, getCombinatorSide, getPowerSwitchSide)
        if (wcp) {
            return wcp.wire[color]
        }

        const isLoaderInputting = () => this.directionType === 'input'
        const getBeltConnectionIndex = () =>
            getBeltWireConnectionIndex(this.m_BP.entityPositionGrid, this.position, direction)
        const cc = getCircuitConnector(e, direction, isLoaderInputting, getBeltConnectionIndex)
        if (cc) {
            return cc.points.wire[color]
        }
    }

    private getWire_connection_box(
        color: string,
        side: number,
        direction = this.direction
    ): [[number, number], [number, number]] {
        const point = this.getWireConnectionPoint(color, side, direction)
        if (!point) return undefined

        const e = this.entityData
        const e_size = getEntitySize(e)
        const size_box: [[number, number], [number, number]] = [
            [-e_size.x / 2, -e_size.y / 2],
            [+e_size.x / 2, +e_size.y / 2],
        ]

        switch (e.type) {
            case 'arithmetic-combinator':
            case 'decider-combinator':
            case 'selector-combinator': {
                const e_resolved = e as CombinatorPrototype
                if (side === 1) {
                    return mapBoundingBox(e_resolved.input_connection_bounding_box)
                } else {
                    return mapBoundingBox(e_resolved.output_connection_bounding_box)
                }
            }
            case 'power-switch': {
                if (color === 'copper') {
                    if (side === 1) {
                        const box = util.duplicate(size_box)
                        box[1][0] = (box[0][0] + box[1][0]) / 2
                        return box
                    } else {
                        const box = util.duplicate(size_box)
                        box[0][0] = (box[0][0] + box[1][0]) / 2
                        return box
                    }
                }
            }
        }

        return size_box
    }

    public getWireConnectionBoundingBox(
        color: string,
        side: number,
        direction = this.direction
    ): IPoint[] {
        const box = this.getWire_connection_box(color, side, direction)
        if (box === undefined) return undefined
        let bbox: IPoint[] = box.map(util.Point)
        bbox = bbox.map(p => util.rotatePointBasedOnDir(p, direction))
        bbox = [
            { x: Math.min(...bbox.map(p => p.x)), y: Math.min(...bbox.map(p => p.y)) },
            { x: Math.max(...bbox.map(p => p.x)), y: Math.max(...bbox.map(p => p.y)) },
        ]
        return bbox
    }

    public serialize(_entNrWhitelist?: Set<number>): IEntity {
        return util.duplicate({
            ...this.m_rawEntity,
            // ...this.m_BP.wireConnections.serializeConnectionData(this.entityNumber, _entNrWhitelist),
        })
    }
}
