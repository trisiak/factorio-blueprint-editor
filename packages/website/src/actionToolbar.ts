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
}

// Priority order: the buttons that fit stay in the rail; the rest spill into the
// ⋯ overflow. Cancel / Items / Rotate / Delete lead (final order TBD). The paint
// ghost's nudge arrows + Place live in a separate bottom d-pad (DPAD), not here.
const BUTTONS: ToolbarButton[] = [
    { action: 'inventory', glyph: '⊞', label: 'Items' },
    { action: 'rotate', glyph: '↻', label: 'Rotate' },
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

// The paint d-pad: a fixed bottom-center cluster shown only while holding a
// paint ghost (PAINT mode). The nudge arrows dial the ghost in a tile at a time
// and **Place** (green, centered like a gamepad's confirm) commits it — both
// only do anything in PAINT, so they only appear then, clear of the rail's ⋯
// overflow. The now-retired quickbar freed this bottom band. `row`/`col` place
// each button in the 3×3 grid explicitly (no named areas — they're brittle
// through the Stylus pipeline).
interface DpadButton extends ToolbarButton {
    row: number
    col: number
}
const DPAD: DpadButton[] = [
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

    // The bottom paint d-pad (nudge arrows + Place), built once. Shown only in
    // PAINT mode on mobile (see updateDpad). Glyph-only — the arrows + check are
    // self-evident — but keep `title` for a11y and e2e.
    const dpad = document.createElement('div')
    dpad.id = 'paint-dpad'
    for (const spec of DPAD) {
        const button = document.createElement('button')
        button.type = 'button'
        button.style.gridRow = String(spec.row)
        button.style.gridColumn = String(spec.col)
        if (spec.className) button.classList.add(spec.className)
        button.title = spec.label
        button.setAttribute('aria-label', spec.label)
        const glyph = document.createElement('span')
        glyph.className = 'glyph'
        glyph.textContent = spec.glyph
        button.appendChild(glyph)
        button.addEventListener('click', () => EDITOR.callAction(spec.action))
        dpad.appendChild(button)
    }
    document.body.appendChild(dpad)

    // The d-pad earns screen space only while there's a ghost to steer.
    const updateDpad = (): void => {
        dpad.classList.toggle(
            'visible',
            inputMode.mode === 'mobile' && editor.mode === EditorMode.PAINT
        )
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

        // As many priority buttons as fit the height (×3 columns in landscape);
        // the rest collapse into the ⋯ overflow so nothing falls below the
        // viewport. The ⋯ takes the last grid cell when present.
        const columns = window.innerWidth > window.innerHeight ? 3 : 1
        const rows = Math.max(1, Math.floor((window.innerHeight - top - MARGIN) / BTN))
        const capacity = rows * columns
        const overflowNeeded = buttons.length > capacity
        const inRail = overflowNeeded ? capacity - 1 : buttons.length

        primary.style.gridTemplateColumns = `repeat(${columns}, ${BTN}px)`
        primary.replaceChildren(...buttons.slice(0, inRail).map(b => b.button))
        if (overflowNeeded) {
            primary.appendChild(moreBtn)
            overflow.replaceChildren(...buttons.slice(inRail).map(b => b.button))
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

    // Emphasize Delete/Cancel only while meaningful: Delete in EDIT, Cancel
    // whenever there's a cursor to drop. (Place lives in the d-pad, which only
    // shows in PAINT, so it needs no per-mode emphasis.) Then refresh the d-pad.
    const applyMode = (mode: EditorMode): void => {
        byAction('mine')?.classList.toggle('active', mode === EditorMode.EDIT)
        byAction('closeWindow')?.classList.toggle('active', isCancelableMode(mode))
        updateDpad()
    }
    applyMode(editor.mode)
    editor.onModeChange(applyMode)

    layout()
    updateDpad()
    window.addEventListener('resize', layout)
    inputMode.on('change', layout)
    inputMode.on('change', updateDpad)
    // The top-left stack's height changes (mobile collapses it to square icons,
    // icons load async); re-anchor when it actually resizes, like settingsPane.
    const stack = document.getElementById('buttons')
    if (stack && 'ResizeObserver' in window) new ResizeObserver(layout).observe(stack)
}
