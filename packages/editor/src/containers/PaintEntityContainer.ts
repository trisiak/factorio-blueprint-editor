import { Container } from 'pixi.js'
import { DirectionType, IPoint } from '../types'
import FD, {
    getEntitySize,
    getPossibleRotations,
    isCraftingMachine,
    getFluidBoxes,
} from '../core/factorioData'
import { UndergroundBeltPrototype } from 'factorio:prototype'
import { Entity } from '../core/Entity'
import { EntitySprite } from './EntitySprite'
import { VisualizationArea } from './VisualizationArea'
import { PaintContainer } from './PaintContainer'
import { BlueprintContainer } from './BlueprintContainer'

export class PaintEntityContainer extends PaintContainer {
    private visualizationArea: VisualizationArea
    private directionType: DirectionType
    private direction: number
    /** Chirality flip (Factorio 2.0) for fluid buildings — see Entity.mirror. */
    private mirror = false
    /** This is only a reference */
    private undergroundLine: Container

    public constructor(bpc: BlueprintContainer, name: string, direction: number) {
        super(bpc, name)

        this.direction = direction
        this.directionType = FD.entities[name].type === 'loader' ? 'output' : 'input'

        this.visualizationArea = this.bpc.underlayContainer.create(this.name, this.position)
        this.visualizationArea.highlight()
        this.bpc.underlayContainer.activateRelatedAreas(this.name)

        this.attachUpdateOn16()
        this.moveAtCursor()
        this.redraw()
    }

    /** The held ghost's current facing (0/4/8/12 for cardinal). Exposed for tests. */
    public getDirection(): number {
        return this.direction
    }

    /** Whether the held ghost is mirror-flipped (chirality). Exposed for tests. */
    public isMirrored(): boolean {
        return this.mirror
    }

    private get size(): IPoint {
        return getEntitySize(FD.entities[this.name], this.direction)
    }

    /** The held ghost is grabbable by touch (drag-to-move). */
    public override containsWorldPoint(x: number, y: number): boolean {
        return this.worldBoundsContain(x, y)
    }

    public hide(): void {
        this.bpc.underlayContainer.deactivateActiveAreas()
        this.destroyUndergroundLine()
        super.hide()
    }

    public show(): void {
        this.bpc.underlayContainer.activateRelatedAreas(this.name)
        this.updateUndergroundLine()
        super.show()
    }

    public destroy(): void {
        this.visualizationArea.destroy()
        this.bpc.underlayContainer.deactivateActiveAreas()
        this.destroyUndergroundLine()
        super.destroy()
    }

    public override getItemName(): string {
        return Entity.getItemName(this.name)
    }

    private checkBuildable(): void {
        const position = this.getGridPosition()
        const direction =
            this.directionType === 'input' ? this.direction : (this.direction + 8) % 16

        if (
            this.bpc.bp.entityPositionGrid.checkFastReplaceableGroup(
                this.name,
                direction,
                position
            ) ||
            this.bpc.bp.entityPositionGrid.checkSameEntityAndDifferentDirection(
                this.name,
                direction,
                position
            ) ||
            this.bpc.bp.entityPositionGrid.isAreaAvailable(this.name, position, direction)
        ) {
            this.blocked = false
        } else {
            this.blocked = true
        }
    }

    private updateUndergroundBeltRotation(): void {
        const fd = FD.entities[this.name]
        if (fd.type === 'underground-belt') {
            const otherEntity = this.bpc.bp.entityPositionGrid.getOpposingEntity(
                this.name,
                (this.direction + 8) % 16,
                {
                    x: this.x / 32,
                    y: this.y / 32,
                },
                this.direction,
                (fd as UndergroundBeltPrototype).max_distance
            )
            if (otherEntity) {
                const oe = this.bpc.bp.entities.get(otherEntity)
                this.directionType = oe.directionType === 'input' ? 'output' : 'input'
            } else {
                if (this.directionType === 'output') {
                    this.directionType = 'input'
                }
            }
            this.redraw()
        }
    }

    private updateUndergroundLine(): void {
        this.destroyUndergroundLine()
        this.undergroundLine = this.bpc.overlayContainer.createUndergroundLine(
            this.name,
            this.getGridPosition(),
            this.directionType === 'input' ? this.direction : (this.direction + 8) % 16,
            this.name === 'pipe-to-ground' ? (this.direction + 8) % 16 : this.direction
        )
    }

    private destroyUndergroundLine(): void {
        if (this.undergroundLine) {
            this.undergroundLine.destroy()
        }
    }

    public override rotate(ccw = false): void {
        if (!this.visible) return

        const pr = getPossibleRotations(FD.entities[this.name])
        if (pr.length === 0) return
        this.direction = pr[(pr.indexOf(this.direction) + (ccw ? 3 : 1)) % pr.length]

        this.redraw()
        this.moveAtCursor()
    }

    public override canFlipOrRotateByCopying(): boolean {
        return false
    }

    /** Throwaway Entity used to reuse the core flip math (direction + mirror). */
    private asEntity(): Entity {
        return new Entity(
            {
                entity_number: 1,
                name: this.name,
                position: { x: 0, y: 0 },
                direction: this.direction,
                mirror: this.mirror || undefined,
            },
            this.bpc.bp
        )
    }

    /** A single held entity flips in place if it's directional or chiral. */
    public override canFlip(): boolean {
        const fd = FD.entities[this.name]
        if (!fd) return false
        // Non-flippable types (train stop, rail signals) throw on flip.
        if (['train-stop', 'rail-chain-signal', 'rail-signal'].includes(fd.type)) return false
        // Worth offering only when flip changes something: a direction or chirality.
        return (
            getPossibleRotations(fd).length > 0 ||
            (isCraftingMachine(fd) && getFluidBoxes(fd, true).length > 0)
        )
    }

    /** Flip in place by reusing the Entity flip math (may throw IllegalFlipError). */
    public override flip(vertical: boolean): void {
        if (!this.visible) return
        const flipped = this.asEntity().getFlippedCopy(vertical)
        this.direction = flipped.direction
        this.mirror = flipped.mirror
        this.redraw()
        this.moveAtCursor()
    }

    public override rotatedEntities(_ccw?: boolean): Entity[] {
        return undefined
    }

    public override flippedEntities(_vertical: boolean): Entity[] {
        return undefined
    }

    protected override redraw(): void {
        this.removeChildren()
        const sprites = EntitySprite.getParts({
            name: this.name,
            direction: this.directionType === 'input' ? this.direction : (this.direction + 8) % 16,
            directionType: this.directionType,
            mirror: this.mirror,
        })
        this.addChild(...sprites)
    }

    public override moveAtCursor(): void {
        if (!this.visible) return

        const railRelatedNames = [
            'legacy-straight-rail',
            'straight-rail',
            'half-diagonal-rail',
            'legacy-curved-rail',
            'curved-rail-a',
            'curved-rail-b',
            'train-stop',
        ]
        const firstRailPos = this.bpc.bp.getFirstRailRelatedEntityPos()

        if (railRelatedNames.includes(this.name) && firstRailPos) {
            // grid offsets
            const oX =
                -Math.abs(
                    (Math.abs(this.bpc.gridData.x32) % 2) - (Math.abs(firstRailPos.x - 1) % 2)
                ) + 1
            const oY =
                -Math.abs(
                    (Math.abs(this.bpc.gridData.y32) % 2) - (Math.abs(firstRailPos.y - 1) % 2)
                ) + 1

            this.setPosition({
                x: (this.bpc.gridData.x32 + oX) * 32,
                y: (this.bpc.gridData.y32 + oY) * 32,
            })
        } else {
            this.setNewPosition(this.size)
        }

        this.updateUndergroundBeltRotation()
        this.updateUndergroundLine()

        this.visualizationArea.moveTo(this.position)

        this.checkBuildable()
    }

    public override removeContainerUnder(): void {
        if (!this.visible) return

        const entities = this.bpc.bp.entityPositionGrid.getEntitiesInArea({
            ...this.getGridPosition(),
            w: this.size.x,
            h: this.size.y,
        })
        this.bpc.bp.removeEntities(entities)
        this.checkBuildable()
    }

    public override placeEntityContainer(): void {
        if (!this.visible) return

        const fd = FD.entities[this.name]
        const position = this.getGridPosition()
        const direction =
            this.directionType === 'input' ? this.direction : (this.direction + 8) % 16

        if (this.bpc.bp.fastReplaceEntity(this.name, direction, position)) return

        const snEnt = this.bpc.bp.entityPositionGrid.checkSameEntityAndDifferentDirection(
            this.name,
            direction,
            position
        )
        if (snEnt) {
            snEnt.direction = direction
            return
        }

        if (this.bpc.bp.entityPositionGrid.isAreaAvailable(this.name, position, direction)) {
            this.bpc.bp.createEntity(
                {
                    name: this.name,
                    position,
                    direction,
                    mirror: this.mirror || undefined,
                    type:
                        fd.type === 'underground-belt' || fd.type === 'loader'
                            ? this.directionType
                            : undefined,
                },
                true
            )

            if (fd.type === 'underground-belt' || this.name === 'pipe-to-ground') {
                this.direction = (direction + 8) % 16
                this.redraw()
                this.destroyUndergroundLine()
            }
        }

        this.checkBuildable()
    }
}
