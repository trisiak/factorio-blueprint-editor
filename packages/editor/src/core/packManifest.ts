// The `packs.json` manifest, and the canonical-pack-id rule that graphics
// variants hang off (docs/slim-graphics.md).
//
// Framework-free on purpose: `globals.ts` owns the fetch (and re-exports these),
// while the rules themselves stay unit-testable in the node env.

/**
 * One `packs.json` entry, as far as the app cares. `variantOf`/`graphics` are the
 * additive fields a **graphics variant** carries: a slim pack is the same game
 * data as its base pack with a smaller texture set, so it declares
 * `variantOf: "<base id>"` and (informationally) which tier it ships. Unknown
 * fields are ignored — the manifest of record lives in the data plane.
 */
export interface PackManifestEntry {
    id: string
    label?: string
    /** Base pack this is a graphics-only variant of. Absent on a base pack. */
    variantOf?: string
    /** Graphics tier this entry ships, e.g. `slim`. Absent = full quality. */
    graphics?: string
    artifacts?: string[]
    default?: boolean
}

/**
 * The CANONICAL pack id of `id`: `variantOf ?? id`. This is the id everything
 * that scopes *user state* keys on — the blueprint library's top tier, the
 * per-pack scratchpad / active leaf, cross-pack copy checks — because a graphics
 * variant is the same game data: a blueprint made on `vanilla-2.0` is native to
 * `vanilla-2.0-slim` and vice versa. Only the persisted `DATA_PACK` choice (which
 * textures to fetch) uses the variant id. An id absent from the manifest is its
 * own canonical id, which is also the behaviour with no manifest at all.
 */
export function canonicalPackId(manifest: PackManifestEntry[], id: string): string {
    return manifest.find(p => p.id === id)?.variantOf ?? id
}

/**
 * The manifest collapsed to its canonical packs — one entry per *game data* set,
 * with variants folded into the base they belong to. This is the list to offer
 * anywhere user state is being addressed (the library panel's pack drop-down),
 * as opposed to the settings pane's pack *selector*, which is about which
 * textures to load and therefore lists variants individually.
 *
 * A canonical id takes its label from the base entry when the manifest has one;
 * otherwise from the first variant that references it (a data plane could publish
 * only a slim tier of some pack). Manifest order is preserved.
 */
export function canonicalPacks(manifest: PackManifestEntry[]): { id: string; label: string }[] {
    const out: { id: string; label: string }[] = []
    const index = new Map<string, number>()
    for (const p of manifest) {
        const id = p.variantOf ?? p.id
        const isBase = !p.variantOf
        const existing = index.get(id)
        if (existing === undefined) {
            index.set(id, out.length)
            out.push({ id, label: isBase ? (p.label ?? id) : id })
        } else if (isBase) {
            // A base entry always wins the label over a variant-derived one.
            out[existing].label = p.label ?? id
        }
    }
    return out
}

/**
 * The graphics tiers published for ONE canonical pack, for the settings pane's
 * "Graphics" axis: the base entry first (labelled "Full"), then its variants in
 * manifest order, labelled by their `graphics` tier ("slim" → "Slim"). Being in
 * the manifest is what "publicly hosted" means, so everything returned here is
 * selectable today — the axis exists so those tiers can sit next to (and be told
 * apart from) the unlock paths that aren't built yet, which the settings pane
 * lists as "(planned)" placeholders (docs/slim-graphics.md). An unknown/unlisted
 * id yields an empty list; callers decide the fallback.
 */
export function graphicsOptions(
    manifest: PackManifestEntry[],
    canonicalId: string
): { id: string; label: string }[] {
    const tierLabel = (g?: string): string => {
        if (!g) return 'Variant'
        // Product naming: the tier is "slim" everywhere machine-facing (pack
        // ids, the manifest's `graphics` field, the docs) but reads
        // "Low quality" in the UI — it names what the user trades, not how the
        // pack was built. Unknown future tiers just get capitalized.
        if (g === 'slim') return 'Low quality'
        return g.charAt(0).toUpperCase() + g.slice(1)
    }
    const out: { id: string; label: string }[] = []
    // Base first — an orphan variant (base not in the manifest) still lists.
    if (manifest.some(p => p.id === canonicalId && !p.variantOf)) {
        out.push({ id: canonicalId, label: 'Full' })
    }
    for (const p of manifest) {
        if (p.variantOf === canonicalId) out.push({ id: p.id, label: tierLabel(p.graphics) })
    }
    return out
}

/**
 * Whether the pack `id` can ship a `textures.json` sidecar — i.e. whether it is
 * worth fetching one (#101 A13). Only a **graphics variant** carries transforms
 * (`variantOf`/`graphics`), so probing a full pack only ever produced a red 404
 * in the console on every load. A pack the manifest doesn't list — and the
 * manifest-less case (empty list: an unreachable/absent `packs.json`, e.g. a
 * local exporter dump) — keeps the old unconditional probe, so a deploy without
 * a manifest still resolves its transforms.
 */
export function packMayHaveTextureTransforms(manifest: PackManifestEntry[], id: string): boolean {
    if (manifest.length === 0) return true
    const entry = manifest.find(p => p.id === id)
    if (!entry) return true
    return entry.variantOf !== undefined || entry.graphics !== undefined
}
