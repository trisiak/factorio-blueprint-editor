import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js'
import { IPoint } from '../types'
import FD, {
    getFluidBoxes,
    isCraftingMachine,
    hasModuleFunctionality,
    getModuleInventoryIndex,
    hasModuleIconsSuppressed,
} from '../core/factorioData'
import F from '../UI/controls/functions'
import G from '../common/globals'
import util from '../common/util'
import { Entity } from '../core/Entity'
import { EditorMode, BlueprintContainer } from './BlueprintContainer'
import { EntityContainer } from './EntityContainer'
import { CursorBoxSpecification } from 'factorio:prototype'
import { Sprite as SpriteData } from 'factorio:prototype'
import { MiningDrillPrototype, UndergroundBeltPrototype } from 'factorio:prototype'

// Glyph drawn between a combinator's input signals so the overlay reads like the
// base game (e.g. `[iron] + [copper]`). White with a heavy outline so it stays
// legible over the dark combinator sprite at any zoom.
const combinatorOperatorStyle = new TextStyle({
    fill: 0xffffff,
    fontFamily: 'sans-serif',
    fontSize: 28,
    fontWeight: '700' as TextStyle['fontWeight'],
    stroke: { color: 0x000000, width: 4 },
})

export class OverlayContainer extends Container {
    private readonly bpc: BlueprintContainer
    private readonly entityInfos = new Container()
    /** Boxes marking the entities on a hovered entity's circuit network. */
    private readonly networkBoxes = new Container()
    private readonly cursorBoxes = new Container()
    private readonly undergroundLines = new Container()
    private readonly selectionArea = new Graphics()
    /** Crosshair marking a held paint ghost's center — the anchor touch taps/drags position. */
    private readonly paintCenterMarker = new Graphics()
    private copyCursorBox: Container
    private selectionAreaUpdateFn: (endX: number, endY: number) => void

    public constructor(bpc: BlueprintContainer) {
        super()
        this.bpc = bpc

        this.addChild(
            this.entityInfos,
            this.networkBoxes,
            this.cursorBoxes,
            this.undergroundLines,
            this.selectionArea,
            this.paintCenterMarker
        )
    }

    /**
     * Highlight a hovered entity's circuit network: box every connected entity
     * (except the hovered one, which already has the regular cursor box) and dim
     * the wires that aren't part of it. `clearNetworkHighlight` undoes both.
     */
    public showNetworkHighlight(entities: Set<number>, hashes: Set<string>, exclude: number): void {
        this.clearNetworkHighlight()
        for (const entityNumber of entities) {
            if (entityNumber === exclude) continue
            // The cursor box is positioned in overlay/world space — use the
            // entity container's pixel position (like the regular cursor box),
            // not the entity's tile position.
            const ec = EntityContainer.mappings.get(entityNumber)
            if (!ec) continue
            this.createCursorBox(ec.position, ec.entity.size, 'pair', this.networkBoxes)
        }
        this.bpc.wiresContainer.highlightNetwork(hashes)
    }

    public clearNetworkHighlight(): void {
        for (const c of this.networkBoxes.removeChildren()) c.destroy()
        this.bpc.wiresContainer.clearHighlight()
    }

    /** Number of network-highlight boxes currently shown (for e2e). */
    public get networkHighlightCount(): number {
        return this.networkBoxes.children.length
    }

    public static createEntityInfo(entity: Entity, position: IPoint): Container {
        const entityInfo = new Container()

        if (
            entity.recipe &&
            isCraftingMachine(entity.entityData) &&
            (entity.entityData.show_recipe_icon === undefined || entity.entityData.show_recipe_icon)
        ) {
            // icon_draw_specification is optional in the prototype (absent on
            // 52 SE crafting machines; every vanilla/SA one happens to define
            // it, which is why this never surfaced). Default to centered,
            // unscaled — without the guard, setting any recipe on those
            // machines threw here, breaking their info panel and editor (#35).
            const spec = entity.entityData.icon_draw_specification ?? {}
            const shift = spec.shift || [0, 0]
            const scale = spec.scale || 1
            const recipeInfo = new Container()
            createIconWithBackground(recipeInfo, entity.recipe)
            recipeInfo.scale.set(scale)
            recipeInfo.position.set(shift[0] * 32, shift[1] * 32)
            entityInfo.addChild(recipeInfo)
        }

        {
            const fluidIcons = new Container()
            const arrows = new Container()

            const fbs = getFluidBoxes(
                entity.entityData,
                entity.assemblerHasFluidInputs || entity.assemblerHasFluidOutputs
            )
                .filter(
                    conn =>
                        !isCraftingMachine(entity.entityData) ||
                        (entity.assemblerHasFluidInputs && conn.production_type === 'input') ||
                        (entity.assemblerHasFluidOutputs && conn.production_type === 'output')
                )
                .filter(fb => !fb.hide_connection_info)

            for (const [i, fb] of fbs.entries()) {
                let filter = fb.filter
                if (isCraftingMachine(entity.entityData)) {
                    const recipe = FD.recipes[entity.recipe]
                    if (recipe) {
                        const items =
                            fb.production_type === 'input' ? recipe.ingredients : recipe.results
                        const fluids = items
                            .filter(item => item.type === 'fluid')
                            .map(fluid => fluid.name)
                        filter = fluids[i >= fluids.length ? 0 : i]
                    }
                }

                for (const connection of fb.pipe_connections) {
                    if (
                        !(
                            connection.connection_type === undefined ||
                            connection.connection_type === 'normal'
                        )
                    )
                        continue

                    const dir = (entity.direction + connection.direction) % 16
                    const offset = connection.position
                        ? util.rotatePointBasedOnDir(connection.position, entity.direction)
                        : util.Point(connection.positions[entity.direction / 4])
                    const offset2 = util.rotatePointBasedOnDir([0, -0.5], dir)
                    offset2.x += offset.x
                    offset2.y += offset.y

                    const type =
                        connection.flow_direction === undefined ||
                        connection.flow_direction === 'input-output'
                            ? 2
                            : 1
                    const arrow = createArrow(util.sumprod(64, offset2), type)
                    arrow.rotation = dir * 0.125 * Math.PI
                    if (connection.flow_direction === 'input') {
                        arrow.rotation += Math.PI
                    }
                    arrows.addChild(arrow)

                    if (filter) {
                        createIconWithBackground(fluidIcons, filter, {
                            x: offset.x * 64,
                            y: offset.y * 64,
                        })
                    }
                }
            }

            fluidIcons.scale.set(0.5, 0.5)
            if (fluidIcons.children.length !== 0) {
                entityInfo.addChild(fluidIcons)
            }
            arrows.scale.set(0.5, 0.5)
            if (arrows.children.length !== 0) {
                entityInfo.addChild(arrows)
            }
        }

        const modules = entity.modules
        const e = entity.entityData
        if (
            modules.filter(m => m).length !== 0 &&
            hasModuleFunctionality(e) &&
            !hasModuleIconsSuppressed(e)
        ) {
            const module_slots = e.module_slots
            if (module_slots > 0) {
                const moduleInfo = new Container()
                const icons_positioning = e.icons_positioning || []
                const module_icon_positioning = icons_positioning.find(
                    ip => ip.inventory_index === getModuleInventoryIndex(e)
                )

                const shift = module_icon_positioning?.shift || [0, 0.7]
                const scale = module_icon_positioning?.scale || 0.5
                const separation_multiplier = module_icon_positioning?.separation_multiplier || 1.1
                for (let slot = 0; slot < module_slots; slot++) {
                    if (modules[slot]) {
                        createIconWithBackground(moduleInfo, modules[slot], {
                            x: slot * 32 * separation_multiplier,
                            y: 0,
                        })
                    }
                }
                moduleInfo.scale.set(scale)
                moduleInfo.position.set(
                    shift[0] * 32 - module_slots * 8 * separation_multiplier + 8,
                    shift[1] * 32
                )
                entityInfo.addChild(moduleInfo)
            }
        }

        const filters =
            entity.filters === undefined
                ? undefined
                : entity.filters.filter(v => v.name !== undefined)
        if (
            filters !== undefined &&
            (entity.type === 'inserter' ||
                entity.type === 'logistic-container' ||
                entity.type === 'infinity-container' ||
                entity.type === 'infinity-pipe')
        ) {
            const filterInfo = new Container()
            for (let i = 0; i < filters.length; i++) {
                if (i === 4) {
                    break
                }
                if (filters[i].name === undefined) {
                    break
                }

                createIconWithBackground(filterInfo, filters[i].name, {
                    x: (i % 2) * 32 - (filters.length === 1 ? 0 : 16),
                    y: filters.length < 3 ? 0 : (i < 2 ? -1 : 1) * 16,
                })
            }
            let S = 0.5
            if (entity.type === 'inserter' && filters.length !== 1) {
                S = 0.4
            }
            if (entity.type === 'logistic-container' && filters.length === 1) {
                S = 0.6
            }
            filterInfo.scale.set(S, S)
            entityInfo.addChild(filterInfo)
        }

        const constantCombinatorFilters = entity.constantCombinatorFilters
        if (constantCombinatorFilters.length > 0) {
            const filterInfo = new Container()
            for (let i = 0; i < constantCombinatorFilters.length; i++) {
                if (i === 4) {
                    break
                }
                createIconWithBackground(filterInfo, constantCombinatorFilters[i], {
                    x: (i % 2) * 32 - (constantCombinatorFilters.length === 1 ? 0 : 16),
                    y: constantCombinatorFilters.length < 3 ? 0 : (i < 2 ? -1 : 1) * 16,
                })
            }
            filterInfo.scale.set(0.5, 0.5)
            entityInfo.addChild(filterInfo)
        }

        const combinatorConditions = entity.combinatorConditions
        if (combinatorConditions) {
            const filterInfo = new Container()
            const cFS = combinatorConditions.first_signal
            const cSS = combinatorConditions.second_signal
            const cOS = combinatorConditions.output_signal
            if (cFS && cFS.name) {
                createIconWithBackground(filterInfo, cFS.name, { x: cSS ? -16 : 0, y: -16 })
            }
            if (cSS && cSS.name) {
                createIconWithBackground(filterInfo, cSS.name, { x: 16, y: -16 })
            }
            if (cOS && cOS.name) {
                createIconWithBackground(filterInfo, cOS.name, { x: 0, y: 16 })
            }
            // Show the operation glyph (e.g. `+`, `>`) between the input signals,
            // matching the base game. Selector combinators use word operations
            // ('select', 'count', …) which are too wide for the sprite, so skip them.
            if (entity.type === 'arithmetic-combinator' || entity.type === 'decider-combinator') {
                const opText = new Text({
                    text: String(entity.operator ?? ''),
                    style: combinatorOperatorStyle,
                })
                opText.anchor.set(0.5)
                opText.position.set(0, 0)
                filterInfo.addChild(opText)
            }
            filterInfo.scale.set(0.5, 0.5)
            if (filterInfo.children.length !== 0) {
                entityInfo.addChild(filterInfo)
            }
        }

        if (entity.splitterInputPriority || entity.splitterOutputPriority) {
            const filterInfo = new Container()

            const createArrowForDirection = (direction: string, offsetY: number): void => {
                const arrow = createArrow(
                    util.rotatePointBasedOnDir(
                        { x: direction === 'right' ? 32 : -32, y: offsetY },
                        entity.direction
                    )
                )
                arrow.scale.set(0.75, 0.75)
                arrow.rotation = entity.direction * Math.PI * 0.125
                filterInfo.addChild(arrow)
            }

            if (entity.filters && entity.filters.length > 0) {
                createIconWithBackground(
                    filterInfo,
                    entity.filters[0].name,
                    util.rotatePointBasedOnDir(
                        { x: entity.splitterOutputPriority === 'right' ? 32 : -32, y: 0 },
                        entity.direction
                    )
                )
            } else if (entity.splitterOutputPriority) {
                createArrowForDirection(entity.splitterOutputPriority, -16)
            }
            if (entity.splitterInputPriority) {
                createArrowForDirection(entity.splitterInputPriority, 16)
            }
            filterInfo.scale.set(0.5, 0.5)
            entityInfo.addChild(filterInfo)
        }

        if (
            entity.type === 'arithmetic-combinator' ||
            entity.type === 'decider-combinator' ||
            entity.type === 'selector-combinator'
        ) {
            const arrows = new Container()
            arrows.addChild(createArrow({ x: 0, y: -48 }), createArrow({ x: 0, y: 48 }))
            arrows.rotation = entity.direction * Math.PI * 0.125
            arrows.scale.set(0.5, 0.5)
            entityInfo.addChild(arrows)
        }

        if (entity.type === 'mining-drill' && entity.name !== 'pumpjack') {
            const arrows = new Container()
            const drillData = entity.entityData as MiningDrillPrototype
            arrows.addChild(
                createArrow({
                    x: drillData.vector_to_place_result[0] * 64,
                    y: drillData.vector_to_place_result[1] * 64 + 18,
                })
            )
            arrows.rotation = entity.direction * Math.PI * 0.125
            arrows.scale.set(0.5, 0.5)
            entityInfo.addChild(arrows)
        }

        if (entityInfo.children.length !== 0) {
            entityInfo.position.set(position.x, position.y)
            return entityInfo
        }

        function createIconWithBackground(
            container: Container,
            itemName: string,
            position?: IPoint
        ): void {
            const icon = F.CreateIcon(itemName, undefined, true, true)
            const data = FD.utilitySprites.entity_info_dark_background
            const background = new Sprite(
                G.getTexture(data.filename, data.x, data.y, data.width, data.height)
            )
            background.anchor.set(0.5, 0.5)
            if (position) {
                icon.position.set(position.x, position.y)
                background.position.set(position.x, position.y)
            }
            const lastLength = container.children.length
            container.addChild(background, icon)
            if (lastLength !== 0) {
                container.swapChildren(
                    container.getChildAt(lastLength / 2),
                    container.getChildAt(lastLength)
                )
            }
        }

        function createArrow(position: IPoint, type = 0): Sprite {
            const typeToPath = (type = 0): SpriteData => {
                switch (type) {
                    case 0:
                        return FD.utilitySprites.indication_arrow
                    case 1:
                        return FD.utilitySprites.fluid_indication_arrow
                    case 2:
                        return FD.utilitySprites.fluid_indication_arrow_both_ways
                }
            }
            const data = typeToPath(type)
            const arrow = new Sprite(
                G.getTexture(data.filename, data.x, data.y, data.width, data.height)
            )
            arrow.anchor.set(0.5, 0.5)
            arrow.position.set(position.x, position.y)
            return arrow
        }
    }

    public updateCopyCursorBox(forceDisable = false): void {
        if (
            !forceDisable &&
            this.bpc.mode === EditorMode.EDIT &&
            this.copyCursorBox === undefined &&
            this.bpc.hoverContainer !== undefined &&
            this.bpc.entityForCopyData !== undefined &&
            EntityContainer.mappings.has(this.bpc.entityForCopyData.entityNumber) &&
            this.bpc.hoverContainer.entity.canPasteSettings(this.bpc.entityForCopyData)
        ) {
            const srcEnt = EntityContainer.mappings.get(this.bpc.entityForCopyData.entityNumber)
            this.copyCursorBox = this.createCursorBox(
                srcEnt.position,
                this.bpc.entityForCopyData.size,
                'copy'
            )
        } else if (this.copyCursorBox !== undefined) {
            this.copyCursorBox.destroy()
            this.copyCursorBox = undefined
        }
    }

    public toggleEntityInfoVisibility(): void {
        this.entityInfos.visible = !this.entityInfos.visible
    }

    public createEntityInfo(entity: Entity, position: IPoint): Container {
        try {
            const entityInfo = OverlayContainer.createEntityInfo(entity, position)
            if (entityInfo !== undefined) {
                this.entityInfos.addChild(entityInfo)
                return entityInfo
            }
        } catch (e) {
            console.warn(`Failed to create entity info for ${entity.name}:`, e)
        }
    }

    public createCursorBox(
        position: IPoint,
        size: IPoint,
        type: keyof CursorBoxSpecification = 'regular',
        parent: Container = this.cursorBoxes
    ): Container {
        const cursorBox = new Container()
        cursorBox.scale.set(0.5, 0.5)
        cursorBox.position.set(position.x, position.y)
        parent.addChild(cursorBox)

        if (size.x === 1 && size.y === 1) {
            const data = FD.utilitySprites.cursor_box[type][0].sprite
            const texture = G.getTexture(data.filename, data.x, data.y, data.width, data.height)
            const s = new Sprite(texture)
            s.anchor.set(0.5, 0.5)
            cursorBox.addChild(s)
        } else {
            cursorBox.addChild(...createCorners(Math.min(size.x, size.y)))
        }

        return cursorBox

        function createCorners(minSideLength: number): Sprite[] {
            const boxes = FD.utilitySprites.cursor_box[type]
            const data = (
                boxes.find(t => t.max_side_length > minSideLength) || boxes[boxes.length - 1]
            ).sprite
            const texture = G.getTexture(data.filename, data.x, data.y, data.width, data.height)

            const c0 = new Sprite(texture)
            const c1 = new Sprite(texture)
            const c2 = new Sprite(texture)
            const c3 = new Sprite(texture)
            const X = size.x * 32
            const Y = size.y * 32
            c0.position.set(-X, -Y)
            c1.position.set(X, -Y)
            c2.position.set(-X, Y)
            c3.position.set(X, Y)
            c1.rotation = Math.PI * 0.5
            c2.rotation = Math.PI * 1.5
            c3.rotation = Math.PI
            return [c0, c1, c2, c3]
        }
    }

    public createUndergroundLine(
        name: string,
        position: IPoint,
        direction: number,
        searchDirection: number
    ): Container {
        const fd = FD.entities[name]
        if (fd.type === 'underground-belt' || fd.type === 'pipe-to-ground') {
            const otherEntity = this.bpc.bp.entities.get(
                this.bpc.bp.entityPositionGrid.getOpposingEntity(
                    name,
                    fd.type === 'pipe-to-ground' ? searchDirection : direction,
                    position,
                    searchDirection,
                    (fd as UndergroundBeltPrototype).max_distance || 10
                )
            )

            if (otherEntity) {
                // Return if directionTypes are the same
                if (
                    fd.type === 'underground-belt' &&
                    (otherEntity.directionType === 'input'
                        ? otherEntity.direction
                        : otherEntity.direction + (8 % 16)) === searchDirection
                ) {
                    return
                }

                const searchingAlongY = searchDirection % 4 === 0
                const distance = searchingAlongY
                    ? Math.abs(otherEntity.position.y - position.y)
                    : Math.abs(otherEntity.position.x - position.x)

                const sign = searchDirection === 0 || searchDirection === 6 ? -1 : 1

                const lineParts = new Container()
                lineParts.x = position.x * 32
                lineParts.y = position.y * 32
                this.undergroundLines.addChild(lineParts)

                for (let i = 1; i < distance; i++) {
                    const data =
                        fd.type === 'pipe-to-ground'
                            ? FD.utilitySprites.underground_pipe_connection
                            : (fd as UndergroundBeltPrototype).underground_sprite
                    const s = new Sprite(
                        G.getTexture(data.filename, data.x, data.y, data.width, data.height)
                    )
                    s.rotation = direction * Math.PI * 0.125
                    if (data.scale) {
                        s.scale.set(data.scale)
                    }
                    s.anchor.set(0.5)
                    s.x = searchingAlongY ? 0 : sign * i * 32
                    s.y = searchingAlongY ? sign * i * 32 : 0
                    lineParts.addChild(s)
                }

                const otherEntityCursorBox = this.createCursorBox(
                    {
                        x: searchingAlongY ? 0 : sign * distance * 32,
                        y: searchingAlongY ? sign * distance * 32 : 0,
                    },
                    otherEntity.size,
                    'pair'
                )
                lineParts.addChild(otherEntityCursorBox)

                return lineParts
            }
        }
    }

    public showSelectionArea(color: number): void {
        // Reset any offset left by a previous selection's in-place nudges.
        this.selectionArea.position.set(0, 0)
        const startPos = { x: this.bpc.gridData.x, y: this.bpc.gridData.y }

        this.selectionAreaUpdateFn = (endX: number, endY: number) => {
            const X = Math.min(startPos.x, endX)
            const Y = Math.min(startPos.y, endY)
            const W = Math.abs(endX - startPos.x)
            const H = Math.abs(endY - startPos.y)

            this.selectionArea
                .clear()
                .moveTo(X, Y)
                .lineTo(X + W, Y)
                .lineTo(X + W, Y + H)
                .lineTo(X, Y + H)
                .lineTo(X, Y)
                .stroke({ width: 2 / this.bpc.getViewportScale(), color })
        }

        this.bpc.gridData.on('update', this.selectionAreaUpdateFn, this)
    }

    public hideSelectionArea(): void {
        this.selectionArea.clear()
        this.bpc.gridData.off('update', this.selectionAreaUpdateFn, this)
    }

    /**
     * Stop the selection rectangle from tracking further grid updates, but leave
     * it drawn. Used by the touch marquee: when the drag ends the box should
     * freeze in place (a later tap moves the grid cursor and would otherwise
     * redraw it) while the held selection awaits a Copy/Cut/Delete choice.
     */
    public freezeSelectionArea(): void {
        this.bpc.gridData.off('update', this.selectionAreaUpdateFn, this)
    }

    /** Shift the frozen selection box by a tile offset (follows in-place nudges). */
    public shiftSelectionArea(dxTiles: number, dyTiles: number): void {
        this.selectionArea.position.x += dxTiles * 32
        this.selectionArea.position.y += dyTiles * 32
    }

    /**
     * (Re)draw the paint-ghost center crosshair at a world position (px). The
     * holder of the ghost calls this whenever the ghost moves or shows — there's
     * no listener here, so there's no event-ordering race against the ghost's
     * own gridData-driven repositioning. Sized in screen px (divided by the
     * viewport scale) so it stays a fixed-size anchor at any zoom.
     */
    public updatePaintCenterMarker(position: IPoint): void {
        const s = this.bpc.getViewportScale()
        const arm = 12 / s
        const gap = 4 / s
        const { x, y } = position
        this.paintCenterMarker
            .clear()
            // four crosshair arms with a gap in the middle, so the exact center
            // tile stays visible under the marker
            .moveTo(x - arm, y)
            .lineTo(x - gap, y)
            .moveTo(x + gap, y)
            .lineTo(x + arm, y)
            .moveTo(x, y - arm)
            .lineTo(x, y - gap)
            .moveTo(x, y + gap)
            .lineTo(x, y + arm)
            .stroke({ width: 3 / s, color: 0xffffff, alpha: 0.9 })
            .circle(x, y, gap)
            .stroke({ width: 1.5 / s, color: 0xffffff, alpha: 0.9 })
    }

    public hidePaintCenterMarker(): void {
        this.paintCenterMarker.clear()
    }
}
