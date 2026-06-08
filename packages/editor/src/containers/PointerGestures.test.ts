import { describe, it, expect } from 'vitest'
import { PinchPanRecognizer, distance, midpoint } from './PointerGestures'

describe('geometry helpers', () => {
    it('distance is euclidean', () => {
        expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    })

    it('midpoint averages both axes', () => {
        expect(midpoint({ x: 0, y: 0 }, { x: 4, y: 10 })).toEqual({ x: 2, y: 5 })
    })
})

describe('PinchPanRecognizer', () => {
    it('ignores a single pointer (leaves it to the mouse pipeline)', () => {
        const r = new PinchPanRecognizer()
        r.down(1, 0, 0)
        expect(r.pointerCount).toBe(1)
        expect(r.isActive).toBe(false)
        expect(r.move(1, 50, 50)).toBeNull()
    })

    it('activates on the second pointer', () => {
        const r = new PinchPanRecognizer()
        r.down(1, 0, 0)
        r.down(2, 10, 0)
        expect(r.pointerCount).toBe(2)
        expect(r.isActive).toBe(true)
    })

    it('reports a scale > 1 when fingers spread apart', () => {
        const r = new PinchPanRecognizer()
        r.down(1, 0, 0)
        r.down(2, 100, 0) // baseline distance 100
        const u = r.move(2, 200, 0) // distance now 200
        expect(u).not.toBeNull()
        expect(u!.scale).toBeCloseTo(2)
    })

    it('reports a scale < 1 when fingers pinch together', () => {
        const r = new PinchPanRecognizer()
        r.down(1, 0, 0)
        r.down(2, 100, 0)
        const u = r.move(2, 50, 0) // distance now 50
        expect(u!.scale).toBeCloseTo(0.5)
    })

    it('reports the screen-space translation of the gesture center', () => {
        const r = new PinchPanRecognizer()
        r.down(1, 0, 0)
        r.down(2, 100, 0) // center (50, 0), spread 100
        // Move both fingers right by 20. Pointer events fire one finger at a
        // time, so the spread wobbles 100 -> 80 -> 100 across the two events and
        // each event's scale is measured incrementally against the previous one.
        r.move(1, 20, 0) // spread 80, center (60, 0)
        const u = r.move(2, 120, 0) // spread back to 100, center (70, 0)
        // The second event reports the incremental rebound (100/80); the two
        // per-event scales (0.8 then 1.25) multiply back to 1, so a pure pan
        // nets to no zoom. This case pins down the center/pan tracking.
        expect(u!.scale).toBeCloseTo(1.25)
        expect(u!.panX).toBeCloseTo(10) // center 60 -> 70
        expect(u!.panY).toBeCloseTo(0)
        expect(u!.centerX).toBeCloseTo(70)
    })

    it('does not jump when the first move only re-reads the baseline spread', () => {
        const r = new PinchPanRecognizer()
        r.down(1, 0, 0)
        r.down(2, 100, 0)
        const u = r.move(2, 100, 0) // no change
        expect(u!.scale).toBeCloseTo(1)
        expect(u!.panX).toBeCloseTo(0)
    })

    it('rebaselines when a finger lifts so the remaining gesture has no jump', () => {
        const r = new PinchPanRecognizer()
        r.down(1, 0, 0)
        r.down(2, 100, 0)
        r.down(3, 200, 0)
        r.up(2) // pointers 1 and 3 remain, spread 200
        expect(r.isActive).toBe(true)
        const u = r.move(3, 250, 0) // distance 250 vs rebaselined 200
        expect(u!.scale).toBeCloseTo(1.25)
    })

    it('deactivates and stops reporting once fewer than two pointers remain', () => {
        const r = new PinchPanRecognizer()
        r.down(1, 0, 0)
        r.down(2, 100, 0)
        r.up(2)
        expect(r.isActive).toBe(false)
        expect(r.move(1, 10, 10)).toBeNull()
    })

    it('clear() resets all state', () => {
        const r = new PinchPanRecognizer()
        r.down(1, 0, 0)
        r.down(2, 100, 0)
        r.clear()
        expect(r.pointerCount).toBe(0)
        expect(r.isActive).toBe(false)
    })
})
