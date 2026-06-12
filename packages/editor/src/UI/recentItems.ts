/**
 * Recently-selected names, persisted per category (items / recipes / modules) so
 * the inventory/recipe/module selectors can surface a "Recents" tab. Framework-
 * free (just localStorage) so it's unit-testable and reusable across selectors.
 */

const STORAGE_PREFIX = 'fbe:recent:'
const CAP = 50

function load(key: string): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + key)
        if (!raw) return []
        const arr: unknown = JSON.parse(raw)
        if (!Array.isArray(arr)) return []
        return arr.filter(x => typeof x === 'string') as string[]
    } catch {
        return []
    }
}

function save(key: string, list: string[]): void {
    try {
        localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(list))
    } catch {
        /* persistence is best-effort */
    }
}

/** Most-recent-first list of names previously selected in `key`'s selector. */
export function getRecents(key: string): string[] {
    return load(key)
}

/** Record `name` as the most recent selection in `key` (deduped, capped). */
export function recordRecent(key: string, name: string): void {
    if (!name) return
    const list = [name, ...load(key).filter(n => n !== name)].slice(0, CAP)
    save(key, list)
}
