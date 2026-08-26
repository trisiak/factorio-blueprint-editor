import { inputMode } from '@fbe/editor'
import { registerDomDialog } from './dialogLayer'

// The DOM dialog shell (#98 Slice 0) — the base every DOM dialog opens
// through, so modal behavior is defined once: a fixed backdrop (tap = close),
// a panel clamped to the viewport with its body scrolling natively, a titled
// header with an always-visible ✕ (the Pixi dialogs' hard-won lesson: on a
// phone the panel covers nearly all the canvas, so "tap away" barely has
// anywhere to land), Escape-to-close, registration with the dialog layer
// (readouts yield while open, per the layering contract), and auto-close on a
// live input-mode switch — a DOM dialog is a mobile presentation for now, and
// the Pixi one takes over on desktop.

export interface DialogShell {
    /** The dialog panel — append content to `body`. */
    panel: HTMLElement
    header: HTMLElement
    body: HTMLElement
    /** Close and remove the dialog (idempotent). */
    close: () => void
}

export function openDialogShell(opts: {
    title: string
    /** Extra class on the panel for per-dialog layout. */
    className?: string
    onClose?: () => void
}): DialogShell {
    const backdrop = document.createElement('div')
    backdrop.className = 'fbe-dialog-backdrop'

    const panel = document.createElement('div')
    panel.className = `fbe-dialog${opts.className ? ` ${opts.className}` : ''}`
    // Taps inside the panel must not reach the backdrop's close handler.
    panel.addEventListener('click', e => e.stopPropagation())

    const header = document.createElement('div')
    header.className = 'fbe-dialog-header'
    const title = document.createElement('span')
    title.className = 'fbe-dialog-title'
    title.textContent = opts.title
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'fbe-dialog-close'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.textContent = '✕'
    header.append(title, closeBtn)

    const body = document.createElement('div')
    body.className = 'fbe-dialog-body'

    panel.append(header, body)
    backdrop.appendChild(panel)
    document.body.appendChild(backdrop)

    let closed = false
    const close = (): void => {
        if (closed) return
        closed = true
        unregister()
        inputMode.off('change', onModeChange)
        window.removeEventListener('keydown', onKeydown)
        backdrop.remove()
        opts.onClose?.()
    }
    const onModeChange = (): void => {
        if (inputMode.mode !== 'mobile') close()
    }
    const onKeydown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.stopPropagation()
            close()
        }
    }

    const shell: DialogShell = { panel, header, body, close }
    const unregister = registerDomDialog(shell)
    inputMode.on('change', onModeChange)
    window.addEventListener('keydown', onKeydown)
    backdrop.addEventListener('click', close)
    closeBtn.addEventListener('click', close)

    return shell
}
