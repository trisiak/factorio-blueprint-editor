import { Entity } from '../core/Entity'
import { IPoint } from '../types'
import { Blueprint } from '../core/Blueprint'
import { Tile } from '../core/Tile'
import { inputMode } from '../common/input'
import { EntitySprite } from './EntitySprite'
import { PaintContainer } from './PaintContainer'
import { PaintBlueprintEntityContainer } from './PaintBlueprintEntityContainer'
import { BlueprintContainer } from './BlueprintContainer'
import { TileContainer } from './TileContainer'
import { IConnectionPoint } from '../core/WireConnections'

export class PaintBlueprintContainer extends PaintContainer {
    private readonly bp: Blueprint
    private readonly entities = new Map<Entity, PaintBlueprintEntityContainer>()
    /**
     * Tiles carried by the ghost (marquee tile Copy/Cut, pasted blueprints with
     * landfill/concrete), as name + center-relative position. Kept out of the
     * internal entity `Blueprint` on purpose: `this.bp` exists to re-bind wires,
     * which tiles don't participate in — they only need rendering (sprites
     * below) and placing (`createTiles` at ghost position + offset).
     */
    private readonly ghostTiles: { name: string; x: number; y: number }[]
    /**
     * Tile the source entities were centered on (their bounding-box center). The
     * ghost re-centers everything on this, so positioning the ghost at this world
     * tile lands the entities back on their *original* positions — used to make a
     * marquee Copy/Cut preview in place (see BlueprintContainer.copy/cutMarquee).
     */
    private readonly center: IPoint

    public constructor(bpc: BlueprintContainer, entities: Entity[], tiles: Tile[] = []) {
        super(bpc, 'blueprint')

        // Bounding box over entity footprints *and* tile cells (a tile's hash
        // position is its center, so its cell spans ±0.5) — a tiles-only ghost
        // must still get a finite center.
        const minX = Math.min(
            entities.reduce((min, e) => Math.min(min, e.position.x - e.size.x / 2), Infinity),
            tiles.reduce((min, t) => Math.min(min, t.x - 0.5), Infinity)
        )
        const minY = Math.min(
            entities.reduce((min, e) => Math.min(min, e.position.y - e.size.y / 2), Infinity),
            tiles.reduce((min, t) => Math.min(min, t.y - 0.5), Infinity)
        )
        const maxX = Math.max(
            entities.reduce((max, e) => Math.max(max, e.position.x + e.size.x / 2), -Infinity),
            tiles.reduce((max, t) => Math.max(max, t.x + 0.5), -Infinity)
        )
        const maxY = Math.max(
            entities.reduce((max, e) => Math.max(max, e.position.y + e.size.y / 2), -Infinity),
            tiles.reduce((max, t) => Math.max(max, t.y + 0.5), -Infinity)
        )

        const center = {
            x: Math.floor((minX + maxX) / 2),
            y: Math.floor((minY + maxY) / 2),
        }
        this.center = center

        const entNrWhitelist = new Set(entities.map(e => e.entityNumber))
        // A tiles-only ghost has no source entity to read connections from.
        const wires =
            entities.length === 0
                ? []
                : entities[0].Blueprint.wireConnections
                      .serializeBpWires()
                      .filter(wire => entNrWhitelist.has(wire[0]) && entNrWhitelist.has(wire[2]))
        this.bp = new Blueprint({
            entities: entities.map(e => {
                const ent = e.serialize(entNrWhitelist)
                ent.position.x -= center.x
                ent.position.y -= center.y
                return ent
            }),
            wires,
        })

        for (const [, e] of this.bp.entities) {
            const epc = new PaintBlueprintEntityContainer(this, this.bpc, this.bp, e)
            this.addChild(...epc.entitySprites)
            this.entities.set(e, epc)
        }

        this.children.sort(EntitySprite.compareFn)

        // Tile sprites go *under* the (already sorted) entity sprites — same
        // layering as the world, where the tile plane renders below entities.
        // Grouped by name so each group shares one `generateSprites` call; the
        // group's base position feeds the texture-variant hash only, so passing
        // the source center keeps the variants stable across re-spawns.
        this.ghostTiles = tiles.map(t => ({ name: t.name, x: t.x - center.x, y: t.y - center.y }))
        const byName = new Map<string, IPoint[]>()
        for (const t of this.ghostTiles) {
            if (!byName.has(t.name)) byName.set(t.name, [])
            byName.get(t.name).push({ x: t.x, y: t.y })
        }
        for (const [name, positions] of byName) {
            for (const s of TileContainer.generateSprites(name, center, positions)) {
                this.addChildAt(s, 0)
            }
        }

        for (const [e] of this.entities) {
            this.bpc.underlayContainer.activateRelatedAreas(e.name)
        }

        this.attachUpdateOn16()
        this.moveAtCursor()
    }

    public hide(): void {
        this.bpc.underlayContainer.deactivateActiveAreas()
        this.bpc.overlayContainer.hidePaintCenterMarker()
        super.hide()
    }

    public show(): void {
        if (this.entities) {
            for (const [e] of this.entities) {
                this.bpc.underlayContainer.activateRelatedAreas(e.name)
            }
        }
        super.show()
        this.updateCenterMarker()
    }

    public destroy(): void {
        this.bpc.underlayContainer.deactivateActiveAreas()
        this.bpc.overlayContainer.hidePaintCenterMarker()
        for (const [, c] of this.entities) {
            c.destroy()
        }
        super.destroy()
    }

    /** The pasted ghost is grabbable by touch (drag-to-move). */
    public override containsWorldPoint(x: number, y: number): boolean {
        return this.worldBoundsContain(x, y)
    }

    /**
     * Keep the on-canvas center crosshair glued to the ghost's origin (= the
     * blueprint's center). Touch-only: it's the visible anchor for precise
     * taps/drags; under a mouse the ghost just follows the cursor, so a marker
     * would only add noise. Keyed off `touchRecent` (#101 Slice 1) so on a hybrid
     * it appears when you touch the screen and goes away when you take the mouse.
     */
    private updateCenterMarker(): void {
        if (!this.visible || !inputMode.touchRecent) {
            // Pick the mouse back up on a hybrid and the crosshair retires with it.
            this.bpc.overlayContainer.hidePaintCenterMarker()
            return
        }
        this.bpc.overlayContainer.updatePaintCenterMarker(this.position)
    }

    public override getItemName(): string {
        return 'blueprint'
    }

    /** The source bounding-box center tile (see `center`). */
    public getSourceCenter(): IPoint {
        return this.center
    }

    public override rotate(_ccw?: boolean): void {}

    public logDataForComparison(): void {
        const withOutNums = [...this.entities.keys()].map(e => ({
            ...e.rawEntity,
            entity_number: undefined,
        }))
        withOutNums.sort(
            (a, b) =>
                Math.sign(b.position.y - a.position.y) || Math.sign(b.position.x - a.position.x)
        )
        console.log(withOutNums)
    }

    public override canFlipOrRotateByCopying(): boolean {
        // Flip/rotate work by re-spawning the ghost from rotated/flipped entity
        // *copies* — tiles have no copy path yet, so they'd silently vanish from
        // the ghost. Gate the whole mechanism off while tiles are aboard (the
        // Flip buttons hide via `cursorCanFlip`; Rotate falls through to this
        // class's no-op `rotate`).
        return this.ghostTiles.length === 0
    }

    public override rotatedEntities(ccw?: boolean): Entity[] {
        if (!this.visible) return undefined
        const result = []
        for (const [e] of this.entities) {
            result.push(e.getRotatedCopy(ccw))
        }
        return result
    }

    public override flippedEntities(vertical: boolean): Entity[] {
        const result = []
        for (const [e] of this.entities) {
            result.push(e.getFlippedCopy(vertical))
        }
        return result
    }

    public override moveAtCursor(): void {
        if (!this.visible) return

        const firstRailPosHere = this.bp.getFirstRailRelatedEntityPos()
        const firstRailPosInBP = this.bpc.bp.getFirstRailRelatedEntityPos()

        if (firstRailPosHere && firstRailPosInBP) {
            const frX = this.bpc.gridData.x32 + firstRailPosHere.x
            const frY = this.bpc.gridData.y32 + firstRailPosHere.y

            // grid offsets
            const oX = -Math.abs((Math.abs(frX) % 2) - (Math.abs(firstRailPosInBP.x - 1) % 2)) + 1
            const oY = -Math.abs((Math.abs(frY) % 2) - (Math.abs(firstRailPosInBP.y - 1) % 2)) + 1

            this.setPosition({
                x: (this.bpc.gridData.x32 + oX) * 32,
                y: (this.bpc.gridData.y32 + oY) * 32,
            })
        } else {
            this.setPosition({
                x: this.bpc.gridData.x32 * 32,
                y: this.bpc.gridData.y32 * 32,
            })
        }

        for (const [, c] of this.entities) {
            c.moveAtCursor()
        }

        this.updateCenterMarker()
    }

    protected override redraw(): void {}

    public override placeEntityContainer(): void {
        if (!this.visible) return

        this.bpc.bp.history.startTransaction('Create Entities')

        const oldEntIDToNewEntID = new Map<number, number>()
        for (const [entity, c] of this.entities) {
            const e = c.placeEntityContainer()
            if (e) {
                oldEntIDToNewEntID.set(entity.entityNumber, e.entityNumber)
            }
        }

        // Create wire connections
        if (oldEntIDToNewEntID.size !== 0) {
            for (const [oldID] of oldEntIDToNewEntID) {
                this.bp.wireConnections
                    .getEntityConnections(oldID)
                    .filter(connection =>
                        connection.cps.every(cp => oldEntIDToNewEntID.has(cp.entityNumber))
                    )
                    .map(connection => ({
                        ...connection,
                        cps: connection.cps.map(cp => ({
                            ...cp,
                            entityNumber: oldEntIDToNewEntID.get(cp.entityNumber),
                        })) as [IConnectionPoint, IConnectionPoint],
                    }))
                    .forEach(conn => this.bpc.bp.wireConnections.create(conn))
            }
        }

        // Lay the carried tiles at ghost position + relative offset, per name
        // (createTiles takes one name at a time). Inside the same transaction so
        // one undo reverts the whole paste.
        for (const [name, positions] of this.ghostTilesByName()) {
            this.bpc.bp.createTiles(name, positions)
        }

        this.bpc.bp.history.commitTransaction()
    }

    /** The ghost's tiles as name → *absolute* world-tile positions (at the current spot). */
    private ghostTilesByName(): Map<string, IPoint[]> {
        const pos = this.getGridPosition()
        const byName = new Map<string, IPoint[]>()
        for (const t of this.ghostTiles) {
            if (!byName.has(t.name)) byName.set(t.name, [])
            byName.get(t.name).push({ x: t.x + pos.x, y: t.y + pos.y })
        }
        return byName
    }

    public override removeContainerUnder(): void {
        if (!this.visible) return

        this.bpc.bp.history.startTransaction('Remove Entities')
        for (const [, c] of this.entities) {
            c.removeContainerUnder()
        }
        // Mirror the tile brush: mining with a tile-carrying ghost also clears
        // the tiles under its footprint.
        for (const [, positions] of this.ghostTilesByName()) {
            this.bpc.bp.removeTiles(positions)
        }
        this.bpc.bp.history.commitTransaction()
    }
}
