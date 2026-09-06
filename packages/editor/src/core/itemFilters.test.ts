import { describe, it, expect, beforeAll } from 'vitest'
import { loadData } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import type { IEntity, ItemFilter, SplitterFilter } from '../types'
import { havePackData, readPackData } from './packDataFiles'

/**
 * Item filters carry a quality spec — inserters and splitters.
 *
 * A filter written without `quality`/`comparator` is not "no quality stated" to
 * Factorio: it reads as *any* quality and the game paints the five-dot
 * any-quality symbol over the slot, even in a save with no Quality mod (which is
 * how this surfaced — on the Space Exploration pack, whose mod list has no
 * Quality at all). The game's own exports always name `normal` + `=`, so these
 * pin that the editor does too, and that an imported blueprint's own quality
 * survives an unrelated edit.
 *
 * `Blueprint`/`Entity` are framework-free, so this runs in the node environment
 * alongside `logisticChestFilters.test.ts`, which pins the chest-request half.
 */

const have = havePackData('vanilla-2.0')

const rawOf = (e: Entity): IEntity => (e as unknown as { m_rawEntity: IEntity }).m_rawEntity

const make = (name: string, data?: Partial<IEntity>): Entity => {
    const bp = new Blueprint()
    return bp.createEntity({
        name,
        position: { x: 0.5, y: 0.5 },
        ...data,
    } as IEntity)
}

describe.skipIf(!have)('item filter quality spec', () => {
    beforeAll(() => loadData(readPackData('vanilla-2.0')))

    it('names normal quality on an inserter filter the editor writes', () => {
        const e = make('inserter')
        e.filters = [{ index: 1, name: 'iron-plate' }]

        expect(rawOf(e).filters).toEqual([
            { index: 1, name: 'iron-plate', quality: 'normal', comparator: '=' },
        ])
    })

    it('names normal quality on a splitter filter the editor writes', () => {
        const e = make('splitter')
        e.filters = [{ index: 1, name: 'iron-plate' }]

        expect(rawOf(e).filter).toEqual({
            name: 'iron-plate',
            quality: 'normal',
            comparator: '=',
        })
    })

    it("keeps an imported inserter filter's quality through an edit", () => {
        // The Filters control rebuilds every slot as a bare {index, name}, so
        // adding a second filter used to strip the first one's quality.
        const e = make('inserter', {
            filters: [{ index: 1, name: 'iron-plate', quality: 'legendary', comparator: '≥' }],
        } as Partial<IEntity>)

        e.filters = [
            { index: 1, name: 'iron-plate' },
            { index: 2, name: 'copper-plate' },
        ]

        expect(rawOf(e).filters).toEqual([
            { index: 1, name: 'iron-plate', quality: 'legendary', comparator: '≥' },
            { index: 2, name: 'copper-plate', quality: 'normal', comparator: '=' },
        ])
    })

    it("keeps an imported splitter filter's quality through an edit", () => {
        const e = make('splitter', {
            filter: { name: 'iron-plate', quality: 'rare', comparator: '=' },
        } as Partial<IEntity>)

        e.filters = [{ index: 1, name: 'copper-plate' }]

        expect(rawOf(e).filter).toEqual({
            name: 'copper-plate',
            quality: 'rare',
            comparator: '=',
        })
    })

    it('clears filters without leaving an empty spec behind', () => {
        const e = make('inserter')
        e.filters = [{ index: 1, name: 'iron-plate' }]
        e.filters = undefined

        expect(rawOf(e).filters).toBeUndefined()

        const s = make('splitter')
        s.filters = [{ index: 1, name: 'iron-plate' }]
        s.filters = undefined

        expect(rawOf(s).filter).toBeUndefined()
    })

    it('does not write history for a re-set of the same filter', () => {
        // The setter now normalizes before comparing; comparing the *incoming*
        // bare slots against the stamped raw ones would never match, so every
        // repaint of the editor would push an undo entry.
        const e = make('inserter')
        e.filters = [{ index: 1, name: 'iron-plate' }]
        const before = rawOf(e).filters as ItemFilter[]

        e.filters = [{ index: 1, name: 'iron-plate' }]

        expect(rawOf(e).filters).toBe(before)
    })

    it("pasted settings carry the source's quality, not the target's", () => {
        // `pasteSettings` routes through the same setter with the *source's* raw
        // filters, so the incoming spec has to outrank whatever the target slot
        // was holding — otherwise a paste silently normalizes the copy.
        const source = make('inserter', {
            filters: [{ index: 1, name: 'iron-plate', quality: 'legendary', comparator: '=' }],
        } as Partial<IEntity>)
        const target = make('inserter', {
            position: { x: 2.5, y: 0.5 },
            filters: [{ index: 1, name: 'copper-plate', quality: 'rare', comparator: '=' }],
        } as Partial<IEntity>)

        target.pasteSettings(source)

        expect(rawOf(target).filters).toEqual([
            { index: 1, name: 'iron-plate', quality: 'legendary', comparator: '=' },
        ])
    })

    it('does not write history for a re-set of the same splitter filter', () => {
        const e = make('splitter')
        e.filters = [{ index: 1, name: 'iron-plate' }]
        const before = rawOf(e).filter as SplitterFilter

        e.filters = [{ index: 1, name: 'iron-plate' }]

        expect(rawOf(e).filter).toBe(before)
    })
})
