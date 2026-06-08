import { describe, it, expect } from 'vitest'
import { fitToWidthScale, QUICKBAR_EDGE_MARGIN } from './quickbarLayout'

// The quickbar's intrinsic width (see QuickbarPanel).
const PANEL_WIDTH = 442

describe('fitToWidthScale', () => {
    it('does not scale up when the panel already fits', () => {
        expect(fitToWidthScale(1920, PANEL_WIDTH)).toBe(1)
        // exactly wide enough (panel + margins) still clamps to 1
        expect(fitToWidthScale(PANEL_WIDTH + QUICKBAR_EDGE_MARGIN * 2, PANEL_WIDTH)).toBe(1)
    })

    it('scales down to fit narrow viewports (the off-screen regression)', () => {
        const screen = 360 // a typical phone in portrait
        const scale = fitToWidthScale(screen, PANEL_WIDTH)
        expect(scale).toBeLessThan(1)

        // scaled panel + a margin on each side must fit within the screen
        const scaledWidth = PANEL_WIDTH * scale
        expect(scaledWidth).toBeLessThanOrEqual(screen - QUICKBAR_EDGE_MARGIN * 2 + 0.001)

        // and centering keeps the left edge on-screen
        const x = screen / 2 - scaledWidth / 2
        expect(x).toBeGreaterThanOrEqual(0)
    })

    it('respects a custom margin', () => {
        // 440 - 2*20 = 400 -> exactly fits the 400px panel
        expect(fitToWidthScale(440, 400, 20)).toBe(1)
        // 420 - 2*20 = 380 < 400 -> must scale down
        expect(fitToWidthScale(420, 400, 20)).toBeCloseTo(380 / 400)
    })
})
