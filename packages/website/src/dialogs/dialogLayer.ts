// The dialog layer (#98 Slice 0) — one owner for `body.fbe-dialog-open`, the
// class the layering contract hangs off (docs/mobile-layout-inventory.md):
// while ANY modal dialog is open — Pixi (announced over `fbe:dialogs`) or DOM
// (registered here by the shell) — the passive readouts (entity-info sheet,
// rates drawer) hide via CSS and restore themselves on close. Before #98 the
// Pixi count drove the class directly from index.ts; DOM dialogs joining the
// modal tier means the two sources must be OR-ed in one place.

let pixiCount = 0
const domDialogs = new Set<{ close: () => void }>()

const apply = (): void => {
    document.body.classList.toggle('fbe-dialog-open', pixiCount > 0 || domDialogs.size > 0)
}

export function initDialogLayer(): void {
    window.addEventListener('fbe:dialogs', e => {
        pixiCount = (e as CustomEvent<number>).detail
        apply()
    })
    // The `?test` probe's closeDialogs closes Pixi dialogs editor-side and
    // asks the DOM ones to close over this bridge.
    window.addEventListener('fbe:closedialogs', () => closeDomDialogs())
}

/** Register an open DOM dialog; call the returned function when it closes. */
export function registerDomDialog(dialog: { close: () => void }): () => void {
    domDialogs.add(dialog)
    apply()
    return () => {
        domDialogs.delete(dialog)
        apply()
    }
}

/** Close every open DOM dialog (mode switches, the e2e bridge). */
export function closeDomDialogs(): void {
    for (const d of [...domDialogs]) d.close()
}

/** Whether any DOM dialog is open (the shells register themselves). */
export function anyDomDialogOpen(): boolean {
    return domDialogs.size > 0
}
