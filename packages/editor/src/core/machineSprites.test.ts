import { describe, it, expect } from 'vitest'
import { loadData } from './factorioData'
import { havePackData, readPackData } from './packDataFiles'
import { getSpriteData, clearSpriteDataCache, ExtendedSpriteData } from './spriteDataBuilder'

/**
 * Placement regressions in `spriteDataBuilder` that only modded packs surface —
 * both were reported as "visual bugs on the Space Exploration pack":
 *
 *  1. Crafting-machine pipe stubs were anchored two tiles from the entity
 *     *centre* instead of at the fluid box's own connection, so every machine
 *     bigger than 3x3 drew its pipes across its own body.
 *  2. A beacon's embedded module chip indexed the sprite strip by module tier
 *     without clamping to `variation_count`, so SE's tier 4-9 modules sampled a
 *     rect past the right edge of the file and the chip came out blank.
 *
 * Data-driven (needs the exporter tiers staged, same as the sprite census), so
 * it self-skips on a fresh clone; CI fetches them before vitest.
 */

/** Sprite parts of `name`, with both fluid-box sides asked for. */
function partsOf(pack: string, name: string, extra: object = {}): ExtendedSpriteData[] {
    // loadData and the generator cache are module-global and the cache keys on
    // entity *name*, which collides across packs — clear it per load.
    clearSpriteDataCache()
    loadData(readPackData(pack))
    return getSpriteData({
        dir: 0,
        name,
        positionGrid: undefined,
        position: { x: 0, y: 0 },
        generateConnector: false,
        assemblerHasFluidInputs: true,
        assemblerHasFluidOutputs: true,
        ...extra,
    } as Parameters<typeof getSpriteData>[0]) as ExtendedSpriteData[]
}

const pipeParts = (parts: ExtendedSpriteData[]): ExtendedSpriteData[] =>
    parts.filter(p => p.filename?.includes('-pipe-') && !p.filename.includes('pipe-cover'))

describe.skipIf(!havePackData('space-exploration'))('crafting machine pipe stubs', () => {
    it("anchors SE's 5x5 industrial-furnace stubs on its edges, not inside it", () => {
        const pipes = pipeParts(partsOf('space-exploration', 'industrial-furnace'))

        // Eight fluid boxes, eight stubs — the bug collapsed them onto four
        // interior points (two pairs drawn twice on top of each other).
        expect(pipes).toHaveLength(8)

        // The furnace is 5x5, so its body spans ±2.5. Every stub has to sit on
        // (or just outside) that boundary: the previous anchors were (0, ∓1.25)
        // and (∓1, 0) — dead inside the building.
        const onEdge = ([x, y]: readonly [number, number]): boolean =>
            Math.max(Math.abs(x), Math.abs(y)) >= 2
        for (const p of pipes) {
            expect(onEdge(p.shift as [number, number]), `${p.filename} at ${p.shift}`).toBe(true)
        }

        // …and each one lands on the tile its own cover caps (cover = the same
        // connection, one tile further out), so stub and cover line up.
        expect(new Set(pipes.map(p => `${p.shift[0]},${p.shift[1]}`)).size).toBe(8)
    })
})

describe.skipIf(!havePackData('vanilla-2.0'))('crafting machine pipe stubs (vanilla)', () => {
    it('leaves the 3x3 assembling machine exactly where it was', () => {
        const pipes = pipeParts(partsOf('vanilla-2.0', 'assembling-machine-3'))
        // Vanilla's connections sit at [0, ∓1], so the connection-relative
        // anchor reproduces the old hardcoded [0, ∓2] to the pixel. This is the
        // no-regression half of the fix.
        expect(pipes.map(p => p.shift)).toEqual([
            [0.0703125, -1.578125],
            [0, 1.0234375],
        ])
    })
})

describe.skipIf(!havePackData('space-exploration'))('beacon module visualisations', () => {
    // The vanilla beacon art carries 4 variations on the slot plate (empty +
    // tiers 1-3) and 3 on the tint masks; SE raises the beacon to 8 slots and
    // ships modules up to tier 9.
    const chips = (modules: string[]): ExtendedSpriteData[] =>
        partsOf('space-exploration', 'beacon', { modules }).filter(p =>
            p.filename?.includes('beacon-module-')
        )

    it('keeps a high-tier module inside the sprite strip', () => {
        const parts = chips(['speed-module-9', 'speed-module-9'])
        expect(parts.length).toBeGreaterThan(0)
        for (const p of parts) {
            const count = (p as { variation_count?: number }).variation_count
            expect(count, `${p.filename} has no variation_count`).toBeGreaterThan(0)
            // Unclamped this was width * 8 (or * 9) — e.g. x = 450 into a
            // 4 x 50px strip, i.e. entirely off the file.
            expect(p.x, `${p.filename} x=${p.x}`).toBeLessThanOrEqual(p.width * (count - 1))
        }
    })

    it('still picks the per-tier variation for in-range tiers', () => {
        const byTier = (module: string): number[] =>
            chips([module, module])
                .filter(p => p.filename?.includes('mask-box-1'))
                .map(p => p.x / p.width)
        // 3 variations, indexed tier - 1 (the mask has no empty-slot frame).
        expect(byTier('speed-module')).toEqual([0])
        expect(byTier('speed-module-2')).toEqual([1])
        expect(byTier('speed-module-3')).toEqual([2])
    })
})
