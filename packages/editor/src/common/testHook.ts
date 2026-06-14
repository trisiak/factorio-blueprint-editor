import G from './globals'
import { inputMode, type InputMode } from './input'
import { EditorMode } from '../containers/BlueprintContainer'
import { PaintEntityContainer } from '../containers/PaintEntityContainer'
import { PaintBlueprintContainer } from '../containers/PaintBlueprintContainer'
import { Dialog } from '../UI/controls/Dialog'
import { Entity } from '../core/Entity'

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
    /** The wires (copper/red/green) panel; sits next to the quickbar. */
    wires: {
        visible: boolean
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
        /**
         * What the cursor holds: a single `entity`, a pasted `blueprint`
         * (multi-entity ghost, draggable/nudgeable on touch), or null when idle.
         * Lets placement tests target the blueprint case specifically.
         */
        kind: 'entity' | 'blueprint' | null
    }
    /**
     * True while a modal dialog (e.g. an entity editor overlay) is open. On touch,
     * tapping an entity selects it (first tap) and only a second tap opens the
     * editor, so tests read this to confirm the overlay didn't pop on first touch.
     */
    dialogOpen: boolean
    /**
     * Touch box-select (#21): entities under the held marquee selection (0 unless
     * a selection is held, i.e. mode SELECT with the action controls showing).
     * `origin` is the selection's top-left tile — lets tests assert in-place
     * nudging actually moved the entities.
     */
    marquee: {
        count: number
        origin: { x: number; y: number } | null
        /** Direction of the first selected entity (for the rotate-in-select test). */
        direction: number | null
    }
    /** Whether the top-right entity info panel is showing (hover/tap-select). */
    infoPanelVisible: boolean
}

export function getEditorTestState(): EditorTestState {
    const qb = G.UI.quickbarPanel
    const r = qb.getBounds().rectangle
    const wp = G.UI.wiresPanel
    const wr = wp.getBounds().rectangle
    const painting = G.BPC.mode === EditorMode.PAINT && !!G.BPC.paintContainer
    return {
        inputMode: inputMode.mode,
        screen: { width: G.app.screen.width, height: G.app.screen.height },
        quickbar: {
            visible: qb.visible && r.width > 0 && r.height > 0,
            scale: qb.scale.x,
            bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        },
        wires: {
            visible: wp.visible && wr.width > 0 && wr.height > 0,
            bounds: { x: wr.x, y: wr.y, width: wr.width, height: wr.height },
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
            kind: !painting
                ? null
                : G.BPC.paintContainer instanceof PaintBlueprintContainer
                  ? 'blueprint'
                  : G.BPC.paintContainer instanceof PaintEntityContainer
                    ? 'entity'
                    : null,
        },
        dialogOpen: Dialog.anyOpen(),
        marquee: {
            count: G.BPC.marqueeCount,
            origin: G.BPC.marqueeOrigin ?? null,
            direction: G.BPC.marqueeDirection ?? null,
        },
        infoPanelVisible: G.UI.entityInfoPanelVisible,
    }
}

/** Property the probe is attached to on `window`. */
export const TEST_HOOK_KEY = '__FBE_TEST__'

export interface FbeTestHook {
    getState: () => EditorTestState
    /**
     * Sandbox/screenshot controls: drive the on-canvas UI into a given state
     * deterministically (no fragile click-coordinate math), reusing the exact
     * code paths real interactions hit. Each returns `false` if the named entity
     * isn't in the blueprint.
     */
    showEntityInfo: (name: string | null) => boolean
    openEntityEditor: (name: string) => boolean
    openInventory: () => void
    /** Open the item inventory and long-press-preview `name` (Confirm/Pin bar). */
    previewInventoryItem: (name: string) => void
    closeDialogs: () => void
    centerView: () => void
    /**
     * Pick up every entity in the blueprint as a paste ghost (a
     * `PaintBlueprintContainer`), the same cursor a copy/paste produces. Lets
     * placement tests exercise drag/nudge/center without a clipboard round-trip
     * or the (not-yet-built) touch marquee. Returns false on an empty blueprint.
     */
    spawnPasteGhost: () => boolean
    /**
     * Screen-space (canvas-relative, CSS px) position of a named entity, or null
     * if absent — lets touch tests tap an entity deterministically (e.g. to enter
     * EDIT mode) without guessing coordinates.
     */
    entityScreenPos: (name: string) => { x: number; y: number } | null
    /**
     * Count rendered wire pixels per colour by extracting the wires container in
     * isolation (so combinator/pole sprites can't be mistaken for a wire). Backs
     * the e2e wire-visibility guards (`e2e/wires.spec.ts`) — asserting that every
     * wire colour actually paints pixels, so a colour silently dropping out (e.g.
     * a paste that places entities but none of their connections) fails the test.
     */
    wireColorPixelCounts: () => { red: number; green: number; copper: number }
    /** Number of circuit-network highlight boxes currently shown (#49 hover highlight). */
    networkHighlightCount: () => number
}

/** Approximate per-channel match against a target colour (tolerant of AA edges). */
function colorNear(r: number, g: number, b: number, target: number, tol = 36): boolean {
    const R = (target >> 16) & 0xff
    const G2 = (target >> 8) & 0xff
    const B = target & 0xff
    return Math.abs(r - R) <= tol && Math.abs(g - G2) <= tol && Math.abs(b - B) <= tol
}

function findEntity(name: string): Entity | undefined {
    return G.bp.entities.valuesArray().find(e => e.name === name)
}

/**
 * Attach the state probe to `window`. Opt-in only — the website installs it
 * under `?test` — so it is absent in normal use.
 */
export function installTestHook(win: Window = window): void {
    const hook: FbeTestHook = {
        getState: getEditorTestState,
        showEntityInfo: name => {
            if (name === null) {
                G.UI.updateEntityInfoPanel(undefined)
                return true
            }
            const e = findEntity(name)
            if (e) G.UI.updateEntityInfoPanel(e)
            return !!e
        },
        openEntityEditor: name => {
            const e = findEntity(name)
            if (!e) return false
            Dialog.closeAll()
            G.UI.createEditor(e)
            return true
        },
        openInventory: () => {
            Dialog.closeAll()
            G.UI.createInventory('Inventory', undefined, undefined, 'items')
        },
        previewInventoryItem: name => {
            Dialog.closeAll()
            G.UI.createInventory('Inventory', undefined, undefined, 'items').beginPreview(name)
        },
        closeDialogs: () => Dialog.closeAll(),
        centerView: () => G.BPC.centerViewport(),
        spawnPasteGhost: () => {
            const entities = G.bp.entities.valuesArray()
            if (entities.length === 0) return false
            G.BPC.spawnPaintContainer(entities)
            return true
        },
        entityScreenPos: name => {
            const e = findEntity(name)
            if (!e) return null
            // World px → screen: the BlueprintContainer carries the viewport
            // transform (position + scale), so screen = world*scale + offset.
            return {
                x: e.position.x * 32 * G.BPC.scale.x + G.BPC.x,
                y: e.position.y * 32 * G.BPC.scale.y + G.BPC.y,
            }
        },
        wireColorPixelCounts: () => {
            // Extract the wires container on its own — it holds only wire sprites,
            // so any red/green/copper pixel here is a wire, not an entity sprite.
            const ex = (
                G.app.renderer as unknown as {
                    extract: { pixels: (t: unknown) => { pixels: Uint8Array } | Uint8Array }
                }
            ).extract.pixels(G.BPC.wiresContainer)
            const px: Uint8Array = 'pixels' in ex ? ex.pixels : ex
            let red = 0
            let green = 0
            let copper = 0
            for (let i = 0; i < px.length; i += 4) {
                if (px[i + 3] < 20) continue
                const r = px[i]
                const g = px[i + 1]
                const b = px[i + 2]
                if (colorNear(r, g, b, 0xc83718)) red++
                if (colorNear(r, g, b, 0x588c38)) green++
                if (colorNear(r, g, b, 0xcf7c00)) copper++
            }
            return { red, green, copper }
        },
        networkHighlightCount: () => G.BPC.overlayContainer.networkHighlightCount,
    }
    ;(win as unknown as Record<string, unknown>)[TEST_HOOK_KEY] = hook
}
