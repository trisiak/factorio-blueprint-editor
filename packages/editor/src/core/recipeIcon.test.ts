import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import FD, { loadData, getRecipeIconSourceName } from './factorioData'
import { Entity } from './Entity'
import type { IEntity } from '../types'
import type { Blueprint } from './Blueprint'

/**
 * Recipe icon resolvability (issue #35).
 *
 * The editor renders a recipe's icon via CreateIcon, which resolves a name to
 * an item/fluid/signal/group, or — for a recipe with no icon of its own — to
 * the product `getRecipeIconSourceName` points at. If none of those resolve,
 * CreateIcon throws; and because the recipe slot renders on the entity's
 * `recipe` change, that throw aborts the editor mid-update and makes the
 * entity's editor un-reopenable (#35).
 *
 * This pins the invariant *headlessly* (the pixel rendering needs a canvas, but
 * the name→icon-source resolution is pure data): every recipe in every pack
 * must resolve to a renderable icon source. Pre-fix counts were
 * space-age 1 / space-exploration 5 unresolvable; this asserts 0 everywhere and
 * fails if a future pack/recipe regresses it.
 */
function resolvesToIcon(name: string, seen = new Set<string>()): boolean {
    if (seen.has(name)) return false
    seen.add(name)
    const withIcon = (o?: { icon?: unknown; icons?: unknown }): boolean =>
        !!o && (!!o.icon || !!o.icons)
    if (
        withIcon(FD.items[name]) ||
        withIcon(FD.fluids[name]) ||
        withIcon(FD.signals?.[name]) ||
        withIcon(FD.recipes[name])
    ) {
        return true
    }
    if (FD.inventoryLayout.some(g => g.name === name && withIcon(g))) return true
    // recipe with no own icon → follow its product fallback (one hop, guarded)
    const fallback = getRecipeIconSourceName(name)
    return fallback ? resolvesToIcon(fallback, seen) : false
}

describe.each(['vanilla-2.0', 'space-age', 'space-exploration'])('recipe icons: %s', pack => {
    it('every recipe resolves to a renderable icon', () => {
        loadData(readFileSync(`packages/exporter/data/output/${pack}/data.json`, 'utf8'))
        const unresolved = Object.keys(FD.recipes).filter(name => !resolvesToIcon(name))
        expect(unresolved, `recipes with no renderable icon: ${unresolved.join(', ')}`).toEqual([])
    })
})

/**
 * assemblerHasFluidInputs/Outputs read recipe.ingredients/results with `.find`.
 * A recipe with none serializes the empty Lua table as `{}` (object, not array)
 * — e.g. SE's `processed-fuel`/`equipment-gantry-*`, SA's `recipe-unknown` — so
 * those getters must guard the shape or they throw and abort rendering the
 * entity the moment such a recipe is set on it (#35). This asserts the getters
 * are total over every recipe in every pack.
 */
const stubBP = undefined as unknown as Blueprint
describe.each(['vanilla-2.0', 'space-age', 'space-exploration'])(
    'assembler fluid getters: %s',
    pack => {
        it('never throw for any recipe', () => {
            loadData(readFileSync(`packages/exporter/data/output/${pack}/data.json`, 'utf8'))
            const threw: string[] = []
            for (const recipe of Object.keys(FD.recipes)) {
                const e = new Entity(
                    {
                        entity_number: 1,
                        name: 'assembling-machine-2',
                        recipe,
                        position: { x: 0, y: 0 },
                    } as IEntity,
                    stubBP
                )
                try {
                    void e.assemblerHasFluidInputs
                    void e.assemblerHasFluidOutputs
                } catch {
                    threw.push(recipe)
                }
            }
            expect(threw, `recipes that threw: ${threw.join(', ')}`).toEqual([])
        })
    }
)
