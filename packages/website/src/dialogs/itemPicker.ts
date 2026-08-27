import type { Editor, CatalogGroup } from '@fbe/editor'
import {
    buildItemCatalog,
    isItemAllowed,
    itemDisplayName,
    itemMatchesQuery,
    getRecents,
    recordRecent,
} from '@fbe/editor'
import { applyAnyPackIcon } from '../packIcons'
import { openDialogShell, DialogShell } from './shell'

// The DOM item picker (#98) — the one grid every DOM selector opens: the main
// inventory (inventorySelector.ts) and the editors' filtered pickers (recipe /
// module slots, entityEditor.ts) are the same surface with different options,
// exactly like the Pixi InventoryDialog before it. Everything rendered comes
// from the render-free seams (buildItemCatalog, getRecents/recordRecent — the
// storage the Pixi dialog shares, so history survives the migration) plus the
// pack's browser icon sheet.
//
// Selection semantics mirror the Pixi dialog's, deliberately:
//  - default: tap *previews* (footer shows the item + ✓ Confirm), a second tap
//    on it — or ✓ — commits; the deliberate two-step that lowers misclicks.
//  - `commitOnTap` (the module picker): a tap commits outright — filling
//    module slots means opening this once per slot, and the choice is a
//    handful of near-identical icons you already know.
//  - `clear`: the escape hatch when opened *from a slot* — "✕ Clear" on a
//    filled slot, "✕ Cancel" on an empty one; same action (empty, close).

export interface ItemPickerOpts {
    title: string
    /** Whitelist for filtered pickers; omit for the placeable main inventory. */
    itemsFilter?: string[]
    /** Recents category ('items' / 'recipes' / 'modules') — shared storage. */
    recentsKey: 'items' | 'recipes' | 'modules'
    /** Tap commits outright, skipping the preview → ✓ Confirm two-step. */
    commitOnTap?: boolean
    /** Escape-hatch button when opened from a slot: empty the slot and close. */
    clear?: { filled: boolean; onClear: () => void }
    /** Pin/Unpin + the Quickbar recents section (main inventory only). */
    quickbarPin?: boolean
    onPick: (name: string) => void
    initialPreview?: string
    onClosed?: () => void
}

export function openItemPicker(editor: Editor, opts: ItemPickerOpts): DialogShell {
    const shell = openDialogShell({
        title: opts.title,
        className: 'item-picker',
        onClose: opts.onClosed,
    })

    const catalog = buildItemCatalog(opts.itemsFilter)
    const RECENTS_TAB = '★-recents' // synthetic — can't collide with a group name
    let activeTab = RECENTS_TAB
    let previewName: string | null = null

    // --- structure: search, tabs, scrolling grid, footer --------------------
    const search = document.createElement('input')
    search.type = 'search'
    search.className = 'is-search'
    search.placeholder = 'Search items…'
    search.autocomplete = 'off'

    const tabs = document.createElement('div')
    tabs.className = 'is-tabs'

    const grid = document.createElement('div')
    grid.className = 'is-grid'

    const footer = document.createElement('div')
    footer.className = 'is-footer'

    shell.body.append(search, tabs, grid, footer)

    const allowed = (name: string): boolean => isItemAllowed(name, opts.itemsFilter)

    const cell = (name: string): HTMLElement => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'is-cell'
        btn.dataset.item = name
        btn.title = itemDisplayName(name)
        const icon = document.createElement('span')
        if (!applyAnyPackIcon(icon, name, 32)) icon.textContent = itemDisplayName(name)
        btn.appendChild(icon)
        btn.addEventListener('click', () => {
            if (opts.commitOnTap || previewName === name) commit(name)
            else setPreview(name)
        })
        return btn
    }

    const rowEl = (names: string[]): HTMLElement => {
        const row = document.createElement('div')
        row.className = 'is-row'
        for (const name of names) row.appendChild(cell(name))
        return row
    }

    const sectionHeader = (label: string, cls: string): HTMLElement => {
        const h = document.createElement('div')
        h.className = `is-section ${cls}`
        h.textContent = label
        return h
    }

    /** The ★ tab mirrors the Pixi dialog's colour-coded sections. */
    const renderRecents = (): void => {
        const seen = new Set<string>()
        const collect = (names: string[], dedupeAgainstShown: boolean): string[] => {
            const out: string[] = []
            for (const name of names) {
                if (!allowed(name) || out.includes(name)) continue
                if (dedupeAgainstShown && seen.has(name)) continue
                out.push(name)
            }
            for (const name of out) seen.add(name)
            return out
        }
        const recent = collect(getRecents(opts.recentsKey), false)
        const quickbar = opts.quickbarPin
            ? collect(
                  editor.quickbarItems.filter((n): n is string => !!n),
                  false
              )
            : []
        const onBlueprint = collect(editor.blueprintUsedNames(opts.recentsKey), true)

        if (recent.length) {
            grid.appendChild(sectionHeader('Recent', 'is-recent'))
            grid.appendChild(rowEl(recent))
        }
        if (quickbar.length) {
            grid.appendChild(sectionHeader('Quickbar', 'is-quickbar'))
            grid.appendChild(rowEl(quickbar))
        }
        if (onBlueprint.length) {
            grid.appendChild(sectionHeader('On blueprint', 'is-onbp'))
            grid.appendChild(rowEl(onBlueprint))
        }
        if (!recent.length && !quickbar.length && !onBlueprint.length) {
            const empty = document.createElement('div')
            empty.className = 'is-empty'
            empty.textContent = 'Nothing recent yet — picks land here.'
            grid.appendChild(empty)
        }
    }

    const renderGroup = (group: CatalogGroup): void => {
        for (const row of group.rows) grid.appendChild(rowEl(row))
    }

    /** Search results: a flat grid over every group, layout order preserved. */
    const renderSearch = (query: string): void => {
        const matches: string[] = []
        for (const group of catalog) {
            for (const row of group.rows) {
                for (const name of row) if (itemMatchesQuery(name, query)) matches.push(name)
            }
        }
        if (matches.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'is-empty'
            empty.textContent = `No items match “${query}”.`
            grid.appendChild(empty)
        } else {
            grid.appendChild(rowEl(matches))
        }
    }

    const renderGrid = (): void => {
        grid.replaceChildren()
        grid.scrollTop = 0
        const query = search.value.trim()
        if (query !== '') renderSearch(query)
        else if (activeTab === RECENTS_TAB) renderRecents()
        else {
            const group = catalog.find(g => g.name === activeTab)
            if (group) renderGroup(group)
        }
        highlightPreview()
    }

    const renderTabs = (): void => {
        tabs.replaceChildren()
        const tab = (id: string, label: string): void => {
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = `is-tab${id === activeTab ? ' active' : ''}`
            btn.textContent = label
            btn.addEventListener('click', () => {
                activeTab = id
                // Picking a tab leaves search mode — the tab bar is the "back".
                search.value = ''
                renderTabs()
                renderGrid()
            })
            tabs.appendChild(btn)
        }
        tab(RECENTS_TAB, '★')
        for (const group of catalog) tab(group.name, group.label)
    }

    // --- footer: ✕ Clear/Cancel (persistent) + preview (name, Pin, ✓) -------
    const highlightPreview = (): void => {
        for (const el of grid.querySelectorAll<HTMLElement>('.is-cell')) {
            el.classList.toggle('active', el.dataset.item === previewName)
        }
    }

    const previewArea = document.createElement('div')
    previewArea.className = 'is-preview'

    // The escape hatch is *always* available (unlike Confirm, which needs a
    // preview) — same reasoning as the Pixi picker's title-row button: on a
    // phone the picker covers nearly the whole canvas, so a first-time "open a
    // recipe slot, change your mind" needs an obvious way out.
    if (opts.clear) {
        const clearBtn = document.createElement('button')
        clearBtn.type = 'button'
        clearBtn.className = 'is-clear'
        clearBtn.textContent = opts.clear.filled ? '✕ Clear' : '✕ Cancel'
        clearBtn.addEventListener('click', () => {
            opts.clear.onClear()
            shell.close()
        })
        footer.appendChild(clearBtn)
    }
    footer.appendChild(previewArea)

    const setPreview = (name: string | null): void => {
        previewName = name
        previewArea.replaceChildren()
        highlightPreview()
        if (!name) return

        const icon = document.createElement('span')
        icon.className = 'is-footer-icon'
        if (!applyAnyPackIcon(icon, name, 24)) icon.textContent = ''
        const label = document.createElement('span')
        label.className = 'is-footer-name'
        label.textContent = itemDisplayName(name)
        previewArea.append(icon, label)

        if (opts.quickbarPin) {
            const pinned = (): boolean => editor.quickbarItems.includes(name)
            const pin = document.createElement('button')
            pin.type = 'button'
            pin.className = 'is-pin'
            pin.textContent = pinned() ? 'Unpin' : 'Pin'
            pin.addEventListener('click', () => {
                // Pin = membership in the quickbar's slots; the quickbar itself
                // is retired on mobile, but its state feeds the ★ tab (and the
                // desktop bar, should the user switch back).
                const items = editor.quickbarItems.filter((n): n is string => !!n)
                editor.quickbarItems = pinned() ? items.filter(n => n !== name) : [...items, name]
                pin.textContent = pinned() ? 'Unpin' : 'Pin'
                if (activeTab === RECENTS_TAB && search.value.trim() === '') renderGrid()
            })
            previewArea.appendChild(pin)
        }

        const confirm = document.createElement('button')
        confirm.type = 'button'
        confirm.className = 'is-confirm'
        confirm.textContent = '✓ Confirm'
        confirm.addEventListener('click', () => commit(name))
        previewArea.appendChild(confirm)
    }

    const commit = (name: string): void => {
        recordRecent(opts.recentsKey, name)
        opts.onPick(name)
        shell.close()
    }

    search.addEventListener('input', renderGrid)

    renderTabs()
    renderGrid()
    if (opts.initialPreview) setPreview(opts.initialPreview)

    return shell
}
