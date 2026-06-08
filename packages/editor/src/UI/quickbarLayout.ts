/**
 * Quickbar layout math, kept free of PixiJS so it can be unit-tested without a
 * renderer. The quickbar is a fixed-width panel; on viewports narrower than it
 * (phones in portrait, narrow desktop windows) it would otherwise run off both
 * edges, so it scales down uniformly to fit.
 */

/** Margin (px) to keep between the quickbar and each screen edge when scaled. */
export const QUICKBAR_EDGE_MARGIN = 8

/**
 * Uniform scale that fits `intrinsicWidth` within `screenWidth` (minus a margin
 * on each side), never scaling up past 1.
 */
export function fitToWidthScale(
    screenWidth: number,
    intrinsicWidth: number,
    margin = QUICKBAR_EDGE_MARGIN
): number {
    const available = screenWidth - margin * 2
    return Math.min(1, available / intrinsicWidth)
}
