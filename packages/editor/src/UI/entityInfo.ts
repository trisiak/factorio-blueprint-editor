import FD from '../core/factorioData'
import {
    BeaconPrototype,
    CraftingMachinePrototype,
    InserterPrototype,
    TransportBeltConnectablePrototype,
} from 'factorio:prototype'
import G from '../common/globals'
import util from '../common/util'
import { ISignal } from '../types'
import {
    BeaconSource,
    beaconReaches,
    computeMachineEffects,
    resolveModuleNames,
} from '../core/craftingRates'
import { getIngredientAmount, getProductAmountWithProductivity } from '../core/recipeAmounts'
import { Entity } from '../core/Entity'

/**
 * Entity-info projection — the render-free description of what the hover/select
 * readout shows.
 *
 * This used to be one half of a pair: a Pixi `EntityInfoPanel` drawn top-right
 * on desktop, and this projection feeding the website's DOM sheet on touch. The
 * Pixi presentation is **retired** (#101 Slice 5): the DOM sheet presents for
 * every input, placed by the `compact` signal rather than by a device mode, so
 * there is exactly one renderer and this module is the only thing between the
 * blueprint and it. The maths helpers below (module/beacon effects, belt and
 * inserter throughput) stay here and are shared with `core/craftingRates`, so
 * the readout and the blueprint-wide rates model can't drift.
 *
 * Delivered to the DOM over the `fbe:entityinfo` CustomEvent (see
 * `UIContainer.updateEntityInfo`), the same canvas→DOM bridge pattern as
 * `fbe:viewportchange`.
 */

const SIZE_OF_ITEM_ON_BELT = 0.25

const getBeltSpeed = (beltSpeed: number): number => beltSpeed * 60 * (1 / SIZE_OF_ITEM_ON_BELT) * 2

const containerToContainer = (rotationSpeed: number, n: number): number => rotationSpeed * 60 * n

/**
    nr of items to ignore the time it takes to place them on a belt

    because: first item is being placed instantly and also in front so
    this also reduces the time it takes to put down the second item by about 75%
*/
const NR_OF_ITEMS_TO_IGNORE = 1.75
const containerToBelt = (rotationSpeed: number, beltSpeed: number, n: number): number => {
    const armTime = 1 / (rotationSpeed * 60)
    const itemTime = (1 / (beltSpeed * 60)) * SIZE_OF_ITEM_ON_BELT
    return n / (armTime + itemTime * Math.max(n - NR_OF_ITEMS_TO_IGNORE, 0))
}
// TODO: add beltToContainer

const roundToTwo = (n: number): number => Math.round(n * 100) / 100
const roundToFour = (n: number): number => Math.round(n * 10000) / 10000

/** One side of a recipe row: an item/fluid token with its (resolved) amount. */
export interface EntityInfoStack {
    type: string
    name: string
    amount: number
}

/**
 * One drawn piece of the circuit summary. The retired canvas panel rendered
 * this section icon-rich (signal sprites from the `.basis` atlas, coloured
 * network badges); the DOM sheet reproduces that through the `packIcons.ts`
 * seam, so the summary ships as **tokens** rather than pre-formatted text:
 *
 * - `text` — a word, an operator, a number: rendered as-is.
 * - `signal` — a game signal. `icon` is the pack-sheet id (`item/iron-plate`)
 *   when the active pack has one, else undefined and `label` is drawn instead.
 *   The browser artifact holds *prototype* icons only (item/fluid/recipe), so
 *   Factorio's **virtual** signals (`signal-A`, each/everything/anything) have
 *   no sheet entry and degrade to their name — the one thing the canvas panel
 *   could draw that the DOM sheet cannot (see `packIcons.ts`' scope note).
 * - `count` — a signal with a quantity beside it (constant-combinator slots).
 * - `network` — a red/green circuit-network id badge, like the game's.
 */
export type EntityInfoToken =
    | { kind: 'text'; text: string }
    | { kind: 'signal'; label: string; icon?: string }
    | { kind: 'count'; label: string; icon?: string; count: number }
    | { kind: 'network'; color: 'red' | 'green'; id: number }

/** One line of the circuit summary: a row of tokens laid out left to right. */
export type EntityInfoRow = EntityInfoToken[]

/**
 * Pure, render-free projection of what the entity-info readout shows — the seam
 * the website's DOM sheet presents (#89 Phase 2, universal since #101 Slice 5)
 * without touching Pixi. Built by `buildEntityInfo` below.
 */
export interface EntityInfoData {
    /** Localised entity name. */
    name: string
    /** Stat lines (crafting speed / power / productivity, belt or inserter speed). */
    lines: string[]
    /** Installed modules, as pack-icon ids with their slot counts. */
    modules: Array<{ label: string; icon?: string; count: number }>
    /** The set recipe, as authored (per craft). */
    recipe?: { time: number; ingredients: EntityInfoStack[]; results: EntityInfoStack[] }
    /** Per-second in/out with module/beacon effects + productivity applied. */
    effectiveRecipe?: { ingredients: EntityInfoStack[]; results: EntityInfoStack[] }
    /**
     * Circuit summary as token rows (see `EntityInfoToken`) — combinator
     * expressions, constant-combinator contents, the enable condition and the
     * read/set-mode flags, in the order the canvas panel drew them.
     */
    circuit: EntityInfoRow[]
}

/**
 * Pack-sheet icon id for a prototype name, or undefined when the pack has no
 * icon for it (a virtual signal, or a name from a foreign modpack). Mirrors the
 * `hasIcon` guard the canvas panel used, resolved to the `folder/name` ids the
 * browser artifact publishes (`packIcons.ts`).
 */
function iconIdFor(name?: string): string | undefined {
    if (!name) return undefined
    if (FD.items[name]) return `item/${name}`
    if (FD.fluids[name]) return `fluid/${name}`
    if (FD.recipes[name]) return `recipe/${name}`
    return undefined
}

const text = (t: string): EntityInfoToken => ({ kind: 'text', text: t })

/** A signal token, or the constant/`?` fallback when there is no signal set. */
function signalToken(signal?: ISignal, constant?: number): EntityInfoToken {
    if (signal?.name) return { kind: 'signal', label: signal.name, icon: iconIdFor(signal.name) }
    return text(constant !== undefined ? String(constant) : '?')
}

/**
 * Every beacon in the entity's blueprint whose supply area reaches it, resolved
 * to the shape the core rate maths consumes. The supply area is the beacon's
 * own footprint grown by its supply_area_distance on every side — beacons
 * differ wildly here (SE alone spans 2x2/range-2 compact to 5x5/range-14
 * wide), so both come from the actual beacon, not the vanilla
 * `FD.entities.beacon` prototype. Range semantics (shared edge = miss) live in
 * `beaconReaches`.
 */
function findBeaconsReaching(entity: Entity): BeaconSource[] {
    const machine = { position: entity.position, size: entity.size }
    return entity.Blueprint.entities
        .filter(e => e.type === 'beacon')
        .map(beacon => ({
            prototype: beacon.entityData as BeaconPrototype,
            modules: resolveModuleNames(beacon.modules),
            footprint: { position: beacon.position, size: beacon.size },
        }))
        .filter(beacon => beaconReaches(beacon, machine))
}

/**
 * Circuit/control_behavior summary for `entity`, as token rows — combinator
 * conditions, constant-combinator contents, enable conditions and mode flags.
 *
 * Read-only by design (Phase 0): it proves we can decode every post-2.0
 * control_behavior shape across the data packs before any editing UI is built
 * on top. Returns an empty list for entities with nothing circuit-related.
 */
function buildCircuitRows(entity: Entity): EntityInfoRow[] {
    const isCombinator =
        entity.type === 'arithmetic-combinator' ||
        entity.type === 'decider-combinator' ||
        entity.type === 'selector-combinator'
    const isConstant = entity.type === 'constant-combinator'
    // A stored condition only takes effect while circuit_enabled is on — the
    // editor keeps the condition across an unchecked box (so re-enabling
    // restores it), and showing it then would misreport the entity as gated.
    const hasEnableCond = entity.circuitEnabled && entity.circuitCondition !== undefined
    const modeLines = entity.circuitModeSummary
    const networks = entity.circuitNetworks
    if (
        !isCombinator &&
        !isConstant &&
        !hasEnableCond &&
        modeLines.length === 0 &&
        networks.length === 0
    ) {
        return []
    }

    const rows: EntityInfoRow[] = []

    // Network ids (red/green numbers, like the game) when wired.
    if (networks.length > 0) {
        rows.push([
            text('Networks:'),
            ...networks.map(
                (n): EntityInfoToken => ({ kind: 'network', color: n.color, id: n.id })
            ),
        ])
    }

    if (entity.type === 'selector-combinator') {
        // Selectors are word-operations ('select', 'count', 'random', …); the
        // index signal only exists for 'select', so show it conditionally.
        const row: EntityInfoRow = [text(`Operation: ${entity.operator ?? 'select'}`)]
        const idx = entity.combinatorConditions?.first_signal
        if (idx?.name) row.push(text('·'), signalToken(idx))
        rows.push(row)
    } else if (isCombinator) {
        const { first_signal, second_signal, output_signal } = entity.combinatorConditions ?? {}
        // Either operand may be a constant instead of a signal; the missing
        // second operand defaults to 0 (matching how Factorio omits it).
        rows.push([
            signalToken(first_signal, entity.combinatorFirstConstant),
            text(String(entity.operator ?? '')),
            signalToken(second_signal, entity.combinatorConstant ?? 0),
            text('→'),
            signalToken(output_signal),
        ])
    } else if (isConstant) {
        const signals = entity.constantCombinatorSignals
        rows.push(
            signals.length === 0
                ? [text('(empty)')]
                : signals.map(
                      (s): EntityInfoToken => ({
                          kind: 'count',
                          label: s.name,
                          icon: iconIdFor(s.name),
                          count: s.count,
                      })
                  )
        )
    }

    if (hasEnableCond) {
        const cond = entity.circuitCondition
        rows.push([
            text('Enabled if'),
            signalToken(cond.first_signal),
            text(cond.comparator ?? '<'),
            signalToken(cond.second_signal, cond.constant ?? 0),
        ])
    }

    // Read/set-mode flags (e.g. "Reads hand contents (hold)", "Sets recipe from
    // circuit") — boolean control_behavior settings, plain text by nature.
    for (const line of modeLines) rows.push([text(line)])

    return rows
}

/**
 * Project `entity` into the render-free `EntityInfoData` the DOM sheet renders:
 * machine effects, installed modules, recipe + effective per-second IO,
 * belt/inserter speeds, and the circuit summary.
 */
export function buildEntityInfo(entity: Entity): EntityInfoData {
    const data: EntityInfoData = {
        name: String(FD.entities[entity.name].localised_name),
        lines: [],
        modules: [],
        circuit: [],
    }

    // Installed modules, collapsed to one entry per module type (a 4-slot
    // machine with the same module in every slot reads "×4", not four icons).
    const moduleCounts = new Map<string, number>()
    for (const module of resolveModuleNames(entity.modules)) {
        moduleCounts.set(module.name, (moduleCounts.get(module.name) ?? 0) + 1)
    }
    data.modules = [...moduleCounts].map(([name, count]) => ({
        label: name,
        icon: iconIdFor(name),
        count,
    }))

    if (entity.entityData.type === 'assembling-machine') {
        // Module/beacon effect summing (incl. the 2.0 per-beacon profile falloff
        // and the engine's -80% clamps) lives in core/craftingRates so the
        // blueprint-wide rates model computes the exact same numbers.
        const { speed, productivity, consumption } = computeMachineEffects(
            resolveModuleNames(entity.modules),
            findBeaconsReaching(entity)
        )
        const machineData = entity.entityData as CraftingMachinePrototype
        const newCraftingSpeed = machineData.crafting_speed * (1 + speed)
        const newEnergyUsage = parseInt(machineData.energy_usage.slice(0, -2)) * (1 + consumption)
        const fmt = (n: number): string =>
            ` (${Math.sign(n) === 1 ? '+' : '-'}${roundToTwo(Math.abs(n) * 100)}%)`
        // Productivity has no base value to modify (unlike speed/power), so it
        // reads as a bare signed percentage rather than a parenthesised factor.
        data.lines.push(
            `Crafting speed: ${roundToFour(newCraftingSpeed)}${speed ? fmt(speed) : ''}`,
            `Power consumption: ${roundToTwo(newEnergyUsage)} kW${consumption ? fmt(consumption) : ''}`,
            `Productivity bonus: ${Math.sign(productivity) === -1 ? '-' : '+'}${roundToTwo(Math.abs(productivity) * 100)}%`
        )

        // The recipe can be unset (e.g. driven from the circuit network via
        // `set_recipe`), so guard rather than early-return — the circuit
        // section below must still render.
        const recipe = entity.recipe ? FD.recipes[entity.recipe] : undefined
        if (recipe !== undefined) {
            const energy_required = recipe.energy_required || 0.5
            // Productivity only applies to recipes that opt into it; when
            // `allow_productivity` is false the engine ignores the bonus
            // entirely (and, with it, each product's `ignored_by_productivity`
            // catalyst floor). This mirrors the module filter in factorioData.ts,
            // which blocks productivity modules on such recipes in the first place.
            const effectiveProductivity = recipe.allow_productivity ? productivity : 0
            // A product/ingredient can express a random yield via
            // amount_min/amount_max and/or probability with no plain `amount`
            // (e.g. SE's cryonite crushing sand by-product); resolve each to its
            // Expected Value here so the rate never comes out NaN. Products scale
            // by productivity via getProductAmountWithProductivity, which honours
            // the catalyst rule (`ignored_by_productivity`) — so e.g. cryonite's
            // water output, pure catalyst, is left untouched by productivity.
            data.recipe = {
                time: energy_required,
                ingredients: recipe.ingredients.map(i => ({
                    type: i.type,
                    name: i.name,
                    amount: roundToTwo(getIngredientAmount(i)),
                })),
                results: recipe.results.map(r => ({
                    type: r.type,
                    name: r.name,
                    amount: roundToTwo(getProductAmountWithProductivity(r, 0)),
                })),
            }
            data.effectiveRecipe = {
                ingredients: recipe.ingredients.map(i => ({
                    type: i.type,
                    name: i.name,
                    amount: roundToTwo(
                        (getIngredientAmount(i) * newCraftingSpeed) / energy_required
                    ),
                })),
                results: recipe.results.map(r => ({
                    type: r.type,
                    name: r.name,
                    amount: roundToTwo(
                        (getProductAmountWithProductivity(r, effectiveProductivity) *
                            newCraftingSpeed) /
                            energy_required
                    ),
                })),
            }
        }
    }

    const isBelt =
        entity.entityData.type === 'transport-belt' ||
        entity.entityData.type === 'underground-belt' ||
        entity.entityData.type === 'splitter' ||
        entity.entityData.type === 'loader'

    if (entity.entityData.type === 'inserter') {
        // Unloading onto a belt is slower than container-to-container.
        let speed = containerToContainer(
            (entity.entityData as InserterPrototype).rotation_speed,
            entity.inserterStackSize
        )
        const tiles = entity.name === 'long-handed-inserter' ? 2 : 1
        const toP = util.rotatePointBasedOnDir([0, tiles], entity.direction)
        const to = G.bp.entityPositionGrid.getEntityAtPosition(util.sumprod(entity.position, toP))
        const toIsBelt =
            to &&
            (to.entityData.type === 'transport-belt' ||
                to.entityData.type === 'underground-belt' ||
                to.entityData.type === 'splitter' ||
                to.entityData.type === 'loader')
        if (toIsBelt) {
            speed = containerToBelt(
                (entity.entityData as InserterPrototype).rotation_speed,
                (to.entityData as TransportBeltConnectablePrototype).speed,
                entity.inserterStackSize
            )
        }
        data.lines.push(
            `Speed: ${roundToTwo(speed)} items/s`,
            '> changes if inserter unloads to a belt'
        )
    }

    if (isBelt) {
        data.lines.push(
            `Speed: ${roundToTwo(
                getBeltSpeed((entity.entityData as TransportBeltConnectablePrototype).speed)
            )} items/s`
        )
    }

    data.circuit = buildCircuitRows(entity)

    return data
}
