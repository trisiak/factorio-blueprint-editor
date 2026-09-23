import { ComparatorString } from '../types'

/**
 * The quality half of a 2.0 item filter.
 *
 * Every filter Factorio writes — an inserter's `filters`, a splitter's `filter`,
 * a logistic chest's request, a constant combinator's signal — carries a
 * `quality` name plus the `comparator` that says how to match it. That holds in
 * a game **without** the Quality mod too: `quality/normal` is a base-2.0
 * prototype, and a Space Exploration export (no Quality mod anywhere in its
 * mod list) still reads `{ index: 1, name: …, quality: "normal", comparator: "=" }`.
 *
 * Leaving the pair off does not mean "no quality restriction stated" — the game
 * reads it as *any* quality and paints the five-dot any-quality symbol over the
 * filter, even where quality is otherwise invisible. So a filter the editor
 * writes has to name `normal` explicitly, exactly like the game does.
 *
 * There is nothing pack-specific to branch on here: the data packs carry no
 * quality prototypes at all (the exporter doesn't dump them), and `normal`
 * exists in every one of them regardless.
 */
export const DEFAULT_FILTER_QUALITY = 'normal'
export const DEFAULT_FILTER_COMPARATOR: ComparatorString = '='

export interface IQualitySpec {
    quality: string
    comparator: ComparatorString
}

/**
 * The `quality`/`comparator` pair to write for a filter slot: the first
 * candidate that states each field wins, and Factorio's own `normal` + `=` fill
 * in when none does. Pass the incoming filter first and the slot's current raw
 * value second — the editor's filter UI rebuilds its slots as bare
 * `{ index, name }`, so without the fallback an edit anywhere on the entity
 * would quietly downgrade a legendary/`≥` filter to plain normal, while a
 * pasted setting has to be able to overwrite what the target slot held.
 */
export const qualitySpec = (
    ...candidates: (Partial<IQualitySpec> | undefined)[]
): IQualitySpec => ({
    quality: candidates.find(c => c?.quality !== undefined)?.quality ?? DEFAULT_FILTER_QUALITY,
    comparator:
        candidates.find(c => c?.comparator !== undefined)?.comparator ?? DEFAULT_FILTER_COMPARATOR,
})
