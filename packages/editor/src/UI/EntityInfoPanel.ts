import { Container, Rectangle, Text } from 'pixi.js'
import FD, { getModule } from '../core/factorioData'
import {
    BeaconPrototype,
    CraftingMachinePrototype,
    InserterPrototype,
    TransportBeltConnectablePrototype,
} from 'factorio:prototype'
import G from '../common/globals'
import util from '../common/util'
import { ISignal } from '../types'
import { Entity } from '../core/Entity'
import F from './controls/functions'
import { Panel } from './controls/Panel'
import { fitToWidthScale } from './quickbarLayout'
import { styles } from './style'

function template(strings: TemplateStringsArray, ...keys: (number | string)[]) {
    return (...values: (unknown | Record<string, unknown>)[]) => {
        const result = [strings[0].replace('\n', '')]
        keys.forEach((key, i) => {
            result.push(
                typeof key === 'number'
                    ? (values as string[])[key]
                    : (values[0] as Record<string, string>)[key],
                strings[i + 1]
            )
        })
        return result.join('')
    }
}

const entityInfoTemplate = template`
Crafting speed: ${'craftingSpeed'} ${'speedMultiplier'}
Power consumption: ${'energyUsage'} kW ${'energyMultiplier'}`

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

/**
 * This class creates a panel to show detailed informations about each entity (as the original game and maybe more).
 * @function updateVisualization (Update informations and show/hide panel)
 * @function setPosition (top right corner of the screen)
 * @extends /controls/panel (extends Container)
 * @see instantiation in /index.ts - event in /containers/entity.ts
 */
export class EntityInfoPanel extends Panel {
    private title: Text
    private m_EntityName: Text
    private m_entityInfo: Text
    private m_RecipeContainer: Container
    private m_RecipeIOContainer: Container
    private m_CircuitContainer: Container

    public constructor() {
        super(270, 270)

        this.eventMode = 'none'
        this.visible = false

        this.title = new Text({ text: 'Information', style: styles.dialog.title })
        this.title.anchor.set(0.5, 0)
        this.title.position.set(super.width / 2, 2)
        this.addChild(this.title)

        this.m_EntityName = new Text({ text: '', style: styles.dialog.label })
        this.m_entityInfo = new Text({ text: '', style: styles.dialog.label })
        this.m_RecipeContainer = new Container()
        this.m_RecipeIOContainer = new Container()
        this.m_CircuitContainer = new Container()

        this.addChild(
            this.m_EntityName,
            this.m_entityInfo,
            this.m_RecipeContainer,
            this.m_RecipeIOContainer,
            this.m_CircuitContainer
        )
    }

    public updateVisualization(entity?: Entity): void {
        this.m_RecipeContainer.removeChildren()
        this.m_RecipeIOContainer.removeChildren()
        this.m_CircuitContainer.removeChildren()

        if (!entity) {
            this.visible = false
            this.m_EntityName.text = ''
            this.m_entityInfo.text = ''
            return
        }

        this.visible = true
        let nextY = this.title.position.y + this.title.height + 10

        this.m_EntityName.text = `Name: ${FD.entities[entity.name].localised_name}`
        this.m_EntityName.position.set(10, nextY)
        nextY = this.m_EntityName.position.y + this.m_EntityName.height + 10

        if (entity.entityData.type === 'assembling-machine') {
            // Details for assembling machines with or without recipe
            let productivity = 0
            let consumption = 0
            // let pollution = 0
            let speed = 0

            for (const module of entity.modules) {
                if (!module) continue

                const moduleData = getModule(module)
                if (moduleData.effect.productivity) {
                    productivity += moduleData.effect.productivity
                }
                if (moduleData.effect.consumption) {
                    consumption += moduleData.effect.consumption
                }
                // if (moduleData.effect.pollution) {
                //     pollution += moduleData.effect.pollution
                // }
                if (moduleData.effect.speed) {
                    speed += moduleData.effect.speed
                }
            }

            for (const beacon of this.findNearbyBeacons(entity)) {
                for (const module of beacon.modules) {
                    if (!module) continue

                    const moduleData = getModule(module)
                    if (moduleData.effect.productivity) {
                        productivity +=
                            moduleData.effect.productivity *
                            (beacon.entityData as BeaconPrototype).distribution_effectivity
                    }
                    if (moduleData.effect.consumption) {
                        consumption +=
                            moduleData.effect.consumption *
                            (beacon.entityData as BeaconPrototype).distribution_effectivity
                    }
                    // if (moduleData.effect.pollution) {
                    //     pollution += moduleData.effect.pollution * (beacon.entityData as BeaconPrototype).distribution_effectivity
                    // }
                    if (moduleData.effect.speed) {
                        speed +=
                            moduleData.effect.speed *
                            (beacon.entityData as BeaconPrototype).distribution_effectivity
                    }
                }
            }

            consumption = consumption < -0.8 ? -0.8 : consumption
            const machineData = entity.entityData as CraftingMachinePrototype
            const newCraftingSpeed = machineData.crafting_speed * (1 + speed)
            const newEnergyUsage =
                parseInt(machineData.energy_usage.slice(0, -2)) * (1 + consumption)

            const fmt = (n: number): string =>
                `(${Math.sign(n) === 1 ? '+' : '-'}${roundToTwo(Math.abs(n) * 100)}%)`

            // Show modules effect and some others informations
            this.m_entityInfo.text = entityInfoTemplate({
                craftingSpeed: roundToFour(newCraftingSpeed),
                speedMultiplier: speed ? fmt(speed) : '',
                energyUsage: roundToTwo(newEnergyUsage),
                energyMultiplier: consumption ? fmt(consumption) : '',
            })

            this.m_entityInfo.position.set(10, nextY)
            nextY = this.m_entityInfo.position.y + this.m_entityInfo.height + 10

            if (!entity.recipe) return

            // Details for assembling machines with recipe
            this.m_RecipeContainer.removeChildren()
            const recipe = FD.recipes[entity.recipe]
            if (recipe === undefined) return

            // Show the original recipe
            this.m_RecipeContainer.addChild(
                new Text({
                    text: 'Recipe:',
                    style: styles.dialog.label,
                })
            )
            F.CreateRecipe(
                this.m_RecipeContainer,
                0,
                20,
                recipe.ingredients,
                recipe.results,
                recipe.energy_required
            )
            this.m_RecipeContainer.position.set(10, nextY)
            nextY = this.m_RecipeContainer.position.y + this.m_RecipeContainer.height + 20

            // Show recipe that takes entity effects into account
            this.m_RecipeIOContainer.addChild(
                new Text({
                    text: 'Recipe (takes entity effects into account):',
                    style: styles.dialog.label,
                })
            )
            const energy_required = recipe.energy_required || 0.5
            F.CreateRecipe(
                this.m_RecipeIOContainer,
                0,
                20,
                recipe.ingredients.map(i => ({
                    ...i,
                    amount: roundToTwo((i.amount * newCraftingSpeed) / energy_required),
                })),
                recipe.results.map(r => ({
                    ...r,
                    amount: roundToTwo(
                        ((r.amount * newCraftingSpeed) / energy_required) * (1 + productivity)
                    ),
                })),
                1
            )
            this.m_RecipeIOContainer.position.set(10, nextY)
            nextY = this.m_RecipeIOContainer.position.y + this.m_RecipeIOContainer.height + 20
        }

        const isBelt = (e: Entity): boolean =>
            e.entityData.type === 'transport-belt' ||
            e.entityData.type === 'underground-belt' ||
            e.entityData.type === 'splitter' ||
            e.entityData.type === 'loader'

        if (entity.entityData.type === 'inserter') {
            // Details for inserters
            let speed = containerToContainer(
                (entity.entityData as InserterPrototype).rotation_speed,
                entity.inserterStackSize
            )
            const tiles = entity.name === 'long-handed-inserter' ? 2 : 1
            // const fromP = util.rotatePointBasedOnDir([0, -tiles], entity.direction)
            const toP = util.rotatePointBasedOnDir([0, tiles], entity.direction)
            // const from = G.bp.entities.get(
            //     G.bp.entityPositionGrid.getCellAtPosition(
            //         util.sumprod(entity.position, fromP)
            //     )
            // )
            const to = G.bp.entityPositionGrid.getEntityAtPosition(
                util.sumprod(entity.position, toP)
            )
            if (to && isBelt(to)) {
                speed = containerToBelt(
                    (entity.entityData as InserterPrototype).rotation_speed,
                    (to.entityData as TransportBeltConnectablePrototype).speed,
                    entity.inserterStackSize
                )
            }
            this.m_entityInfo.text = `Speed: ${roundToTwo(
                speed
            )} items/s\n> changes if inserter unloads to a belt`
            this.m_entityInfo.position.set(10, nextY)
            nextY = this.m_entityInfo.position.y + this.m_entityInfo.height + 20
        }

        if (isBelt(entity)) {
            // Details for belts
            this.m_entityInfo.text = `Speed: ${roundToTwo(
                getBeltSpeed((entity.entityData as TransportBeltConnectablePrototype).speed)
            )} items/s`
            this.m_entityInfo.position.set(10, nextY)
            nextY = this.m_entityInfo.position.y + this.m_entityInfo.height + 20
        }

        // Phase 0a (read-only): surface circuit settings already in the blueprint —
        // combinator conditions, constant-combinator contents and enable conditions.
        nextY = this.renderCircuitInfo(entity, nextY)
    }

    /**
     * Renders a read-only summary of an entity's circuit/control_behavior settings
     * into `m_CircuitContainer`, returning the new layout cursor `y`. Returns `y`
     * unchanged for entities with nothing circuit-related to show.
     *
     * This is deliberately read-only (Phase 0): it proves we can decode every
     * post-2.0 control_behavior shape across the data packs before any editing UI
     * is built on top. Signal tokens fall back to plain text when the data pack
     * has no icon for them, so modded/virtual signals never crash the panel.
     */
    private renderCircuitInfo(entity: Entity, startY: number): number {
        const container = this.m_CircuitContainer
        const ICON = 20
        const ROW_H = 24

        // Is there anything circuit-related to show?
        const isCombinator =
            entity.type === 'arithmetic-combinator' ||
            entity.type === 'decider-combinator' ||
            entity.type === 'selector-combinator'
        const isConstant = entity.type === 'constant-combinator'
        const hasEnableCond = entity.circuitCondition !== undefined
        if (!isCombinator && !isConstant && !hasEnableCond) return startY

        const hasIcon = (name?: string): boolean =>
            !!name && !!(FD.items[name] || FD.fluids[name] || FD.recipes[name] || FD.signals[name])

        // Render a signal icon (or a plain-text fallback / a constant) into `row`
        // at horizontal offset `x`, returning the next free x.
        const placeToken = (
            row: Container,
            x: number,
            signal?: ISignal,
            constant?: number
        ): number => {
            if (signal?.name && hasIcon(signal.name)) {
                const icon = F.CreateIcon(signal.name, ICON, false)
                icon.position.set(x, 0)
                row.addChild(icon)
                return x + ICON + 4
            }
            const text = signal?.name ?? (constant !== undefined ? String(constant) : '?')
            const label = new Text({ text, style: styles.dialog.label })
            label.position.set(x, 2)
            row.addChild(label)
            return x + label.width + 4
        }

        const placeText = (row: Container, x: number, text: string): number => {
            const label = new Text({ text, style: styles.dialog.label })
            label.position.set(x, 2)
            row.addChild(label)
            return x + label.width + 4
        }

        let y = startY
        const header = new Text({ text: 'Circuit network:', style: styles.dialog.label })
        header.position.set(10, y)
        container.addChild(header)
        y += header.height + 6

        if (entity.type === 'selector-combinator') {
            // Selectors are word-operations ('select', 'count', 'random', …); the
            // index signal only exists for 'select', so show it conditionally.
            const row = new Container()
            let x = placeText(row, 0, `Operation: ${entity.operator ?? 'select'}`)
            const idx = entity.combinatorConditions?.first_signal
            if (idx?.name) {
                x = placeText(row, x, '·')
                placeToken(row, x, idx)
            }
            row.position.set(10, y)
            container.addChild(row)
            y += ROW_H
        } else if (isCombinator) {
            const { first_signal, second_signal, output_signal } = entity.combinatorConditions ?? {}
            const row = new Container()
            let x = 0
            // Either operand may be a constant instead of a signal; the missing
            // second operand defaults to 0 (matching how Factorio omits it).
            x = placeToken(row, x, first_signal, entity.combinatorFirstConstant)
            x = placeText(row, x, String(entity.operator ?? ''))
            x = placeToken(row, x, second_signal, entity.combinatorConstant ?? 0)
            x = placeText(row, x, '→')
            placeToken(row, x, output_signal)
            row.position.set(10, y)
            container.addChild(row)
            y += ROW_H
        } else if (isConstant) {
            const signals = entity.constantCombinatorSignals
            if (signals.length === 0) {
                const label = new Text({ text: '(empty)', style: styles.dialog.label })
                label.position.set(10, y)
                container.addChild(label)
                y += ROW_H
            } else {
                // Wrap signal icons (with their counts) into rows of 6.
                const PER_ROW = 6
                const STEP = 38
                signals.forEach((s, i) => {
                    const col = i % PER_ROW
                    const line = Math.floor(i / PER_ROW)
                    if (hasIcon(s.name)) {
                        F.CreateIconWithAmount(
                            container,
                            10 + col * STEP,
                            y + line * STEP,
                            s.name,
                            s.count
                        )
                    } else {
                        const label = new Text({ text: s.name, style: styles.dialog.label })
                        label.position.set(10 + col * STEP, y + line * STEP)
                        container.addChild(label)
                    }
                })
                y += (Math.floor((signals.length - 1) / PER_ROW) + 1) * STEP + 4
            }
        }

        if (hasEnableCond) {
            const cond = entity.circuitCondition
            const row = new Container()
            let x = 0
            x = placeText(row, x, 'Enabled if')
            x = placeToken(row, x, cond.first_signal)
            x = placeText(row, x, cond.comparator ?? '<')
            placeToken(row, x, cond.second_signal, cond.constant ?? 0)
            row.position.set(10, y)
            container.addChild(row)
            y += ROW_H
        }

        return y
    }

    protected override setPosition(): void {
        // Pin to the top-right; scale down on a viewport narrower than the panel
        // (only sub-~290px screens) and clamp so it never spills off-screen.
        const scale = fitToWidthScale(G.app.screen.width, this.width)
        this.scale.set(scale)
        this.clampToScreen(G.app.screen.width - this.width * scale + 1, 0)
    }

    private findNearbyBeacons(entity: Entity): Entity[] {
        const entityRect = new Rectangle(entity.position.x, entity.position.y)
        entityRect.pad(entity.size.x / 2, entity.size.y / 2)

        return entity.Blueprint.entities.filter((beacon: Entity): boolean => {
            if (beacon.type !== 'beacon') {
                return false
            }

            const beaconAura = new Rectangle(beacon.position.x, beacon.position.y, 1, 1)
            beaconAura.pad((FD.entities.beacon as BeaconPrototype).supply_area_distance + 1)

            return (
                beaconAura.contains(entityRect.left, entityRect.top) ||
                beaconAura.contains(entityRect.right, entityRect.top) ||
                beaconAura.contains(entityRect.left, entityRect.bottom) ||
                beaconAura.contains(entityRect.right, entityRect.bottom)
            )
        })
    }
}
