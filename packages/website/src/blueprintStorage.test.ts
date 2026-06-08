import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    saveBlueprint,
    loadSavedBlueprint,
    clearSavedBlueprint,
    planBlueprintLoad,
} from './blueprintStorage'

// Minimal in-memory localStorage stand-in (the node test env has none).
function installLocalStorage(): Map<string, string> {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => (store.has(k) ? store.get(k) : null),
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
    })
    return store
}

describe('blueprintStorage save/load/clear', () => {
    beforeEach(() => installLocalStorage())

    it('round-trips a saved blueprint string', () => {
        expect(loadSavedBlueprint()).toBeNull()
        saveBlueprint('0abc')
        expect(loadSavedBlueprint()).toBe('0abc')
    })

    it('clears the saved blueprint', () => {
        saveBlueprint('0abc')
        clearSavedBlueprint()
        expect(loadSavedBlueprint()).toBeNull()
    })

    it('swallows storage errors (private mode / quota)', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('denied')
            },
            setItem: () => {
                throw new Error('denied')
            },
            removeItem: () => {
                throw new Error('denied')
            },
        })
        expect(() => saveBlueprint('0abc')).not.toThrow()
        expect(loadSavedBlueprint()).toBeNull()
        expect(() => clearSavedBlueprint()).not.toThrow()
    })
})

describe('planBlueprintLoad precedence', () => {
    it('starts empty with no URL and no autosave', () => {
        expect(planBlueprintLoad(undefined, null)).toEqual({ kind: 'empty' })
    })

    it('restores the autosave when there is no URL argument', () => {
        expect(planBlueprintLoad(undefined, '0saved')).toEqual({
            kind: 'restore',
            source: '0saved',
        })
    })

    it('loads the URL argument when there is no autosave', () => {
        expect(planBlueprintLoad('0url', null)).toEqual({
            kind: 'url',
            source: '0url',
            savedString: null,
        })
    })

    it('lets the URL win but carries the autosave for the mixed-state prompt', () => {
        expect(planBlueprintLoad('0url', '0saved')).toEqual({
            kind: 'url',
            source: '0url',
            savedString: '0saved',
        })
    })

    it('treats an empty URL source as a real (explicit) argument', () => {
        // `?source=` yields '' — still an explicit intent, distinct from undefined.
        expect(planBlueprintLoad('', '0saved')).toEqual({
            kind: 'url',
            source: '',
            savedString: '0saved',
        })
    })
})
