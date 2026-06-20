// Blueprint library — session controller.
//
// The bridge between the pure model (`model.ts`) + persistence (`store.ts`) and
// the app. It owns the *session* state the model doesn't: which pack is active
// and which leaf is the working context. It deliberately deals only in encoded
// strings (never `Blueprint`/`Book`), so it stays free of the PixiJS editor and
// is unit-testable in the node env — `index.ts` does the encode/decode and canvas
// wiring around it.
//
// Working-context model (agreed in the design conversation): the active leaf *is*
// the canvas. `autosave()` continuously mirrors the canvas into it so a reload
// never loses work; `save()` is the deliberate act that creates a version
// checkpoint. "Modified" means there are edits since the last checkpoint.

import { LibraryStore } from './store'
import * as interchange from './interchange'
import {
    LibraryState,
    PackTree,
    LibraryNode,
    BlueprintEntry,
    createLibrary,
    ensurePack,
    ensureFolder,
    makeBlueprint,
    makeFolder,
    addNode,
    findNode,
    removeNode,
    renameNode,
    moveNode,
    duplicateNode,
    cloneNode,
    updateEntryContent,
    checkpointEntry,
    restoreSnapshot,
    deleteSnapshot,
    pushRecent,
    Now,
    IdGen,
    genId,
} from './model'

/** Auto-created home for blueprints brought in via a `?source=` URL / paste. */
export const IMPORTED_FOLDER = 'Imported'

export class LibraryController {
    private state: LibraryState = createLibrary()

    public constructor(
        private readonly store: LibraryStore,
        private readonly pack: string,
        private readonly now: Now = Date.now,
        private readonly id: IdGen = genId
    ) {}

    /** Load (or create) the library and resolve the active leaf for this pack. */
    public async init(): Promise<void> {
        const loaded = await this.store.load().catch(() => null)
        this.state = loaded ?? createLibrary()
        const tree = this.tree()
        // A persisted activeId that no longer resolves falls back to the scratchpad.
        if (!tree.activeId || !findNode(tree, tree.activeId)) {
            tree.activeId = tree.scratchpad.id
        }
    }

    private tree(): PackTree {
        return ensurePack(this.state, this.pack, this.now)
    }

    private persist(): Promise<void> {
        return this.store.save(this.state).catch(() => undefined)
    }

    public getState(): LibraryState {
        return this.state
    }

    public getTree(): PackTree {
        return this.tree()
    }

    /** The leaf currently being edited (falls back to the scratchpad). */
    public getActive(): BlueprintEntry {
        const tree = this.tree()
        const node = tree.activeId ? findNode(tree, tree.activeId) : null
        return node && node.kind === 'blueprint' ? node : tree.scratchpad
    }

    public getActiveId(): string {
        return this.getActive().id
    }

    public getActiveName(): string {
        return this.getActive().name
    }

    public isScratchpad(id: string): boolean {
        return id === this.tree().scratchpad.id
    }

    /**
     * Continuous autosave of the live canvas into the active leaf (no checkpoint).
     * Keeps work durable across reloads without churning version history.
     */
    public async autosave(encoded: string): Promise<void> {
        const tree = this.tree()
        updateEntryContent(tree, tree.activeId, encoded, this.now)
        await this.persist()
    }

    /**
     * Whether `encoded` (the current canvas) has changes since the active leaf's
     * last checkpoint — drives the "unsaved changes" prompt and the indicator dot.
     * The scratchpad is always live (it holds no versions), so it's never
     * "modified".
     */
    public isModified(encoded: string): boolean {
        if (this.isScratchpad(this.getActiveId())) return false
        const active = this.getActive()
        return !!encoded && encoded !== (active.snapshots[0]?.encoded ?? '')
    }

    /**
     * Explicit Save: mirror the latest content, then checkpoint the active leaf.
     * Returns true if a new version was actually recorded. The scratchpad can't
     * hold versions (it's always live) — saving it is a no-op here; the UI routes
     * the scratchpad to "Save as…" instead.
     */
    public async save(encoded: string): Promise<boolean> {
        const tree = this.tree()
        updateEntryContent(tree, tree.activeId, encoded, this.now)
        const made = this.isScratchpad(tree.activeId)
            ? false
            : checkpointEntry(tree, tree.activeId, this.now)
        await this.persist()
        return made
    }

    /**
     * Save As: create a new named leaf from `encoded` (under `parentId`, or at the
     * pack root), make it the active working context, and checkpoint it.
     */
    public async saveAs(name: string, encoded: string, parentId?: string): Promise<BlueprintEntry> {
        const tree = this.tree()
        const leaf = makeBlueprint(name, encoded, this.now, this.id)
        addNode(tree, leaf, parentId)
        checkpointEntry(tree, leaf.id, this.now)
        tree.activeId = leaf.id
        pushRecent(tree, leaf.id)
        await this.persist()
        return leaf
    }

    /**
     * Open an existing leaf as the working context. Returns its encoded content
     * to load onto the canvas, or `null` if the id isn't a blueprint leaf.
     */
    public async open(id: string): Promise<string | null> {
        const tree = this.tree()
        const node = findNode(tree, id)
        if (!node || node.kind !== 'blueprint') return null
        tree.activeId = id
        pushRecent(tree, id)
        await this.persist()
        return node.encoded
    }

    /** Start a fresh project: reset the scratchpad and make it the working context. */
    public async newScratch(): Promise<void> {
        const tree = this.tree()
        tree.scratchpad.encoded = ''
        tree.scratchpad.snapshots = []
        tree.scratchpad.updatedAt = this.now()
        tree.activeId = tree.scratchpad.id
        await this.persist()
    }

    /**
     * Import: store `encoded` as a new leaf under the "Imported" folder, make it
     * the working context, and record it in recents. (Decomposing imported *books*
     * into a folder of blueprints is a later, hierarchical-import slice.)
     */
    public async importEntry(name: string, encoded: string): Promise<BlueprintEntry> {
        const tree = this.tree()
        const folder = ensureFolder(tree, IMPORTED_FOLDER, this.now, this.id)
        const leaf = makeBlueprint(name, encoded, this.now, this.id)
        addNode(tree, leaf, folder.id)
        tree.activeId = leaf.id
        pushRecent(tree, leaf.id)
        await this.persist()
        return leaf
    }

    // --- multi-pack browsing + organization (Phase 2) -----------------------
    //
    // Organize ops take an explicit `pack` so the panel can browse and edit any
    // pack's tree, not just the active one. (The working-context ops above always
    // act on the active pack, since they involve the live canvas.)

    /** The active (rendered) data pack — the one the canvas belongs to. */
    public getActivePack(): string {
        return this.pack
    }

    /** Packs that exist in the library document (may differ from the manifest). */
    public getPacks(): string[] {
        return Object.keys(this.state.packs)
    }

    /** A pack's subtree, created on demand (in memory) so any pack can be browsed. */
    public getTreeFor(pack: string): PackTree {
        return ensurePack(this.state, pack, this.now)
    }

    public async createFolder(pack: string, name: string, parentId?: string): Promise<boolean> {
        const ok = addNode(this.getTreeFor(pack), makeFolder(name, this.now, this.id), parentId)
        await this.persist()
        return ok
    }

    public async rename(pack: string, id: string, name: string): Promise<void> {
        renameNode(this.getTreeFor(pack), id, name, this.now)
        await this.persist()
    }

    /** Set a folder's book description (a folder is a Factorio book). */
    public async setDescription(pack: string, id: string, description: string): Promise<void> {
        const node = findNode(this.getTreeFor(pack), id)
        if (node && node.kind === 'folder') {
            node.description = description || undefined
            node.updatedAt = this.now()
            await this.persist()
        }
    }

    /** Reparent a node within its pack (into a folder, or to the root). */
    public async move(pack: string, id: string, newParentId?: string): Promise<boolean> {
        const ok = moveNode(this.getTreeFor(pack), id, newParentId)
        await this.persist()
        return ok
    }

    /** Duplicate a node in place (no version history travels). */
    public async duplicate(pack: string, id: string): Promise<LibraryNode | null> {
        const clone = duplicateNode(this.getTreeFor(pack), id, this.now, this.id)
        await this.persist()
        return clone
    }

    /** Remove a leaf/folder (never the scratchpad); reassigns active if needed. */
    public async remove(pack: string, id: string): Promise<boolean> {
        const tree = this.getTreeFor(pack)
        if (id === tree.scratchpad.id) return false
        const removed = removeNode(tree, id)
        if (pack === this.pack && (tree.activeId === id || !findNode(tree, tree.activeId))) {
            tree.activeId = tree.scratchpad.id
        }
        await this.persist()
        return removed
    }

    /**
     * Copy a node into another pack (optimistic — no compatibility check; any
     * prototypes the target pack lacks are stripped when the entry is opened
     * there). Version history does not travel. Returns the clone, or null.
     */
    public async copyToPack(
        fromPack: string,
        id: string,
        toPack: string,
        parentId?: string
    ): Promise<LibraryNode | null> {
        const node = findNode(this.getTreeFor(fromPack), id)
        if (!node) return null
        const clone = cloneNode(node, this.now, this.id)
        if (!addNode(this.getTreeFor(toPack), clone, parentId)) return null
        await this.persist()
        return clone
    }

    /**
     * Move a node to another pack: copy it there (history dropped, as for any
     * cross-pack copy) and remove the original. Reassigns the active leaf if the
     * moved node was the active one in the (active) source pack.
     */
    public async moveToPack(
        fromPack: string,
        id: string,
        toPack: string,
        parentId?: string
    ): Promise<boolean> {
        const from = this.getTreeFor(fromPack)
        if (id === from.scratchpad.id) return false
        const node = findNode(from, id)
        if (!node) return false
        if (!addNode(this.getTreeFor(toPack), cloneNode(node, this.now, this.id), parentId)) {
            return false
        }
        removeNode(from, id)
        if (fromPack === this.pack && (from.activeId === id || !findNode(from, from.activeId))) {
            from.activeId = from.scratchpad.id
        }
        await this.persist()
        return true
    }

    /**
     * Mark `id` as the active leaf of `pack` so that, after the app switches to
     * that pack (a `setDataPack` reload), it reopens this entry. The persisted
     * activeId is the cross-pack-open handoff. Returns false if the id is unknown.
     */
    public async setActiveForPack(pack: string, id: string): Promise<boolean> {
        const tree = this.getTreeFor(pack)
        if (!findNode(tree, id)) return false
        tree.activeId = id
        await this.persist()
        return true
    }

    public async restore(pack: string, id: string, snapshotIndex: number): Promise<boolean> {
        const ok = restoreSnapshot(this.getTreeFor(pack), id, snapshotIndex, this.now)
        await this.persist()
        return ok
    }

    /** Delete one saved version of a leaf. */
    public async deleteSnapshot(pack: string, id: string, snapshotIndex: number): Promise<boolean> {
        const ok = deleteSnapshot(this.getTreeFor(pack), id, snapshotIndex)
        await this.persist()
        return ok
    }

    /** A leaf by id within a pack (for reading its versions), or null. */
    public getEntry(pack: string, id: string): BlueprintEntry | null {
        const node = findNode(this.getTreeFor(pack), id)
        return node && node.kind === 'blueprint' ? node : null
    }

    // --- native-string interchange (Phase 4) --------------------------------

    /** Export a node to a native string (leaf → bp string; folder → nested book). */
    public exportNode(pack: string, id: string): string | null {
        const node = findNode(this.getTreeFor(pack), id)
        return node ? interchange.exportNode(node) : null
    }

    /** Export a whole pack as a book labelled with the pack id. */
    public exportPack(pack: string): string | null {
        return interchange.exportPack(this.getTreeFor(pack))
    }

    /** Export the whole library as a book of per-pack books. */
    public exportLibrary(): string | null {
        return interchange.exportLibrary(this.state)
    }

    /**
     * Import a pasted blueprint/book string into a pack, decomposing a book into a
     * folder subtree. Grafts under `parentId` (or the pack root). Returns the
     * grafted top-level node. Throws (caller toasts) on a malformed string.
     */
    public async importInto(pack: string, str: string, parentId?: string): Promise<LibraryNode> {
        const { node } = interchange.importString(str, 'Imported blueprint', this.now, this.id)
        addNode(this.getTreeFor(pack), node, parentId)
        await this.persist()
        return node
    }

    /** Recently-opened entries, resolved to leaves (stale ids dropped). */
    public getRecents(): BlueprintEntry[] {
        const tree = this.tree()
        return tree.recents
            .map(id => findNode(tree, id))
            .filter((n): n is BlueprintEntry => !!n && n.kind === 'blueprint')
    }

    /**
     * One-time migration: fold a legacy single-slot autosave into the scratchpad
     * (only when the scratchpad is still empty, so we never clobber real work).
     */
    public async seedScratchpad(encoded: string): Promise<boolean> {
        const tree = this.tree()
        if (tree.scratchpad.encoded) return false
        tree.scratchpad.encoded = encoded
        tree.scratchpad.updatedAt = this.now()
        await this.persist()
        return true
    }
}
