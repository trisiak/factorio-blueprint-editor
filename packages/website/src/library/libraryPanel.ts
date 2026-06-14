// Blueprint library — DOM panel.
//
// A hand-built (no framework, matching the rest of the website chrome) overlay
// that browses the active pack's library tree and drives the controller. Like
// `#info-panel` it's a fixed, centered, dark panel toggled from the top-left
// button stack. It's intentionally scoped to the *active* pack for now — multi-
// pack browsing (and the pack-switch-on-open it implies) is a later slice.
//
// The panel owns its widget tree and model operations; it calls back into
// `index.ts` only for things that need the PixiJS canvas (load/encode) or the
// shared toast/confirm/clipboard chrome.

import { LibraryController } from './controller'
import { LibraryNode } from './model'

export interface LibraryPanelCallbacks {
    /** Load an encoded blueprint/book onto the canvas ('' → a blank blueprint). */
    loadEncoded(encoded: string): Promise<void>
    /** Encode the current canvas (active blueprint or book) to a string. */
    currentEncoded(): Promise<string>
    /** Show a transient message. */
    toast(text: string, type?: 'success' | 'info' | 'warning' | 'error'): void
    /** Ask for a name (returns null if cancelled). */
    promptName(message: string, defaultName: string): string | null
    /** Copy text to the clipboard (with its own success/failure toast). */
    copyText(text: string): void
    /** Confirm a destructive action; resolves true only if the user confirms. */
    confirm(text: string, confirmLabel: string): Promise<boolean>
    /** Notify that the active project changed (so the indicator can refresh). */
    onActiveChange(): void
}

export interface LibraryPanel {
    toggle(): void
    open(): void
    close(): void
    refresh(): void
}

export function initLibraryPanel(
    controller: LibraryController,
    cb: LibraryPanelCallbacks
): LibraryPanel {
    const panel = document.createElement('div')
    panel.id = 'library-panel'

    const close = (): void => panel.classList.remove('active')
    const open = (): void => {
        refresh()
        panel.classList.add('active')
    }
    const toggle = (): void => (panel.classList.contains('active') ? close() : open())

    // --- header -------------------------------------------------------------
    const header = document.createElement('div')
    header.className = 'library-header'
    const title = document.createElement('h1')
    title.textContent = 'Blueprint Library'
    const closeBtn = document.createElement('button')
    closeBtn.className = 'library-close'
    closeBtn.type = 'button'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', close)
    header.append(title, closeBtn)

    // --- top action row (New / Save / Save As) ------------------------------
    const actions = document.createElement('div')
    actions.className = 'library-actions'

    const actionButton = (label: string, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement('button')
        b.type = 'button'
        b.textContent = label
        b.addEventListener('click', onClick)
        actions.appendChild(b)
        return b
    }

    actionButton('New project', async () => {
        const current = await cb.currentEncoded().catch(() => '')
        if (controller.isModified(current)) {
            const go = await cb.confirm(
                'You have unsaved changes. Start a new project anyway?',
                'Discard & start new'
            )
            if (!go) return
        }
        await controller.newScratch()
        await cb.loadEncoded('')
        cb.onActiveChange()
        refresh()
        cb.toast('Started a new project', 'success')
    })

    actionButton('Save version', async () => {
        const current = await cb.currentEncoded().catch(() => '')
        if (!current) {
            cb.toast('Nothing to save — the blueprint is empty.', 'info')
            return
        }
        const made = await controller.save(current)
        cb.toast(made ? 'Saved a new version' : 'No changes since the last version', 'success')
        refresh()
    })

    actionButton('Save as…', async () => {
        const current = await cb.currentEncoded().catch(() => '')
        if (!current) {
            cb.toast('Nothing to save — the blueprint is empty.', 'info')
            return
        }
        const name = cb.promptName('Name this blueprint', controller.getActiveName())
        if (!name) return
        await controller.saveAs(name, current)
        cb.onActiveChange()
        refresh()
        cb.toast(`Saved "${name}"`, 'success')
    })

    // --- scrollable body (recents + tree) -----------------------------------
    const body = document.createElement('div')
    body.className = 'library-body'

    panel.append(header, actions, body)
    document.body.appendChild(panel)

    // Open a leaf as the working context, then load it onto the canvas.
    const openLeaf = async (id: string): Promise<void> => {
        const encoded = await controller.open(id)
        if (encoded === null) return
        await cb.loadEncoded(encoded)
        cb.onActiveChange()
        refresh()
        close()
    }

    const removeNode = async (id: string, name: string): Promise<void> => {
        const ok = await cb.confirm(`Delete "${name}"? This can't be undone.`, 'Delete')
        if (!ok) return
        const wasActive = controller.getActiveId() === id
        await controller.remove(id)
        if (wasActive) {
            // Active was deleted → controller reassigned the scratchpad; reflect it.
            await cb.loadEncoded(controller.getActive().encoded)
            cb.onActiveChange()
        }
        refresh()
    }

    const copyLeaf = (encoded: string): void => {
        if (!encoded) {
            cb.toast('This entry is empty — nothing to copy.', 'info')
            return
        }
        cb.copyText(encoded)
    }

    // Build a single blueprint row (name + Open/Copy/Delete).
    const blueprintRow = (
        node: Extract<LibraryNode, { kind: 'blueprint' }>,
        opts: { isScratchpad?: boolean } = {}
    ): HTMLElement => {
        const row = document.createElement('div')
        row.className = 'library-row'
        if (node.id === controller.getActiveId()) row.classList.add('active')

        const name = document.createElement('span')
        name.className = 'library-row-name'
        name.textContent = (opts.isScratchpad ? '✎ ' : '') + node.name
        if (node.snapshots.length) {
            const badge = document.createElement('span')
            badge.className = 'library-badge'
            badge.textContent = `v${node.snapshots.length}`
            badge.title = `${node.snapshots.length} saved version(s)`
            name.appendChild(badge)
        }
        name.addEventListener('click', () => openLeaf(node.id))

        const buttons = document.createElement('span')
        buttons.className = 'library-row-buttons'
        const mk = (label: string, fn: () => void): void => {
            const b = document.createElement('button')
            b.type = 'button'
            b.textContent = label
            b.addEventListener('click', fn)
            buttons.appendChild(b)
        }
        mk('Open', () => openLeaf(node.id))
        mk('Copy', () => copyLeaf(node.encoded))
        if (!opts.isScratchpad) mk('Delete', () => removeNode(node.id, node.name))

        row.append(name, buttons)
        return row
    }

    // Recursively render a folder and its children with indentation.
    const renderNode = (node: LibraryNode, into: HTMLElement, depth: number): void => {
        if (node.kind === 'blueprint') {
            const row = blueprintRow(node)
            row.style.paddingLeft = `${8 + depth * 16}px`
            into.appendChild(row)
            return
        }
        const folder = document.createElement('div')
        folder.className = 'library-folder'
        folder.style.paddingLeft = `${8 + depth * 16}px`
        folder.textContent = `📁 ${node.name}`
        into.appendChild(folder)
        for (const child of node.children) renderNode(child, into, depth + 1)
    }

    const section = (label: string): HTMLElement => {
        const h = document.createElement('div')
        h.className = 'library-section'
        h.textContent = label
        body.appendChild(h)
        return h
    }

    function refresh(): void {
        body.replaceChildren()
        const tree = controller.getTree()

        // Scratchpad — always present, pinned at the top.
        section('Working')
        body.appendChild(blueprintRow(tree.scratchpad, { isScratchpad: true }))

        // Recents (excluding the scratchpad, which is always visible above).
        const recents = controller.getRecents().filter(r => r.id !== tree.scratchpad.id)
        if (recents.length) {
            section('Recent')
            for (const r of recents) body.appendChild(blueprintRow(r))
        }

        // The saved tree.
        section('All blueprints')
        if (tree.children.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'library-empty'
            empty.textContent = 'No saved blueprints yet — use “Save as…” to add one.'
            body.appendChild(empty)
        } else {
            for (const child of tree.children) renderNode(child, body, 0)
        }
    }

    return { toggle, open, close, refresh }
}
