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

import { wheelGuard } from '@fbe/editor'
import { LibraryController } from './controller'
import { LibraryNode } from './model'
import { SyncStatus, ConflictChoice, ConflictKind } from './syncService'

/**
 * The conflict prompt's outcome — the two real resolutions plus the app-level
 * `sign-out` abort (bail back to the pre-sign-in state so the user can back up
 * before choosing). `sign-out` deliberately lives only here at the prompt seam,
 * *not* in `SyncService.ConflictChoice`, which stays the two resolver outcomes;
 * `index.ts` maps it to `signOut()` rather than `resolveConflict`.
 */
export type ConflictPromptChoice = ConflictChoice | 'sign-out'

/**
 * The cloud-sync surface the panel needs (Phase 6). Supplied only when firebase
 * is configured; when absent (or `isConfigured()` is false) the panel renders no
 * sync chrome at all and is pixel-identical to the local-only build. Holds no
 * firebase imports itself — `index.ts` bridges to `firebase.ts` / the SyncService.
 */
export interface LibrarySyncCallbacks {
    /** Whether this build has firebase config (else: no sync UI). */
    isConfigured(): boolean
    /** The signed-in user (email may be null), or null when signed out. */
    getUser(): { email: string | null } | null
    /** The current sync status (drives the status glyph). */
    getStatus(): SyncStatus
    /** Begin a Google sign-in (a redirect). */
    signIn(): void
    /** Sign out (back to local-only). */
    signOut(): void
    /**
     * Pull from the remote *now* — the manual "sync now" trigger behind the status
     * glyph (a focused tab otherwise only reconciles on attach / tab-return, so it
     * never sees another device's changes). `reconcile` handles both directions:
     * it pulls a newer remote and pushes if local advanced.
     */
    syncNow(): void
    /**
     * Re-open the conflict chooser against the live pending conflict. The status
     * glyph (⚠, in the `conflict` state) calls this so an overlay-dismissed prompt
     * is reachable again without a reload — the earlier dedupe keeps the pending
     * conflict live, so there's always something to re-prompt against.
     */
    reopenConflict(): void
}

export interface LibraryPanelCallbacks {
    /** Load an encoded blueprint/book onto the canvas ('' → a blank blueprint). */
    loadEncoded(encoded: string): Promise<void>
    /** Load a folder's book onto the canvas to navigate (a view — not editable). */
    openFolderBook(bookString: string, label: string): Promise<void>
    /** True while a folder is being viewed as a book (Save is suspended then). */
    isViewingBook(): boolean
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
    /** Cloud sync (Phase 6). Absent ⇒ no sync chrome (local-only build). */
    sync?: LibrarySyncCallbacks
}

export interface LibraryPanel {
    toggle(): void
    open(): void
    close(): void
    refresh(): void
    /** Re-render the header sync widget (called by index.ts on auth/status change). */
    syncChanged(): void
    /**
     * Show the conflict chooser. `kind` selects the wording — a `first-attach`
     * (this device and the cloud hold unrelated libraries; neither is "newer") or
     * a `diverged` (the cloud copy is genuinely later work from another device).
     * Resolves the user's choice (keep-mine / take-theirs / the sign-out abort),
     * or null if dismissed. Opens the panel first so the in-panel modal is
     * reachable, and no-ops (resolving null) if a chooser is already up.
     */
    promptConflict(
        kind: ConflictKind,
        local: { updatedAt: number },
        remote: { updatedAt: number }
    ): Promise<ConflictPromptChoice | null>
}

export function initLibraryPanel(
    controller: LibraryController,
    cb: LibraryPanelCallbacks
): LibraryPanel {
    // Which pack's tree is being browsed (defaults to the active/rendered one).
    let browsedPack = controller.getActivePack()
    // Folder ids the user has collapsed (UI-only, per session — not persisted).
    const collapsed = new Set<string>()
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
        renderSync()
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

    // --- cloud sync bar (Phase 6) -------------------------------------------
    // Rendered only when firebase is configured; otherwise it stays empty and
    // hidden (see the `hidden` toggle in renderSync), so a local-only build looks
    // exactly as before. Signed out ⇒ a "Sign in" button; signed in ⇒ the account
    // email, a status glyph, and "Sign out".
    const syncBar = document.createElement('div')
    syncBar.className = 'library-sync'

    // The status glyph + its accessible label, keyed off the sync status. Each
    // glyph carries a trailing U+FE0E (text variation selector, `TEXT` below):
    // ⚠ and ☁ default to colourful *emoji* presentation on many platforms, so
    // without it the four glyphs render as a mismatched set (some monochrome text,
    // some emoji). FE0E forces text presentation uniformly; it's a harmless no-op
    // on the glyphs that have no emoji variant (⟳, ⦸).
    const TEXT = '︎'
    const STATUS_GLYPH: Record<SyncStatus, { glyph: string; label: string } | null> = {
        disabled: null,
        'signed-out': null,
        syncing: { glyph: '⟳' + TEXT, label: 'Syncing…' },
        synced: { glyph: '☁' + TEXT, label: 'Synced' },
        conflict: { glyph: '⚠' + TEXT, label: 'Sync conflict' },
        error: { glyph: '⚠' + TEXT, label: 'Sync error' },
        offline: { glyph: '⦸' + TEXT, label: 'Offline' },
    }

    function renderSync(): void {
        const sync = cb.sync
        syncBar.replaceChildren()
        if (!sync || !sync.isConfigured()) {
            syncBar.hidden = true
            return
        }
        syncBar.hidden = false
        const user = sync.getUser()
        if (!user) {
            const signIn = document.createElement('button')
            signIn.type = 'button'
            signIn.className = 'library-sync-btn'
            signIn.textContent = 'Sign in to sync'
            signIn.addEventListener('click', () => sync.signIn())
            syncBar.appendChild(signIn)
            return
        }
        const status = sync.getStatus()
        const glyph = STATUS_GLYPH[status]
        if (glyph) {
            const g = document.createElement('span')
            g.className = `library-sync-glyph library-sync-${status}`
            g.textContent = glyph.glyph
            if (status === 'conflict') {
                // In the conflict state the ⚠ is a re-entry point: clicking it
                // re-opens the chooser (an overlay-dismissed prompt is otherwise
                // unreachable short of a reload). Give it the button affordance
                // only here, where it's actionable.
                g.classList.add('library-sync-action')
                g.title = 'Resolve…'
                g.setAttribute('role', 'button')
                g.setAttribute('aria-label', 'Resolve sync conflict')
                g.addEventListener('click', () => sync.reopenConflict())
            } else if (status === 'synced' || status === 'error' || status === 'offline') {
                // Resting states double as a manual "sync now" trigger: clicking the
                // glyph reconciles against the remote (pulls another device's
                // changes, or retries after an error/offline blip) without a reload.
                // The pass flips the status to `syncing` and back — which is itself
                // the click feedback. `syncing` is deliberately left non-interactive
                // (a reconcile is already in flight; a click would be a no-op), as is
                // `conflict`, which keeps its own reopen behaviour above.
                g.classList.add('library-sync-action')
                g.title = 'Sync now'
                g.setAttribute('role', 'button')
                g.setAttribute('aria-label', 'Sync now')
                g.addEventListener('click', () => sync.syncNow())
            } else {
                g.title = glyph.label
                g.setAttribute('aria-label', glyph.label)
            }
            syncBar.appendChild(g)
        }
        const email = document.createElement('span')
        email.className = 'library-sync-email'
        email.textContent = user.email ?? 'Signed in'
        email.title = user.email ?? ''
        syncBar.appendChild(email)
        const signOut = document.createElement('button')
        signOut.type = 'button'
        signOut.className = 'library-sync-btn'
        signOut.textContent = 'Sign out'
        signOut.addEventListener('click', () => sync.signOut())
        syncBar.appendChild(signOut)
    }

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

    // Interchange: copy a native string out, or paste one in (decomposed). These
    // act on the *browsed* pack (pure data ops — no live canvas involved).
    const exportToClipboard = (str: string | null, what: string): void => {
        if (!str) {
            cb.toast(`Nothing to export — ${what} is empty.`, 'info')
            return
        }
        cb.copyText(str)
    }

    actionButton('Import…', async () => {
        // A <textarea> modal, not window.prompt: blueprint strings are thousands of
        // chars and prompt truncates/mangles them (notably on touch).
        const raw = await textModal('Paste a blueprint or book string', 'Import')
        if (raw === null) return
        const str = raw.trim()
        if (!str) return
        if (!str.startsWith('0')) {
            cb.toast('Paste a blueprint string (it should start with “0”).', 'warning')
            return
        }
        try {
            await controller.importInto(browsedPack, str)
            refresh()
            cb.toast('Imported', 'success')
        } catch {
            cb.toast('Couldn’t read that blueprint string.', 'error')
        }
    })
    actionButton('Export pack', () =>
        exportToClipboard(controller.exportPack(browsedPack), 'this pack')
    )
    actionButton('Export all', () => exportToClipboard(controller.exportLibrary(), 'the library'))

    // --- scrollable body ----------------------------------------------------
    const body = document.createElement('div')
    body.className = 'library-body'

    panel.append(header, syncBar, packBar, actions, body)
    document.body.appendChild(panel)
    // The panel (and every picker/dialog it hosts) claims the wheel while it's
    // being scrolled — capture phase, so an inner list that stops propagation
    // still registers. Without it the tail of an inertial scroll lands on the
    // canvas and zooms (#101 Slice 5 review, `wheelGuard`).
    wheelGuard.watch(panel)
    renderSync()

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

    // A modal with a <textarea> for pasting long text (e.g. a blueprint/book
    // string). window.prompt truncates/mangles long strings, especially on touch,
    // so import needs a real field. Resolves the entered text, or null on cancel.
    const textModal = (title: string, confirmLabel: string): Promise<string | null> =>
        new Promise(resolve => {
            const overlay = document.createElement('div')
            overlay.className = 'library-picker'
            const box = document.createElement('div')
            box.className = 'library-picker-box library-dialog'
            const heading = document.createElement('div')
            heading.className = 'library-dialog-text'
            heading.textContent = title
            const textarea = document.createElement('textarea')
            textarea.className = 'library-textarea'
            textarea.rows = 5
            textarea.spellcheck = false
            const row = document.createElement('div')
            row.className = 'library-dialog-actions'
            const done = (v: string | null): void => {
                overlay.remove()
                resolve(v)
            }
            const cancel = document.createElement('button')
            cancel.type = 'button'
            cancel.textContent = 'Cancel'
            cancel.addEventListener('click', () => done(null))
            const ok = document.createElement('button')
            ok.type = 'button'
            ok.className = 'library-dialog-confirm'
            ok.textContent = confirmLabel
            ok.addEventListener('click', () => done(textarea.value))
            row.append(cancel, ok)
            box.append(heading, textarea, row)
            overlay.appendChild(box)
            overlay.addEventListener('click', e => {
                if (e.target === overlay) done(null)
            })
            panel.appendChild(overlay)
            textarea.focus()
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

    // Open a folder as a navigable book on the canvas (Phase 5b — view only).
    // Rendering needs the active pack's atlas, so it's active-pack-only for now.
    const openFolder = async (folder: Extract<LibraryNode, { kind: 'folder' }>): Promise<void> => {
        if (!onActivePack()) {
            cb.toast('Switch to this pack to open its books.', 'info')
            return
        }
        const book = controller.exportNode(browsedPack, folder.id)
        if (!book) {
            cb.toast('This folder has no blueprints to open.', 'info')
            return
        }
        await cb.openFolderBook(book, folder.name)
        refresh()
        close()
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
        if (parentId) collapsed.delete(parentId) // reveal the new subfolder
        refresh()
    }

    const copyString = (encoded: string): void => {
        if (!encoded) {
            cb.toast('This entry is empty — nothing to copy.', 'info')
            return
        }
        cb.copyText(encoded)
    }

    // A folder is a Factorio book — edit its book description.
    const editDescription = async (
        folder: Extract<LibraryNode, { kind: 'folder' }>
    ): Promise<void> => {
        const desc = cb.promptName('Folder / book description', folder.description ?? '')
        if (desc === null) return
        await controller.setDescription(browsedPack, folder.id, desc)
        refresh()
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
        if (node.kind === 'folder') {
            items.push({ label: 'New subfolder', run: () => newFolder(node.id) })
            items.push({ label: 'Edit description…', run: () => editDescription(node) })
            items.push({
                label: 'Export as book',
                run: () =>
                    exportToClipboard(controller.exportNode(browsedPack, node.id), 'this folder'),
            })
        }
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
        const isCollapsed = collapsed.has(node.id)
        const name = document.createElement('span')
        name.className = 'library-row-name'
        // 📂 open / 📁 closed; click the name to toggle (the ⋯ stays a menu).
        name.textContent = `${isCollapsed ? '📁' : '📂'} ${node.name}`
        // The folder's book description shows on hover (a "ⓘ" hints it's set).
        if (node.description) {
            row.title = node.description
            name.textContent += ' ⓘ'
        }
        name.addEventListener('click', () => {
            if (collapsed.has(node.id)) collapsed.delete(node.id)
            else collapsed.add(node.id)
            refresh()
        })
        const buttons = document.createElement('span')
        buttons.className = 'library-row-buttons'
        // Open the folder as a navigable book on the canvas (Phase 5b).
        buttons.appendChild(iconBtn('Open', 'Open as book', () => openFolder(node)))
        buttons.appendChild(
            iconBtn('⋯', 'More', e => showMenu(e.currentTarget as HTMLElement, menuFor(node)))
        )
        row.append(name, buttons)
        into.appendChild(row)
        if (!isCollapsed) for (const child of node.children) renderNode(child, into, depth + 1)
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
        // While viewing a folder as a book (5b) there's no leaf to save to, so the
        // Save actions are suspended (New project exits the view).
        const active = onActivePack()
        const viewing = cb.isViewingBook()
        const onScratchpad = active && controller.isScratchpad(controller.getActiveId())
        newProjectBtn.disabled = !active
        saveAsBtn.disabled = !active || viewing
        saveBtn.disabled = !active || onScratchpad || viewing
        saveBtn.title = viewing
            ? 'Viewing a book — open a blueprint to edit and save.'
            : onScratchpad
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

    // The cloud-conflict chooser — an in-panel modal (reuses the .library-picker
    // overlay like confirmModal/textModal). Unlike confirmModal's single confirm,
    // the outcomes are explicit choices, each annotated with when that side was
    // last changed so the user can judge which to keep. Two structurally different
    // conflicts share this modal (`kind`): a `diverged` one, where the cloud is
    // genuinely newer, and a `first-attach` one, where this device and the cloud
    // hold unrelated libraries and neither is "newer". Both offer a third,
    // non-destructive "sign out" abort so a user with messy local state can bail
    // back to before sign-in and back up first.
    //
    // Guards against stacking: the ⚠ re-entry point can fire while a chooser is
    // already up, so a second open no-ops (resolving null) rather than layering a
    // duplicate overlay.
    let conflictOpen = false
    const promptConflict = (
        kind: ConflictKind,
        local: { updatedAt: number },
        remote: { updatedAt: number }
    ): Promise<ConflictPromptChoice | null> => {
        if (conflictOpen) return Promise.resolve(null)
        open() // ensure the panel (and thus the in-panel modal) is visible
        conflictOpen = true
        return new Promise(resolve => {
            const overlay = document.createElement('div')
            overlay.className = 'library-picker'
            const box = document.createElement('div')
            box.className = 'library-picker-box library-dialog'
            const text = document.createElement('div')
            text.className = 'library-dialog-text'
            text.textContent =
                kind === 'first-attach'
                    ? 'This device and the cloud have different libraries.'
                    : 'Cloud copy is newer — it was changed on another device.'
            // First-attach gets an extra line spelling out the situation (there's no
            // "newer" side to reason about, so the timestamps below stay neutral).
            const explain = document.createElement('div')
            explain.className = 'library-conflict-explain'
            if (kind === 'first-attach') {
                explain.textContent =
                    'You signed in on a device that already has its own library; ' +
                    'keeping one discards the other.'
            }
            const detail = document.createElement('div')
            detail.className = 'library-conflict-times'
            const when = (ms: number): string => (ms ? new Date(ms).toLocaleString() : 'unknown')
            detail.textContent = `This device: ${when(local.updatedAt)} · Cloud: ${when(remote.updatedAt)}`
            const row = document.createElement('div')
            row.className = 'library-dialog-actions'
            const done = (v: ConflictPromptChoice | null): void => {
                conflictOpen = false
                overlay.remove()
                resolve(v)
            }
            const mine = document.createElement('button')
            mine.type = 'button'
            mine.textContent = 'Keep this device’s copy'
            mine.addEventListener('click', () => done('keep-mine'))
            const theirs = document.createElement('button')
            theirs.type = 'button'
            theirs.className = 'library-dialog-confirm'
            theirs.textContent = 'Take the cloud copy'
            theirs.addEventListener('click', () => done('take-theirs'))
            // The abort: sign out without touching either side, so the user can back
            // up before deciding (index.ts maps this to signOut(), not a resolve).
            const signOut = document.createElement('button')
            signOut.type = 'button'
            signOut.className = 'library-conflict-signout'
            signOut.textContent = 'Neither — sign out'
            signOut.addEventListener('click', () => done('sign-out'))
            row.append(mine, theirs, signOut)
            box.append(text)
            if (kind === 'first-attach') box.append(explain)
            box.append(detail, row)
            overlay.appendChild(box)
            // A backdrop click dismisses without choosing (the conflict persists;
            // the next reconcile — or a click on the ⚠ glyph — re-raises it).
            overlay.addEventListener('click', e => {
                if (e.target === overlay) done(null)
            })
            panel.appendChild(overlay)
        })
    }

    return { toggle, open, close, refresh, syncChanged: renderSync, promptConflict }
}
