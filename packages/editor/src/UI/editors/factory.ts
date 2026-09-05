import { Entity } from '../../core/Entity'
import { isCraftingMachine } from '../../core/factorioData'
import { Editor } from './Editor'
import { BeaconEditor } from './BeaconEditor'
import { InserterEditor } from './InserterEditor'
import { MachineEditor } from './MachineEditor'
import { MiningEditor } from './MiningEditor'
import { SplitterEditor } from './SplitterEditor'
import { ChestEditor } from './ChestEditor'
import { TempEditor } from './TempEditor'
import { TrainStopEditor } from './TrainStopEditor'
import { LampEditor } from './LampEditor'
import { RoboportEditor } from './RoboportEditor'
import { DisplayPanelEditor } from './DisplayPanelEditor'
import { ArithmeticCombinatorEditor } from './ArithmeticCombinatorEditor'
import { DeciderCombinatorEditor } from './DeciderCombinatorEditor'
import { ConstantCombinatorEditor } from './ConstantCombinatorEditor'
import { SelectorCombinatorEditor } from './SelectorCombinatorEditor'
import { CircuitConditionEditor } from './CircuitConditionEditor'

/**
 * Which editor an entity gets — or `undefined` for an entity with nothing to
 * configure (no editor opens). Pure routing decision, split out from
 * `createEditor` so it can be unit-tested across data packs without the PixiJS
 * editor classes (which need a canvas); see `editorRouting.test.ts`.
 */
export type EditorKind =
    | 'machine'
    | 'beacon'
    | 'inserter'
    | 'mining'
    | 'splitter'
    | 'chest'
    | 'temp'
    | 'trainstop'
    | 'lamp'
    | 'roboport'
    | 'display-panel'
    | 'arithmetic-combinator'
    | 'decider-combinator'
    | 'constant-combinator'
    | 'selector-combinator'
    | 'circuit-condition'

export function editorKindFor(entity: Entity): EditorKind | undefined {
    // Circuit entities route off `entity.type`, not name, so any modded prototype
    // of these types (not just the vanilla names) gets the editor — the data pack
    // defines the signals, the editor adapts. See docs/circuit-editing (#31).
    switch (entity.type) {
        case 'arithmetic-combinator':
            return 'arithmetic-combinator'
        case 'roboport':
            return 'roboport'
        case 'display-panel':
            return 'display-panel'
        case 'decider-combinator':
            return 'decider-combinator'
        case 'constant-combinator':
            return 'constant-combinator'
        case 'selector-combinator':
            return 'selector-combinator'
        // Entities whose only configurable circuit feature is an enable/disable
        // condition and which have no other editor. Inserters and mining drills
        // are handled by their own (richer) editors below.
        case 'pump':
        case 'offshore-pump':
        case 'transport-belt':
            return 'circuit-condition'
        case 'lamp':
            return 'lamp'
        // Logistic containers: storage chests filter one item, requester/buffer
        // chests hold a request list, and *all* of them (providers included,
        // which request nothing and used to open no editor) carry the circuit
        // mode-of-operation — so every logistic container opens the chest
        // editor now; it sizes itself to the slots the mode actually has. By
        // type, so modded logistic containers are covered too.
        case 'logistic-container':
            return 'chest'
    }
    switch (entity.name) {
        case 'assembling-machine-1':
        case 'assembling-machine-2':
        case 'assembling-machine-3':
            return 'machine'
        case 'beacon':
            return 'beacon'
        case 'burner-inserter':
        case 'inserter':
        case 'long-handed-inserter':
        case 'fast-inserter':
        case 'bulk-inserter':
        case 'stack-inserter':
            return 'inserter'
        case 'electric-mining-drill':
            return 'mining'
        case 'splitter':
        case 'fast-splitter':
        case 'express-splitter':
        case 'turbo-splitter':
            return 'splitter'
        case 'lab':
        case 'electric-furnace':
        case 'pumpjack':
        case 'oil-refinery':
        case 'chemical-plant':
        case 'centrifuge':
        case 'rocket-silo':
            return 'temp'
        case 'train-stop':
            return 'trainstop'
        default: {
            // The cases above enumerate vanilla crafting machines by name, so
            // modded/expansion ones (e.g. Space Age's foundry, electromagnetic-
            // plant, biochamber, cryogenic-plant, recycler) fall through here.
            // Without this they'd open no editor at all — you could place them
            // but never set a recipe. Route any unrecognised crafting machine
            // through the generic editor, which reads `acceptedRecipes`/
            // `moduleSlots` off the entity and so adapts to whatever the active
            // data pack defines. Only do so when there's actually something to
            // configure — a selectable recipe (assembling-machine types; furnaces
            // and rocket silos auto-pick theirs) or module slots — so e.g. a plain
            // stone/steel furnace still opens nothing rather than a blank dialog.

            // Generalize the name-matched editor families above to their *type*,
            // so modded variants reach the same editor (SE's compact/wide
            // beacons, burner-lab/se-space-science-lab, area-mining-drill; Space
            // Age's biolab/big-mining-drill). Only when there's a module slot to
            // configure — these types have no recipe picker. (#28)
            if (entity.moduleSlots > 0) {
                if (entity.type === 'beacon') return 'beacon'
                if (entity.type === 'mining-drill') return 'mining'
                if (entity.type === 'lab') return 'temp'
            }
            if (isCraftingMachine(entity.entityData)) {
                if (entity.hasRecipeSlot || entity.moduleSlots > 0) {
                    return 'temp'
                }
            }
            return undefined
        }
    }
}

/**
 * Factory Function for creating Editor based on Entity Number
 *
 * @description This function is needed externally of the Editor class as otherwise there will
 * be a raise condition where the MachineEditor cannot be created due to teh Editor not being
 * available yet. This can be solved in the future with lazy loading classes with Import(). Once
 * lazy loading is available, this function can move into the Editor class
 *
 * @param entityNumber - Entity Number for which to create Editor for
 */
export function createEditor(entity: Entity): Editor {
    switch (editorKindFor(entity)) {
        case 'machine':
            return new MachineEditor(entity)
        case 'beacon':
            return new BeaconEditor(entity)
        case 'inserter':
            return new InserterEditor(entity)
        case 'mining':
            return new MiningEditor(entity)
        case 'splitter':
            return new SplitterEditor(entity)
        case 'chest':
            return new ChestEditor(entity)
        case 'temp':
            return new TempEditor(entity)
        case 'trainstop':
            return new TrainStopEditor(entity)
        case 'lamp':
            return new LampEditor(entity)
        case 'roboport':
            return new RoboportEditor(entity)
        case 'display-panel':
            return new DisplayPanelEditor(entity)
        case 'arithmetic-combinator':
            return new ArithmeticCombinatorEditor(entity)
        case 'decider-combinator':
            return new DeciderCombinatorEditor(entity)
        case 'constant-combinator':
            return new ConstantCombinatorEditor(entity)
        case 'selector-combinator':
            return new SelectorCombinatorEditor(entity)
        case 'circuit-condition':
            return new CircuitConditionEditor(entity)
        default:
            return undefined
    }
}
