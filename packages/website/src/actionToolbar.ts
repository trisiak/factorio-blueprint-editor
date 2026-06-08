import EDITOR, { Editor, EditorMode, inputMode } from '@fbe/editor'
import type { InputMode } from '@fbe/editor'

// On-screen action toolbar: a DOM (not Pixi) mirror of the keyboard-only actions
// in the editor's action registry, so touch users — who have no keyboard — can
// rotate / flip / undo / open the inventory and, crucially, *exit paint mode*
// (previously only reachable via the pipette key). It's deliberately DOM-built:
// these are stateless action buttons that need no game sprites, so they get the
// browser's native hit-target sizing, focus and accessibility for free.
//
// Buttons invoke actions by name through `EDITOR.callAction`, so they stay in
// lockstep with the keybind registry instead of duplicating its logic. Visibility
// is gated on the explicit input mode (shown on mobile, hidden on desktop) to
// respect the desktop/mobile separation owned by `input.ts`.

interface ToolbarButton {
    /** Action registry name passed to `EDITOR.callAction`. */
    action: string
    /** Unicode glyph shown large. */
    glyph: string
    /** Short caption under the glyph. */
    label: string
    /** Extra class (e.g. the cancel button gets emphasized in paint modes). */
    className?: string
}

const BUTTONS: ToolbarButton[] = [
    { action: 'inventory', glyph: '⊞', label: 'Items' },
    { action: 'rotate', glyph: '↻', label: 'Rotate' },
    { action: 'flipHorizontal', glyph: '⇄', label: 'Flip H' },
    { action: 'flipVertical', glyph: '⇅', label: 'Flip V' },
    { action: 'pipette', glyph: '⊙', label: 'Pick' },
    { action: 'undo', glyph: '↶', label: 'Undo' },
    { action: 'redo', glyph: '↷', label: 'Redo' },
    { action: 'focus', glyph: '⌖', label: 'Center' },
    { action: 'closeWindow', glyph: '✕', label: 'Cancel', className: 'cancel' },
]

/** A cursor mode the user needs an explicit way out of (no keyboard on touch). */
function isCancelableMode(mode: EditorMode): boolean {
    return mode === EditorMode.PAINT || mode === EditorMode.COPY || mode === EditorMode.DELETE
}

export function initActionToolbar(editor: Editor): void {
    const toolbar = document.createElement('div')
    toolbar.id = 'action-toolbar'

    let cancelButton: HTMLButtonElement | undefined

    for (const spec of BUTTONS) {
        const button = document.createElement('button')
        button.type = 'button'
        if (spec.className) button.classList.add(spec.className)
        button.title = spec.label

        const glyph = document.createElement('span')
        glyph.className = 'glyph'
        glyph.textContent = spec.glyph
        button.appendChild(glyph)

        const label = document.createElement('span')
        label.textContent = spec.label
        button.appendChild(label)

        // `click` covers mouse and touch tap; the action runs through the same
        // registry path a keypress would, so paint/edit semantics are identical.
        button.addEventListener('click', () => {
            EDITOR.callAction(spec.action)
        })

        toolbar.appendChild(button)
        if (spec.action === 'closeWindow') cancelButton = button
    }

    document.body.appendChild(toolbar)

    // Emphasize Cancel while there's a cursor to cancel. It still works in any
    // mode (it also closes dialogs), so it stays enabled — just visually calmer.
    const applyMode = (mode: EditorMode): void => {
        cancelButton?.classList.toggle('active', isCancelableMode(mode))
    }
    applyMode(editor.mode)
    editor.onModeChange(applyMode)

    // Touch-only affordance: show in mobile input mode, hide on desktop (which
    // has the keyboard). Live-toggles when the input mode is switched.
    const applyInputMode = (mode: InputMode): void => {
        toolbar.classList.toggle('visible', mode === 'mobile')
    }
    applyInputMode(inputMode.mode)
    inputMode.on('change', applyInputMode)
}
