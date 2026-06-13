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
// Buttons invoke actions by name through `EDITOR.callAction`, staying in lockstep
// with the keybind registry instead of duplicating its logic.

interface ToolbarButton {
    /** Action registry name passed to `EDITOR.callAction`. */
    action: string
    /** Unicode glyph shown large. */
    glyph: string
    /** Short caption (also the button `title`, which e2e locates by). */
    label: string
    /** Extra class (cancel/confirm/delete get emphasized in the relevant modes). */
    className?: string
    /**
     * Editor modes the button is shown in (default: all). Mode-specific controls
     * (e.g. the paint-ghost nudges) only earn rail space while they're usable.
     */
    modes?: EditorMode[]
}

// Priority order: the buttons that fit stay in the rail; the rest spill into the
// ⋯ overflow. Cancel / Items / Place / Rotate / Delete lead (final order TBD).
const BUTTONS: ToolbarButton[] = [
    { action: 'inventory', glyph: '⊞', label: 'Items' },
    { action: 'rotate', glyph: '↻', label: 'Rotate' },
    { action: 'confirmPlacement', glyph: '✓', label: 'Place', className: 'confirm' },
    // Fine-tune nudges for a held paint ghost — the touch way to position a big
    // paste precisely (drag gets close, arrows dial it in). PAINT-only so they
    // don't waste rail space the rest of the time (see issue #30).
    { action: 'moveEntityUp', glyph: '▲', label: 'Up', modes: [EditorMode.PAINT] },
    { action: 'moveEntityLeft', glyph: '◀', label: 'Left', modes: [EditorMode.PAINT] },
    { action: 'moveEntityRight', glyph: '▶', label: 'Right', modes: [EditorMode.PAINT] },
    { action: 'moveEntityDown', glyph: '▼', label: 'Down', modes: [EditorMode.PAINT] },
    { action: 'closeWindow', glyph: '✕', label: 'Cancel', className: 'cancel' },
    { action: 'mine', glyph: '🗑', label: 'Delete', className: 'delete' },
    { action: 'pipette', glyph: '⊙', label: 'Pick' },
    { action: 'undo', glyph: '↶', label: 'Undo' },
    { action: 'redo', glyph: '↷', label: 'Redo' },
    { action: 'focus', glyph: '⌖', label: 'Center' },
    { action: 'flipHorizontal', glyph: '⇄', label: 'Flip H' },
    { action: 'flipVertical', glyph: '⇅', label: 'Flip V' },
    { action: 'copyEntitySettings', glyph: '⧉', label: 'Copy cfg' },
    { action: 'pasteEntitySettings', glyph: '⊟', label: 'Paste cfg' },
    // Blueprint-level / management actions — keyboard-only otherwise, so unreachable
    // on touch (see issue #26). Low priority → live in the ⋯ overflow.
    { action: 'copyBlueprint', glyph: '📋', label: 'Copy BP' },
    { action: 'appendBlueprint', glyph: '📥', label: 'Paste BP' },
    { action: 'takePicture', glyph: '📷', label: 'Export' },
    { action: 'clear', glyph: '🆕', label: 'New' },
]

const BTN = 44 // button square (px); flush, no gap — see index.styl
const MARGIN = 2 // sliver between the rail and the canvas

/** A cursor mode the user needs an explicit way out of (no keyboard on touch). */
function isCancelableMode(mode: EditorMode): boolean {
    return mode === EditorMode.PAINT || mode === EditorMode.COPY || mode === EditorMode.DELETE
}

/**
 * @param handlers Optional overrides keyed by action name, for buttons that
 *   aren't plain registry actions (e.g. clipboard copy, which is a `document`
 *   copy listener). If a button's action has a handler it's called instead of
 *   `EDITOR.callAction`.
 */
export function initActionToolbar(editor: Editor, handlers: Record<string, () => void> = {}): void {
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

    // Build each button once; layout() re-parents them between primary/overflow.
    const buttons = BUTTONS.map(spec => {
        const button = document.createElement('button')
        button.type = 'button'
        if (spec.className) button.classList.add(spec.className)
        button.title = spec.label

        const glyph = document.createElement('span')
        glyph.className = 'glyph'
        glyph.textContent = spec.glyph
        button.appendChild(glyph)

        const label = document.createElement('span')
        label.className = 'label'
        label.textContent = spec.label
        button.appendChild(label)

        button.addEventListener('click', () => {
            const handler = handlers[spec.action]
            if (handler) handler()
            else EDITOR.callAction(spec.action)
            closeOverflow()
        })
        return { spec, button }
    })

    const byAction = (name: string): HTMLButtonElement | undefined =>
        buttons.find(b => b.spec.action === name)?.button

    document.body.appendChild(rail)

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

        // Mode-specific buttons (the paint nudges) only take rail space while
        // they're usable — everything else shows in every mode.
        const visible = buttons.filter(b => !b.spec.modes || b.spec.modes.includes(editor.mode))

        // As many priority buttons as fit the height (×3 columns in landscape);
        // the rest collapse into the ⋯ overflow so nothing falls below the
        // viewport. The ⋯ takes the last grid cell when present.
        const columns = window.innerWidth > window.innerHeight ? 3 : 1
        const rows = Math.max(1, Math.floor((window.innerHeight - top - MARGIN) / BTN))
        const capacity = rows * columns
        const overflowNeeded = visible.length > capacity
        const inRail = overflowNeeded ? capacity - 1 : visible.length

        primary.style.gridTemplateColumns = `repeat(${columns}, ${BTN}px)`
        primary.replaceChildren(...visible.slice(0, inRail).map(b => b.button))
        if (overflowNeeded) {
            primary.appendChild(moreBtn)
            overflow.replaceChildren(...visible.slice(inRail).map(b => b.button))
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

    // Emphasize Place/Cancel/Delete only while meaningful: Place when holding,
    // Delete in EDIT, Cancel whenever there's a cursor to drop.
    const applyMode = (mode: EditorMode): void => {
        byAction('confirmPlacement')?.classList.toggle('active', mode === EditorMode.PAINT)
        byAction('mine')?.classList.toggle('active', mode === EditorMode.EDIT)
        byAction('closeWindow')?.classList.toggle('active', isCancelableMode(mode))
        // The nudge buttons appear/disappear with PAINT mode, so re-flow the rail.
        layout()
    }
    applyMode(editor.mode)
    editor.onModeChange(applyMode)

    layout()
    window.addEventListener('resize', layout)
    inputMode.on('change', layout)
    // The top-left stack's height changes (mobile collapses it to square icons,
    // icons load async); re-anchor when it actually resizes, like settingsPane.
    const stack = document.getElementById('buttons')
    if (stack && 'ResizeObserver' in window) new ResizeObserver(layout).observe(stack)
}
