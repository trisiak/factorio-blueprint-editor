import type { Editor, CatalogGroup } from '@fbe/editor'
import {
    inputMode,
    buildItemCatalog,
    isItemAllowed,
    itemDisplayName,
    itemMatchesQuery,
    getRecents,
    recordRecent,
} from '@fbe/editor'
import { applyPackIcon } from '../packIcons'
import { openDialogShell, DialogShell } from './shell'

// The DOM item selector (#98 Slice 1) — the mobile presentation of the main
// inventory (E / rail "Items"), and the first Pixi dialog to leave the canvas.
// The editor opens it over `fbe:openinventory` (see UIContainer.
// openMainInventory; a repeat request while open toggles it closed) and takes
// the pick back through `editor.spawnPaintItem`. Everything it shows comes
// from the render-free seams: `buildItemCatalog` (the same walk the Pixi
// dialog does inline), `getRecents`/`recordRecent` (shared storage — recents
// survive the migration), `editor.quickbarItems` (Pin) and
// `editor.blueprintItemNames` (the Recents tab's third section). What DOM buys
// over the Pixi dialog: native scrolling and a real search box — the first
// text input touch users get in a selector (#56).
//
// Selection keeps the touch two-step the Pixi dialog established: a tap
// *previews* the item (name + Pin/✓ Confirm in the footer), a second tap on it
// — or ✓ — commits. The editor-embedded pickers (recipe/module/filter slots)
// are NOT this dialog; they stay Pixi until their editors migrate.

const RECENTS_TAB = '★-recents' // ★ — synthetic, can't collide with a group name

export function initInventorySelector(editor: Editor): void {
    let open: DialogShell | null = null

    window.addEventListener('fbe:openinventory', e => {
        if (open) {
            // A repeat request (E / rail "Items" while open) toggles it closed.
            open.close()
            return
        }
        if (inputMode.mode !== 'mobile') return
        open = openSelector(
            editor,
            (e as CustomEvent<{ preview?: string }>).detail?.preview,
            () => {
                open = null
            }
        )
    })
}

function openSelector(
    editor: Editor,
    initialPreview: string | undefined,
    onClosed: () => void
): DialogShell {
    const shell = openDialogShell({
        title: 'Items',
        className: 'inventory-selector',
        onClose: onClosed,
    })

    const catalog = buildItemCatalog()
    let activeTab = RECENTS_TAB
    let previewName: string | null = null

    // --- structure: search, tabs, scrolling grid, preview footer ------------
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

    const cell = (name: string): HTMLElement => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'is-cell'
        btn.dataset.item = name
        btn.title = itemDisplayName(name)
        const icon = document.createElement('span')
        if (!applyPackIcon(icon, `item/${name}`, 32)) icon.textContent = itemDisplayName(name)
        btn.appendChild(icon)
        btn.addEventListener('click', () => {
            // Two-step select: first tap previews, a repeat tap commits.
            if (previewName === name) commit(name)
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

    /** The Recents tab mirrors the Pixi dialog's three colour-coded sections. */
    const renderRecents = (): void => {
        const seen = new Set<string>()
        const collect = (names: string[], dedupeAgainstShown: boolean): string[] => {
            const out: string[] = []
            for (const name of names) {
                if (!isItemAllowed(name) || out.includes(name)) continue
                if (dedupeAgainstShown && seen.has(name)) continue
                out.push(name)
            }
            for (const name of out) seen.add(name)
            return out
        }
        const recent = collect(getRecents('items'), false)
        const quickbar = collect(
            editor.quickbarItems.filter((n): n is string => !!n),
            false
        )
        const onBlueprint = collect(editor.blueprintItemNames, true)

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

    // --- preview footer: icon + name, Pin/Unpin, ✓ Confirm ------------------
    const highlightPreview = (): void => {
        for (const el of grid.querySelectorAll<HTMLElement>('.is-cell')) {
            el.classList.toggle('active', el.dataset.item === previewName)
        }
    }

    const setPreview = (name: string | null): void => {
        previewName = name
        footer.replaceChildren()
        highlightPreview()
        if (!name) return

        const icon = document.createElement('span')
        icon.className = 'is-footer-icon'
        if (!applyPackIcon(icon, `item/${name}`, 24)) icon.textContent = ''
        const label = document.createElement('span')
        label.className = 'is-footer-name'
        label.textContent = itemDisplayName(name)

        const pinned = (): boolean => editor.quickbarItems.includes(name)
        const pin = document.createElement('button')
        pin.type = 'button'
        pin.className = 'is-pin'
        pin.textContent = pinned() ? 'Unpin' : 'Pin'
        pin.addEventListener('click', () => {
            // Pin = membership in the quickbar's slots; the quickbar itself is
            // retired on mobile, but its state feeds the Recents tab (and the
            // desktop bar, should the user switch back).
            const items = editor.quickbarItems.filter((n): n is string => !!n)
            editor.quickbarItems = pinned() ? items.filter(n => n !== name) : [...items, name]
            pin.textContent = pinned() ? 'Unpin' : 'Pin'
            if (activeTab === RECENTS_TAB && search.value.trim() === '') renderGrid()
        })

        const confirm = document.createElement('button')
        confirm.type = 'button'
        confirm.className = 'is-confirm'
        confirm.textContent = '✓ Confirm'
        confirm.addEventListener('click', () => commit(name))

        footer.append(icon, label, pin, confirm)
    }

    const commit = (name: string): void => {
        recordRecent('items', name)
        editor.spawnPaintItem(name)
        shell.close()
    }

    search.addEventListener('input', renderGrid)

    renderTabs()
    renderGrid()
    if (initialPreview) setPreview(initialPreview)

    return shell
}
