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
// The render-free entity-info projection consumed by the website's DOM bottom
// sheet (#89 Phase 2); delivered at runtime via the `fbe:entityinfo` event.
export type { EntityInfoData, EntityInfoStack } from './UI/EntityInfoPanel'
// Likewise for the rates readout (`fbe:rates`); formatRate keeps the DOM
// drawer's numbers formatted exactly like the canvas panel's.
export type { RatesData, RatesEntryData } from './UI/RatesPanel'
export { formatRate } from './UI/RatesPanel'
// The render-free item-catalog projection + recents store behind the website's
// DOM item selector (#98 Slice 1; opened at runtime via `fbe:openinventory`).
export {
    buildItemCatalog,
    isItemAllowed,
    itemDisplayName,
    itemMatchesQuery,
} from './core/itemCatalog'
export type { CatalogGroup } from './core/itemCatalog'
export { getRecents, recordRecent } from './UI/recentItems'
// The DOM entity editor (#98 Slice 2) receives the live Entity over the
// `fbe:openentityeditor` event (same JS runtime — no serialization) and works
// it through the same accessors/setters the Pixi editors use.
export type { Entity } from './core/Entity'
export default {
    registerAction,
    callAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
}
