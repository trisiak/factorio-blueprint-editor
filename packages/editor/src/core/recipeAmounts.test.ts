import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { IngredientPrototype, ProductPrototype } from 'factorio:prototype'
import FD, { loadData } from './factorioData'
import {
    abbreviateAmount,
    formatProductAmount,
    getIngredientAmount,
    getProductAmount,
} from './recipeAmounts'

const product = (partial: Partial<ProductPrototype>): ProductPrototype =>
    ({ type: 'item', name: 'x', ...partial }) as ProductPrototype

describe('getProductAmount', () => {
    it('returns the plain amount when defined', () => {
        expect(getProductAmount(product({ amount: 20 }))).toBe(20)
        expect(getProductAmount(product({ amount: 1 }))).toBe(1)
    })

    it('scales a plain amount by its probability', () => {
        // asteroid-crushing style: the chunk comes back 20% of the time.
        expect(getProductAmount(product({ amount: 1, probability: 0.2 }))).toBeCloseTo(0.2)
    })

    it('handles a probabilistic amount_min/amount_max by-product without amount (the NaN bug)', () => {
        // SE's se-cryonite-powder sand by-product: no `amount` field at all.
        const sand = product({ amount_min: 1, amount_max: 1, probability: 0.25 })
        const value = getProductAmount(sand)
        expect(Number.isNaN(value)).toBe(false)
        expect(value).toBeCloseTo(0.25)
    })

    it('uses the expected value of a min/max range', () => {
        // EV = p * 0.5 * (min + max) = 1 * 0.5 * (2 + 8) = 5
        expect(getProductAmount(product({ amount_min: 2, amount_max: 8 }))).toBe(5)
        expect(getProductAmount(product({ amount_min: 2, amount_max: 8, probability: 0.5 }))).toBe(
            2.5
        )
    })

    it('adds extra_count_fraction on top (recycling recipes)', () => {
        expect(
            getProductAmount(
                product({ amount: 2, extra_count_fraction: 0.5 } as Partial<ProductPrototype>)
            )
        ).toBe(2.5)
    })

    it('degrades to 0 rather than NaN for an empty product', () => {
        const value = getProductAmount(product({}))
        expect(Number.isNaN(value)).toBe(false)
        expect(value).toBe(0)
    })
})

describe('abbreviateAmount', () => {
    it('shows values under 1000 verbatim', () => {
        expect(abbreviateAmount(1)).toBe('1')
        expect(abbreviateAmount(12.34)).toBe('12.34')
        expect(abbreviateAmount(999)).toBe('999')
    })

    it('collapses large values to Nk', () => {
        expect(abbreviateAmount(1000)).toBe('1k')
        expect(abbreviateAmount(2500)).toBe('2k')
    })

    it('degrades non-finite input to 0 rather than NaNk', () => {
        expect(abbreviateAmount(NaN)).toBe('0')
        expect(abbreviateAmount(undefined as unknown as number)).toBe('0')
    })
})

describe('formatProductAmount', () => {
    it('shows a plain amount with no annotation', () => {
        expect(formatProductAmount(product({ amount: 20 }))).toBe('20')
    })

    it('annotates a probabilistic by-product with its percentage (the cryonite case)', () => {
        // se-cryonite-powder sand by-product: no `amount`, 25% chance of 1.
        expect(
            formatProductAmount(product({ amount_min: 1, amount_max: 1, probability: 0.25 }))
        ).toBe('1 25%')
    })

    it('annotates a plain amount that has a probability', () => {
        expect(formatProductAmount(product({ amount: 1, probability: 0.2 }))).toBe('1 20%')
        expect(formatProductAmount(product({ amount: 1, probability: 0.05 }))).toBe('1 5%')
    })

    it('shows a min–max range', () => {
        expect(formatProductAmount(product({ amount_min: 1, amount_max: 5 }))).toBe('1–5')
        expect(
            formatProductAmount(product({ amount_min: 0, amount_max: 5, probability: 0.5 }))
        ).toBe('0–5 50%')
    })

    it('never renders NaN for an empty product', () => {
        expect(formatProductAmount(product({}))).toBe('0')
    })
})

describe('getIngredientAmount', () => {
    it('returns the ingredient amount', () => {
        expect(
            getIngredientAmount({ type: 'item', name: 'x', amount: 3 } as IngredientPrototype)
        ).toBe(3)
    })

    it('degrades to 0 rather than NaN when amount is missing', () => {
        const value = getIngredientAmount({
            type: 'item',
            name: 'x',
        } as unknown as IngredientPrototype)
        expect(Number.isNaN(value)).toBe(false)
        expect(value).toBe(0)
    })
})

// Regression against the shipped Space Exploration pack: `se-cryonite-powder`
// (crafted in the Pulveriser) is the exact recipe from the bug report — its
// `sand` by-product carries amount_min/amount_max/probability and no plain
// `amount`, which produced a "NaNk" crafting rate.
describe('se-cryonite-powder (shipped SE data — the cryonite crushing bug)', () => {
    loadData(readFileSync('packages/exporter/data/output/space-exploration/data.json', 'utf8'))
    const recipe = FD.recipes['se-cryonite-powder']
    const sand = recipe.results.find(r => r.name === 'sand')

    it('exists with a probabilistic sand by-product that has no plain amount', () => {
        expect(recipe).toBeDefined()
        expect(sand).toBeDefined()
        expect(sand.amount).toBeUndefined()
        expect(sand.probability).toBe(0.25)
    })

    it('never yields NaN for any product amount (rate maths)', () => {
        for (const r of recipe.results) {
            expect(Number.isNaN(getProductAmount(r))).toBe(false)
        }
        // 25% chance of one sand -> expected 0.25.
        expect(getProductAmount(sand)).toBeCloseTo(0.25)
    })

    it('renders the sand by-product with its probability, not a bare number', () => {
        expect(formatProductAmount(sand)).toBe('1 25%')
        // The main product is deterministic, so it stays a plain amount.
        const powder = recipe.results.find(r => r.name === 'se-cryonite-powder')
        expect(formatProductAmount(powder)).toBe('1')
    })
})
