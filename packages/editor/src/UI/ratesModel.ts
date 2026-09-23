import G from '../common/globals'
import { Blueprint } from '../core/Blueprint'
import { Entity } from '../core/Entity'
import { ItemRateTotals, calculateBlueprintRates } from '../core/craftingRates'

/**
 * Blueprint-wide production/consumption model (a RateCalculator-style readout,
 * computed offline — see core/craftingRates.ts for the maths and
 * docs/rate-calculator.md for scope/backlog).
 *
 * This is the **state holder and computer**, not a presentation: the canvas
 * panel it used to draw is retired (#101 Slice 5) and the website's DOM drawer
 * renders for every input. What lives here is the logical "the readout is open"
 * state that the `showRates` action / the `T` keybind toggle, the live-recompute
 * subscriptions, and the projection dispatched over the `fbe:rates` window event
 * (`null` = closed).
 *
 * Materials are bucketed the way the mod presents them:
 *   - products — only produced here (what the blueprint exports),
 *   - intermediates — produced *and* consumed, shown as a net rate so a
 *     shortfall (negative net) is immediately visible,
 *   - ingredients — only consumed (what must be supplied).
 *
 * While open it recomputes live: blueprint-level entity add/remove plus
 * per-entity recipe/module edits (each rated entity is subscribed on every
 * recompute; entities drop their listeners on destroy, and a blueprint swap
 * re-attaches via UIContainer → onBlueprintSwapped).
 */

/**
 * Compact per-second rate: 2 decimals under 10 (module ratios live in the
 * hundredths), 1 under 100, whole numbers above — keeps megabase-scale rows
 * from overflowing the drawer. Lives here rather than in the website so the
 * projection and its renderer format identically.
 */
export const formatRate = (n: number): string => {
    const abs = Math.abs(n)
    const digits = abs < 10 ? 2 : abs < 100 ? 1 : 0
    // Trim trailing zeros so common exact rates read clean ("1.5", not "1.50").
    return `${Number(n.toFixed(digits))}/s`
}

/** One material row of the rates projection: gross rates + per-machine-type counts. */
export interface RatesEntryData {
    type: 'item' | 'fluid'
    name: string
    production: number
    consumption: number
    /** Producing machines by prototype name (largest groups first). */
    producerMachines: Array<{ name: string; count: number }>
    consumerMachines: Array<{ name: string; count: number }>
}

/**
 * Render-free projection of the rates readout — the `EntityInfoData` pattern
 * (#89 Phase 2) applied to this readout: built by `updateRates` from the
 * `calculateBlueprintRates` report and delivered to the website's DOM drawer
 * via the `fbe:rates` CustomEvent (null = hidden).
 */
export interface RatesData {
    products: RatesEntryData[]
    intermediates: RatesEntryData[]
    ingredients: RatesEntryData[]
    countedMachines: number
    machinesWithoutRecipe: number
}

export class RatesModel {
    /** Blueprint currently subscribed for add/remove events (tracked so a
     * blueprint swap on load can re-attach cleanly). */
    private attachedBp?: Blueprint
    /** Entities carrying recipe/modules listeners from the last recompute. */
    private readonly subscribedEntities = new Set<Entity>()
    private readonly recompute = (): void => this.updateRates()
    /**
     * Logical "the rates readout is open" state — what the `showRates` toggle
     * and the live-recompute subscriptions key off. The DOM drawer follows it
     * through the dispatched projection, so this stays the single source of
     * truth even though nothing here draws.
     */
    private m_shown = false

    public toggle(): void {
        if (this.m_shown) {
            this.hide()
        } else {
            this.show()
        }
    }

    /** Whether the readout is open. */
    public get shown(): boolean {
        return this.m_shown
    }

    public show(): void {
        this.m_shown = true
        this.attach()
        this.updateRates()
    }

    public hide(): void {
        this.m_shown = false
        this.detach()
        window.dispatchEvent(new CustomEvent('fbe:rates', { detail: null }))
    }

    /** Called by UIContainer when `loadBlueprint` swaps `G.bp`, so an open
     * readout follows the new blueprint instead of listening to a dead one. */
    public onBlueprintSwapped(): void {
        if (!this.m_shown) return
        this.detach()
        this.attach()
        this.updateRates()
    }

    private attach(): void {
        this.attachedBp = G.bp
        this.attachedBp.on('create-entity', this.recompute)
        this.attachedBp.on('remove-entity', this.recompute)
    }

    private detach(): void {
        this.attachedBp?.off('create-entity', this.recompute)
        this.attachedBp?.off('remove-entity', this.recompute)
        this.attachedBp = undefined
        for (const entity of this.subscribedEntities) {
            entity.off('recipe', this.recompute)
            entity.off('modules', this.recompute)
        }
        this.subscribedEntities.clear()
    }

    /**
     * (Re)subscribe to the entities whose settings feed the calculation, so a
     * recipe/module edit refreshes an open readout. Destroyed entities drop
     * their listeners themselves (`Entity.destroy` → `removeAllListeners`);
     * they're also pruned here on the next recompute.
     */
    private resubscribeEntities(entities: Entity[]): void {
        for (const entity of this.subscribedEntities) {
            entity.off('recipe', this.recompute)
            entity.off('modules', this.recompute)
        }
        this.subscribedEntities.clear()
        for (const entity of entities) {
            const type = entity.entityData?.type
            if (
                type === 'assembling-machine' ||
                type === 'furnace' ||
                type === 'rocket-silo' ||
                type === 'beacon'
            ) {
                entity.on('recipe', this.recompute)
                entity.on('modules', this.recompute)
                this.subscribedEntities.add(entity)
            }
        }
    }

    private updateRates(): void {
        if (!this.m_shown) return

        const entities = G.bp.entities.valuesArray()
        this.resubscribeEntities(entities)

        const report = calculateBlueprintRates(entities)

        const all = [...report.rates.values()]
        const products = all
            .filter(r => r.consumption === 0)
            .sort((a, b) => b.production - a.production)
        const ingredients = all
            .filter(r => r.production === 0)
            .sort((a, b) => b.consumption - a.consumption)
        const intermediates = all
            .filter(r => r.production > 0 && r.consumption > 0)
            .sort((a, b) => a.production - a.consumption - (b.production - b.consumption))

        // Same report, same bucketing/sorting for every consumer — the drawer
        // renders exactly what was computed here, nothing re-derived downstream.
        const toEntry = (r: ItemRateTotals): RatesEntryData => ({
            type: r.type,
            name: r.name,
            production: r.production,
            consumption: r.consumption,
            producerMachines: [...r.producerMachines.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => ({ name, count })),
            consumerMachines: [...r.consumerMachines.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => ({ name, count })),
        })
        window.dispatchEvent(
            new CustomEvent<RatesData>('fbe:rates', {
                detail: {
                    products: products.map(toEntry),
                    intermediates: intermediates.map(toEntry),
                    ingredients: ingredients.map(toEntry),
                    countedMachines: report.countedMachines,
                    machinesWithoutRecipe: report.machinesWithoutRecipe,
                },
            })
        )
    }
}
