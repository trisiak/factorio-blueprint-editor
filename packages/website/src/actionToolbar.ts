import EDITOR, { Editor, EditorMode, inputMode } from '@fbe/editor'

// On-screen action rail: a DOM (not Pixi) mirror of the keyboard-only actions in
// the editor's action registry, so touch users — who have no keyboard — can
// rotate / flip / undo / open the inventory and, crucially, *exit paint mode*.
//
// Layout is a left **gutter** (the "layout authority" for the left edge): the
// rail claims a reserved left inset on the canvas (`editor.setViewportInsets`)
// so the Pixi UI reflows out of it instead of being covered. It's *dynamic* —
// as many priority-ordered buttons as fit the available height stay in the rail;
// the rest collapse behind a ⋯ button that opens an overflow sheet over the
// canvas. Shown only in the `mobile` input mode (desktop has the keyboard).
//
// Below the rail, **contextual** clusters appear, one per editor mode: a PAINT
// d-pad (nudge + Place), SELECT controls (nudge a held selection in place +
// Copy/Cut/Delete/Rotate/Done), and an EDIT bar (Select / Edit). Since #101
// Slice 3 they are keyed on **editor state + input signals, never on the
// device** (see `updateContextual`):
//
// | cluster        | shown when                                    | placement                          |
// |----------------|-----------------------------------------------|------------------------------------|
// | SELECT         | `EditorMode.SELECT` — everyone                | bottom band on `coarse`, else a floating toolbar anchored to the selection |
// | PAINT d-pad    | `EditorMode.PAINT` and the touch driver is live | bottom band                        |
// | EDIT bar       | `EditorMode.EDIT` and the touch driver is live  | bottom band                        |
//
// The SELECT cluster is one component with two *placements*: a mouse user gets
// it next to what they selected (with keybind hints), a finger gets it in the
// thumb band at the bottom. The PAINT d-pad and the EDIT bar stay touch-only
// affordances — a mouse has hover, the wheel and the arrow keys for a ghost, and
// its EDIT is transient hover rather than a tap-select — so they appear the
// moment the screen is touched and go away again on the next mouse move.
//
// Buttons invoke actions by name: a matching entry in `handlers` (an Editor
// method) wins, else `EDITOR.callAction` keeps the rail in lockstep with the
// keybind registry.

interface ToolbarButton {
    /** Action name: a key in `handlers`, else an `EDITOR.callAction` action. */
    action: string
    /** Unicode glyph shown large. */
    glyph: string
    /**
     * Optional pack-icon id (`"item/red-wire"`): when the active pack's icon
     * sheet is loaded (packIcons.ts), the glyph is replaced by the real game
     * icon; until then — or on a pack without the browser artifact — the glyph
     * stays as the fallback. Only buttons that represent a *game thing* can
     * carry one; pure editor actions have no game sprite and keep glyphs.
     */
    icon?: string
    /** Short caption (also the button `title`, which e2e locates by). */
    label: string
    /** Extra class (cancel/confirm/delete get emphasized in the relevant modes). */
    className?: string
    /** Grid placement for d-pad clusters (1-based). */
    row?: number
    col?: number
    /**
     * Editor modes this rail button is shown in. Omit = always (global actions).
     * Buttons hide in modes where their action is a no-op, so the rail only ever
     * shows what's useful right now (#33).
     */
    modes?: EditorMode[]
    /** Extra show condition beyond mode (e.g. Select needs a non-empty blueprint). */
    when?: (editor: Editor) => boolean
    /**
     * Action registry name whose keybind this button mirrors — the source of the
     * keybind hint shown on the floating SELECT toolbar (#101 Slice 3). Usually
     * but not always the button's own `action`: the cluster buttons call `Editor`
     * methods directly (`copyMarquee`), while the *key* that does the same thing
     * is a registry action registered elsewhere (`copySelection`, in the
     * website's `registerActions`). Read live, so a rebind in Settings shows up.
     */
    keyAction?: string
    /**
     * Permanently parked in the ⋯ overflow, never in the rail — for rare,
     * deliberate actions (blueprint management). Keeps the rail short and
     * *stable*: the everyday cells sit in the same places across modes
     * (muscle memory) instead of shifting as mode-gating frees rows.
     */
    parked?: boolean
}

// Rail (left gutter). Priority order: the buttons that fit stay in the rail; the
// rest spill into the ⋯ overflow. Each button declares the modes it's useful in
// (`modes`); it hides elsewhere so the rail only shows live actions (#33).
// `EM` is a short alias for EditorMode to keep the table readable.
const EM = EditorMode
const BUTTONS: ToolbarButton[] = [
    // Global actions — useful in any mode.
    { action: 'inventory', glyph: '⊞', label: 'Items' },
    { action: 'undo', glyph: '↶', label: 'Undo' },
    { action: 'redo', glyph: '↷', label: 'Redo' },
    { action: 'focus', glyph: '⌖', label: 'Center' },
    // Blueprint-wide production/consumption readout (keyboard: T). Global —
    // the panel is a passive overlay, useful while inspecting or editing.
    { action: 'showRates', glyph: '⚖', label: 'Rates' },
    // Touch marquee (#21): arm a box-select. Only when idle/inspecting and there's
    // something to select; the drag + held-selection controls live in SELECT_*.
    // The box resolves game-like: entities win, tiles only when it holds none.
    {
        action: 'marquee',
        glyph: '▦',
        label: 'Select',
        modes: [EM.NONE, EM.EDIT],
        when: e => !e.blueprintEmpty,
    },
    // Tiles-flavoured box-select: collects the tiles even where entities sit on
    // top of them — the case the regular Select's entities-win rule can't reach.
    // Only offered while the blueprint actually holds tiles.
    {
        action: 'marqueeTiles',
        glyph: '▨',
        label: 'Select tiles',
        modes: [EM.NONE, EM.EDIT],
        when: e => e.blueprintHasTiles,
    },
    // Cursor actions — only where they do something. Rotate works on a held
    // ghost, an edited entity, and a *single*-entity selection (group rotation
    // isn't supported yet — #52); flip only works on a pasted-blueprint ghost.
    {
        action: 'rotate',
        glyph: '↻',
        label: 'Rotate',
        modes: [EM.PAINT, EM.EDIT, EM.SELECT],
        when: e => e.mode !== EM.SELECT || e.marqueeCount === 1,
    },
    {
        action: 'flipHorizontal',
        glyph: '⇄',
        label: 'Flip H',
        modes: [EM.PAINT],
        when: e => e.cursorCanFlip,
    },
    {
        action: 'flipVertical',
        glyph: '⇅',
        label: 'Flip V',
        modes: [EM.PAINT],
        when: e => e.cursorCanFlip,
    },
    { action: 'pipette', glyph: '⊙', label: 'Pick', modes: [EM.PAINT, EM.EDIT] },
    { action: 'mine', glyph: '🗑', label: 'Delete', className: 'delete', modes: [EM.EDIT] },
    { action: 'copyEntitySettings', glyph: '⧉', label: 'Copy cfg', modes: [EM.EDIT] },
    { action: 'pasteEntitySettings', glyph: '⊟', label: 'Paste cfg', modes: [EM.EDIT] },
    // "Get me out" — present whenever there's a cursor/selection to drop.
    {
        action: 'closeWindow',
        glyph: '✕',
        label: 'Cancel',
        className: 'cancel',
        modes: [EM.PAINT, EM.SELECT],
    },
    // Wires (#89): paint items, but not inventory items — the Items dialog can't
    // reach them, so they get rail buttons (which also retires the bottom-band
    // wires panel on mobile). Tapping toggles: spawn the wire, or drop it if
    // it's already held. Colored glyphs (index.styl) until the pack icon loads.
    {
        action: 'copper-wire',
        glyph: '∿',
        icon: 'item/copper-wire',
        label: 'Copper',
        className: 'wire-copper',
    },
    {
        action: 'red-wire',
        glyph: '∿',
        icon: 'item/red-wire',
        label: 'Red wire',
        className: 'wire-red',
    },
    {
        action: 'green-wire',
        glyph: '∿',
        icon: 'item/green-wire',
        label: 'Green wire',
        className: 'wire-green',
    },
    // Blueprint-level / management actions — global; keyboard-only otherwise, so
    // unreachable on touch (see issue #26). Rare and deliberate, so they live
    // *permanently* in the ⋯ overflow (`parked`), never occupying rail cells.
    { action: 'copyBlueprint', glyph: '📋', label: 'Copy BP', parked: true },
    { action: 'appendBlueprint', glyph: '📥', label: 'Paste BP', parked: true },
    { action: 'takePicture', glyph: '📷', label: 'Export', parked: true },
    { action: 'clear', glyph: '🆕', label: 'New', parked: true },
]

// PAINT d-pad: nudge arrows + green Place (gamepad layout), shown while holding a
// paint ghost. `row`/`col` place each in the 3×3 grid explicitly (named grid
// areas are brittle through the Stylus pipeline). The corners carry tile-brush
// extras (gated via `when` — makeCluster hides them for entity/wire cursors):
// Size − / + drive the same registry actions as the [ / ] keys (the brush was
// stuck at 2×2 on touch), and Erase fires `mine` — desktop's right-click — which
// in PAINT mode removes the tiles under the ghost footprint, so tap-to-position
// then Erase is the touch way to collect laid tiles (brush size = eraser size).
const PAINT_DPAD: ToolbarButton[] = [
    {
        action: 'decreaseTileBuildingArea',
        glyph: '−',
        label: 'Size -',
        row: 1,
        col: 1,
        when: e => e.cursorIsTile,
    },
    { action: 'moveEntityUp', glyph: '▲', label: 'Up', row: 1, col: 2 },
    {
        action: 'increaseTileBuildingArea',
        glyph: '+',
        label: 'Size +',
        row: 1,
        col: 3,
        when: e => e.cursorIsTile,
    },
    { action: 'moveEntityLeft', glyph: '◀', label: 'Left', row: 2, col: 1 },
    {
        action: 'confirmPlacement',
        glyph: '✓',
        label: 'Place',
        row: 2,
        col: 2,
        className: 'confirm',
    },
    { action: 'moveEntityRight', glyph: '▶', label: 'Right', row: 2, col: 3 },
    { action: 'moveEntityDown', glyph: '▼', label: 'Down', row: 3, col: 2 },
    {
        action: 'mine',
        glyph: '⌫',
        label: 'Erase',
        row: 3,
        col: 1,
        className: 'delete',
        when: e => e.cursorIsTile,
    },
]

// SELECT d-pad: nudge the *held selection* in place (moves the real entities,
// preserving wiring — #21 polish). Pure 4-arrow d-pad (empty centre); finishing
// is the Cancel in the action row below. In-place nudge is entity-only (tiles
// have no group-move path), so the arrows hide for a tile selection — Copy /
// Cut / Delete in the action row are the tile operations.
const nudgeable = (e: Editor): boolean => e.marqueeCount > 0
const SELECT_DPAD: ToolbarButton[] = [
    {
        action: 'nudgeSelUp',
        glyph: '▲',
        label: 'Up',
        row: 1,
        col: 2,
        when: nudgeable,
        keyAction: 'moveEntityUp',
    },
    {
        action: 'nudgeSelLeft',
        glyph: '◀',
        label: 'Left',
        row: 2,
        col: 1,
        when: nudgeable,
        keyAction: 'moveEntityLeft',
    },
    {
        action: 'nudgeSelRight',
        glyph: '▶',
        label: 'Right',
        row: 2,
        col: 3,
        when: nudgeable,
        keyAction: 'moveEntityRight',
    },
    {
        action: 'nudgeSelDown',
        glyph: '▼',
        label: 'Down',
        row: 3,
        col: 2,
        when: nudgeable,
        keyAction: 'moveEntityDown',
    },
]

// SELECT action row: what to do with the held selection. Copy → paste ghost
// (originals stay); Cut → ghost + remove originals; Delete → remove; Rotate →
// turn a *single* selected entity in place (group rotation about a pivot is
// still #52, so it gates itself off for a multi-entity box); Cancel → drop the
// selection (any in-place nudges already applied persist). Nudging in place via
// the d-pad is the wire-preserving alternative to cut/paste.
//
// `keyAction` names the keybind each button mirrors (#101 Slice 3): the SELECT
// cluster is shown to mouse users too now, and a floating toolbar that also
// teaches the shortcut is how the on-screen driver and the keyboard driver stay
// one feature rather than two.
const SELECT_ACTIONS: ToolbarButton[] = [
    { action: 'copyMarquee', glyph: '⧉', label: 'Copy', keyAction: 'copySelection' },
    { action: 'cutMarquee', glyph: '✂', label: 'Cut', keyAction: 'cutSelection' },
    {
        action: 'deleteMarquee',
        glyph: '🗑',
        label: 'Delete',
        className: 'delete',
        keyAction: 'deleteSelection',
    },
    // Rotate is in the rail as well, but the rail is touch-only until Slice 4 —
    // on a fine pointer this row is the *only* on-screen way to turn a selected
    // entity, so it belongs to the cluster the design table puts it in.
    {
        action: 'rotate',
        glyph: '↻',
        label: 'Rotate',
        when: e => e.marqueeCount === 1,
        keyAction: 'rotate',
    },
    {
        action: 'cancelMarquee',
        glyph: '✕',
        label: 'Cancel',
        className: 'cancel',
        keyAction: 'closeWindow',
    },
]

// EDIT bar: shown when a single entity is selected (EDIT). Select → promote it to
// a one-entity held selection (so the SELECT nudge applies); Edit → open its
// editor (same as a second tap).
const EDIT_ACTIONS: ToolbarButton[] = [
    { action: 'selectHovered', glyph: '▦', label: 'Select' },
    { action: 'editHovered', glyph: '✎', label: 'Edit', className: 'confirm' },
]

const BTN = 44 // button square (px); flush, no gap — see index.styl
const MARGIN = 2 // sliver between the rail and the canvas
/** Breathing room between the held selection and the toolbar anchored to it. */
const ANCHOR_GAP = 8
/** Keep the anchored toolbar this far inside the viewport when clamping. */
const ANCHOR_EDGE = 8

/**
 * Registry key codes → what a person calls that key. The registry stores
 * `KeyboardEvent.code` (`KeyC`, `ArrowUp`) joined with its modifiers
 * (`Control+KeyC`); a badge wants `Ctrl+C`. Anything not listed falls through
 * the `Key`/`Digit` prefix strip, which covers every letter and digit.
 */
const KEY_LABELS: Record<string, string> = {
    Control: 'Ctrl',
    Escape: 'Esc',
    Delete: 'Del',
    Backspace: '⌫',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    BracketLeft: '[',
    BracketRight: ']',
    ClickL: 'LMB',
    ClickM: 'MMB',
    ClickR: 'RMB',
}

/** `"Control+KeyC"` → `"Ctrl+C"`. */
function formatKeyCombo(combo: string): string {
    return combo
        .split('+')
        .map(part => KEY_LABELS[part] ?? part.replace(/^(?:Key|Digit)/, ''))
        .join('+')
}

/**
 * Snapshot of every action's current keybind, formatted for a badge. Read from
 * the registry rather than hard-coded, so a rebind in Settings' Keybinds folder
 * shows up on the buttons; rebuilt on each refresh (a few dozen actions).
 */
function keyComboMap(): Map<string, string> {
    const map = new Map<string, string>()
    EDITOR.forEachAction(action => map.set(action.name, formatKeyCombo(action.keyCombo)))
    return map
}

/** A cursor mode the user needs an explicit way out of (no keyboard on touch). */
function isCancelableMode(mode: EditorMode): boolean {
    return mode === EditorMode.PAINT || mode === EditorMode.SELECT
}

/**
 * @param handlers Optional overrides keyed by action name, for buttons that
 *   aren't plain registry actions (e.g. clipboard copy, which is a `document`
 *   copy listener). If a button's action has a handler it's called instead of
 *   `EDITOR.callAction`.
 */
export function initActionToolbar(editor: Editor, handlers: Record<string, () => void> = {}): void {
    // Built-in handlers for buttons backed by Editor methods rather than the
    // keybind registry. Caller overrides win.
    handlers = {
        'copper-wire': () => editor.togglePaintItem('copper-wire'),
        'red-wire': () => editor.togglePaintItem('red-wire'),
        'green-wire': () => editor.togglePaintItem('green-wire'),
        marquee: () => editor.armMarquee(),
        marqueeTiles: () => editor.armMarquee(true),
        copyMarquee: () => editor.copyMarquee(),
        cutMarquee: () => editor.cutMarquee(),
        deleteMarquee: () => editor.deleteMarquee(),
        cancelMarquee: () => editor.cancelMarquee(),
        nudgeSelUp: () => editor.nudgeSelection({ x: 0, y: -1 }),
        nudgeSelDown: () => editor.nudgeSelection({ x: 0, y: 1 }),
        nudgeSelLeft: () => editor.nudgeSelection({ x: -1, y: 0 }),
        nudgeSelRight: () => editor.nudgeSelection({ x: 1, y: 0 }),
        selectHovered: () => editor.selectHovered(),
        editHovered: () => editor.editHovered(),
        ...handlers,
    }
    const run = (action: string): void => {
        const handler = handlers[action]
        if (handler) handler()
        else EDITOR.callAction(action)
    }

    const rail = document.createElement('div')
    rail.id = 'action-toolbar'

    const primary = document.createElement('div')
    primary.className = 'rail-primary'

    const moreBtn = document.createElement('button')
    moreBtn.type = 'button'
    moreBtn.className = 'rail-more'
    moreBtn.title = 'More'
    moreBtn.textContent = '⋯'

    const overflow = document.createElement('div')
    overflow.className = 'rail-overflow'

    // moreBtn is placed into the grid as its last cell when overflowing.
    rail.append(primary, overflow)

    const closeOverflow = (): void => overflow.classList.remove('open')

    /** Build a button (glyph + optional label), wired to `run`. */
    const makeButton = (spec: ToolbarButton, withLabel: boolean): HTMLButtonElement => {
        const button = document.createElement('button')
        button.type = 'button'
        if (spec.className) button.classList.add(spec.className)
        button.title = spec.label
        button.setAttribute('aria-label', spec.label)
        if (spec.row) button.style.gridRow = String(spec.row)
        if (spec.col) button.style.gridColumn = String(spec.col)

        const glyph = document.createElement('span')
        glyph.className = 'glyph'
        glyph.textContent = spec.glyph
        // Marked for the pack-icon upgrade (packIcons.ts swaps the glyph for
        // the real game sprite once the sheet manifest loads).
        if (spec.icon) glyph.dataset.packIcon = spec.icon
        button.appendChild(glyph)
        if (withLabel) {
            const label = document.createElement('span')
            label.className = 'label'
            label.textContent = spec.label
            button.appendChild(label)
        }
        // Keybind badge, filled in by refreshHints(). Always in the DOM, shown by
        // CSS only where it earns its space: the floating SELECT toolbar on a
        // machine that has a keyboard (`body.keys`). In the bottom band — the
        // thumb-driven placement — it stays hidden, so touch layout is untouched.
        if (spec.keyAction) {
            const hint = document.createElement('span')
            hint.className = 'hint'
            button.appendChild(hint)
        }
        return button
    }

    // Rail buttons (rebuilt into primary/overflow by layout()). Closing the
    // overflow after a tap keeps the sheet from lingering.
    const buttons = BUTTONS.map(spec => {
        const button = makeButton(spec, true)
        button.addEventListener('click', () => {
            run(spec.action)
            closeOverflow()
        })
        return { spec, button }
    })
    const byAction = (name: string): HTMLButtonElement | undefined =>
        buttons.find(b => b.spec.action === name)?.button

    document.body.appendChild(rail)

    /**
     * Build a fixed bottom cluster element from specs (id drives its CSS).
     * Returns the element plus a `refresh` that re-evaluates each button's
     * `when` gate (e.g. the paint d-pad's tile-only Size/Erase corners) —
     * cheap, so updateContextual just runs it for every cluster on each mode
     * emit. Buttons place themselves via explicit `row`/`col`, so hiding a
     * gated one leaves the grid layout intact.
     */
    const makeCluster = (
        id: string,
        specs: ToolbarButton[],
        withLabel: boolean,
        parent: HTMLElement = document.body
    ): { el: HTMLElement; refresh: () => void; refreshHints: () => void } => {
        const el = document.createElement('div')
        el.id = id
        const entries = specs.map(spec => {
            const button = makeButton(spec, withLabel)
            button.addEventListener('click', () => run(spec.action))
            el.appendChild(button)
            return { spec, button }
        })
        parent.appendChild(el)
        const refresh = (): void => {
            for (const { spec, button } of entries) {
                button.classList.toggle('gated-off', !!spec.when && !spec.when(editor))
            }
        }
        // Stamp the current keybinds onto the buttons that mirror one: a visible
        // badge (CSS decides where it shows) plus `aria-keyshortcuts`, which says
        // the same thing to a screen reader and — unlike `title`, which e2e and
        // the pack-icon pass both key off — is nobody else's handle.
        const refreshHints = (): void => {
            const combos = keyComboMap()
            for (const { spec, button } of entries) {
                if (!spec.keyAction) continue
                const combo = combos.get(spec.keyAction) ?? ''
                const hint = button.querySelector('.hint')
                if (hint) hint.textContent = combo
                if (combo) button.setAttribute('aria-keyshortcuts', combo)
            }
        }
        return { el, refresh, refreshHints }
    }

    // The SELECT cluster's two parts (nudge d-pad + action row) live in one
    // wrapper so the *floating* placement has a single box to measure, position
    // and clamp. In the bottom-band placement the wrapper is `display: contents`
    // and the two elements stay viewport-fixed exactly where they always were —
    // same DOM ids, same CSS, so the touch specs are untouched (#101 Slice 3).
    const selectFloat = document.createElement('div')
    selectFloat.id = 'select-float'
    document.body.appendChild(selectFloat)

    // Contextual clusters, one editor mode at a time (see updateContextual).
    const paintDpad = makeCluster('paint-dpad', PAINT_DPAD, false)
    const selectDpad = makeCluster('select-dpad', SELECT_DPAD, false, selectFloat)
    const selectActions = makeCluster('select-actions', SELECT_ACTIONS, true, selectFloat)
    const editBar = makeCluster('edit-bar', EDIT_ACTIONS, true)
    const clusters = [paintDpad, selectDpad, selectActions, editBar]

    /**
     * Anchor the floating SELECT toolbar to the held selection: just below it,
     * left edges aligned, flipped above when the bottom of the viewport is in
     * the way and clamped so the whole thing stays on screen. Reads the
     * selection's screen box from the editor (`marqueeScreenBounds`), so it
     * tracks pan/zoom/nudge/drag without knowing anything about the world.
     * No-op in the bottom-band placement, where CSS does the positioning.
     */
    const positionSelectFloat = (): void => {
        if (!selectFloat.classList.contains('floating')) {
            selectFloat.style.left = ''
            selectFloat.style.top = ''
            return
        }
        const b = editor.marqueeScreenBounds
        if (!b) return
        const w = selectFloat.offsetWidth
        const h = selectFloat.offsetHeight
        const below = b.y + b.height + ANCHOR_GAP
        const above = b.y - h - ANCHOR_GAP
        let y = below
        if (below + h > window.innerHeight - ANCHOR_EDGE && above >= ANCHOR_EDGE) y = above
        const clamp = (v: number, max: number): number =>
            Math.min(Math.max(v, ANCHOR_EDGE), Math.max(ANCHOR_EDGE, max))
        selectFloat.style.left = `${Math.round(clamp(b.x, window.innerWidth - ANCHOR_EDGE - w))}px`
        selectFloat.style.top = `${Math.round(clamp(y, window.innerHeight - ANCHOR_EDGE - h))}px`
    }

    // The selection's screen box moves once per rendered frame while panning, so
    // coalesce the re-anchor into an animation frame: one measure per frame, not
    // one per event.
    let anchorFrame = 0
    const scheduleAnchor = (): void => {
        if (anchorFrame) return
        anchorFrame = requestAnimationFrame(() => {
            anchorFrame = 0
            positionSelectFloat()
        })
    }

    /**
     * Show the clusters that the *editor state* calls for, placed by the input
     * signals — never by a device mode (#101 Slice 3).
     *
     * `touchDriven` is what gates the two touch-only helpers. The rule the design
     * states is "`touchRecent` or no keyboard": a mouse user with a keyboard has
     * hover, the wheel and the arrow keys, so the on-screen d-pad only appears
     * once they actually touch the screen, and goes away on their next mouse
     * move. `coarse` is folded in as well because on touch-first hardware the
     * cluster is the *only* driver: pairing a Bluetooth keyboard (`keys`) or a
     * stray mouse event must not take the buttons away mid-gesture.
     */
    const updateContextual = (): void => {
        const { coarse, keys, touchRecent } = inputMode.signals
        const touchDriven = coarse || touchRecent || !keys
        const mode = editor.mode
        // Re-gate before showing: spawnPaintContainer re-emits PAINT on every
        // cursor swap, so an entity→tile switch lands here with the right cursor.
        for (const c of clusters) c.refresh()
        const selecting = mode === EditorMode.SELECT
        paintDpad.el.classList.toggle('visible', mode === EditorMode.PAINT && touchDriven)
        // The held selection is device-independent: whoever holds one gets the
        // controls for it. Only the *placement* differs — bottom band for a
        // thumb, anchored to the selection for a pointer.
        selectDpad.el.classList.toggle('visible', selecting)
        selectActions.el.classList.toggle('visible', selecting)
        editBar.el.classList.toggle('visible', mode === EditorMode.EDIT && touchDriven)
        selectFloat.classList.toggle('floating', selecting && !coarse)
        if (selecting) {
            selectDpad.refreshHints()
            selectActions.refreshHints()
        }
        positionSelectFloat()
    }

    moreBtn.addEventListener('click', () => overflow.classList.toggle('open'))
    // A tap outside the rail dismisses the overflow sheet.
    window.addEventListener('pointerdown', e => {
        if (overflow.classList.contains('open') && !rail.contains(e.target as Node)) closeOverflow()
    })

    // Lay out the rail: pick a column count by orientation, split buttons into
    // rail vs overflow, and reserve the matching left gutter on the canvas.
    const layout = (): void => {
        const mobile = inputMode.mode === 'mobile'
        rail.classList.toggle('visible', mobile)
        if (!mobile) {
            editor.setViewportInsets({ left: 0 })
            return
        }

        // Sit directly below the top-left logo + folded-in corner buttons.
        const stack = document.getElementById('buttons')
        const top = stack ? Math.round(stack.getBoundingClientRect().bottom) : 140

        // Only the buttons whose action is live in the current mode (and pass any
        // extra `when`). Priority order is preserved, so the survivors keep their
        // relative spots — the rail collapses rather than reshuffling (#33).
        const mode = editor.mode
        const live = buttons.filter(
            b =>
                (!b.spec.modes || b.spec.modes.includes(mode)) &&
                (!b.spec.when || b.spec.when(editor))
        )

        // Single-file in portrait — a second column cramps the Pixel-7-class
        // width too much (feedback on the lattice round); 3 columns in
        // landscape. The corner Github/Settings/Library block above is one
        // 3-wide row either way (index.styl), so the vertical cost of the
        // non-action chrome is a single row. As many priority buttons as fit
        // the height stay in the rail; the rest collapse into the ⋯ overflow
        // so nothing falls below the viewport. The ⋯ takes the last grid cell
        // when present.
        const columns = window.innerWidth > window.innerHeight ? 3 : 1
        const rows = Math.max(1, Math.floor((window.innerHeight - top - MARGIN) / BTN))
        const capacity = rows * columns

        // Parked buttons go straight to the overflow; the rest compete for
        // rail cells in priority order. Whenever *anything* overflows, the ⋯
        // needs a grid cell of its own.
        const railCandidates = live.filter(b => !b.spec.parked)
        const parked = live.filter(b => b.spec.parked)
        const overflowNeeded = parked.length > 0 || railCandidates.length > capacity
        const inRail = overflowNeeded
            ? Math.min(railCandidates.length, capacity - 1)
            : railCandidates.length

        primary.style.gridTemplateColumns = `repeat(${columns}, ${BTN}px)`
        primary.replaceChildren(...railCandidates.slice(0, inRail).map(b => b.button))
        if (overflowNeeded) {
            primary.appendChild(moreBtn)
            overflow.replaceChildren(
                ...[...railCandidates.slice(inRail), ...parked].map(b => b.button)
            )
        } else {
            overflow.replaceChildren()
            closeOverflow()
        }

        const railWidth = columns * BTN + MARGIN
        rail.style.top = `${top}px`
        rail.style.width = `${railWidth}px`
        overflow.style.left = `${railWidth}px`
        overflow.style.top = `${top}px`
        editor.setViewportInsets({ left: railWidth })
    }

    // On a mode change: re-filter the rail to the now-live actions, refresh the
    // contextual bottom clusters, and emphasize the cancel/delete buttons.
    const applyMode = (mode: EditorMode): void => {
        byAction('mine')?.classList.toggle('active', mode === EditorMode.EDIT)
        byAction('closeWindow')?.classList.toggle('active', isCancelableMode(mode))
        layout()
        updateContextual()
    }
    applyMode(editor.mode)
    editor.onModeChange(applyMode)
    // The Select button's `when` depends on the blueprint being non-empty, so
    // re-filter when entities are added/removed (across blueprint loads).
    editor.onBlueprintChange(layout)

    layout()
    updateContextual()
    window.addEventListener('resize', layout)
    window.addEventListener('resize', scheduleAnchor)
    inputMode.on('change', layout)
    // Every signal flip re-decides the clusters — `touchRecent` in particular
    // fires on each pointer event whose kind changed, which is exactly the
    // "appears the moment they touch the screen, hides on the next mouse move"
    // behaviour the PAINT d-pad and the EDIT bar are supposed to have.
    inputMode.on('signals', updateContextual)
    // Keep the anchored toolbar glued to the selection as it is nudged, dragged,
    // rotated, or panned/zoomed under.
    editor.onSelectionChange(scheduleAnchor)
    // The top-left stack's height changes (mobile collapses it to square icons,
    // icons load async); re-anchor when it actually resizes, like settingsPane.
    const stack = document.getElementById('buttons')
    if (stack && 'ResizeObserver' in window) new ResizeObserver(layout).observe(stack)
}
