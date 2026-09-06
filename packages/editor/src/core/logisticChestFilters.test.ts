import { describe, it, expect, beforeAll } from 'vitest'
import FD, { loadData } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import type { IEntity, LogisticSections } from '../types'
import { havePackData, readPackData } from './packDataFiles'

/**
 * Logistic-chest requests — the `request_filters.sections` read/write path.
 *
 * `Entity`'s setter was an unimplemented `throw` until now, so chest filters
 * could be read but never written (and the editor that would have written them
 * was never routed). These pin the write shape, since it lands directly in the
 * exported blueprint string: getting it wrong produces a blueprint Factorio
 * rejects, which no amount of UI testing would catch.
 *
 * `Blueprint`/`Entity` are framework-free, so this runs in the node environment
 * without a canvas — the first unit coverage of the entity setters (the harness
 * gap noted in #31).
 */

const have = havePackData('vanilla-2.0')

/** Raw `request_filters` as it would serialize into the blueprint string. */
const raw = (e: Entity): LogisticSections =>
    (e as unknown as { m_rawEntity: IEntity }).m_rawEntity.request_filters as LogisticSections

const makeChest = (name: string, data?: Partial<IEntity>): Entity => {
    const bp = new Blueprint()
    return bp.createEntity({
        name,
        position: { x: 0.5, y: 0.5 },
        ...data,
    } as IEntity)
}

describe.skipIf(!have)('logistic chest filters', () => {
    beforeAll(() => loadData(readPackData('vanilla-2.0')))

    it('exposes slots per logistic mode, and none for providers', () => {
        // Storage declares max_logistic_slots=1; requester/buffer declare none and
        // fall back to the flat grid; providers request nothing at all.
        expect(makeChest('storage-chest').filterSlots).toBe(1)
        expect(makeChest('requester-chest').filterSlots).toBe(30)
        expect(makeChest('buffer-chest').filterSlots).toBe(30)
        expect(makeChest('passive-provider-chest').filterSlots).toBe(0)
        expect(makeChest('active-provider-chest').filterSlots).toBe(0)
    })

    it('writes a request into section 0 of a chest that had none', () => {
        // The case that used to throw twice over: no request_filters to duplicate,
        // and a setter that was a bare `throw`.
        const e = makeChest('requester-chest')
        e.filters = [{ index: 1, name: 'iron-plate', count: 100 }]

        expect(raw(e).sections).toEqual([
            {
                index: 1,
                filters: [
                    // quality/comparator are written the way the game writes them
                    // — see `qualitySpec` in core/itemFilters.ts.
                    {
                        index: 1,
                        name: 'iron-plate',
                        count: 100,
                        quality: 'normal',
                        comparator: '=',
                    },
                ],
            },
        ])
        expect(e.filters.map(f => f.name)).toEqual(['iron-plate'])
    })

    it('defaults a missing count rather than emitting an invalid filter', () => {
        // A storage chest has no count in the UI, but LogisticFilter.count is
        // required — matching how the pre-2.0 import normalizes.
        const e = makeChest('storage-chest')
        e.filters = [{ index: 1, name: 'iron-plate' }]

        expect(raw(e).sections[0].filters[0]).toEqual({
            index: 1,
            name: 'iron-plate',
            count: 1,
            quality: 'normal',
            comparator: '=',
        })
    })

    it('clears a request without disturbing its siblings', () => {
        // request_from_buffers and trash_not_requested live next to `sections`, so
        // clearing must not take out the rest of request_filters.
        const e = makeChest('requester-chest', {
            request_filters: {
                request_from_buffers: true,
                trash_not_requested: true,
                sections: [{ index: 1, filters: [{ index: 1, name: 'iron-plate', count: 5 }] }],
            },
        } as Partial<IEntity>)

        e.filters = [{ index: 1, name: undefined }]

        expect(e.filters).toEqual([])
        expect(raw(e).sections[0].filters).toBeUndefined()
        expect(raw(e).request_from_buffers).toBe(true)
        expect(raw(e).trash_not_requested).toBe(true)
    })

    it('keeps attributes the editor does not model through an edit', () => {
        // The Filters component rebuilds its slots as bare {index,name,count}, so
        // without merging onto the existing entry a count change would silently
        // drop quality/comparator/max_count from an imported blueprint.
        const e = makeChest('requester-chest', {
            request_filters: {
                sections: [
                    {
                        index: 1,
                        filters: [
                            {
                                index: 1,
                                name: 'iron-plate',
                                count: 5,
                                quality: 'rare',
                                comparator: '=',
                                max_count: 50,
                            },
                        ],
                    },
                ],
            },
        } as Partial<IEntity>)

        e.filters = [{ index: 1, name: 'iron-plate', count: 42 }]

        expect(raw(e).sections[0].filters[0]).toEqual({
            index: 1,
            name: 'iron-plate',
            count: 42,
            quality: 'rare',
            comparator: '=',
            max_count: 50,
        })
    })

    it('preserves sections the editor never touches', () => {
        // Only section 0 is editable here; a grouped second section must survive.
        const e = makeChest('requester-chest', {
            request_filters: {
                sections: [
                    { index: 1, filters: [{ index: 1, name: 'iron-plate', count: 5 }] },
                    { index: 2, group: 'my-group', multiplier: 2 },
                ],
            },
        } as Partial<IEntity>)

        e.filters = [{ index: 1, name: 'copper-plate', count: 5 }]

        expect(raw(e).sections[1]).toEqual({ index: 2, group: 'my-group', multiplier: 2 })
    })

    it('is a no-op when nothing actually changed', () => {
        // Guards against every slot repaint pushing a redundant undo entry.
        const e = makeChest('requester-chest')
        e.filters = [{ index: 1, name: 'iron-plate', count: 5 }]
        const before = raw(e)

        e.filters = [{ index: 1, name: 'iron-plate', count: 5 }]

        // Unchanged writes don't go through history, so the object is untouched.
        expect(raw(e)).toBe(before)
    })

    it('round-trips through undo/redo', () => {
        const bp = new Blueprint()
        const e = bp.createEntity({
            name: 'requester-chest',
            position: { x: 0.5, y: 0.5 },
        } as IEntity)

        e.filters = [{ index: 1, name: 'iron-plate', count: 7 }]
        expect(e.filters.map(f => f.name)).toEqual(['iron-plate'])

        bp.history.undo()
        expect(e.filters).toEqual([])

        bp.history.redo()
        expect(e.filters.map(f => f.name)).toEqual(['iron-plate'])
    })

    it('reports chests as filter-editable so the clear hint is offered', () => {
        expect(makeChest('storage-chest').canEditFilters).toBe(true)
        expect(makeChest('requester-chest').canEditFilters).toBe(true)
        expect(makeChest('buffer-chest').canEditFilters).toBe(true)
    })

    it('reads request_from_buffers off a chest that has no request_filters', () => {
        // Reading through an absent request_filters threw a TypeError, which took
        // the requester-chest editor down as it built its checkbox.
        expect(makeChest('requester-chest').requestFromBufferChest).toBe(false)
    })

    it('sets request_from_buffers on a chest that has no request_filters', () => {
        const e = makeChest('requester-chest')
        e.requestFromBufferChest = true
        expect(e.requestFromBufferChest).toBe(true)
        expect(raw(e).request_from_buffers).toBe(true)
    })

    it('routes modded logistic containers by mode, not by vanilla name', () => {
        // Mod-safety: the getters/setters key off type + logistic_mode, so any
        // prototype of the type behaves like its vanilla counterpart.
        const modes = Object.entries(FD.entities)
            .filter(([, p]) => (p as { type?: string }).type === 'logistic-container')
            .map(([name]) => makeChest(name).logisticMode)
        expect(modes).toContain('requester')
        expect(modes).toContain('storage')
        expect(modes.every(m => m !== undefined)).toBe(true)
    })
})
