// Local autosave for the working blueprint.
//
// The editor never persisted the blueprint itself before — only quickbar /
// settings / keybinds — so a reload (or a backgrounded mobile tab being
// discarded) wiped your work unless you'd manually copied the blueprint string.
// This stores the encoded blueprint string in localStorage and lets the loader
// decide how it interacts with a `?source` URL argument (see `planBlueprintLoad`).

const STORAGE_KEY = 'fbe:blueprint'

/** Persist the encoded blueprint string. Best-effort: storage may be unavailable. */
export function saveBlueprint(encoded: string): void {
    try {
        localStorage.setItem(STORAGE_KEY, encoded)
    } catch {
        /* persistence is best-effort (private mode / quota) */
    }
}

/** Read the saved blueprint string, or `null` if there isn't one. */
export function loadSavedBlueprint(): string | null {
    try {
        return localStorage.getItem(STORAGE_KEY)
    } catch {
        return null
    }
}

/** Drop the saved blueprint (e.g. once the editor has been cleared). */
export function clearSavedBlueprint(): void {
    try {
        localStorage.removeItem(STORAGE_KEY)
    } catch {
        /* best-effort */
    }
}

/**
 * What the loader should do given the URL `?source` argument and whatever is in
 * local autosave. Kept as a pure function so the precedence rules can be unit
 * tested without the (PixiJS-heavy) editor.
 *
 * - `url`      load the blueprint named by the URL — explicit intent wins. If an
 *              autosave also exists, `savedString` carries it so the loader can
 *              offer to restore it (the "mixed state").
 * - `restore`  no URL argument, but we have a local autosave to bring back.
 * - `empty`    nothing to load; start with a blank blueprint.
 */
export type LoadPlan =
    | { kind: 'url'; source: string; savedString: string | null }
    | { kind: 'restore'; source: string }
    | { kind: 'empty' }

export function planBlueprintLoad(
    urlSource: string | undefined,
    savedString: string | null
): LoadPlan {
    if (urlSource !== undefined) {
        return { kind: 'url', source: urlSource, savedString: savedString || null }
    }
    if (savedString) {
        return { kind: 'restore', source: savedString }
    }
    return { kind: 'empty' }
}
