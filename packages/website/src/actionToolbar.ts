import EDITOR, { Editor, EditorMode, inputMode } from '@fbe/editor'
import { formatKeyCombo } from './keyCombo'

// On-screen action rail: a DOM (not Pixi) mirror of the editor's action
// registry — the one left column every layout gets (#101 Slice 4). It carries
// the logo + corner buttons (Github / Settings / Library, folded in by CSS) and
// below them the live actions: rotate / flip / undo / the inventory / the wire
// toggles and, crucially on touch, an explicit way to *exit paint mode*.
//
// Layout is a left **gutter** (the "layout authority" for the left edge): the
// rail claims a reserved left inset on the canvas (`editor.setViewportInsets`)
// so the Pixi UI reflows out of it instead of being covered. It's *dynamic* —
// as many priority-ordered buttons as fit the available height stay in the rail;
// the rest collapse behind a ⋯ button that opens an overflow sheet over the
// canvas.
//
// It is sized by the input *signals*, never by a device switch (#101 §2):
//
//   `coarse`  → 44 px touch cells with captions; otherwise a slim 34 px strip
//   `keys`    → a keybind badge on every button whose action is in the registry,
//               so a mouse+keyboard user learns the shortcut instead of being
//               told to click (the rail is a discovery surface for them, not a
//               replacement input)
//   `compact` → the height that's left decides how much overflows behind the ⋯
//
// It used to be mobile-only, which left desktop with the old top-left clutter
// and no on-screen mirror of the registry at all.
//
// Below the rail, **contextual** clusters appear in the freed bottom band, one
// per mode: a PAINT d-pad (nudge + Place), SELECT controls (nudge a held
// selection in place + Copy/Cut/Delete/Done), and an EDIT bar (Select / Edit).
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
        modes: [EM.PAINT, EM.COPY, EM.DELETE, EM.SELECT],
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
    { action: 'nudgeSelUp', glyph: '▲', label: 'Up', row: 1, col: 2, when: nudgeable },
    { action: 'nudgeSelLeft', glyph: '◀', label: 'Left', row: 2, col: 1, when: nudgeable },
    { action: 'nudgeSelRight', glyph: '▶', label: 'Right', row: 2, col: 3, when: nudgeable },
    { action: 'nudgeSelDown', glyph: '▼', label: 'Down', row: 3, col: 2, when: nudgeable },
]

// SELECT action row: what to do with the held selection. Copy → paste ghost
// (originals stay); Cut → ghost + remove originals; Delete → remove; Cancel →
// drop the selection (any in-place nudges already applied persist). Nudging in
// place via the d-pad is the wire-preserving alternative to cut/paste.
const SELECT_ACTIONS: ToolbarButton[] = [
    { action: 'copyMarquee', glyph: '⧉', label: 'Copy' },
    { action: 'cutMarquee', glyph: '✂', label: 'Cut' },
    { action: 'deleteMarquee', glyph: '🗑', label: 'Delete', className: 'delete' },
    { action: 'cancelMarquee', glyph: '✕', label: 'Cancel', className: 'cancel' },
]

// EDIT bar: shown when a single entity is selected (EDIT). Select → promote it to
// a one-entity held selection (so the SELECT nudge applies); Edit → open its
// editor (same as a second tap).
const EDIT_ACTIONS: ToolbarButton[] = [
    { action: 'selectHovered', glyph: '▦', label: 'Select' },
    { action: 'editHovered', glyph: '✎', label: 'Edit', className: 'confirm' },
]

// Cell square (px), flush with no gap — see index.styl. Touch needs a 44 px
// target; a mouse doesn't, and a slim strip keeps the desktop gutter cheap.
const COARSE_CELL = 44
const FINE_CELL = 34
const MARGIN = 2 // sliver between the rail and the canvas
/** Widest the rail may grow, in cells — beyond this the ⋯ overflow takes over. */
const MAX_COLUMNS = 3

/** A cursor mode the user needs an explicit way out of (no keyboard on touch). */
function isCancelableMode(mode: EditorMode): boolean {
    return (
        mode === EditorMode.PAINT ||
        mode === EditorMode.COPY ||
        mode === EditorMode.DELETE ||
        mode === EditorMode.SELECT
    )
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

    /**
     * Build a button (glyph, caption, keybind badge), wired to `run`.
     *
     * `title` stays exactly the action's label in every layout — it is the
     * stable handle the e2e suite locates buttons by, so the keybind rides
     * along in `aria-keyshortcuts` (the raw registry combo, e.g.
     * `Control+KeyZ`) and in a `.hint` badge (the pretty form, `⌃Z` — see
     * `keyCombo.ts`). CSS shows the badge only while the rail carries
     * `.with-hints`, i.e. only when a keyboard is present: a badge reading "R"
     * is noise on a device that can't press R.
     */
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
        const hint = document.createElement('span')
        hint.className = 'hint'
        button.appendChild(hint)
        return button
    }

    /**
     * Refresh the keybind badges from the registry. Read live rather than
     * cached: keybinds are user-editable in the settings pane's Keybinds folder,
     * and this runs on every layout pass (which a settings-driven reflow
     * triggers anyway), so a rebind shows up without a reload. Buttons whose
     * action isn't a registry action — the wire toggles, the marquee/selection
     * handlers — simply have no combo and keep an empty badge.
     */
    const refreshHints = (targets: { spec: ToolbarButton; button: HTMLButtonElement }[]): void => {
        const combos = new Map<string, string>()
        EDITOR.forEachAction(action => combos.set(action.name, action.keyCombo))
        for (const { spec, button } of targets) {
            const combo = combos.get(spec.action)
            const hint = button.querySelector('.hint')
            if (hint) hint.textContent = combo ? formatKeyCombo(combo) : ''
            if (combo) button.setAttribute('aria-keyshortcuts', combo)
            else button.removeAttribute('aria-keyshortcuts')
        }
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
        withLabel: boolean
    ): { el: HTMLElement; refresh: () => void } => {
        const el = document.createElement('div')
        el.id = id
        const entries = specs.map(spec => {
            const button = makeButton(spec, withLabel)
            button.addEventListener('click', () => run(spec.action))
            el.appendChild(button)
            return { spec, button }
        })
        document.body.appendChild(el)
        const refresh = (): void => {
            for (const { spec, button } of entries) {
                button.classList.toggle('gated-off', !!spec.when && !spec.when(editor))
            }
        }
        return { el, refresh }
    }

    // Contextual bottom clusters, one shown at a time by mode (see updateContextual).
    const paintDpad = makeCluster('paint-dpad', PAINT_DPAD, false)
    const selectDpad = makeCluster('select-dpad', SELECT_DPAD, false)
    const selectActions = makeCluster('select-actions', SELECT_ACTIONS, true)
    const editBar = makeCluster('edit-bar', EDIT_ACTIONS, true)
    const clusters = [paintDpad, selectDpad, selectActions, editBar]

    const updateContextual = (): void => {
        const mobile = inputMode.mode === 'mobile'
        const mode = editor.mode
        // Re-gate before showing: spawnPaintContainer re-emits PAINT on every
        // cursor swap, so an entity→tile switch lands here with the right cursor.
        for (const c of clusters) c.refresh()
        paintDpad.el.classList.toggle('visible', mobile && mode === EditorMode.PAINT)
        selectDpad.el.classList.toggle('visible', mobile && mode === EditorMode.SELECT)
        selectActions.el.classList.toggle('visible', mobile && mode === EditorMode.SELECT)
        editBar.el.classList.toggle('visible', mobile && mode === EditorMode.EDIT)
    }

    moreBtn.addEventListener('click', () => overflow.classList.toggle('open'))
    // A tap outside the rail dismisses the overflow sheet.
    window.addEventListener('pointerdown', e => {
        if (overflow.classList.contains('open') && !rail.contains(e.target as Node)) closeOverflow()
    })

    // Lay out the rail: size the cells from the signals, pick a column count,
    // split buttons into rail vs overflow, and reserve the matching left gutter
    // on the canvas. Runs for every layout since #101 Slice 4 — the rail is the
    // one left column, not a touch-only affordance.
    const layout = (): void => {
        const { coarse, keys, compact } = inputMode.signals
        rail.classList.add('visible')
        // 44 px touch cells with captions vs a slim icon strip. The cell size is
        // published as a custom property on <html> because the folded corner
        // buttons (#buttons, styled in index.styl) have to match the column
        // width exactly — the rail and the chrome above it are one column.
        const cell = coarse ? COARSE_CELL : FINE_CELL
        document.documentElement.style.setProperty('--rail-cell', `${cell}px`)
        rail.classList.toggle('slim', !coarse)
        rail.classList.toggle('with-hints', keys)

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

        // Parked buttons go straight to the overflow; the rest compete for
        // rail cells in priority order. Whenever *anything* overflows, the ⋯
        // needs a grid cell of its own. (Management actions stay parked in
        // every layout: a keyboard reaches them by their own keybinds, so
        // spending everyday rail cells on them would only make the column
        // taller for both drivers.)
        const railCandidates = live.filter(b => !b.spec.parked)
        const parked = live.filter(b => b.spec.parked)

        // How many rows fit under the chrome, and how wide the column has to be
        // to hold the live buttons in them.
        //
        // A `compact` viewport is never worth a second column — width is the
        // scarce axis there, and the ⋯ overflow is the pressure valve. Otherwise
        // coarse keeps the touch rule the feedback rounds settled on: single-file
        // in portrait (a second 44 px column cramps a Pixel-7-class width), 3
        // wide in landscape, where height is scarce instead. On a fine pointer
        // the strip is slim, so it starts single-file and only widens when the
        // live buttons genuinely don't fit the height — the column stays a
        // sliver on a roomy window and never eats desktop canvas for nothing.
        // Whatever still doesn't fit collapses into the ⋯ overflow so nothing
        // falls below the viewport; the ⋯ takes the last grid cell.
        const rows = Math.max(1, Math.floor((window.innerHeight - top - MARGIN) / cell))
        const columns = compact
            ? 1
            : coarse
              ? window.innerWidth > window.innerHeight
                  ? 3
                  : 1
              : Math.min(MAX_COLUMNS, Math.max(1, Math.ceil((railCandidates.length + 1) / rows)))
        const capacity = rows * columns

        const overflowNeeded = parked.length > 0 || railCandidates.length > capacity
        const inRail = overflowNeeded
            ? Math.min(railCandidates.length, capacity - 1)
            : railCandidates.length

        primary.style.gridTemplateColumns = `repeat(${columns}, ${cell}px)`
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

        refreshHints(buttons)

        const railWidth = columns * cell + MARGIN
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
    // The rail re-lays out on any *signal* change now (`coarse` resizes the
    // cells, `keys` adds the badges, `compact` changes what still fits), not
    // just on the derived mode flip the contextual clusters still key off.
    inputMode.on('signals', layout)
    inputMode.on('change', updateContextual)
    // The top-left stack's height changes (mobile collapses it to square icons,
    // icons load async); re-anchor when it actually resizes, like settingsPane.
    const stack = document.getElementById('buttons')
    if (stack && 'ResizeObserver' in window) new ResizeObserver(layout).observe(stack)
}
