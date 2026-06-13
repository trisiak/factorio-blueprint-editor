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
 * The gap list is a RATCHET. It exists because the factory matches several
 * editor families (beacon/lab/mining-drill) by vanilla *name*, so modded
 * variants of those types fall through. When routing is generalized to match by
 * type, delete the fixed entries here; the test fails if the set grows (a new
 * pack/entity regressed) or shrinks (a fix landed — update the baseline).
 *
 * Browser-verified separately: all 67 editor-yielding space-exploration
 * entities open their editor without console/page errors (manual sweep via the
 * `?test` openEntityEditor hook).
 */

// Entities that SHOULD expose configurable state but currently get no editor.
// furnaces / rocket-silos with no module slots are intentionally excluded —
// they auto-select their recipe, so "no editor" is correct, not a gap.
const KNOWN_GAPS: Record<string, string[]> = {
    // vanilla matches every editor family by name, so it has no gaps.
    'vanilla-2.0': [],
    // Not SE-specific: Space Age's biolab + big-mining-drill have module slots
    // but aren't the vanilla 'lab'/'electric-mining-drill' names, so no editor.
    'space-age': ['biolab', 'big-mining-drill'],
    'space-exploration': [
        'se-compact-beacon', // 10 module slots
        'se-compact-beacon-2', // 10
        'se-wide-beacon', // 15
        'se-wide-beacon-2', // 20
        'burner-lab', // 2
        'se-space-science-lab', // 6
        'area-mining-drill', // 5
    ],
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
