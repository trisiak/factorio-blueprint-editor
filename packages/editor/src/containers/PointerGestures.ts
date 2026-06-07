/**
 * Framework-free multi-touch gesture recognizer.
 *
 * The editor's input pipeline is mouse + keyboard and has no notion of a second
 * pointer, so pinch-to-zoom and two-finger pan have no analog. This recognizer
 * tracks active pointers by `pointerId` and, while two (or more) are down,
 * reports the incremental scale change and screen-space translation of the
 * gesture center. It is intentionally decoupled from PixiJS / the DOM so the
 * geometry can be unit tested without a browser or the sprite atlas.
 */

export interface Point {
    x: number
    y: number
}

export interface PinchPanUpdate {
    /** multiplicative scale change since the previous update (`curDist / prevDist`) */
    scale: number
    /** screen-space x translation of the gesture center since the previous update */
    panX: number
    /** screen-space y translation of the gesture center since the previous update */
    panY: number
    /** current gesture center in screen space */
    centerX: number
    centerY: number
}

export function distance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

export function midpoint(a: Point, b: Point): Point {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export class PinchPanRecognizer {
    /** insertion-ordered so the "first two" pointers stay stable across moves */
    private readonly pointers = new Map<number, Point>()
    private lastDistance = 0
    private lastCenter: Point = { x: 0, y: 0 }
    private active = false

    /** number of pointers currently down */
    public get pointerCount(): number {
        return this.pointers.size
    }

    /** true while a two-finger pinch/pan gesture is in progress */
    public get isActive(): boolean {
        return this.active
    }

    public down(id: number, x: number, y: number): void {
        this.pointers.set(id, { x, y })
        this.rebaseline()
    }

    public up(id: number): void {
        this.pointers.delete(id)
        this.rebaseline()
    }

    public clear(): void {
        this.pointers.clear()
        this.active = false
    }

    /**
     * Update a pointer's position.
     *
     * Returns a {@link PinchPanUpdate} when two or more pointers are down,
     * otherwise `null` (single-pointer movement is left to the existing
     * mouse pipeline). Deltas are measured against the previous reported
     * position, and the baseline is reset whenever the pointer set changes,
     * so adding or lifting a finger never produces a jump.
     */
    public move(id: number, x: number, y: number): PinchPanUpdate | null {
        if (!this.pointers.has(id)) return null
        this.pointers.set(id, { x, y })

        if (this.pointers.size < 2) return null

        const [a, b] = this.firstTwo()
        const dist = distance(a, b)
        const center = midpoint(a, b)

        const scale = this.lastDistance === 0 ? 1 : dist / this.lastDistance
        const panX = center.x - this.lastCenter.x
        const panY = center.y - this.lastCenter.y

        this.lastDistance = dist
        this.lastCenter = center

        return { scale, panX, panY, centerX: center.x, centerY: center.y }
    }

    /** Re-establish the pinch baseline from the current first two pointers. */
    private rebaseline(): void {
        this.active = this.pointers.size >= 2
        if (this.active) {
            const [a, b] = this.firstTwo()
            this.lastDistance = distance(a, b)
            this.lastCenter = midpoint(a, b)
        }
    }

    private firstTwo(): [Point, Point] {
        const it = this.pointers.values()
        const a = it.next().value as Point
        const b = it.next().value as Point
        return [a, b]
    }
}
