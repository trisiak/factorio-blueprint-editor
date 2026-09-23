import { describe, it, expect, beforeAll } from 'vitest'
import { loadData } from './factorioData'
import { Blueprint } from './Blueprint'
import { Entity } from './Entity'
import type { IEntity } from '../types'
import util from '../common/util'
import { havePackData, readPackData } from './packDataFiles'

/**
 * Underground belt/pipe pairing — `PositionGrid.getOpposingEntity`.
 *
 * Both ends of a pair share a `direction` and differ only in `type`
 * (input/output), so finding the other end is a walk along the direction the
 * entity faces. That walk derived its axis and sign from 1.1's **8**-way
 * directions (`% 4 !== 0` for "horizontal", `=== 6` for west) while everything
 * around it had moved to 2.0's **16**-way ones, where every cardinal is
 * `% 4 === 0` and west is 12 — so east and west both marched *south* and never
 * found their other end. North/south happened to survive, which is why this
 * only ever showed up on horizontal runs: the exit stayed an entrance, the pair
 * silently didn't connect in game, and the overlay line drew off in the wrong
 * direction.
 *
 * These pin all four directions, for a vanilla and a modded (Space Exploration)
 * underground belt alike.
 */

const PACK = 'vanilla-2.0'
const have = havePackData(PACK)

/** Blueprint-grid tile centers, the convention `Entity.position` uses. */
const at = (x: number, y: number): { x: number; y: number } => ({ x: x + 0.5, y: y + 0.5 })

const place = (bp: Blueprint, data: Partial<IEntity>): Entity =>
    bp.createEntity({ position: at(0, 0), ...data } as IEntity)

/** north, east, south, west with the tile step each one should walk. */
const CARDINALS = [
    { name: 'north', direction: 0, step: { x: 0, y: -1 } },
    { name: 'east', direction: 4, step: { x: 1, y: 0 } },
    { name: 'south', direction: 8, step: { x: 0, y: 1 } },
    { name: 'west', direction: 12, step: { x: -1, y: 0 } },
]

describe('directionToVector', () => {
    it.each(CARDINALS)('steps $name ($direction)', ({ direction, step }) => {
        expect(util.directionToVector(direction)).toEqual(step)
    })

    it('resolves the in-between directions to their diagonal', () => {
        // Undergrounds are cardinal-only, but the helper has to stay total —
        // a throw here would take out a render pass.
        expect(util.directionToVector(2)).toEqual({ x: 1, y: -1 })
        expect(util.directionToVector(10)).toEqual({ x: -1, y: 1 })
    })
})

describe.skipIf(!have)('underground belt pairing', () => {
    beforeAll(() => loadData(readPackData(PACK)))

    describe.each(CARDINALS)('facing $name', ({ direction, step }) => {
        const GAP = 3

        it('finds the exit from the entrance', () => {
            const bp = new Blueprint()
            const entrance = place(bp, {
                name: 'underground-belt',
                direction,
                type: 'input',
                position: at(0, 0),
            })
            const exit = place(bp, {
                name: 'underground-belt',
                direction,
                type: 'output',
                position: at(step.x * GAP, step.y * GAP),
            })

            expect(
                bp.entityPositionGrid.getOpposingEntity(
                    'underground-belt',
                    entrance.direction,
                    entrance.position,
                    entrance.direction,
                    5
                )
            ).toBe(exit.entityNumber)
        })

        it('finds the entrance from the exit (searching backwards)', () => {
            const bp = new Blueprint()
            const entrance = place(bp, {
                name: 'underground-belt',
                direction,
                type: 'input',
                position: at(0, 0),
            })
            const exit = place(bp, {
                name: 'underground-belt',
                direction,
                type: 'output',
                position: at(step.x * GAP, step.y * GAP),
            })

            expect(
                bp.entityPositionGrid.getOpposingEntity(
                    'underground-belt',
                    exit.direction,
                    exit.position,
                    // An exit searches back along the way it came.
                    (exit.direction + 8) % 16,
                    5
                )
            ).toBe(entrance.entityNumber)
        })

        it('stops at an underground facing the other way', () => {
            // A belt pointing back at us claims the run — the pair can't reach
            // past it, so the search reports nothing rather than the one behind.
            const bp = new Blueprint()
            const entrance = place(bp, {
                name: 'underground-belt',
                direction,
                type: 'input',
                position: at(0, 0),
            })
            place(bp, {
                name: 'underground-belt',
                direction: (direction + 8) % 16,
                type: 'input',
                position: at(step.x, step.y),
            })
            place(bp, {
                name: 'underground-belt',
                direction,
                type: 'output',
                position: at(step.x * GAP, step.y * GAP),
            })

            expect(
                bp.entityPositionGrid.getOpposingEntity(
                    'underground-belt',
                    entrance.direction,
                    entrance.position,
                    entrance.direction,
                    5
                )
            ).toBeUndefined()
        })

        it('does not reach past max_distance', () => {
            const bp = new Blueprint()
            const entrance = place(bp, {
                name: 'underground-belt',
                direction,
                type: 'input',
                position: at(0, 0),
            })
            place(bp, {
                name: 'underground-belt',
                direction,
                type: 'output',
                position: at(step.x * 6, step.y * 6),
            })

            expect(
                bp.entityPositionGrid.getOpposingEntity(
                    'underground-belt',
                    entrance.direction,
                    entrance.position,
                    entrance.direction,
                    5
                )
            ).toBeUndefined()
        })
    })
})

describe.skipIf(!havePackData('space-exploration'))('underground pairing on a modded pack', () => {
    beforeAll(() => loadData(readPackData('space-exploration')))

    it.each(CARDINALS)('pairs an SE underground belt facing $name', ({ direction, step }) => {
        const bp = new Blueprint()
        const name = 'se-space-underground-belt'
        const entrance = place(bp, { name, direction, type: 'input', position: at(0, 0) })
        const exit = place(bp, {
            name,
            direction,
            type: 'output',
            position: at(step.x * 3, step.y * 3),
        })

        expect(
            bp.entityPositionGrid.getOpposingEntity(
                name,
                entrance.direction,
                entrance.position,
                entrance.direction,
                5
            )
        ).toBe(exit.entityNumber)
    })
})
