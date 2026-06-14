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
import {
    LibraryState,
    PackTree,
    BlueprintEntry,
    createLibrary,
    ensurePack,
    ensureFolder,
    makeBlueprint,
    addNode,
    findNode,
    removeNode,
    renameNode,
    updateEntryContent,
    checkpointEntry,
    restoreSnapshot,
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
     * last checkpoint — drives the "unsaved changes" prompt.
     */
    public isModified(encoded: string): boolean {
        const active = this.getActive()
        return !!encoded && encoded !== (active.snapshots[0]?.encoded ?? '')
    }

    /**
     * Explicit Save: mirror the latest content, then checkpoint the active leaf.
     * Returns true if a new version was actually recorded.
     */
    public async save(encoded: string): Promise<boolean> {
        const tree = this.tree()
        updateEntryContent(tree, tree.activeId, encoded, this.now)
        const made = checkpointEntry(tree, tree.activeId, this.now)
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

    public async rename(id: string, name: string): Promise<void> {
        renameNode(this.tree(), id, name, this.now)
        await this.persist()
    }

    /** Remove a leaf/folder (never the scratchpad); reassigns active if needed. */
    public async remove(id: string): Promise<boolean> {
        const tree = this.tree()
        if (id === tree.scratchpad.id) return false
        const removed = removeNode(tree, id)
        if (tree.activeId === id || !findNode(tree, tree.activeId)) {
            tree.activeId = tree.scratchpad.id
        }
        await this.persist()
        return removed
    }

    public async restore(id: string, snapshotIndex: number): Promise<boolean> {
        const ok = restoreSnapshot(this.tree(), id, snapshotIndex, this.now)
        await this.persist()
        return ok
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
