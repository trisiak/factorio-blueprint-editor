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
// ⋯ overflow. Cancel / Items / Place / Rotate / Delete lead (final order TBD).
const BUTTONS: ToolbarButton[] = [
    { action: 'inventory', glyph: '⊞', label: 'Items' },
    { action: 'rotate', glyph: '↻', label: 'Rotate' },
    { action: 'confirmPlacement', glyph: '✓', label: 'Place', className: 'confirm' },
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
]

const SLOT = 50 // px per button cell incl. gap
const GAP = 6

/** A cursor mode the user needs an explicit way out of (no keyboard on touch). */
function isCancelableMode(mode: EditorMode): boolean {
    return mode === EditorMode.PAINT || mode === EditorMode.COPY || mode === EditorMode.DELETE
}

export function initActionToolbar(editor: Editor): void {
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

    rail.append(primary, moreBtn, overflow)

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
            EDITOR.callAction(spec.action)
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

    // Lay out the rail: pick a column count by orientation, compute how many cells
    // fit the available height, split buttons into rail vs overflow, and reserve
    // the matching left gutter on the canvas.
    const layout = (): void => {
        const mobile = inputMode.mode === 'mobile'
        rail.classList.toggle('visible', mobile)
        if (!mobile) {
            editor.setViewportInsets({ left: 0 })
            return
        }

        const landscape = window.innerWidth > window.innerHeight
        const columns = landscape ? 2 : 1
        const railWidth = columns * SLOT + GAP

        // Sit below the top-left button stack; keep a small bottom margin.
        const stack = document.getElementById('buttons')
        const top = (stack ? Math.round(stack.getBoundingClientRect().bottom) : 132) + GAP
        const availH = window.innerHeight - top - GAP
        const rows = Math.max(1, Math.floor(availH / SLOT))
        const capacity = rows * columns

        const overflowNeeded = buttons.length > capacity
        // Reserve a cell for the ⋯ button when overflowing.
        const inRail = overflowNeeded ? Math.max(0, capacity - 1) : buttons.length

        primary.style.gridTemplateColumns = `repeat(${columns}, ${SLOT - GAP}px)`
        primary.replaceChildren(...buttons.slice(0, inRail).map(b => b.button))
        overflow.replaceChildren(...buttons.slice(inRail).map(b => b.button))
        moreBtn.style.display = overflowNeeded ? '' : 'none'
        if (!overflowNeeded) closeOverflow()

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
