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
    // Touch marquee (#21): arm a box-select. Only when idle/inspecting and there's
    // something to select; the drag + held-selection controls live in SELECT_*.
    {
        action: 'marquee',
        glyph: '▦',
        label: 'Select',
        modes: [EM.NONE, EM.EDIT],
        when: e => !e.blueprintEmpty,
    },
    // Cursor actions — only where they do something. Rotate works on a held
    // ghost, an edited entity, and a *single*-entity selection (group rotation
    // isn't supported yet — #52); flip works on a held ghost (single entity or
    // pasted blueprint), a placed entity in EDIT, and a single-entity selection
    // — `cursorCanFlip` resolves the right target per mode (#55).
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
        modes: [EM.PAINT, EM.EDIT, EM.SELECT],
        when: e => e.cursorCanFlip,
    },
    {
        action: 'flipVertical',
        glyph: '⇅',
        label: 'Flip V',
        modes: [EM.PAINT, EM.EDIT, EM.SELECT],
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
    // Blueprint-level / management actions — global; keyboard-only otherwise, so
    // unreachable on touch (see issue #26). Low priority → live in the ⋯ overflow.
    { action: 'copyBlueprint', glyph: '📋', label: 'Copy BP' },
    { action: 'appendBlueprint', glyph: '📥', label: 'Paste BP' },
    { action: 'takePicture', glyph: '📷', label: 'Export' },
    { action: 'clear', glyph: '🆕', label: 'New' },
]

// PAINT d-pad: nudge arrows + green Place (gamepad layout), shown while holding a
// paint ghost. `row`/`col` place each in the 3×3 grid explicitly (named grid
// areas are brittle through the Stylus pipeline).
const PAINT_DPAD: ToolbarButton[] = [
    { action: 'moveEntityUp', glyph: '▲', label: 'Up', row: 1, col: 2 },
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
]

// SELECT d-pad: nudge the *held selection* in place (moves the real entities,
// preserving wiring — #21 polish). Pure 4-arrow d-pad (empty centre); finishing
// is the Cancel in the action row below.
const SELECT_DPAD: ToolbarButton[] = [
    { action: 'nudgeSelUp', glyph: '▲', label: 'Up', row: 1, col: 2 },
    { action: 'nudgeSelLeft', glyph: '◀', label: 'Left', row: 2, col: 1 },
    { action: 'nudgeSelRight', glyph: '▶', label: 'Right', row: 2, col: 3 },
    { action: 'nudgeSelDown', glyph: '▼', label: 'Down', row: 3, col: 2 },
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

const BTN = 44 // button square (px); flush, no gap — see index.styl
const MARGIN = 2 // sliver between the rail and the canvas

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
        marquee: () => editor.armMarquee(),
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
        button.appendChild(glyph)
        if (withLabel) {
            const label = document.createElement('span')
            label.className = 'label'
            label.textContent = spec.label
            button.appendChild(label)
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

    /** Build a fixed bottom cluster element from specs (id drives its CSS). */
    const makeCluster = (id: string, specs: ToolbarButton[], withLabel: boolean): HTMLElement => {
        const el = document.createElement('div')
        el.id = id
        for (const spec of specs) {
            const button = makeButton(spec, withLabel)
            button.addEventListener('click', () => run(spec.action))
            el.appendChild(button)
        }
        document.body.appendChild(el)
        return el
    }

    // Contextual bottom clusters, one shown at a time by mode (see updateContextual).
    const paintDpad = makeCluster('paint-dpad', PAINT_DPAD, false)
    const selectDpad = makeCluster('select-dpad', SELECT_DPAD, false)
    const selectActions = makeCluster('select-actions', SELECT_ACTIONS, true)
    const editBar = makeCluster('edit-bar', EDIT_ACTIONS, true)

    const updateContextual = (): void => {
        const mobile = inputMode.mode === 'mobile'
        const mode = editor.mode
        paintDpad.classList.toggle('visible', mobile && mode === EditorMode.PAINT)
        selectDpad.classList.toggle('visible', mobile && mode === EditorMode.SELECT)
        selectActions.classList.toggle('visible', mobile && mode === EditorMode.SELECT)
        editBar.classList.toggle('visible', mobile && mode === EditorMode.EDIT)
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

        // As many priority buttons as fit the height (×3 columns in landscape);
        // the rest collapse into the ⋯ overflow so nothing falls below the
        // viewport. The ⋯ takes the last grid cell when present.
        const columns = window.innerWidth > window.innerHeight ? 3 : 1
        const rows = Math.max(1, Math.floor((window.innerHeight - top - MARGIN) / BTN))
        const capacity = rows * columns
        const overflowNeeded = live.length > capacity
        const inRail = overflowNeeded ? capacity - 1 : live.length

        primary.style.gridTemplateColumns = `repeat(${columns}, ${BTN}px)`
        primary.replaceChildren(...live.slice(0, inRail).map(b => b.button))
        if (overflowNeeded) {
            primary.appendChild(moreBtn)
            overflow.replaceChildren(...live.slice(inRail).map(b => b.button))
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
    inputMode.on('change', layout)
    inputMode.on('change', updateContextual)
    // The top-left stack's height changes (mobile collapses it to square icons,
    // icons load async); re-anchor when it actually resizes, like settingsPane.
    const stack = document.getElementById('buttons')
    if (stack && 'ResizeObserver' in window) new ResizeObserver(layout).observe(stack)
}
