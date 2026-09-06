// Wheel ownership (#101 Slice 5 review) — who gets to act on a `wheel` event
// when the DOM overlays and the canvas share one page.
//
// The bug this exists for: macOS (and any inertial trackpad/mouse) keeps
// emitting `wheel` events *after* the finger leaves the wheel/trackpad, for as
// long as the momentum lasts. Scroll the rates drawer, flick, then move the
// pointer off it and the tail of that same physical gesture lands on whatever
// is under the cursor next — the canvas — and `BlueprintContainer`'s wheel
// handler dutifully zooms. The user asked to scroll a drawer and got a zoom.
//
// Neither `stopPropagation` nor `overscroll-behavior` fixes that: the canvas
// handler isn't in the drawer's propagation path (Pixi listens on its own
// canvas element), and the later events genuinely *are* over the canvas. What
// distinguishes them is time, not target — they're the tail of a gesture that
// began on an overlay. So the rule is a short ownership window: once a DOM
// overlay sees a wheel event it *owns the wheel* for a moment, and the canvas
// declines anything that arrives inside that window.
//
// Deliberately dumb and framework-free: no event plumbing between the layers,
// no "is this event synthetic/inertial" heuristics (the browser doesn't tell
// us), just a timestamp. A wheel over the canvas with no recent overlay wheel
// zooms exactly as before, and the window is short enough (300 ms) that
// deliberately moving from a drawer to the canvas and scrolling costs at most
// one ignored notch.

/**
 * How long an overlay keeps the wheel after its last wheel event. Long enough
 * to swallow the tail of an inertial flick, short enough that a deliberate
 * "scroll the drawer, now zoom the map" never feels stuck.
 */
export const WHEEL_OWNERSHIP_MS = 300

export class WheelGuard {
    /** Timestamp of the last overlay wheel; -Infinity = never. */
    private last = Number.NEGATIVE_INFINITY

    public constructor(
        private readonly windowMs: number = WHEEL_OWNERSHIP_MS,
        /** Injectable so the timing logic is testable without a real clock. */
        private readonly now: () => number = () => performance.now()
    ) {}

    /** A DOM overlay received a wheel event: it owns the wheel from here. */
    public claim(): void {
        this.last = this.now()
    }

    /** True while an overlay owns the wheel — the canvas must ignore its own. */
    public blocksCanvas(): boolean {
        return this.now() - this.last < this.windowMs
    }

    /** Drop the claim (tests, and any future "the overlay closed" case). */
    public release(): void {
        this.last = Number.NEGATIVE_INFINITY
    }

    /**
     * Attach the claim to an overlay element. Passive — claiming ownership is
     * bookkeeping, never a reason to cancel the overlay's own scrolling — and
     * on the capture phase so a child that stops propagation (a scrollable list
     * inside a dialog, say) can't hide the gesture from the guard.
     *
     * Returns the detach function for overlays that come and go.
     */
    public watch(target: EventTarget): () => void {
        const onWheel = (): void => this.claim()
        target.addEventListener('wheel', onWheel, { passive: true, capture: true })
        return () => target.removeEventListener('wheel', onWheel, { capture: true })
    }
}

/** The one guard the canvas consults and every DOM overlay claims through. */
export const wheelGuard = new WheelGuard()
