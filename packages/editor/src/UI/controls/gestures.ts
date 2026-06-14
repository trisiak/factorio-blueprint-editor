import { Container, FederatedPointerEvent } from 'pixi.js'

/**
 * Wire a slot so that a quick tap/left-click *activates* it and a long-press (or
 * right-click on desktop) *clears* it. Long-press is the touch-friendly way to
 * clear a slot, since touch has no right-click — used by the signal/operand/
 * recipe slots so a held tap removes the current value.
 */
export function bindSlotGestures(
    target: Container,
    onActivate: () => void,
    onClear: () => void,
    longPressMs = 500
): void {
    let timer: ReturnType<typeof setTimeout> | undefined
    let longFired = false

    const cancelTimer = (): void => {
        if (timer) {
            clearTimeout(timer)
            timer = undefined
        }
    }

    target.on('pointerdown', (e: FederatedPointerEvent) => {
        e.stopPropagation()
        if (e.button === 2) {
            onClear()
            return
        }
        if (e.button !== 0) return
        longFired = false
        timer = setTimeout(() => {
            timer = undefined
            longFired = true
            onClear()
        }, longPressMs)
    })
    target.on('pointerup', (e: FederatedPointerEvent) => {
        if (e.button !== 0) return
        const wasPending = timer !== undefined
        cancelTimer()
        if (wasPending && !longFired) onActivate()
    })
    target.on('pointerupoutside', cancelTimer)
}
