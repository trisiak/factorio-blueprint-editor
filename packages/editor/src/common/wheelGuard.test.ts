import { describe, expect, it } from 'vitest'
import { WHEEL_OWNERSHIP_MS, WheelGuard } from './wheelGuard'

// The wheel-ownership window (#101 Slice 5 review). The guard itself is a
// timestamp comparison, which is exactly the part worth pinning: the browser
// half (who calls `claim`, who calls `blocksCanvas`) is wired in
// `BlueprintContainer` and the website's overlays and covered by
// `e2e/domReadouts.spec.ts`. A fake clock stands in for `performance.now`, so
// these assertions are about the *rule*, not about real elapsed time.
const guardAt = (clock: { t: number }, windowMs = WHEEL_OWNERSHIP_MS): WheelGuard =>
    new WheelGuard(windowMs, () => clock.t)

describe('WheelGuard', () => {
    it('does not block the canvas before any overlay wheel', () => {
        const clock = { t: 0 }
        const guard = guardAt(clock)
        expect(guard.blocksCanvas()).toBe(false)
        // ...nor after an eternity of nothing happening: a never-claimed guard
        // must not become blocking just because the clock moved.
        clock.t = 1e9
        expect(guard.blocksCanvas()).toBe(false)
    })

    it('blocks the canvas for the ownership window after an overlay wheel', () => {
        const clock = { t: 1_000 }
        const guard = guardAt(clock)
        guard.claim()

        expect(guard.blocksCanvas()).toBe(true)
        clock.t += WHEEL_OWNERSHIP_MS - 1
        expect(guard.blocksCanvas()).toBe(true)
    })

    it('releases the wheel once the window elapses', () => {
        const clock = { t: 1_000 }
        const guard = guardAt(clock)
        guard.claim()

        // Exactly at the boundary the claim is over — the window is half-open,
        // so a 300 ms wait is enough to zoom again.
        clock.t += WHEEL_OWNERSHIP_MS
        expect(guard.blocksCanvas()).toBe(false)
        clock.t += 5_000
        expect(guard.blocksCanvas()).toBe(false)
    })

    it('extends the window on every further overlay wheel', () => {
        const clock = { t: 0 }
        const guard = guardAt(clock)

        // A long inertial scroll is a stream of events; each one must renew the
        // claim, or a flick lasting longer than the window would leak its tail.
        for (let i = 0; i < 10; i++) {
            guard.claim()
            clock.t += WHEEL_OWNERSHIP_MS - 10
            expect(guard.blocksCanvas()).toBe(true)
        }
        clock.t += 20
        expect(guard.blocksCanvas()).toBe(false)
    })

    it('drops the claim on release', () => {
        const clock = { t: 500 }
        const guard = guardAt(clock)
        guard.claim()
        expect(guard.blocksCanvas()).toBe(true)
        guard.release()
        expect(guard.blocksCanvas()).toBe(false)
    })

    it('claims through `watch`, on the capture phase and without cancelling', () => {
        const clock = { t: 0 }
        const guard = guardAt(clock)

        // A minimal EventTarget stand-in: the node env has no DOM, and what
        // matters here is that `watch` registers a passive capture listener and
        // that its handler claims (and stops claiming once detached).
        const listeners: { type: string; fn: EventListener; opts: AddEventListenerOptions }[] = []
        const target = {
            addEventListener: (type: string, fn: EventListener, opts: AddEventListenerOptions) =>
                listeners.push({ type, fn, opts }),
            removeEventListener: (type: string, fn: EventListener) => {
                const i = listeners.findIndex(l => l.type === type && l.fn === fn)
                if (i >= 0) listeners.splice(i, 1)
            },
        } as unknown as EventTarget

        const detach = guard.watch(target)
        expect(listeners).toHaveLength(1)
        expect(listeners[0].type).toBe('wheel')
        expect(listeners[0].opts).toMatchObject({ passive: true, capture: true })

        listeners[0].fn(new Event('wheel'))
        expect(guard.blocksCanvas()).toBe(true)

        detach()
        expect(listeners).toHaveLength(0)
    })
})
