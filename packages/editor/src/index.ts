import { Book } from './core/Book'
import { Blueprint } from './core/Blueprint'
import { EditorMode, GridPattern } from './containers/BlueprintContainer'
import {
    registerAction,
    callAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
} from './actions'
import { Editor } from './Editor'
import { inputMode, InputMode, InputPreset, InputSignals } from './common/input'
import { installTestHook } from './common/testHook'
import type { EditorTestState, FbeTestHook } from './common/testHook'
import FD from './core/factorioData'
import {
    DATA_ROOT,
    DATA_PACK,
    DEFAULT_DATA_PACK,
    setDataPack,
    loadPackManifest,
    getCanonicalDataPack,
} from './common/globals'
import { canonicalPackId, canonicalPacks, graphicsOptions } from './core/packManifest'
import type { PackManifestEntry } from './core/packManifest'

export * from './core/bpString'
export { Editor, Book, Blueprint, GridPattern, EditorMode, FD, inputMode, installTestHook }
export { DATA_ROOT, DATA_PACK, DEFAULT_DATA_PACK, setDataPack }
export { loadPackManifest, getCanonicalDataPack, canonicalPackId, canonicalPacks }
export { graphicsOptions }
export type {
    InputMode,
    InputPreset,
    InputSignals,
    EditorTestState,
    FbeTestHook,
    PackManifestEntry,
}
// The render-free entity-info projection the website's DOM sheet renders for
// every input (#89 Phase 2, universal since #101 Slice 5); delivered at runtime
// via the `fbe:entityinfo` event. The token types carry the circuit summary's
// icon-or-text pieces (see `UI/entityInfo.ts`).
export type {
    EntityInfoData,
    EntityInfoStack,
    EntityInfoRow,
    EntityInfoToken,
} from './UI/entityInfo'
// Likewise for the rates readout (`fbe:rates`); formatRate keeps the numbers
// formatted by the model that computes them, not by the renderer.
export type { RatesData, RatesEntryData } from './UI/ratesModel'
export { formatRate } from './UI/ratesModel'
// The quickbar's slot model (#101 Slice 5) — the website's DOM quickbar is its
// only view, and `WIRE_ITEMS` is the list of paint-only items it pins beside
// the slots (the rail's wire buttons retired with the Pixi panel before it).
export { QuickbarModel } from './UI/quickbarModel'
export { WIRE_ITEMS } from './core/wireItems'
// Wheel ownership (#101 Slice 5 review): the website's DOM overlays claim the
// wheel while they're being scrolled, so the canvas can decline the inertial
// tail of a gesture that started on a drawer instead of zooming on it.
export { wheelGuard, WHEEL_OWNERSHIP_MS } from './common/wheelGuard'
export default {
    registerAction,
    callAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
}
