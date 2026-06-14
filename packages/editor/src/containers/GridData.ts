import EventEmitter from 'eventemitter3'
import { EditorMode, BlueprintContainer } from './BlueprintContainer'
import { inputMode } from '../common/input'

export interface GridDataEvents {
    destroy: []
    update: [x: number, y: number]
    update16: [x: number, y: number]
    update32: [x: number, y: number, dx: number, dy: number]
}

export class GridData extends EventEmitter<GridDataEvents> {
    private readonly bpc: BlueprintContainer

    private _x = 0
    private _y = 0
    private _x16 = 0
    private _y16 = 0
    private _x32 = 0
    private _y32 = 0

    private lastMousePosX = 0
    private lastMousePosY = 0

    public constructor(bpc: BlueprintContainer) {
        super()
        this.bpc = bpc

        const onMouseMove = (e: MouseEvent): void => {
            // On touch the grid cursor is placed explicitly by taps (`moveTo`),
            // not by pointer movement. If we tracked moves here too, dragging to
            // pan (or the synthetic mouse events a tap emits) would drag the paint
            // ghost along with the finger instead of leaving it pinned to its tile.
            if (inputMode.mode === 'mobile') return
            this.update(e.clientX, e.clientY)
        }
        window.addEventListener('pointermove', onMouseMove)
        this.on('destroy', () => window.removeEventListener('pointermove', onMouseMove))
    }

    /** mouse x */
    public get x(): number {
        return this._x
    }
    /** mouse y */
    public get y(): number {
        return this._y
    }
    /** mouse x in 16 pixel size grid */
    public get x16(): number {
        return this._x16
    }
    /** mouse y in 16 pixel size grid */
    public get y16(): number {
        return this._y16
    }
    /** mouse x in 32 pixel size grid */
    public get x32(): number {
        return this._x32
    }
    /** mouse y in 32 pixel size grid */
    public get y32(): number {
        return this._y32
    }

    public destroy(): void {
        this.emit('destroy')
    }

    public recalculate(): void {
        this.update(this.lastMousePosX, this.lastMousePosY)
    }

    /**
     * Force the grid position to a screen-space point. Touch taps have no
     * preceding pointermove to establish a position, so the tap handler seeds
     * it here before dispatching the action; the touch ghost-drag feeds it
     * continuously while a paint ghost is being dragged.
     */
    public moveTo(screenX: number, screenY: number): void {
        this.update(screenX, screenY)
    }

    /**
     * Shift the grid position by whole tiles — the fine-tune "nudge" for a held
     * paint ghost (arrow keys on desktop, the d-pad arrows on touch). Shifts the
     * cached world position directly (rather than nudging the screen point and
     * re-deriving through `toWorld`) so a nudge is *exactly* N tiles at any zoom,
     * then re-emits so the ghost (which listens on these events) follows.
     */
    public nudge(dxTiles: number, dyTiles: number): void {
        if (this.bpc.mode === EditorMode.PAN) return

        this._x += dxTiles * 32
        this._y += dyTiles * 32
        this._x16 = Math.floor(this._x / 16)
        this._y16 = Math.floor(this._y / 16)
        this._x32 = Math.floor(this._x / 32)
        this._y32 = Math.floor(this._y / 32)

        this.emit('update', this._x, this._y)
        this.emit('update16', this._x16, this._y16)
        this.emit('update32', this._x32, this._y32, -dxTiles, -dyTiles)
    }

    /**
     * Force the grid position to a world-space point (px), bypassing the
     * screen→world transform, and re-emit. Used to drop a held paint ghost at a
     * known world location (e.g. a marquee Copy/Cut previewing in place) rather
     * than under the finger.
     */
    public moveToWorld(worldX: number, worldY: number): void {
        if (this.bpc.mode === EditorMode.PAN) return

        const oldX32 = this._x32
        const oldY32 = this._y32
        this._x = Math.floor(worldX)
        this._y = Math.floor(worldY)
        this._x16 = Math.floor(this._x / 16)
        this._y16 = Math.floor(this._y / 16)
        this._x32 = Math.floor(this._x / 32)
        this._y32 = Math.floor(this._y / 32)

        this.emit('update', this._x, this._y)
        this.emit('update16', this._x16, this._y16)
        this.emit('update32', this._x32, this._y32, oldX32 - this._x32, oldY32 - this._y32)
    }

    private update(mouseX: number, mouseY: number): void {
        if (!this.bpc) return

        if (this.bpc.mode === EditorMode.PAN) return

        this.lastMousePosX = mouseX
        this.lastMousePosY = mouseY

        const oldX = this._x
        const oldY = this._y
        const [X, Y] = this.bpc.toWorld(mouseX, mouseY)
        this._x = Math.floor(X)
        this._y = Math.floor(Y)

        const oldX16 = this._x16
        const oldY16 = this._y16
        this._x16 = Math.floor(this._x / 16)
        this._y16 = Math.floor(this._y / 16)

        const oldX32 = this._x32
        const oldY32 = this._y32
        this._x32 = Math.floor(this._x / 32)
        this._y32 = Math.floor(this._y / 32)

        // emit update when mouse changes tile whithin the 1 pixel size grid
        if (!(oldX === this._x && oldY === this._y)) {
            this.emit('update', this._x, this._y)
        }
        // emit update16 when mouse changes tile whithin the 16 pixel size grid
        if (!(oldX16 === this._x16 && oldY16 === this._y16)) {
            this.emit('update16', this._x16, this._y16)
        }
        // emit update32 when mouse changes tile whithin the 32 pixel size grid
        if (!(oldX32 === this._x32 && oldY32 === this._y32)) {
            this.emit('update32', this._x32, this._y32, oldX32 - this._x32, oldY32 - this._y32)
        }
    }
}
