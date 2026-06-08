import { Book } from './core/Book'
import { Blueprint } from './core/Blueprint'
import { GridPattern } from './containers/BlueprintContainer'
import {
    registerAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
} from './actions'
import { Editor } from './Editor'
import { inputMode, InputMode } from './common/input'
import { installTestHook } from './common/testHook'
import type { EditorTestState, FbeTestHook } from './common/testHook'
import FD from './core/factorioData'

export * from './core/bpString'
export { Editor, Book, Blueprint, GridPattern, FD, inputMode, installTestHook }
export type { InputMode, EditorTestState, FbeTestHook }
export default {
    registerAction,
    forEachAction,
    resetKeybinds,
    importKeybinds,
    exportKeybinds,
}
