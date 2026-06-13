import { Container, Graphics } from 'pixi.js'
import { Blueprint } from '../core/Blueprint'
import { IConnection, IConnectionPoint } from '../core/WireConnections'
import U from '../core/generators/util'
import { IPoint, WireColor } from '../types'
import { EntityContainer } from './EntityContainer'

export class WiresContainer extends Container {
    private readonly bp: Blueprint
    private connectionToWire = new Map<string, Graphics>()

    public constructor(bp: Blueprint) {
        super()
        this.bp = bp
    }

    private static createWire(
        p1: IPoint,
        p2: IPoint,
        color: WireColor,
        connectionsReach = true
    ): Graphics {
        const wire = new Graphics()

        const minX = Math.min(p1.x, p2.x)
        const minY = Math.min(p1.y, p2.y)
        const maxX = Math.max(p1.x, p2.x)
        const maxY = Math.max(p1.y, p2.y)
        const dX = maxX - minX
        const dY = maxY - minY

        const colorMap: Record<string, number> = {
            copper: 0xcf7c00,
            red: 0xc83718,
            green: 0x588c38,
        }

        wire.moveTo(0, 0)

        if (p1.x === p2.x) {
            wire.lineTo(dX, dY)
        } else {
            const d = Math.sqrt(dX * dX + dY * dY)
            const a = Math.atan2(dX, -dY)
            const height = Math.sin(a) * Math.min(1, d / 32 / 3) * 30

            const slope = dY / dX
            const uX = -dY / d
            const uY = dX / d

            const oX = dX / 5
            const oY = slope * oX
            const oX2 = (dX / 5) * 4
            const oY2 = slope * oX2

            const X = oX + height * uX
            const Y = oY + height * uY
            const X2 = oX2 + height * uX
            const Y2 = oY2 + height * uY

            wire.bezierCurveTo(X, Y, X2, Y2, dX, dY)
        }

        wire.stroke({
            width: 1.5,
            color: colorMap[color],
            alpha: connectionsReach ? 1 : 0.3,
        })

        // Each wire is its own vector Graphics, drawn straight into the scene
        // rather than baked into a per-wire RenderTexture first. The texture route
        // was a recurring source of GPU fragility (issue #37): a short circuit
        // (red/green) wire between adjacent entities is a thin ~1.5px stroke, and
        // on high-DPR / WebGPU that tiny texture lost the stroke — first to its mip
        // chain (the wire vanished under minification while long copper power wires,
        // with big textures, survived), and a wire-dense blueprint could drop *all*
        // its wires at once (dozens of small antialiased — i.e. multisampled —
        // render targets is a lot of texture memory for a mobile GPU). Vector
        // Graphics sidesteps the whole class: no textures, no mips, no resolution
        // to clamp — it rasterizes crisply at any zoom.
        //
        // The curve is drawn in a local frame from (0,0)→(dX,dY); positioning the
        // Graphics at the segment midpoint with a matching pivot — and mirroring on
        // X for the "other diagonal" — places it in world space and preserves the
        // original bow direction, exactly as the baked sprite did.
        wire.position.set(minX + dX / 2, minY + dY / 2)
        wire.pivot.set(dX / 2, dY / 2)

        if (!((p1.x < p2.x && p1.y < p2.y) || (p2.x < p1.x && p2.y < p1.y))) {
            wire.scale.x = -1
        }

        return wire
    }

    public connect(hash: string, connection: IConnection): void {
        this.add(hash, connection)
        this.updateConnectedEntities(connection)
    }

    public disconnect(hash: string, connection: IConnection): void {
        this.remove(hash)
        this.updateConnectedEntities(connection)
    }

    public add(hash: string, connection: IConnection): void {
        const wire = this.getWire(connection)
        this.addChild(wire)
        this.connectionToWire.set(hash, wire)
    }

    public remove(hash: string): void {
        const wire = this.connectionToWire.get(hash)
        if (wire) {
            wire.destroy()
            this.connectionToWire.delete(hash)
        }
    }

    public update(entityNumber: number): void {
        const connections = this.bp.wireConnections.getEntityConnections(entityNumber)

        for (const conn of connections) {
            const entNr =
                entityNumber === conn.cps[0].entityNumber
                    ? conn.cps[1].entityNumber
                    : conn.cps[0].entityNumber
            const ec = EntityContainer.mappings.get(entNr)
            if (ec.entity.type === 'electric-pole') {
                ec.redraw()
                this.redrawEntityConnections(entNr)
            }
        }

        this.redrawEntityConnections(entityNumber)
    }

    private updateConnectedEntities(connection: IConnection): void {
        for (const cp of connection.cps) {
            const ec = EntityContainer.mappings.get(cp.entityNumber)
            ec.redraw()
            this.update(cp.entityNumber)
        }
    }

    /** This is done in cases where the connection doesn't change but the rotation does */
    private redrawEntityConnections(entityNumber: number): void {
        const hashes = this.bp.wireConnections.getEntityConnectionHashes(entityNumber)
        for (const hash of hashes) {
            const connection = this.bp.wireConnections.get(hash)
            this.remove(hash)
            this.add(hash, connection)
        }
    }

    private getWire(connection: IConnection): Graphics {
        const getWirePos = (cp: IConnectionPoint, color: string): IPoint => {
            if (cp.entityNumber) {
                const entity = this.bp.entities.get(cp.entityNumber)
                const point = entity.getWireConnectionPoint(color, cp.entitySide)
                if (!point) {
                    throw new Error('Could not find the wire connection point!')
                }
                return {
                    x: (entity.position.x + point[0]) * 32,
                    y: (entity.position.y + point[1]) * 32,
                }
            } else if (cp.position) {
                return {
                    x: cp.position.x * 32,
                    y: cp.position.y * 32,
                }
            }
        }
        const getPos = (cp: IConnectionPoint): IPoint => {
            if (cp.entityNumber) {
                const entity = this.bp.entities.get(cp.entityNumber)
                return entity.position
            } else if (cp.position) {
                return cp.position
            }
        }
        const getMaxWireDistance = (cp: IConnectionPoint): number => {
            if (cp.entityNumber) {
                const entity = this.bp.entities.get(cp.entityNumber)
                return entity.maxWireDistance
            }
        }
        const connectionsReach = U.pointInCircle(
            getPos(connection.cps[0]),
            getPos(connection.cps[1]),
            Math.min(
                Infinity,
                ...connection.cps.map(getMaxWireDistance).filter(d => d !== undefined)
            )
        )

        return WiresContainer.createWire(
            getWirePos(connection.cps[0], connection.color),
            getWirePos(connection.cps[1], connection.color),
            connection.color,
            connectionsReach
        )
    }
}
