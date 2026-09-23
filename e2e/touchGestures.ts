import { type Page } from '@playwright/test'

// Shared touch-gesture helpers for the mobile specs. Playwright's high-level
// `touchscreen` API is single-tap only, so one-finger *drags* (pan / grab-ghost /
// marquee) are synthesized over CDP `Input.dispatchTouchEvent`. This lived
// copy-pasted in three spec files; it's centralized here so the (load-sensitive)
// dispatch logic has a single, hardened implementation.

/**
 * Drag a single finger across the canvas over CDP.
 *
 * Coordinates are **canvas/element-relative** — the same frame as
 * `locator.tap({position})` — so the helper adds the `#editor` box offset before
 * handing CDP page coordinates: the canvas is inset by the action rail, and
 * skipping this would land the touch ~a rail-width off (fine for a pan, but it
 * would miss a small ghost you mean to grab).
 *
 * **Why so few, un-awaited dispatches.** Each `Input.dispatchTouchEvent` blocks
 * until the *renderer* acknowledges it, and when the full suite runs in parallel
 * the render loop is starved (many canvas pages at once, software WebGL with no
 * GPU): an ack that's instant in isolation takes seconds under load. The old
 * helper fired ~10 moves and `await`ed each one, so the per-event stalls *added
 * up* and blew the test budget mid-drag — the timeout then tore the page down
 * (`cdpSession.send: Target page ... has been closed`). We now (a) keep the move
 * count tiny — a gesture only needs its start, one threshold-crossing midpoint,
 * and its end to be classified and tracked — and (b) fire the moves without
 * awaiting each, settling on a single `await` at `touchEnd`. Same gesture, a
 * fraction of the serialized renderer round-trips.
 */
export async function dragOneFinger(
    page: Page,
    from: { x: number; y: number },
    to: { x: number; y: number },
    steps = 3
): Promise<void> {
    const box = await page.locator('#editor').boundingBox()
    const ox = box?.x ?? 0
    const oy = box?.y ?? 0
    const cdp = await page.context().newCDPSession(page)
    try {
        // Sends on one CDP session are dispatched to the renderer in order, so we
        // pipeline the start + intermediate moves rather than `await`ing each in
        // turn — that per-send round-trip is what stacked up under load and blew
        // the test budget. We then `await` the whole stream before sending
        // `touchEnd`, so the move that crosses the tap-vs-drag threshold is
        // guaranteed handled before the release (otherwise the drag could be misread
        // as a tap — the marquee staying *armed* with no box drawn).
        const stream: Promise<unknown>[] = [
            cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: [{ x: ox + from.x, y: oy + from.y }],
            }),
        ]
        for (let i = 1; i <= steps; i++) {
            stream.push(
                cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [
                        {
                            x: ox + from.x + ((to.x - from.x) * i) / steps,
                            y: oy + from.y + ((to.y - from.y) * i) / steps,
                        },
                    ],
                })
            )
        }
        await Promise.all(stream)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } finally {
        await cdp.detach()
    }
}

/**
 * Hold a single finger down at one point, then release — the touch gesture that
 * *clears* a slot (`bindSlotGestures`, 500 ms). Playwright's `touchscreen.tap()`
 * releases immediately, so the hold has to go over CDP like the drag above.
 *
 * Coordinates are canvas/element-relative, same as `dragOneFinger`. No moves are
 * sent: the recognizer cancels the long-press on a drag past its slop, so a
 * still finger is exactly what we want.
 *
 * `holdMs` is padded far past the recognizer's 500 ms threshold: that timer is a
 * `setTimeout` on the page's main thread, which a parallel suite on software
 * WebGL can starve for the better part of a second. If the release lands before
 * the timer fires, the gesture is (correctly) read as a *tap* — so an
 * under-generous hold doesn't fail loudly, it silently exercises the wrong path.
 */
export async function longPressOneFinger(
    page: Page,
    at: { x: number; y: number },
    holdMs = 1_500
): Promise<void> {
    const box = await page.locator('#editor').boundingBox()
    const x = (box?.x ?? 0) + at.x
    const y = (box?.y ?? 0) + at.y
    const cdp = await page.context().newCDPSession(page)
    try {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x, y }],
        })
        await page.waitForTimeout(holdMs)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } finally {
        await cdp.detach()
    }
}

/**
 * Pinch two fingers apart (or together) about a center point — the two-finger
 * gesture `PointerGestures` turns into a viewport zoom. Playwright's high-level
 * `touchscreen` API is single-touch, so this is the only way to express it.
 *
 * Coordinates are canvas/element-relative, like the helpers above. The fingers
 * start `from` px either side of `center` on the x axis and end `to` px either
 * side, so `to > from` zooms in and `to < from` zooms out. Move dispatches are
 * pipelined for the same reason `dragOneFinger` pipelines its own: each send
 * blocks on a renderer ack, and a starved render loop turns a handful of awaited
 * round-trips into seconds.
 */
export async function pinch(
    page: Page,
    center: { x: number; y: number },
    from: number,
    to: number,
    steps = 4
): Promise<void> {
    const box = await page.locator('#editor').boundingBox()
    const cx = (box?.x ?? 0) + center.x
    const cy = (box?.y ?? 0) + center.y
    const points = (spread: number): { x: number; y: number }[] => [
        { x: cx - spread, y: cy },
        { x: cx + spread, y: cy },
    ]
    const cdp = await page.context().newCDPSession(page)
    try {
        const stream: Promise<unknown>[] = [
            cdp.send('Input.dispatchTouchEvent', {
                type: 'touchStart',
                touchPoints: points(from),
            }),
        ]
        for (let i = 1; i <= steps; i++) {
            stream.push(
                cdp.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: points(from + ((to - from) * i) / steps),
                })
            )
        }
        await Promise.all(stream)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } finally {
        await cdp.detach()
    }
}
