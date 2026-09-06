import { Container } from 'pixi.js'
import { IPoint } from '../types'
import FD, { isCraftingMachine } from '../core/factorioData'
import G from '../common/globals'
import { Entity } from '../core/Entity'
import { EntitySprite } from './EntitySprite'
import { VisualizationArea } from './VisualizationArea'
import { CursorBoxSpecification } from 'factorio:prototype'

export class EntityContainer {
    public static readonly mappings: Map<number, EntityContainer> = new Map()

    private static _updateGroups: Map<string, Set<string>>
    private static get updateGroups(): Map<string, Set<string>> {
        if (!EntityContainer._updateGroups) {
            EntityContainer._updateGroups = EntityContainer.generateUpdateGroups()
        }
        return EntityContainer._updateGroups
    }

    private visualizationArea: VisualizationArea
    private entityInfo: Container
    private entitySprites: EntitySprite[] = []
    /** This is only a reference */
    private cursorBoxContainer: Container
    /** The active cursor-box kind, so it can be re-drawn when the entity moves/rotates. */
    private cursorBoxType?: keyof CursorBoxSpecification
    /** This is only a reference */
    private undergroundLine: Container

    private readonly m_Entity: Entity

    public constructor(entity: Entity, sort = true) {
        this.m_Entity = entity

        EntityContainer.mappings.set(this.m_Entity.entityNumber, this)

        this.visualizationArea = G.BPC.underlayContainer.create(this.m_Entity.name, this.position)
        this.entityInfo = G.BPC.overlayContainer.createEntityInfo(this.m_Entity, this.position)

        this.redraw(false, sort)
        if (sort) {
            this.redrawSurroundingEntities()
        }

        const onRecipeChange = (): void => {
            this.redrawEntityInfo()
            if (this.m_Entity.name === 'chemical-plant' || this.m_Entity.mayCraftWithFluid) {
                this.redraw()
                this.redrawSurroundingEntities()
            }
        }

        const onDirectionChange = (): void => {
            this.redraw()
            this.redrawSurroundingEntities()

            this.updateUndergroundLine()
            this.redrawEntityInfo()
            this.refreshCursorBox()
            G.BPC.wiresContainer.update(this.m_Entity.entityNumber)
        }

        const onDirectionTypeChange = (): void => {
            this.redraw()
            this.redrawSurroundingEntities()

            this.updateUndergroundLine()
        }

        const onPositionChange = (newPos: IPoint, oldPos: IPoint): void => {
            this.redraw()
            this.redrawSurroundingEntities(oldPos)
            this.redrawSurroundingEntities(newPos)

            this.updateUndergroundLine()
            this.redrawEntityInfo()
            this.refreshCursorBox()
            G.BPC.wiresContainer.update(this.m_Entity.entityNumber)
            this.visualizationArea.moveTo(this.position)
        }

        const onModulesChange = (): void => {
            this.redrawEntityInfo()
            if (this.m_Entity.type === 'beacon') {
                this.redraw()
            }
        }

        // The train-stop sign (and locomotive body) is tinted by the root-level
        // `color` at sprite-build time, so a colour edit needs a full sprite
        // rebuild to show — cheap, and instant feedback while picking a swatch.
        const onColorChange = (): void => {
            this.redraw()
        }

        const onEntityDestroy = (): void => {
            this.redrawSurroundingEntities()

            for (const s of this.entitySprites) {
                s.destroy()
            }

            EntityContainer.mappings.delete(this.m_Entity.entityNumber)

            this.cursorBox = undefined

            this.visualizationArea.destroy()

            if (this.entityInfo !== undefined) {
                this.entityInfo.destroy()
            }
        }

        this.m_Entity.on('recipe', onRecipeChange)
        this.m_Entity.on('direction', onDirectionChange)
        this.m_Entity.on('directionType', onDirectionTypeChange)
        this.m_Entity.on('position', onPositionChange)
        this.m_Entity.on('modules', onModulesChange)

        this.m_Entity.on('filters', this.redrawEntityInfo, this)
        this.m_Entity.on('splitterInputPriority', this.redrawEntityInfo, this)
        this.m_Entity.on('splitterOutputPriority', this.redrawEntityInfo, this)
        this.m_Entity.on('controlBehavior', this.redrawEntityInfo, this)
        this.m_Entity.on('color', onColorChange)
        // The panel's icon is part of the sprite build, so an icon pick shows
        // in-world immediately (text/flags ride along harmlessly).
        this.m_Entity.on('displayPanel', onColorChange)

        this.m_Entity.on('destroy', onEntityDestroy)

        G.BPC.on('destroyed', () => {
            this.m_Entity.off('recipe', onRecipeChange)
            this.m_Entity.off('direction', onDirectionChange)
            this.m_Entity.off('directionType', onDirectionTypeChange)
            this.m_Entity.off('position', onPositionChange)
            this.m_Entity.off('modules', onModulesChange)

            this.m_Entity.off('filters', this.redrawEntityInfo, this)
            this.m_Entity.off('splitterInputPriority', this.redrawEntityInfo, this)
            this.m_Entity.off('splitterOutputPriority', this.redrawEntityInfo, this)
            this.m_Entity.off('controlBehavior', this.redrawEntityInfo, this)
            this.m_Entity.off('color', onColorChange)
            this.m_Entity.off('displayPanel', onColorChange)

            this.m_Entity.off('destroy', onEntityDestroy)
        })
    }

    /**
     * Which entities have to be redrawn when another one is placed, moved or
     * removed next to them — belts re-corner and re-sideload, pipes/heat pipes
     * re-connect, walls re-join.
     *
     * Groups are keyed by prototype **type** (`types`) or by the presence of a
     * prototype **field** (`has`), never by entity name: a name list only ever
     * covers the pack it was written against, so on the Space Exploration pack
     * the nine `se-…` belts/undergrounds/splitters got no update group at all
     * and their neighbours were left showing a stale corner or underground
     * structure. Dispatching by type is also what the game itself does.
     */
    private static generateUpdateGroups(): Map<string, Set<string>> {
        const beltTypes = [
            'transport-belt',
            'splitter',
            'underground-belt',
            'loader',
            'loader-1x1',
            'lane-splitter',
            'linked-belt',
        ]
        const mappigs: { types?: string[]; has?: string[]; updates: string[] }[] = [
            {
                types: beltTypes,
                updates: beltTypes,
            },
            {
                types: ['heat-pipe', 'reactor', 'boiler', 'heat-interface'],
                updates: ['heat-pipe', 'reactor', 'boiler', 'heat-interface'],
            },
            {
                has: ['fluid_box', 'output_fluid_box', 'fluid_boxes'],
                updates: ['fluid_box', 'output_fluid_box', 'fluid_boxes'],
            },
            {
                types: ['wall', 'gate', 'legacy-straight-rail', 'straight-rail'],
                updates: ['wall', 'gate', 'legacy-straight-rail', 'straight-rail'],
            },
        ]

        // Expand each group into the concrete names the current data pack ships.
        // Both sides of a group are matched the same way, so `updates` reads as
        // types or as field names depending on how the group was declared.
        const entities = Object.values(FD.entities)
        const byType = (types: string[]): string[] =>
            entities.filter(e => types.includes(e.type)).map(e => e.name)
        const byField = (fields: string[]): string[] =>
            entities.filter(e => Object.keys(e).some(k => fields.includes(k))).map(e => e.name)

        return mappigs
            .map(uG =>
                uG.types
                    ? { is: byType(uG.types), updates: byType(uG.updates) }
                    : { is: byField(uG.has), updates: byField(uG.updates) }
            )
            .reduce<Map<string, Set<string>>>((map, cV) => {
                for (const k of cV.is) {
                    if (map.has(k)) {
                        for (const v of cV.updates) {
                            map.get(k).add(v)
                        }
                    } else {
                        map.set(k, new Set(cV.updates))
                    }
                }
                return map
            }, new Map())
    }

    public get entity(): Entity {
        return this.m_Entity
    }

    public get position(): IPoint {
        return {
            x: this.m_Entity.position.x * 32,
            y: this.m_Entity.position.y * 32,
        }
    }

    public set cursorBox(type: keyof CursorBoxSpecification) {
        this.cursorBoxType = type
        if (this.cursorBoxContainer) {
            this.cursorBoxContainer.destroy()
        }
        if (type !== undefined) {
            this.cursorBoxContainer = G.BPC.overlayContainer.createCursorBox(
                this.position,
                this.m_Entity.size,
                type
            )
        }
    }

    /**
     * Re-draw the cursor box at the entity's current position/size. The box is an
     * overlay anchored to a fixed spot, so it must be rebuilt when the entity
     * moves or rotates (e.g. a held selection nudged in place) — otherwise the
     * green highlight stays at the original location.
     */
    private refreshCursorBox(): void {
        if (this.cursorBoxType !== undefined) this.cursorBox = this.cursorBoxType
    }

    private createUndergroundLine(): void {
        this.undergroundLine = G.BPC.overlayContainer.createUndergroundLine(
            this.m_Entity.name,
            this.m_Entity.position,
            this.m_Entity.direction,
            this.m_Entity.directionType === 'output' || this.m_Entity.type === 'pipe-to-ground'
                ? (this.m_Entity.direction + 8) % 16
                : this.m_Entity.direction
        )
    }

    private destroyUndergroundLine(): void {
        if (this.undergroundLine) {
            this.undergroundLine.destroy()
            this.undergroundLine = undefined
        }
    }

    private updateUndergroundLine(): void {
        if (G.BPC.hoverContainer === this) {
            this.destroyUndergroundLine()
            this.createUndergroundLine()
        }
    }

    private redrawEntityInfo(): void {
        if (
            this.m_Entity.moduleSlots !== 0 ||
            this.m_Entity.type === 'splitter' ||
            isCraftingMachine(this.m_Entity.entityData) ||
            this.m_Entity.type === 'mining-drill' ||
            this.m_Entity.type === 'boiler' ||
            this.m_Entity.type === 'generator' ||
            this.m_Entity.type === 'pump' ||
            this.m_Entity.type === 'offshore-pump' ||
            this.m_Entity.type === 'arithmetic-combinator' ||
            this.m_Entity.type === 'decider-combinator' ||
            this.m_Entity.type === 'selector-combinator' ||
            this.m_Entity.type === 'constant-combinator' ||
            this.m_Entity.type === 'inserter' ||
            this.m_Entity.type === 'logistic-container'
        ) {
            if (this.entityInfo !== undefined) {
                this.entityInfo.destroy()
            }
            this.entityInfo = G.BPC.overlayContainer.createEntityInfo(this.m_Entity, this.position)
        }

        G.UI.updateEntityInfoPanel(this.m_Entity)
    }

    public pointerOverEventHandler(): void {
        this.cursorBox = 'regular'
        this.createUndergroundLine()

        G.UI.updateEntityInfoPanel(this.m_Entity)
        this.visualizationArea.show()

        // Highlight the entity's circuit network — box the connected entities —
        // so the signal network reads at a glance.
        const net = G.bp.wireConnections.getConnectedNetwork(this.m_Entity.entityNumber)
        if (net.entities.size > 1) {
            G.BPC.overlayContainer.showNetworkHighlight(net.entities, this.m_Entity.entityNumber)
        }
    }

    public pointerOutEventHandler(): void {
        this.cursorBox = undefined
        this.destroyUndergroundLine()

        G.UI.updateEntityInfoPanel(undefined)
        this.visualizationArea.hide()
        G.BPC.overlayContainer.clearNetworkHighlight()
    }

    private redrawSurroundingEntities(position: IPoint = this.m_Entity.position): void {
        const updatesEntities = EntityContainer.updateGroups.get(this.m_Entity.name)
        if (!updatesEntities) return
        const area = {
            x: position.x,
            y: position.y,
            w: this.m_Entity.size.x,
            h: this.m_Entity.size.y,
        }
        if (
            this.m_Entity.type === 'legacy-straight-rail' ||
            this.m_Entity.type === 'straight-rail'
        ) {
            G.bp.entityPositionGrid
                .getEntitiesInArea(area)
                .filter(e => e.type === 'gate')
                .forEach(entity => EntityContainer.mappings.get(entity.entityNumber).redraw())
        } else {
            const entities = G.bp.entityPositionGrid.getSurroundingEntities(area)

            // We need to update a larger area because belt endings might change
            if (
                this.m_Entity.type === 'transport-belt' ||
                this.m_Entity.type === 'splitter' ||
                this.m_Entity.type === 'underground-belt' ||
                this.m_Entity.type === 'loader'
            ) {
                entities.push(
                    ...G.bp.entityPositionGrid.getSurroundingEntities({
                        ...area,
                        w: area.w + 2,
                        h: area.h + 2,
                    })
                )
            }

            entities
                .filter(entity => updatesEntities.has(entity.name))
                .forEach(entity => {
                    EntityContainer.mappings.get(entity.entityNumber).redraw()
                    if (entity.type === 'transport-belt') {
                        G.BPC.wiresContainer.update(entity.entityNumber)
                    }
                })
        }
    }

    public redraw(ignoreConnections?: boolean, sort?: boolean): void {
        for (const s of this.entitySprites) {
            s.destroy()
        }
        this.entitySprites = EntitySprite.getParts(
            this.m_Entity,
            this.position,
            ignoreConnections ? undefined : G.bp.entityPositionGrid
        )
        G.BPC.addEntitySprites(this.entitySprites, sort)
    }
}
