// Blueprint library — DOM panel.
//
// A hand-built (no framework, matching the rest of the website chrome) overlay
// that browses the library tree and drives the controller. Like `#info-panel`
// it's a fixed, centered, dark panel toggled from the top-left button stack.
//
// Phase 2 adds organization + multi-pack: a pack drop-down browses any pack's
// tree without reloading; per-row "⋯" menus expose rename/duplicate/move/copy/
// delete; a destination picker spans packs (so move/copy can cross packs). The
// editor's rendering pack only switches when you *open* a project from a
// non-active pack (via `requestPackSwitch` → a `setDataPack` reload), using the
// persisted activeId as the handoff.
//
// The panel owns its widget tree and model operations; it calls back into
// `index.ts` only for things that need the PixiJS canvas (load/encode), the
// shared toast/confirm/clipboard chrome, or the pack switch.

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
    /** Notify that the active project changed (so the indicator can refresh). */
    onActiveChange(): void
    /** Available packs (manifest ∪ what's in the library), for the drop-down. */
    packList(): { id: string; label: string }[]
    /** Switch the editor's rendering pack (a `setDataPack` reload). */
    requestPackSwitch(pack: string): void
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
    // Which pack's tree is being browsed (defaults to the active/rendered one).
    let browsedPack = controller.getActivePack()
    const onActivePack = (): boolean => browsedPack === controller.getActivePack()
    const packLabel = (id: string): string => cb.packList().find(p => p.id === id)?.label ?? id

    const panel = document.createElement('div')
    panel.id = 'library-panel'

    const close = (): void => {
        closeMenu()
        panel.classList.remove('active')
    }
    const open = (): void => {
        browsedPack = controller.getActivePack()
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

    // --- pack drop-down -----------------------------------------------------
    const packBar = document.createElement('div')
    packBar.className = 'library-packbar'
    const packLabelEl = document.createElement('label')
    packLabelEl.textContent = 'Pack'
    const packSelect = document.createElement('select')
    packSelect.addEventListener('change', () => {
        browsedPack = packSelect.value
        refresh()
    })
    packBar.append(packLabelEl, packSelect)

    // --- action row ---------------------------------------------------------
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

    actionButton('New folder', () => newFolder())

    const newProjectBtn = actionButton('New project', async () => {
        const current = await cb.currentEncoded().catch(() => '')
        // "New project" wipes the scratchpad and starts there. Switching off a
        // *named* entry loses nothing (its content is already saved/reopenable),
        // so the only work at risk is live scratchpad content — warn just for that.
        const onScratchpad = controller.isScratchpad(controller.getActiveId())
        if (onScratchpad && current) {
            const go = await confirmModal(
                'Discard your current scratchpad work and start fresh?',
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

    // The scratchpad is always live and can't hold versions; "Save version" is
    // disabled there (see refresh) and routes the user to "Save as…".
    const saveBtn = actionButton('Save version', async () => {
        if (controller.isScratchpad(controller.getActiveId())) {
            cb.toast('The scratchpad is always live — use “Save as…” to keep a copy.', 'info')
            return
        }
        const current = await cb.currentEncoded().catch(() => '')
        if (!current) {
            cb.toast('Nothing to save — the blueprint is empty.', 'info')
            return
        }
        const made = await controller.save(current)
        cb.toast(made ? 'Saved a new version' : 'No changes since the last version', 'success')
        refresh()
    })

    const saveAsBtn = actionButton('Save as…', async () => {
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

    // --- scrollable body ----------------------------------------------------
    const body = document.createElement('div')
    body.className = 'library-body'

    panel.append(header, packBar, actions, body)
    document.body.appendChild(panel)

    // --- a small popover menu (the per-row "⋯") -----------------------------
    interface MenuItem {
        label: string
        run: () => void
    }
    let openMenuEl: HTMLElement | null = null
    const closeMenu = (): void => {
        openMenuEl?.remove()
        openMenuEl = null
    }
    const showMenu = (anchor: HTMLElement, items: MenuItem[]): void => {
        closeMenu()
        const menu = document.createElement('div')
        menu.className = 'library-menu'
        for (const item of items) {
            const b = document.createElement('button')
            b.type = 'button'
            b.textContent = item.label
            b.addEventListener('click', () => {
                closeMenu()
                item.run()
            })
            menu.appendChild(b)
        }
        document.body.appendChild(menu)
        const r = anchor.getBoundingClientRect()
        // Right-align the menu under the ⋯ button, clamped into the viewport.
        const width = 180
        const margin = 8
        menu.style.left = `${Math.round(Math.min(r.right - width, window.innerWidth - width - margin))}px`
        // Vertical placement: drop below the button, but if it would run off the
        // bottom (rows near the screen edge), flip above it; then clamp so the top
        // never goes off-screen — so every item stays reachable.
        const h = menu.offsetHeight
        let top = r.bottom + 2
        if (top + h > window.innerHeight - margin) top = r.top - h - 2
        top = Math.max(margin, Math.min(top, window.innerHeight - h - margin))
        menu.style.top = `${Math.round(top)}px`
        openMenuEl = menu
    }
    // A pointerdown outside the open menu dismisses it.
    window.addEventListener('pointerdown', e => {
        if (openMenuEl && !openMenuEl.contains(e.target as Node)) closeMenu()
    })

    // --- destination picker (Move to… / Copy to…) ---------------------------
    interface Destination {
        pack: string
        parentId?: string
        label: string
    }
    // Every place a node can land: each pack's root + every folder (path-labelled).
    const enumerateDestinations = (): Destination[] => {
        const dests: Destination[] = []
        for (const p of cb.packList()) {
            const tree = controller.getTreeFor(p.id)
            dests.push({ pack: p.id, parentId: undefined, label: `${p.label} / (root)` })
            const walk = (nodes: LibraryNode[], prefix: string): void => {
                for (const n of nodes) {
                    if (n.kind !== 'folder') continue
                    const path = prefix + n.name
                    dests.push({ pack: p.id, parentId: n.id, label: `${p.label} / ${path}` })
                    walk(n.children, `${path} / `)
                }
            }
            walk(tree.children, '')
        }
        return dests
    }
    const pickDestination = (heading: string): Promise<Destination | null> =>
        new Promise(resolve => {
            const overlay = document.createElement('div')
            overlay.className = 'library-picker'
            const box = document.createElement('div')
            box.className = 'library-picker-box'
            const h = document.createElement('div')
            h.className = 'library-picker-title'
            h.textContent = heading
            const list = document.createElement('div')
            list.className = 'library-picker-list'
            const done = (d: Destination | null): void => {
                overlay.remove()
                resolve(d)
            }
            for (const dest of enumerateDestinations()) {
                const b = document.createElement('button')
                b.type = 'button'
                b.textContent = dest.label
                b.addEventListener('click', () => done(dest))
                list.appendChild(b)
            }
            const cancel = document.createElement('button')
            cancel.type = 'button'
            cancel.className = 'library-picker-cancel'
            cancel.textContent = 'Cancel'
            cancel.addEventListener('click', () => done(null))
            box.append(h, list, cancel)
            overlay.appendChild(box)
            overlay.addEventListener('click', e => {
                if (e.target === overlay) done(null)
            })
            panel.appendChild(overlay)
        })

    // A modal confirm rendered *inside the panel* (above its content), so it's
    // always reachable — unlike a toast, which sits behind the open panel and can
    // be hidden off-screen. Resolves true only if the user confirms.
    const confirmModal = (message: string, confirmLabel: string): Promise<boolean> =>
        new Promise(resolve => {
            const overlay = document.createElement('div')
            overlay.className = 'library-picker'
            const box = document.createElement('div')
            box.className = 'library-picker-box library-dialog'
            const text = document.createElement('div')
            text.className = 'library-dialog-text'
            text.textContent = message
            const row = document.createElement('div')
            row.className = 'library-dialog-actions'
            const done = (v: boolean): void => {
                overlay.remove()
                resolve(v)
            }
            const cancel = document.createElement('button')
            cancel.type = 'button'
            cancel.textContent = 'Cancel'
            cancel.addEventListener('click', () => done(false))
            const ok = document.createElement('button')
            ok.type = 'button'
            ok.className = 'library-dialog-confirm'
            ok.textContent = confirmLabel
            ok.addEventListener('click', () => done(true))
            row.append(cancel, ok)
            box.append(text, row)
            overlay.appendChild(box)
            overlay.addEventListener('click', e => {
                if (e.target === overlay) done(false)
            })
            panel.appendChild(overlay)
        })

    // --- node operations ----------------------------------------------------

    // Open a leaf as the working context. From a non-active pack this reloads the
    // editor onto that pack (the only thing that switches the rendered pack).
    const openEntry = async (id: string): Promise<void> => {
        if (onActivePack()) {
            const encoded = await controller.open(id)
            if (encoded === null) return
            await cb.loadEncoded(encoded)
            cb.onActiveChange()
            refresh()
            close()
            return
        }
        const go = await confirmModal(
            `Open this in ${packLabel(browsedPack)}? The editor will reload to switch packs.`,
            'Switch & open'
        )
        if (!go) return
        await controller.setActiveForPack(browsedPack, id)
        cb.requestPackSwitch(browsedPack) // setDataPack → reload → reopens this entry
    }

    // After a structural change, reload the canvas if the active leaf was affected.
    const reflectActive = async (touchedId: string): Promise<void> => {
        if (!onActivePack()) return
        if (touchedId === controller.getActiveId()) return // unchanged identity
        await cb.loadEncoded(controller.getActive().encoded)
        cb.onActiveChange()
    }

    const renameNode = async (node: LibraryNode): Promise<void> => {
        const name = cb.promptName('Rename', node.name)
        if (!name) return
        await controller.rename(browsedPack, node.id, name)
        if (onActivePack() && node.id === controller.getActiveId()) cb.onActiveChange()
        refresh()
    }

    const duplicateNode = async (id: string): Promise<void> => {
        await controller.duplicate(browsedPack, id)
        refresh()
        cb.toast('Duplicated', 'success')
    }

    const deleteNode = async (node: LibraryNode): Promise<void> => {
        const extra = node.kind === 'folder' ? ' and everything in it' : ''
        const ok = await confirmModal(
            `Delete "${node.name}"${extra}? This can't be undone.`,
            'Delete'
        )
        if (!ok) return
        const wasActive = onActivePack() && node.id === controller.getActiveId()
        await controller.remove(browsedPack, node.id)
        if (wasActive) {
            await cb.loadEncoded(controller.getActive().encoded)
            cb.onActiveChange()
        }
        refresh()
    }

    const moveNode = async (id: string): Promise<void> => {
        const dest = await pickDestination('Move to…')
        if (!dest) return
        const ok =
            dest.pack === browsedPack
                ? await controller.move(browsedPack, id, dest.parentId)
                : await controller.moveToPack(browsedPack, id, dest.pack, dest.parentId)
        if (!ok) {
            cb.toast('Couldn’t move there (a folder can’t go inside itself).', 'warning')
            return
        }
        await reflectActive(id)
        refresh()
        cb.toast('Moved', 'success')
    }

    const copyNode = async (id: string): Promise<void> => {
        const dest = await pickDestination('Copy to…')
        if (!dest) return
        const clone = await controller.copyToPack(browsedPack, id, dest.pack, dest.parentId)
        if (!clone) {
            cb.toast('Couldn’t copy there.', 'warning')
            return
        }
        refresh()
        cb.toast(
            dest.pack === browsedPack ? 'Copied' : `Copied to ${packLabel(dest.pack)}`,
            'success'
        )
    }

    const newFolder = async (parentId?: string): Promise<void> => {
        const name = cb.promptName('New folder name', 'New folder')
        if (!name) return
        await controller.createFolder(browsedPack, name, parentId)
        refresh()
    }

    const copyString = (encoded: string): void => {
        if (!encoded) {
            cb.toast('This entry is empty — nothing to copy.', 'info')
            return
        }
        cb.copyText(encoded)
    }

    // Compact relative time for version timestamps ("5m ago", "3h ago", …).
    const relTime = (ms: number): string => {
        const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
        if (s < 60) return 'just now'
        const m = Math.round(s / 60)
        if (m < 60) return `${m}m ago`
        const h = Math.round(m / 60)
        if (h < 24) return `${h}h ago`
        const d = Math.round(h / 24)
        if (d < 30) return `${d}d ago`
        return new Date(ms).toLocaleDateString()
    }

    // Version history viewer: list a leaf's saved versions (newest first), each
    // with Restore + Delete. Restore overwrites the live content (explicit-only,
    // time-linear); if it's the active leaf it also reloads the canvas, confirming
    // first when there are uncommitted edits to overwrite.
    const openVersions = (node: Extract<LibraryNode, { kind: 'blueprint' }>): void => {
        const pack = browsedPack
        const overlay = document.createElement('div')
        overlay.className = 'library-picker'
        const box = document.createElement('div')
        box.className = 'library-picker-box'
        const heading = document.createElement('div')
        heading.className = 'library-picker-title'
        heading.textContent = `Versions of "${node.name}"`
        const list = document.createElement('div')
        list.className = 'library-version-list'
        const closeBtn = document.createElement('button')
        closeBtn.type = 'button'
        closeBtn.className = 'library-picker-cancel'
        closeBtn.textContent = 'Close'
        closeBtn.addEventListener('click', () => overlay.remove())
        box.append(heading, list, closeBtn)
        overlay.appendChild(box)
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.remove()
        })
        panel.appendChild(overlay)

        const restoreVersion = async (index: number): Promise<void> => {
            const isActiveLeaf = onActivePack() && node.id === controller.getActiveId()
            if (isActiveLeaf) {
                const current = await cb.currentEncoded().catch(() => '')
                if (
                    controller.isModified(current) &&
                    !(await confirmModal(
                        'Restore this version? Unsaved changes to the current version will be lost.',
                        'Restore'
                    ))
                ) {
                    return
                }
            }
            await controller.restore(pack, node.id, index)
            if (isActiveLeaf) {
                await cb.loadEncoded(controller.getEntry(pack, node.id)?.encoded ?? '')
                cb.onActiveChange()
            }
            renderVersions()
            refresh()
            cb.toast('Version restored', 'success')
        }

        const deleteVersion = async (index: number): Promise<void> => {
            if (!(await confirmModal('Delete this saved version?', 'Delete'))) return
            await controller.deleteSnapshot(pack, node.id, index)
            renderVersions()
            refresh()
        }

        function renderVersions(): void {
            const entry = controller.getEntry(pack, node.id)
            const snaps = entry?.snapshots ?? []
            list.replaceChildren()
            if (snaps.length === 0) {
                const empty = document.createElement('div')
                empty.className = 'library-empty'
                empty.textContent = 'No saved versions yet — use “Save version”.'
                list.appendChild(empty)
                return
            }
            snaps.forEach((snap, i) => {
                const row = document.createElement('div')
                row.className = 'library-version'
                const label = document.createElement('span')
                label.className = 'library-version-label'
                label.textContent = relTime(snap.savedAt) + (i === 0 ? ' · latest' : '')
                const buttons = document.createElement('span')
                buttons.className = 'library-row-buttons'
                const restore = document.createElement('button')
                restore.type = 'button'
                restore.textContent = 'Restore'
                restore.addEventListener('click', () => restoreVersion(i))
                const del = document.createElement('button')
                del.type = 'button'
                del.textContent = 'Delete'
                del.addEventListener('click', () => deleteVersion(i))
                buttons.append(restore, del)
                row.append(label, buttons)
                list.appendChild(row)
            })
        }
        renderVersions()
    }

    // --- rendering ----------------------------------------------------------

    // The ⋯ menu items for a node (organize ops, pack-agnostic).
    const menuFor = (node: LibraryNode): MenuItem[] => {
        const items: MenuItem[] = []
        if (node.kind === 'blueprint') {
            items.push({ label: 'Copy string', run: () => copyString(node.encoded) })
            items.push({ label: 'Versions…', run: () => openVersions(node) })
        }
        if (node.kind === 'folder')
            items.push({ label: 'New subfolder', run: () => newFolder(node.id) })
        items.push(
            { label: 'Rename', run: () => renameNode(node) },
            { label: 'Duplicate', run: () => duplicateNode(node.id) },
            { label: 'Move to…', run: () => moveNode(node.id) },
            { label: 'Copy to…', run: () => copyNode(node.id) },
            { label: 'Delete', run: () => deleteNode(node) }
        )
        return items
    }

    const iconBtn = (
        glyph: string,
        title: string,
        onClick: (e: MouseEvent) => void
    ): HTMLButtonElement => {
        const b = document.createElement('button')
        b.type = 'button'
        b.title = title
        // aria-label so the accessible name is the title, not the glyph (e.g. "⋯"
        // would otherwise name the button "⋯"); keeps it findable/announced.
        b.setAttribute('aria-label', title)
        b.textContent = glyph
        b.addEventListener('click', onClick)
        return b
    }

    // A blueprint row: name (+ version badge) and its actions.
    const blueprintRow = (
        node: Extract<LibraryNode, { kind: 'blueprint' }>,
        opts: { isScratchpad?: boolean; depth?: number } = {}
    ): HTMLElement => {
        const row = document.createElement('div')
        row.className = 'library-row'
        row.style.paddingLeft = `${8 + (opts.depth ?? 0) * 16}px`
        if (onActivePack() && node.id === controller.getActiveId()) row.classList.add('active')

        const name = document.createElement('span')
        name.className = 'library-row-name'
        name.textContent = (opts.isScratchpad ? '✎ ' : '') + node.name
        // The scratchpad is always live — it never carries a version count.
        if (!opts.isScratchpad && node.snapshots.length) {
            const badge = document.createElement('span')
            badge.className = 'library-badge'
            badge.textContent = `v${node.snapshots.length}`
            badge.title = `${node.snapshots.length} saved version(s)`
            name.appendChild(badge)
        }
        name.addEventListener('click', () => openEntry(node.id))

        const buttons = document.createElement('span')
        buttons.className = 'library-row-buttons'
        buttons.appendChild(iconBtn('Open', 'Open', () => openEntry(node.id)))
        if (opts.isScratchpad) {
            // The scratchpad can't be renamed/moved/deleted; offer Copy only.
            buttons.appendChild(iconBtn('Copy', 'Copy string', () => copyString(node.encoded)))
        } else {
            buttons.appendChild(
                iconBtn('⋯', 'More', e => showMenu(e.currentTarget as HTMLElement, menuFor(node)))
            )
        }

        row.append(name, buttons)
        return row
    }

    // A folder row, then its children indented below it.
    const renderNode = (node: LibraryNode, into: HTMLElement, depth: number): void => {
        if (node.kind === 'blueprint') {
            into.appendChild(blueprintRow(node, { depth }))
            return
        }
        const row = document.createElement('div')
        row.className = 'library-row library-folder'
        row.style.paddingLeft = `${8 + depth * 16}px`
        const name = document.createElement('span')
        name.className = 'library-row-name'
        name.textContent = `📁 ${node.name}`
        const buttons = document.createElement('span')
        buttons.className = 'library-row-buttons'
        buttons.appendChild(
            iconBtn('⋯', 'More', e => showMenu(e.currentTarget as HTMLElement, menuFor(node)))
        )
        row.append(name, buttons)
        into.appendChild(row)
        for (const child of node.children) renderNode(child, into, depth + 1)
    }

    const section = (label: string): void => {
        const h = document.createElement('div')
        h.className = 'library-section'
        h.textContent = label
        body.appendChild(h)
    }

    function refresh(): void {
        closeMenu()

        // Pack drop-down options (manifest ∪ packs in the library).
        const packs = cb.packList()
        packSelect.replaceChildren()
        for (const p of packs) {
            const opt = document.createElement('option')
            opt.value = p.id
            opt.textContent = p.id === controller.getActivePack() ? `${p.label} (active)` : p.label
            packSelect.appendChild(opt)
        }
        if (!packs.some(p => p.id === browsedPack)) browsedPack = controller.getActivePack()
        packSelect.value = browsedPack

        // Working-context actions act on the live canvas (the active pack); they're
        // disabled while browsing another pack. "New folder" works on any pack.
        const active = onActivePack()
        const onScratchpad = active && controller.isScratchpad(controller.getActiveId())
        newProjectBtn.disabled = !active
        saveAsBtn.disabled = !active
        saveBtn.disabled = !active || onScratchpad
        saveBtn.title = onScratchpad
            ? 'The scratchpad is always live — use “Save as…” to keep a named copy.'
            : !active
              ? 'Switch to this pack to edit here.'
              : ''

        const tree = controller.getTreeFor(browsedPack)
        body.replaceChildren()

        // Scratchpad — always present, pinned at the top.
        section(active ? 'Working' : `Working (in ${packLabel(browsedPack)})`)
        body.appendChild(blueprintRow(tree.scratchpad, { isScratchpad: true }))

        // Recents (active pack only — recents are tracked per active session).
        if (active) {
            const recents = controller.getRecents().filter(r => r.id !== tree.scratchpad.id)
            if (recents.length) {
                section('Recent')
                for (const r of recents) body.appendChild(blueprintRow(r, {}))
            }
        }

        section('All blueprints')
        if (tree.children.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'library-empty'
            empty.textContent = 'No saved blueprints yet — use “Save as…” or “New folder”.'
            body.appendChild(empty)
        } else {
            for (const child of tree.children) renderNode(child, body, 0)
        }
    }

    return { toggle, open, close, refresh }
}
