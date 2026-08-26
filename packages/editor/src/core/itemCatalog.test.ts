import { describe, it, expect, beforeEach } from 'vitest'
import FD, { loadData } from './factorioData'
import { havePackData, readPackData } from './packDataFiles'
import { buildItemCatalog, isItemAllowed, itemDisplayName, itemMatchesQuery } from './itemCatalog'

/**
 * The DOM selector (#98) renders straight from buildItemCatalog, so the walk
 * rules the Pixi InventoryDialog implements inline are pinned here: dedup
 * across tabs, creative gating, per-subgroup rows, and the "Other" orphan tab.
 * A synthetic FD keeps the rules testable without pack data; the pack-data
 * case (CI) then asserts the projection holds on a real dump.
 */

type AnyFD = {
    inventoryLayout: unknown
    items: Record<string, unknown>
    entities: Record<string, unknown>
}

const fd = FD as unknown as AnyFD

function stubFD(): void {
    fd.items = {
        'transport-belt': { localised_name: 'Transport belt', place_result: 'transport-belt' },
        'fast-inserter': { localised_name: 'Fast inserter', place_result: 'fast-inserter' },
        landfill: { localised_name: 'Landfill', place_as_tile: {} },
        'iron-plate': { localised_name: 'Iron plate' }, // not placeable
        'ghost-item': { localised_name: 'Ghost', place_result: 'no-such-entity' },
    }
    fd.entities = { 'transport-belt': {}, 'fast-inserter': {} }
    fd.inventoryLayout = [
        {
            name: 'logistics',
            localised_name: 'Logistics',
            subgroups: [
                { name: 'belt', items: [{ name: 'transport-belt' }, { name: 'iron-plate' }] },
                { name: 'inserter', items: [{ name: 'fast-inserter' }] },
                // Empty Lua table serializes as an object, not an array.
                { name: 'broken', items: {} },
            ],
        },
        {
            name: 'terrain',
            localised_name: 'Terrain',
            subgroups: [
                // transport-belt again: dedup must keep only the first placement.
                { name: 'tiles', items: [{ name: 'landfill' }, { name: 'transport-belt' }] },
            ],
        },
        {
            name: 'creative',
            localised_name: 'Creative',
            subgroups: [{ name: 'c', items: [{ name: 'fast-inserter' }] }],
        },
        { name: 'empty-group', localised_name: 'Empty', subgroups: {} },
    ]
}

describe('buildItemCatalog (synthetic layout)', () => {
    beforeEach(stubFD)

    it('main inventory: placeable items only, deduped, one row per subgroup', () => {
        const catalog = buildItemCatalog()
        expect(catalog.map(g => g.name)).toEqual(['logistics', 'terrain'])
        const logistics = catalog[0]
        expect(logistics.label).toBe('Logistics')
        // iron-plate (not placeable) and ghost-item (dangling place_result) are
        // out; the empty subgroup contributes no row.
        expect(logistics.rows).toEqual([['transport-belt'], ['fast-inserter']])
        // terrain keeps landfill (tile) but not the already-placed belt...
        expect(catalog[1].rows).toEqual([['landfill']])
        // ...but creative appears in the unfiltered inventory only when it has
        // *new* names — fast-inserter was already placed, so the tab is gone.
    })

    it('filtered picker: whitelist only, creative excluded, orphans in Other', () => {
        const catalog = buildItemCatalog(['fast-inserter', 'iron-plate', 'not-in-layout'])
        expect(catalog.map(g => g.name)).toEqual(['logistics', 'other'])
        // The whitelist overrides placeability: iron-plate is offered.
        expect(catalog[0].rows).toEqual([['iron-plate'], ['fast-inserter']])
        expect(catalog[1]).toEqual({ name: 'other', label: 'Other', rows: [['not-in-layout']] })
    })

    it('isItemAllowed mirrors the main-inventory placeability rules', () => {
        expect(isItemAllowed('transport-belt')).toBe(true)
        expect(isItemAllowed('landfill')).toBe(true)
        expect(isItemAllowed('iron-plate')).toBe(false)
        expect(isItemAllowed('ghost-item')).toBe(false)
        expect(isItemAllowed('unknown')).toBe(false)
        expect(isItemAllowed('iron-plate', ['iron-plate'])).toBe(true)
    })

    it('search matches display name and internal id, case-insensitively', () => {
        expect(itemDisplayName('transport-belt')).toBe('Transport belt')
        expect(itemDisplayName('unknown-name')).toBe('unknown-name')
        expect(itemMatchesQuery('transport-belt', 'BELT')).toBe(true)
        expect(itemMatchesQuery('fast-inserter', 'insert')).toBe(true)
        expect(itemMatchesQuery('landfill', 'belt')).toBe(false)
        expect(itemMatchesQuery('anything', '  ')).toBe(true)
    })
})

describe('buildItemCatalog (real pack data)', () => {
    it.skipIf(!havePackData('vanilla-2.0'))('projects a well-formed vanilla catalog', () => {
        loadData(readPackData('vanilla-2.0'))
        const catalog = buildItemCatalog()
        expect(catalog.length).toBeGreaterThan(3)
        const seen = new Set<string>()
        for (const group of catalog) {
            expect(group.rows.length).toBeGreaterThan(0)
            for (const row of group.rows) {
                expect(row.length).toBeGreaterThan(0)
                for (const name of row) {
                    // Every name exactly once, and every name allowed.
                    expect(seen.has(name)).toBe(false)
                    seen.add(name)
                    expect(isItemAllowed(name)).toBe(true)
                }
            }
        }
        // The staples every vanilla catalog must offer.
        for (const staple of ['transport-belt', 'assembling-machine-3', 'landfill']) {
            expect(seen.has(staple)).toBe(true)
        }
    })
})
