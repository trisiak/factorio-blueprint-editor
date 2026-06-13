import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import FD, { loadData } from '../../core/factorioData'
import { Entity } from '../../core/Entity'
import type { IEntity } from '../../types'
import type { Blueprint } from '../../core/Blueprint'
import { editorKindFor } from './factory'

// editorKindFor reads only name/entityData/type/acceptedRecipes/moduleSlots —
// none of which touch the Blueprint — so a stub BP is enough to build entities.
const stubBP = undefined as unknown as Blueprint
const makeEntity = (name: string): Entity =>
    new Entity({ entity_number: 1, name, position: { x: 0, y: 0 } } as IEntity, stubBP)

/**
 * Entity-editor routing audit + ratchet (issue #28).
 *
 * `editorKindFor` is the pure routing half of `createEditor` (the other half
 * just constructs the matching PixiJS editor, which needs a canvas). This test
 * runs every entity of every pack through it and pins two things:
 *
 *  - how many entities get an editor at all (sanity), and
 *  - the GAP set: entities with genuinely configurable state (a module slot, or
 *    a selectable recipe on a non-furnace/non-silo crafting machine) that route
 *    to NO editor — so that state is unreachable in the UI.
 *
 * The gap list is a RATCHET. `editorKindFor` now routes the beacon / lab /
 * mining-drill editor families by *type* (when the entity has module slots),
 * not by vanilla name, so modded variants reach the right editor — every pack
 * is now gap-free. The test fails if the set grows (a new pack/entity
 * regressed); restore the relevant entries with a comment if that's intended.
 *
 * Browser-verified separately: all editor-yielding space-exploration entities
 * open their editor without console/page errors (sweep via the `?test`
 * openEntityEditor hook), and SE's wide beacons show their full module grid.
 */

// Entities that SHOULD expose configurable state but get no editor. Empty
// everywhere now that routing is type-based; furnaces / rocket-silos with no
// module slots are correctly absent (they auto-select their recipe).
const KNOWN_GAPS: Record<string, string[]> = {
    'vanilla-2.0': [],
    'space-age': [],
    'space-exploration': [],
}

describe.each(Object.keys(KNOWN_GAPS))('editor routing: %s', pack => {
    it('matches the known-gap baseline', () => {
        loadData(readFileSync(`packages/exporter/data/output/${pack}/data.json`, 'utf8'))

        const gaps: string[] = []
        let withEditor = 0
        for (const name of Object.keys(FD.entities)) {
            const e = makeEntity(name)
            let kind: ReturnType<typeof editorKindFor>
            let modules = 0
            let recipes = 0
            try {
                kind = editorKindFor(e)
                modules = e.moduleSlots
                recipes = e.acceptedRecipes.length
            } catch {
                continue
            }
            if (kind) {
                withEditor++
                continue
            }
            // No editor, but it has configurable state the user can't reach.
            // Recipes only count as reachable-via-editor for non furnace/silo
            // (those auto-select), matching editorKindFor's own rule.
            const recipeReachable = recipes > 0 && e.type !== 'furnace' && e.type !== 'rocket-silo'
            if (modules > 0 || recipeReachable) gaps.push(name)
        }

        expect(withEditor).toBeGreaterThan(0)
        expect(gaps.sort(), `routing gaps for ${pack}`).toEqual([...KNOWN_GAPS[pack]].sort())
    })
})
