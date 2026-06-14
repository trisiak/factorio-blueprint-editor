// Blueprint library — data model + pure tree operations.
//
// This is the framework-free heart of the in-app blueprint library (see issue
// #50 and docs/blueprint-library.md). It models a persistent, organized tree of
// blueprint projects as a single rich JSON document — deliberately *not* one
// native blueprint string, because snapshots, timestamps and per-pack grouping
// don't fit a native string and because an external backend (e.g. Firebase) is
// the eventual home, where a structured document is the natural unit.
//
// Everything here is pure and deterministic: the two sources of nondeterminism
// (ids and timestamps) are injected, so the whole model is unit-testable in the
// node test env without IndexedDB. Persistence lives in `store.ts`; wiring to the
// editor canvas comes in later phases. Mutating helpers mutate the passed-in
// state in place (the store/controller owns it) and return the affected node for
// convenience — the repo isn't redux-style and this keeps call sites direct.

/** Bump when the on-disk shape changes; the store migrates on load. */
export const LIBRARY_VERSION = 1

/** Per-leaf version history depth. Oldest snapshots are pruned past this. */
export const DEFAULT_SNAPSHOT_LIMIT = 20

/** How many recently-opened entries a pack remembers. */
export const DEFAULT_RECENTS_LIMIT = 10

/** A prior version of a blueprint leaf, kept for rollback. Newest first. */
export interface Snapshot {
    /** Encoded blueprint string ("0…") as it was before being overwritten. */
    encoded: string
    /** When this version was superseded (ms since epoch). */
    savedAt: number
}

/** A blueprint project — a leaf of the tree. */
export interface BlueprintEntry {
    id: string
    kind: 'blueprint'
    name: string
    /** Portable encoded string — the same currency `encode()` produces. '' = empty. */
    encoded: string
    createdAt: number
    updatedAt: number
    /** Prior versions, newest first, capped at the snapshot limit. */
    snapshots: Snapshot[]
}

/** A folder — an interior node that nests other nodes. */
export interface FolderEntry {
    id: string
    kind: 'folder'
    name: string
    createdAt: number
    updatedAt: number
    children: LibraryNode[]
}

export type LibraryNode = FolderEntry | BlueprintEntry

/**
 * One modpack's subtree. The library's top tier is one of these per data pack —
 * which is how a blueprint's pack is encoded (positionally, by which subtree it
 * lives in). Every pack subtree always has a Scratchpad (the default landing
 * place for transient work) and remembers recently-opened entry ids.
 */
export interface PackTree {
    pack: string
    scratchpad: BlueprintEntry
    children: LibraryNode[]
    /** Entry ids, most-recently-opened first, capped at the recents limit. */
    recents: string[]
    /**
     * The leaf currently being edited (the "working context"). Defaults to the
     * scratchpad; persisted so a reload reopens the same project. May dangle if
     * the entry was removed elsewhere — callers fall back to the scratchpad.
     */
    activeId?: string
}

/** The whole library — a single document, one entry per modpack. */
export interface LibraryState {
    version: number
    packs: Record<string, PackTree>
}

/** Injected clock/id sources so the model stays deterministic for tests. */
export type Now = () => number
export type IdGen = () => string

/** Best-effort unique id — `crypto.randomUUID` when available, else a fallback. */
export const genId: IdGen = () => {
    try {
        const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
        if (c?.randomUUID) return c.randomUUID()
    } catch {
        /* fall through */
    }
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** A fresh, empty library. */
export function createLibrary(): LibraryState {
    return { version: LIBRARY_VERSION, packs: {} }
}

/** A new, empty blueprint entry. */
export function makeBlueprint(
    name: string,
    encoded = '',
    now: Now = Date.now,
    id: IdGen = genId
): BlueprintEntry {
    const t = now()
    return { id: id(), kind: 'blueprint', name, encoded, createdAt: t, updatedAt: t, snapshots: [] }
}

/** A new, empty folder. */
export function makeFolder(name: string, now: Now = Date.now, id: IdGen = genId): FolderEntry {
    const t = now()
    return { id: id(), kind: 'folder', name, createdAt: t, updatedAt: t, children: [] }
}

/**
 * Get the subtree for a pack, creating it (with a fresh Scratchpad) on first
 * use. The scratchpad gets a stable, pack-derived id so it's easy to address.
 */
export function ensurePack(state: LibraryState, pack: string, now: Now = Date.now): PackTree {
    let tree = state.packs[pack]
    if (!tree) {
        const t = now()
        const scratchpad: BlueprintEntry = {
            id: `scratchpad:${pack}`,
            kind: 'blueprint',
            name: 'Scratchpad',
            encoded: '',
            createdAt: t,
            updatedAt: t,
            snapshots: [],
        }
        tree = { pack, scratchpad, children: [], recents: [] }
        state.packs[pack] = tree
    }
    return tree
}

/** Result of locating a node: the node and the array it lives in. */
interface Located {
    node: LibraryNode
    /** The `children` array (or pack root) that directly contains `node`. */
    siblings: LibraryNode[]
}

/** Depth-first search for a node by id within a pack subtree's children. */
function locate(children: LibraryNode[], id: string): Located | null {
    for (const node of children) {
        if (node.id === id) return { node, siblings: children }
        if (node.kind === 'folder') {
            const hit = locate(node.children, id)
            if (hit) return hit
        }
    }
    return null
}

/**
 * Find a node anywhere in a pack subtree, including the scratchpad. Returns the
 * node, or `null` if not found.
 */
export function findNode(tree: PackTree, id: string): LibraryNode | null {
    if (tree.scratchpad.id === id) return tree.scratchpad
    return locate(tree.children, id)?.node ?? null
}

/** True if `folder` is, or contains anywhere below it, the node `id`. */
function containsId(folder: FolderEntry, id: string): boolean {
    if (folder.id === id) return true
    return folder.children.some(c => c.id === id || (c.kind === 'folder' && containsId(c, id)))
}

/**
 * Insert a node under a parent folder (by id), or at the pack root when
 * `parentId` is omitted. Returns false if the named parent isn't a folder.
 */
export function addNode(tree: PackTree, node: LibraryNode, parentId?: string): boolean {
    if (parentId === undefined) {
        tree.children.push(node)
        return true
    }
    const found = findNode(tree, parentId)
    if (!found || found.kind !== 'folder') return false
    found.children.push(node)
    return true
}

/** Remove a node by id (the scratchpad can't be removed). Returns true if removed. */
export function removeNode(tree: PackTree, id: string): boolean {
    const hit = locate(tree.children, id)
    if (!hit) return false
    const i = hit.siblings.indexOf(hit.node)
    hit.siblings.splice(i, 1)
    // Dropping a node also drops it from recents so we never dangle a stale id.
    tree.recents = tree.recents.filter(r => r !== id)
    return true
}

/**
 * Move a node under a new parent (by id), or to the pack root when `newParentId`
 * is omitted. Refuses to move the scratchpad, to move a node into itself, or to
 * move a folder into its own descendant (which would orphan the subtree).
 * Returns true on success.
 */
export function moveNode(tree: PackTree, id: string, newParentId?: string): boolean {
    if (id === tree.scratchpad.id) return false
    const hit = locate(tree.children, id)
    if (!hit) return false

    if (newParentId !== undefined) {
        if (newParentId === id) return false
        const parent = findNode(tree, newParentId)
        if (!parent || parent.kind !== 'folder') return false
        if (hit.node.kind === 'folder' && containsId(hit.node, newParentId)) return false
    }

    // Detach, then re-attach. (Detach first so root re-insert can't duplicate.)
    hit.siblings.splice(hit.siblings.indexOf(hit.node), 1)
    return addNode(tree, hit.node, newParentId)
}

/** Rename any node (including the scratchpad). Returns true if found. */
export function renameNode(tree: PackTree, id: string, name: string, now: Now = Date.now): boolean {
    const node = findNode(tree, id)
    if (!node) return false
    node.name = name
    node.updatedAt = now()
    return true
}

/** Find a top-level folder by name, or create it. Used for the "Imported" area. */
export function ensureFolder(
    tree: PackTree,
    name: string,
    now: Now = Date.now,
    id: IdGen = genId
): FolderEntry {
    const existing = tree.children.find(
        (c): c is FolderEntry => c.kind === 'folder' && c.name === name
    )
    if (existing) return existing
    const folder = makeFolder(name, now, id)
    tree.children.push(folder)
    return folder
}

/**
 * Autosave: replace a leaf's live content *without* creating a checkpoint. This
 * is the continuous "don't lose work on reload" path — the active leaf is the
 * working context, so it tracks the canvas, but that must not churn version
 * history. Returns true if the leaf was found.
 */
export function updateEntryContent(
    tree: PackTree,
    id: string,
    encoded: string,
    now: Now = Date.now
): boolean {
    const node = findNode(tree, id)
    if (!node || node.kind !== 'blueprint') return false
    node.encoded = encoded
    node.updatedAt = now()
    return true
}

/**
 * Explicit Save: checkpoint the leaf's current content as a restore point
 * (newest first, pruned to `limit`). A no-op when the content is empty or already
 * matches the newest checkpoint, so repeatedly hitting Save doesn't pile up
 * identical versions. Returns true if a checkpoint was actually created.
 */
export function checkpointEntry(
    tree: PackTree,
    id: string,
    now: Now = Date.now,
    limit = DEFAULT_SNAPSHOT_LIMIT
): boolean {
    const node = findNode(tree, id)
    if (!node || node.kind !== 'blueprint') return false
    if (!node.encoded) return false
    if (node.snapshots[0]?.encoded === node.encoded) return false
    node.snapshots.unshift({ encoded: node.encoded, savedAt: now() })
    if (node.snapshots.length > limit) node.snapshots.length = limit
    return true
}

/**
 * True if a leaf has uncheckpointed edits — its live content differs from the
 * newest checkpoint (or it has content but no checkpoint yet). Drives the
 * "you have unsaved changes" prompt when starting/opening another project.
 */
export function hasUncheckpointedChanges(entry: BlueprintEntry): boolean {
    return !!entry.encoded && entry.encoded !== (entry.snapshots[0]?.encoded ?? '')
}

/**
 * Restore a checkpoint (by index) into a leaf's live content. The pre-restore
 * content is checkpointed first (unless it's already the newest), so a restore
 * is itself recoverable. Returns true if the leaf and checkpoint exist.
 */
export function restoreSnapshot(
    tree: PackTree,
    id: string,
    snapshotIndex: number,
    now: Now = Date.now,
    limit = DEFAULT_SNAPSHOT_LIMIT
): boolean {
    const node = findNode(tree, id)
    if (!node || node.kind !== 'blueprint') return false
    // Capture the target by reference — checkpointEntry's unshift would shift indices.
    const snap = node.snapshots[snapshotIndex]
    if (!snap) return false
    checkpointEntry(tree, id, now, limit)
    node.encoded = snap.encoded
    node.updatedAt = now()
    return true
}

/** Record that an entry was just opened — most-recent first, deduped, capped. */
export function pushRecent(tree: PackTree, id: string, limit = DEFAULT_RECENTS_LIMIT): void {
    tree.recents = [id, ...tree.recents.filter(r => r !== id)].slice(0, limit)
}
