import FD, { namesMissingFromInventoryLayout } from './factorioData'

/**
 * Render-free projection of the item/recipe/module selector's choices (#98).
 *
 * The Pixi InventoryDialog walks `FD.inventoryLayout` inline; the DOM selector
 * (the first dialog to leave the canvas) needs the same walk without touching
 * Pixi, so the rules live here once: group tabs in layout order, one row block
 * per subgroup, the `creative` group only in the unfiltered main inventory,
 * every name shown exactly once across all tabs (a recipe and its like-named
 * product both land in the layout — `nuclear-fuel`, `lubricant`, …), and
 * filtered pickers get a trailing "Other" group for names the layout couldn't
 * place (modded recipes that inherit their subgroup from an unresolved
 * product; see recipePicker.test.ts).
 */

export interface CatalogGroup {
    /** Prototype group name (`logistics`, `production`, …; `other` for orphans). */
    name: string
    /** Human tab label — the group's localised name. */
    label: string
    /** One entry per non-empty subgroup: the item names it shows, in order. */
    rows: string[][]
}

/**
 * Whether `name` is offered by a selector with the given filter — filtered
 * pickers (recipe/module/item-filter) show exactly their whitelist; the main
 * inventory shows every item that places an entity or tile the pack knows.
 */
export function isItemAllowed(name: string, itemsFilter?: string[]): boolean {
    if (itemsFilter !== undefined) return itemsFilter.includes(name)
    const itemData = FD.items[name]
    if (!itemData) return false
    if (!itemData.place_result && !itemData.place_as_tile) return false
    // needed for robots/trains/cars
    if (itemData.place_result && !FD.entities[itemData.place_result]) return false
    return true
}

/** Display name for search/labels — the localised name, falling back to the id. */
export function itemDisplayName(name: string): string {
    // LocalisedString can be a non-string (a number, or a key+params array the
    // exporter didn't flatten) — only a plain string is usable as a label.
    const localised = FD.items[name]?.localised_name
    return typeof localised === 'string' ? localised : name
}

export function buildItemCatalog(itemsFilter?: string[]): CatalogGroup[] {
    const groups: CatalogGroup[] = []
    const placed = new Set<string>()

    for (const group of FD.inventoryLayout) {
        // Make creative entities available only in the main inventory
        if (group.name === 'creative' && itemsFilter !== undefined) continue

        const rows: string[][] = []
        // Modded dumps can carry groups with nothing placeable in them: an
        // empty Lua table serializes as `{}` — an object, not an array — so
        // guard on the shape, not just nullishness.
        const subgroups = Array.isArray(group.subgroups) ? group.subgroups : []
        for (const subgroup of subgroups) {
            const row: string[] = []
            const subgroupItems = Array.isArray(subgroup.items) ? subgroup.items : []
            for (const item of subgroupItems) {
                if (!isItemAllowed(item.name, itemsFilter)) continue
                if (placed.has(item.name)) continue
                placed.add(item.name)
                row.push(item.name)
            }
            if (row.length > 0) rows.push(row)
        }
        if (rows.length > 0) {
            groups.push({ name: group.name, label: group.localised_name ?? group.name, rows })
        }
    }

    // Filtered names the layout couldn't place still need to be selectable.
    if (itemsFilter !== undefined) {
        const orphans = namesMissingFromInventoryLayout(itemsFilter).filter(n => !placed.has(n))
        if (orphans.length > 0) groups.push({ name: 'other', label: 'Other', rows: [orphans] })
    }

    return groups
}

/**
 * Case-insensitive substring match on the display name and the internal id —
 * the search box's predicate ("assembl" hits every assembling machine; power
 * users can type prototype names directly).
 */
export function itemMatchesQuery(name: string, query: string): boolean {
    const q = query.trim().toLowerCase()
    if (q === '') return true
    return name.toLowerCase().includes(q) || itemDisplayName(name).toLowerCase().includes(q)
}
