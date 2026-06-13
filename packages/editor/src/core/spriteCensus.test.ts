import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import FD, { loadData } from './factorioData'
import { getSpriteData, clearSpriteDataCache, SPRITE_GENERATION_FAILED } from './spriteDataBuilder'

/**
 * Sprite-generation census + ratchet (issue #28).
 *
 * Runs every entity of every committed data pack through getSpriteData and
 * tallies three buckets:
 *  - ok:      a non-empty sprite list, every visible part resolvable
 *  - partial: sprites generated, but some part resolves to no texture — no
 *             `filename`, `filenames`, or `stripes` (e.g. an un-flattened
 *             `{layers}` object) — so EntitySprite drops it and the entity
 *             renders incomplete
 *  - failed:  SPRITE_GENERATION_FAILED — the entity draws as the labeled
 *             UnknownEntitySprite box fallback
 *
 * The exact counts below are a RATCHET: when a fix lands, lower the numbers
 * (the test fails on improvement too, so the baseline can't go stale); a
 * regression can never land silently. The failing assertion message lists the
 * offending entity names — that listing is the live to-do list for #28.
 */
const BASELINES: Record<string, { partial: number; failed: number }> = {
    // Remaining failures are graphics-less internal entities (dummy rails,
    // fulgoran ruin attractor, SE's spaceship-clamp/console/blocker internals)
    // that draw as the labeled box — acceptable; they aren't placeable buildings.
    'vanilla-2.0': { partial: 0, failed: 2 },
    'space-age': { partial: 0, failed: 3 },
    'space-exploration': { partial: 0, failed: 10 },
}

describe.each(Object.keys(BASELINES))('sprite census: %s', pack => {
    it('matches the ratchet baseline', () => {
        // Both loadData and the generator cache are module-global; clear the
        // cache so this pack's tally can't be served generators that closed
        // over a previously loaded pack's prototypes (cache keys are names,
        // which collide across packs).
        clearSpriteDataCache()
        // Repo-root relative: vitest runs with the repo root as cwd (the root
        // vitest.config.ts), and the tsconfig types don't cover __dirname /
        // import.meta.url, so a plain relative path is the portable option.
        loadData(readFileSync(`packages/exporter/data/output/${pack}/data.json`, 'utf8'))

        const failed: string[] = []
        const partial: string[] = []
        for (const name of Object.keys(FD.entities)) {
            let res: ReturnType<typeof getSpriteData> | typeof SPRITE_GENERATION_FAILED
            try {
                res = getSpriteData({
                    dir: 0,
                    name,
                    position: { x: 0, y: 0 },
                    generateConnector: false,
                } as Parameters<typeof getSpriteData>[0])
            } catch {
                res = SPRITE_GENERATION_FAILED
            }
            if (res === SPRITE_GENERATION_FAILED || (Array.isArray(res) && res.length === 0)) {
                failed.push(name)
            } else if (
                (res as readonly { draw_as_shadow?: boolean; filename?: string }[]).some(d => {
                    // Mirror EntitySprite's resolution: a part is dropped only if
                    // it resolves to no texture — no filename, no `filenames`
                    // (direction-indexed), and no `stripes` (multi-file frames).
                    const p = d as {
                        filenames?: unknown[]
                        stripes?: unknown[]
                    }
                    return d && !d.draw_as_shadow && !d.filename && !p.filenames && !p.stripes
                })
            ) {
                partial.push(name)
            }
        }

        const baseline = BASELINES[pack]
        expect(failed.length, `failed entities: ${failed.join(', ')}`).toBe(baseline.failed)
        expect(partial.length, `partial entities: ${partial.join(', ')}`).toBe(baseline.partial)
    })
})
