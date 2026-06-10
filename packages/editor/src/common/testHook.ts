import G from './globals'
import { inputMode, type InputMode } from './input'
import { EditorMode } from '../containers/BlueprintContainer'
import { PaintEntityContainer } from '../containers/PaintEntityContainer'
import { Dialog } from '../UI/controls/Dialog'

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
    /** Entities currently in the blueprint — lets tests assert what got placed. */
    blueprint: { entityCount: number }
    /**
     * The paint cursor (held item). On touch, a tap positions/previews the ghost
     * without committing, so tests read `tile` to confirm where it landed and
     * `entityCount` to confirm a tap did *not* place until confirmed.
     */
    paint: {
        active: boolean
        visible: boolean
        tile: { x: number; y: number } | null
        /** Held entity ghost's facing (0/4/8/12 cardinal); null for tiles/wires. */
        direction: number | null
    }
    /**
     * True while a modal dialog (e.g. an entity editor overlay) is open. On touch,
     * tapping an entity selects it (first tap) and only a second tap opens the
     * editor, so tests read this to confirm the overlay didn't pop on first touch.
     */
    dialogOpen: boolean
}

export function getEditorTestState(): EditorTestState {
    const qb = G.UI.quickbarPanel
    const r = qb.getBounds().rectangle
    const painting = G.BPC.mode === EditorMode.PAINT && !!G.BPC.paintContainer
    return {
        inputMode: inputMode.mode,
        screen: { width: G.app.screen.width, height: G.app.screen.height },
        quickbar: {
            visible: qb.visible && r.width > 0 && r.height > 0,
            scale: qb.scale.x,
            bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        },
        blueprint: { entityCount: G.bp.entities.size },
        paint: {
            active: painting,
            visible: painting && G.BPC.paintContainer.visible,
            tile: painting ? G.BPC.paintContainer.getGridPosition() : null,
            direction:
                painting && G.BPC.paintContainer instanceof PaintEntityContainer
                    ? G.BPC.paintContainer.getDirection()
                    : null,
        },
        dialogOpen: Dialog.anyOpen(),
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
