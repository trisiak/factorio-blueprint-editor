import { IngredientPrototype, ProductPrototype } from 'factorio:prototype'

/**
 * Recipe amount helpers.
 *
 * Post-2.0 (and heavily in Space Age / Space Exploration) a recipe product can
 * omit the plain `amount` field and instead describe a *random yield* via
 * `amount_min` / `amount_max` and/or a `probability`. The pulverising/crushing
 * recipes are the common offenders — e.g. SE's `se-cryonite-powder` lists its
 * `sand` by-product as `{ amount_min: 1, amount_max: 1, probability: 0.25 }`
 * with no `amount` at all, and across the SE pack 218 products carry no plain
 * `amount`, 190 carry a probability and 29 span a min/max range.
 *
 * Reading `product.amount` blindly then yields `undefined`, and any arithmetic
 * on it (`amount * craftingSpeed / energy_required`) produces `NaN`, which is
 * what surfaced as the "NaNk" crafting rate in the entity info panel.
 *
 * There are two distinct things we want out of a product:
 *   - `getProductAmount` — the Expected Value, for throughput/rate maths.
 *   - `formatProductAmount` — a faithful *display* of the authored yield
 *     (the amount or min–max range, annotated with the probability), so the
 *     base recipe doesn't misrepresent a probabilistic output as a flat number.
 */

type ProductAmountFields = {
    amount?: number
    amount_min?: number
    amount_max?: number
    probability?: number
    extra_count_fraction?: number
}

/**
 * The Expected Value of a product, using the exact formula from the Factorio
 * docs:
 *
 *   EV = probability * 0.5 * (amount_max + amount_min)
 *
 * with `amount` standing in as both min and max when the range is absent (so it
 * simplifies to `probability * amount`). `extra_count_fraction` — the fractional
 * bonus craft used by recycling recipes — is added on top as its own expected
 * contribution. The result is always a finite number, never `NaN`.
 */
export const getProductAmount = (product: ProductPrototype): number => {
    const p = product as ProductAmountFields
    const min = p.amount ?? p.amount_min ?? 0
    const max = p.amount ?? p.amount_max ?? min
    const probability = p.probability ?? 1
    const extra = p.extra_count_fraction ?? 0
    return probability * 0.5 * (min + max) + extra
}

/**
 * The consumed amount of an ingredient. Ingredients always carry a mandatory
 * `amount`, but we guard defensively so a malformed data pack degrades to `0`
 * instead of poisoning a rate calculation with `NaN`.
 */
export const getIngredientAmount = (ingredient: IngredientPrototype): number =>
    ingredient.amount ?? 0

/**
 * Abbreviate a count for the tiny amount label on an icon: anything under 1000
 * is shown verbatim, larger values collapse to `Nk`. Non-finite input degrades
 * to `'0'` rather than rendering `NaNk`/`undefinedk`.
 */
export const abbreviateAmount = (amount: number): string => {
    if (!Number.isFinite(amount)) return '0'
    return amount < 1000 ? amount.toString() : `${Math.floor(amount / 1000)}k`
}

/**
 * A faithful display string for a product's authored *amount*:
 *   - `amount_min`–`amount_max` when the product spans a range,
 *   - otherwise the plain amount.
 *
 * The probability is deliberately *not* folded in here — it is rendered as a
 * separate badge (see `formatProductProbability`) so a wide `1 25%` label can't
 * collide with the neighbouring icon's amount. This is what belongs in the
 * *base* recipe view; use `getProductAmount` when you need a value to compute a
 * rate with.
 */
export const formatProductAmount = (product: ProductPrototype): string => {
    const p = product as ProductAmountFields
    const hasRange =
        p.amount === undefined &&
        p.amount_min !== undefined &&
        p.amount_max !== undefined &&
        p.amount_min !== p.amount_max

    return hasRange
        ? `${abbreviateAmount(p.amount_min)}–${abbreviateAmount(p.amount_max)}`
        : abbreviateAmount(p.amount ?? p.amount_min ?? p.amount_max ?? 0)
}

/**
 * The probability badge for a random-yield product (e.g. `"25%"`), or
 * `undefined` when the product is guaranteed (probability of 100% / absent).
 * Rendered separately from the amount so the two never run together.
 */
export const formatProductProbability = (product: ProductPrototype): string | undefined => {
    const probability = (product as ProductAmountFields).probability ?? 1
    if (probability >= 1) return undefined
    // Round the percentage to at most two decimals (0.25 -> 25, 0.05 -> 5).
    const pct = Math.round(probability * 100 * 100) / 100
    return `${pct}%`
}
