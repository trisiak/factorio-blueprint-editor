import G from './globals'
import { inputMode, type InputMode } from './input'
import { EditorMode } from '../containers/BlueprintContainer'
import { PaintEntityContainer } from '../containers/PaintEntityContainer'
import { PaintBlueprintContainer } from '../containers/PaintBlueprintContainer'
import { PaintTileContainer } from '../containers/PaintTileContainer'
import { Dialog } from '../UI/controls/Dialog'
import { InventoryDialog } from '../UI/InventoryDialog'
import { Modules } from '../UI/editors/components/Modules'
import { Filters } from '../UI/editors/components/Filters'
import { Recipe } from '../UI/editors/components/Recipe'
import { Editor } from '../UI/editors/Editor'
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
    /**
     * Entities/tiles currently in the blueprint — lets tests assert what got
     * placed (tiles are separate from entities: a landfill paint bumps
     * `tileCount` only).
     */
    blueprint: { entityCount: number; tileCount: number }
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
        /**
         * Square tile brush edge length while a *tile* brush is held (the
         * value the [ / ] keys and the d-pad Size buttons drive); null for
         * entity/wire/blueprint cursors — so non-null doubles as "the cursor
         * is a tile brush".
         */
        tileSize: number | null
    }
    /**
     * True while a modal dialog (e.g. an entity editor overlay) is open. On touch,
     * tapping an entity selects it (first tap) and only a second tap opens the
     * editor, so tests read this to confirm the overlay didn't pop on first touch.
     */
    dialogOpen: boolean
    /**
     * Whether any modal is open in *either* technology — a Pixi dialog or a
     * DOM one (#98). Presentation-agnostic specs (tap-to-edit, Edit-toggle)
     * assert this; `dialogOpen` stays Pixi-only for the per-mode-presentation
     * ratchets that need "the canvas dialog did NOT open".
     */
    modalOpen: boolean
    /**
     * Touch box-select (#21): entities under the held marquee selection (0 unless
     * a selection is held, i.e. mode SELECT with the action controls showing).
     * `origin` is the selection's top-left tile — lets tests assert in-place
     * nudging actually moved the entities.
     */
    marquee: {
        count: number
        /**
         * Tiles in the held selection. Selections are either/or: entities win
         * (game-like), so `count` and `tileCount` are never both non-zero —
         * a tile selection comes from a box with no entities, or from the
         * rail's "Select tiles".
         */
        tileCount: number
        origin: { x: number; y: number } | null
        /** Direction of the first selected entity (for the rotate-in-select test). */
        direction: number | null
    }
    /**
     * Whether the top-right entity info panel is showing (hover/tap-select).
     * Desktop presentation only: on mobile this is always false — the DOM
     * `#entity-info-sheet` presents instead (#89 Phase 2), and specs assert on
     * that element directly.
     */
    infoPanelVisible: boolean
    /** Whether the top-left blueprint-wide production rates panel is showing. */
    ratesPanelVisible: boolean
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
        blueprint: { entityCount: G.bp.entities.size, tileCount: G.bp.tiles.size },
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
            tileSize:
                painting && G.BPC.paintContainer instanceof PaintTileContainer
                    ? G.BPC.paintContainer.brushSize
                    : null,
        },
        dialogOpen: Dialog.anyOpen(),
        modalOpen: Dialog.anyModalOpen(),
        marquee: {
            count: G.BPC.marqueeCount,
            tileCount: G.BPC.marqueeTileCount,
            origin: G.BPC.marqueeOrigin ?? null,
            direction: G.BPC.marqueeDirection ?? null,
        },
        infoPanelVisible: G.UI.entityInfoPanelVisible,
        ratesPanelVisible: G.UI.ratesPanelVisible,
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
    /**
     * @returns whether an editor actually opened — false both when the entity
     * isn't in the blueprint and when it has nothing to configure (the factory
     * returns no editor, e.g. a provider chest). It used to report only "the
     * entity exists", which couldn't express "correctly opened nothing".
     */
    openEntityEditor: (name: string) => boolean
    openInventory: () => void
    /** Open the item inventory and long-press-preview `name` (Confirm/Pin bar). */
    previewInventoryItem: (name: string) => void
    /**
     * Open the item inventory (selecting spawns a paint ghost, like the `E`
     * keybind does), switch to its tallest item group, scroll it fully to the
     * bottom and return the last item button's on-screen centre (CSS px) plus
     * the applied scroll. Backs the "last row stays clickable at full scroll"
     * regression e2e — the returned point is then clicked for real.
     */
    inventoryScrollToLastItem: () => { x: number; y: number; scroll: number } | null
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
    /**
     * Count rendered pixels of the marquee's two overlay visuals — the blue drag
     * rectangle and the green per-tile selection highlight — by extracting the
     * overlay container in isolation. Backs the e2e guards that the rectangle
     * *disappears* once a selection is held (it used to linger frozen) and that
     * a held tile selection actually shows its highlight. Counts opaque stroke
     * pixels only (the highlight's translucent fill premultiplies too dim to
     * match reliably).
     */
    marqueeOverlayPixels: () => { box: number; highlight: number }
    /**
     * Logical slot contents for the clear-a-slot specs — `null` for an empty slot.
     * Read *through the entity*, so a cleared slot has to have actually been
     * written back to the blueprint (not merely blanked in the dialog).
     */
    entityModules: (name: string) => (string | null)[] | null
    entityFilters: (name: string) => (string | null)[] | null
    entityRecipe: (name: string) => string | null
    /**
     * Open `name`'s editor and return the on-screen centre (canvas-relative CSS
     * px, the same frame as `dragOneFinger`) of its module or filter slot `index`
     * — so the spec can right-click / long-press the slot *for real* instead of
     * reimplementing the dialog's scaled, clamped layout maths.
     */
    openEditorSlot: (
        name: string,
        kind: 'modules' | 'filters' | 'recipe',
        index: number
    ) => { x: number; y: number } | null
    /**
     * On-screen centre of the open item-selector's "✕ Clear" button, or null when
     * no selector is open / it has nothing to clear.
     */
    inventoryClearButtonPos: () => { x: number; y: number } | null
    /** The escape-hatch button's label — "✕ Clear", "✕ Cancel", or null if absent. */
    inventoryClearButtonLabel: () => string | null
    /** On-screen centre of "✓ Confirm", or null while it's hidden. */
    inventoryConfirmButtonPos: () => { x: number; y: number } | null
    /**
     * Flip the input mode, as the settings pane's Input Mode dropdown does. Lets
     * a spec assert that live-mode-switch handling works on already-open UI.
     */
    setInputMode: (mode: InputMode) => void
    /**
     * On-screen centre of the first item button in the open selector's active
     * group — lets a spec tap a real item without hardcoding which one the tab
     * shows. Null when no selector is open / the group is empty.
     */
    inventoryFirstItemPos: () => { x: number; y: number } | null
    /**
     * Whether an item selector is open — the Pixi InventoryDialog *or* the DOM
     * item picker (#98), whichever presents in the current mode. Distinct from
     * `getState().dialogOpen`, which stays true for the entity editor the
     * selector was opened *from* — so "the picker closed" needs its own signal.
     */
    inventoryOpen: () => boolean
    /**
     * Whether the *Pixi* InventoryDialog specifically is open — the probe for
     * "the canvas dialog did NOT present" in per-mode presentation ratchets.
     */
    pixiInventoryOpen: () => boolean
    /**
     * Open `name`'s editor and report its clear-a-slot hint text (null when the
     * editor has no clearable slots — currently none: every routed editor holds
     * at least one). The hint is canvas-drawn, so the DOM can't see it.
     */
    editorClearHint: (name: string) => string | null
    /**
     * The clear hint of the editor that is *already* open, without reopening it —
     * `editorClearHint` closes and rebuilds, which would mask whether an open
     * dialog reacts to a live input-mode switch.
     */
    openEditorClearHint: () => string | null
    /**
     * Bounds of the entity info panel (CSS px, canvas-relative), null while
     * hidden — desktop presentation only (see `infoPanelVisible`); on mobile
     * the DOM sheet is asserted through the DOM instead.
     */
    infoPanelBounds: () => { x: number; y: number; width: number; height: number } | null
    /** Toggle the blueprint-wide production rates panel (as the T keybind does). */
    toggleRatesPanel: () => void
    /**
     * The rates panel's rendered text lines, top to bottom — section headers,
     * per-material rates, the machines-counted footer. Canvas-drawn, so the DOM
     * can't see them; e2e asserts on these instead of pixels.
     */
    ratesPanelLines: () => string[]
    /**
     * On-screen centre of the rates panel's ✕ close button (canvas-relative CSS
     * px), or null while the panel is hidden — so the spec can dismiss it with
     * a real click/tap instead of the toggle action.
     */
    ratesPanelClosePos: () => { x: number; y: number } | null
    /**
     * Train-stop config, read through the entity — text typed into the DOM
     * station-name overlay (#56) / flags toggled in the editor only count once
     * they have been committed to the blueprint, not merely rendered.
     */
    entityTrainStop: (name: string) => {
        station: string
        manualTrainsLimit: number | null
        priority: number
        color: { r: number; g: number; b: number; a: number } | null
        sendToTrain: boolean
        readFromTrain: boolean
        readStoppedTrain: boolean
        trainStoppedSignal: string | null
        setTrainsLimit: boolean
        trainsLimitSignal: string | null
        readTrainsCount: boolean
        trainsCountSignal: string | null
        setPriority: boolean
        prioritySignal: string | null
    } | null
    /**
     * On-screen centre of a named control in the topmost *open* entity editor
     * (canvas-relative CSS px) — editor controls are canvas-drawn, so specs
     * have no other way to press one for real. Editors opt controls in via
     * `Editor.registerControl`; null when no editor is open or the name is
     * unknown to it.
     */
    editorControlPos: (control: string) => { x: number; y: number } | null
    /**
     * The entity's raw `control_behavior` (deep copy) — the generic committed-
     * state read for circuit-editing specs: a tapped control only counts once
     * its write landed here. Null when the entity is absent; an entity with no
     * circuit config yet returns null too (the object is created on demand).
     */
    entityControlBehavior: (name: string) => Record<string, unknown> | null
    /** Inserter root fields — `use_filters` gates whether its filters apply in-game. */
    entityInserter: (name: string) => {
        useFilters: boolean
        filterMode: string
        filters: (string | null)[]
    } | null
    /** Display-panel root fields (text/icon/flags live outside control_behavior). */
    entityDisplayPanel: (name: string) => {
        text: string
        alwaysShow: boolean
        showInChart: boolean
        icon: string | null
    } | null
    /** Quickbar slot contents, `null` for an unassigned slot. */
    quickbarItems: () => (string | null)[]
    /** On-screen centre of quickbar slot `index`, or null if it isn't rendered. */
    quickbarSlotPos: (index: number) => { x: number; y: number } | null
    /**
     * Seed quickbar slot 0 with a known item, so a spec has something to clear
     * without driving the assign flow (which is not what those tests are about).
     */
    quickbarAssign: (name?: string) => void
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
/**
 * The DOM presentations of the migrated dialogs (#98) are queryable directly,
 * but the hook still reports them through the same coordinate/label shapes as
 * the Pixi ones, so specs stay press-at-position across the migration. These
 * class names are the website's dialog markup — test-only coupling, kept here
 * because the hook *is* the cross-boundary probe.
 */
function domPicker(): Element | null {
    const pickers = document.querySelectorAll('.fbe-dialog.item-picker')
    return pickers.length ? pickers[pickers.length - 1] : null
}

function domCenter(el: Element | null): { x: number; y: number } | null {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

/** Close Pixi dialogs and (over the bridge event) the DOM ones. */
function closeEverything(): void {
    Dialog.closeAllModals()
}

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
            closeEverything()
            // The real per-mode entry (#98): DOM editor on mobile for the
            // migrated kinds, Pixi otherwise.
            return G.UI.openEntityEditor(e)
        },
        // Routed through the real per-mode entry (#98) so the probe drives the
        // presentation the user would get: Pixi dialog on desktop, the DOM
        // selector (via `fbe:openinventory`) on mobile.
        openInventory: () => {
            closeEverything()
            G.UI.openMainInventory()
        },
        previewInventoryItem: name => {
            closeEverything()
            G.UI.openMainInventory(name)
        },
        inventoryScrollToLastItem: () => {
            Dialog.closeAll()
            return G.UI.createInventory(
                'Inventory',
                undefined,
                name => G.BPC.spawnPaintContainer(name),
                'items'
            ).scrollToLastItem()
        },
        // Closes the Pixi dialogs and — over the `fbe:closedialogs` bridge —
        // the website-side DOM ones (#98).
        closeDialogs: () => closeEverything(),
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
        marqueeOverlayPixels: () => {
            // Extraction of a fully-empty container can throw on zero bounds —
            // report "nothing drawn" instead, which is exactly what that means.
            try {
                const ex = (
                    G.app.renderer as unknown as {
                        extract: { pixels: (t: unknown) => { pixels: Uint8Array } | Uint8Array }
                    }
                ).extract.pixels(G.BPC.overlayContainer)
                const px: Uint8Array = 'pixels' in ex ? ex.pixels : ex
                let box = 0
                let highlight = 0
                for (let i = 0; i < px.length; i += 4) {
                    if (px[i + 3] < 100) continue // opaque strokes only
                    const r = px[i]
                    const g = px[i + 1]
                    const b = px[i + 2]
                    if (colorNear(r, g, b, 0x3b9eff)) box++
                    if (colorNear(r, g, b, 0x00d400)) highlight++
                }
                return { box, highlight }
            } catch {
                return { box: 0, highlight: 0 }
            }
        },
        // `Entity.modules` is a *sparse* array (`new Array(moduleSlots)` with only
        // filled stacks assigned), and `map` skips holes — which would serialize
        // across CDP as `undefined` rather than the `null` an empty slot means.
        // `Array.from` visits every index, so holes normalize to `null`.
        entityModules: name => {
            const mods = findEntity(name)?.modules
            return mods ? Array.from(mods, m => m ?? null) : null
        },
        entityFilters: name => {
            const filters = findEntity(name)?.filters
            return filters ? Array.from(filters, f => f?.name ?? null) : null
        },
        entityRecipe: name => findEntity(name)?.recipe ?? null,
        openEditorSlot: (name, kind, index) => {
            const e = findEntity(name)
            if (!e) return null
            closeEverything()
            if (!G.UI.openEntityEditor(e)) return null
            // DOM editor (#98, mobile migrated kinds): the slots are real
            // buttons; report the same coordinate shape so specs stay
            // press-at-position either way.
            const dom = document.querySelector('.fbe-dialog.entity-editor')
            if (dom) {
                return domCenter(
                    kind === 'recipe'
                        ? dom.querySelector('.ee-recipe-slot')
                        : dom.querySelector(
                              `.ee-${kind === 'modules' ? 'module' : 'filter'}-slot[data-index="${index}"]`
                          )
                )
            }
            const editor = Dialog.openDialogs.findLast(d => d instanceof Editor)
            if (!(editor instanceof Editor)) return null
            // The recipe control *is* a Slot (Recipe extends Slot), so it sits
            // directly on the editor rather than inside a group container.
            const target =
                kind === 'recipe'
                    ? editor.children.find(c => c instanceof Recipe)
                    : editor.children.find(c =>
                          kind === 'modules' ? c instanceof Modules : c instanceof Filters
                      )?.children[index]
            if (!target) return null
            const r = target.getBounds().rectangle
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        },
        inventoryClearButtonPos: () => {
            const dom = domPicker()
            if (dom) return domCenter(dom.querySelector('.is-clear'))
            const inv = Dialog.openDialogs.findLast(d => d instanceof InventoryDialog)
            return inv ? inv.clearButtonPosition() : null
        },
        inventoryClearButtonLabel: () => {
            const dom = domPicker()
            if (dom) return dom.querySelector('.is-clear')?.textContent ?? null
            const inv = Dialog.openDialogs.findLast(d => d instanceof InventoryDialog)
            return inv ? inv.clearButtonLabel() : null
        },
        inventoryConfirmButtonPos: () => {
            const dom = domPicker()
            if (dom) return domCenter(dom.querySelector('.is-confirm'))
            const inv = Dialog.openDialogs.findLast(d => d instanceof InventoryDialog)
            return inv ? inv.confirmButtonPosition() : null
        },
        setInputMode: mode => {
            inputMode.mode = mode
        },
        openEditorClearHint: () => {
            const dom = document.querySelector('.fbe-dialog.entity-editor .ee-hint')
            if (dom) return dom.textContent
            const editor = Dialog.openDialogs.findLast(d => d instanceof Editor)
            return editor ? editor.clearHintText : null
        },
        inventoryFirstItemPos: () => {
            const dom = domPicker()
            if (dom) return domCenter(dom.querySelector('.is-cell'))
            const inv = Dialog.openDialogs.findLast(d => d instanceof InventoryDialog)
            return inv ? inv.firstItemPosition() : null
        },
        inventoryOpen: () =>
            Dialog.openDialogs.some(d => d instanceof InventoryDialog) || domPicker() !== null,
        pixiInventoryOpen: () => Dialog.openDialogs.some(d => d instanceof InventoryDialog),
        editorClearHint: name => {
            const e = findEntity(name)
            if (!e) return null
            closeEverything()
            if (!G.UI.openEntityEditor(e)) return null
            const dom = document.querySelector('.fbe-dialog.entity-editor .ee-hint')
            if (dom) return dom.textContent
            const editor = Dialog.openDialogs.findLast(d => d instanceof Editor)
            return editor instanceof Editor ? editor.clearHintText : null
        },
        infoPanelBounds: () => G.UI.entityInfoPanelBounds(),
        toggleRatesPanel: () => G.UI.toggleRatesPanel(),
        ratesPanelLines: () => G.UI.ratesPanelLines(),
        ratesPanelClosePos: () => G.UI.ratesPanelClosePos(),
        entityTrainStop: name => {
            const e = findEntity(name)
            if (!e) return null
            // `undefined` (no limit / no signal) would vanish in the CDP
            // round-trip; normalize to null.
            return {
                station: e.station,
                manualTrainsLimit: e.manualTrainsLimit ?? null,
                priority: e.trainStopPriority,
                color: e.trainStopColor ?? null,
                sendToTrain: e.sendToTrain,
                readFromTrain: e.readFromTrain,
                readStoppedTrain: e.readStoppedTrain,
                trainStoppedSignal: e.trainStoppedSignal?.name ?? null,
                setTrainsLimit: e.setTrainsLimit,
                trainsLimitSignal: e.trainsLimitSignal?.name ?? null,
                readTrainsCount: e.readTrainsCount,
                trainsCountSignal: e.trainsCountSignal?.name ?? null,
                setPriority: e.setPriority,
                prioritySignal: e.prioritySignal?.name ?? null,
            }
        },
        editorControlPos: control => {
            const editor = Dialog.openDialogs.findLast(d => d instanceof Editor)
            return editor instanceof Editor ? editor.controlPosition(control) : null
        },
        entityControlBehavior: name => {
            const cb = findEntity(name)?.rawEntity.control_behavior
            return cb ? (JSON.parse(JSON.stringify(cb)) as Record<string, unknown>) : null
        },
        entityInserter: name => {
            const e = findEntity(name)
            if (!e) return null
            return {
                useFilters: e.inserterUseFilters,
                filterMode: e.filterMode,
                filters: Array.from(e.filters ?? [], f => f?.name ?? null),
            }
        },
        entityDisplayPanel: name => {
            const e = findEntity(name)
            if (!e) return null
            return {
                text: e.displayPanelText,
                alwaysShow: e.displayPanelAlwaysShow,
                showInChart: e.displayPanelShowInChart,
                icon: e.displayPanelIcon?.name ?? null,
            }
        },
        quickbarItems: () =>
            G.UI.quickbarPanel.serialize().map(itemName => itemName ?? null) as (string | null)[],
        quickbarSlotPos: index => {
            const slot = G.UI.quickbarPanel.slotAt(index)
            if (!slot) return null
            const r = slot.getBounds().rectangle
            if (r.width === 0 || r.height === 0) return null
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        },
        quickbarAssign: (name = 'fast-inserter') => {
            G.UI.quickbarPanel.slotAt(0)?.assignItem(name)
        },
    }
    ;(win as unknown as Record<string, unknown>)[TEST_HOOK_KEY] = hook
}
