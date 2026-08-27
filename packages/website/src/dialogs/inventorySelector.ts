import type { Editor } from '@fbe/editor'
import { inputMode } from '@fbe/editor'
import { openItemPicker } from './itemPicker'
import { DialogShell } from './shell'

// The main-inventory selector (#98 Slice 1) — the mobile presentation of
// E / rail "Items", and the first Pixi dialog to leave the canvas. The editor
// opens it over `fbe:openinventory` (see UIContainer.openMainInventory; a
// repeat request while open toggles it closed) and the pick lands on the
// cursor through `editor.spawnPaintItem`. It is the unfiltered flavour of the
// shared item picker (itemPicker.ts), plus the main-inventory extras: the
// Quickbar recents section and Pin/Unpin. The editor-embedded pickers
// (recipe/module slots) are the *filtered* flavour, opened by the DOM entity
// editor (entityEditor.ts) — or still by the Pixi editors where those haven't
// migrated yet.

export function initInventorySelector(editor: Editor): void {
    let open: DialogShell | null = null

    window.addEventListener('fbe:openinventory', e => {
        if (open) {
            // A repeat request (E / rail "Items" while open) toggles it closed.
            open.close()
            return
        }
        if (inputMode.mode !== 'mobile') return
        open = openItemPicker(editor, {
            title: 'Items',
            recentsKey: 'items',
            quickbarPin: true,
            onPick: name => editor.spawnPaintItem(name),
            initialPreview: (e as CustomEvent<{ preview?: string }>).detail?.preview,
            onClosed: () => {
                open = null
            },
        })
    })
}
