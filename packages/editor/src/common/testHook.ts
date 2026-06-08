import G from './globals'
import { inputMode, type InputMode } from './input'

/**
 * Read-only logical-state snapshot for e2e tests. The editor renders into a
 * single <canvas>, so Playwright can't query on-canvas UI (the quickbar,
 * dialogs, ...) through the DOM; this exposes the state those assertions need.
 * All measurements are in CSS pixels (matching `page.viewportSize()`).
 */
export interface EditorTestState {
    inputMode: InputMode
    screen: { width: number; height: number }
    quickbar: {
        visible: boolean
        scale: number
        bounds: { x: number; y: number; width: number; height: number }
    }
}

export function getEditorTestState(): EditorTestState {
    const qb = G.UI.quickbarPanel
    const r = qb.getBounds().rectangle
    return {
        inputMode: inputMode.mode,
        screen: { width: G.app.screen.width, height: G.app.screen.height },
        quickbar: {
            visible: qb.visible && r.width > 0 && r.height > 0,
            scale: qb.scale.x,
            bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        },
    }
}

/** Property the probe is attached to on `window`. */
export const TEST_HOOK_KEY = '__FBE_TEST__'

export interface FbeTestHook {
    getState: () => EditorTestState
}

/**
 * Attach the state probe to `window`. Opt-in only — the website installs it
 * under `?test` — so it is absent in normal use.
 */
export function installTestHook(win: Window = window): void {
    const hook: FbeTestHook = { getState: getEditorTestState }
    ;(win as unknown as Record<string, unknown>)[TEST_HOOK_KEY] = hook
}
