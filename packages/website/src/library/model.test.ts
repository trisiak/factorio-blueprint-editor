import { describe, it, expect } from 'vitest'
import {
    createLibrary,
    ensurePack,
    makeBlueprint,
    makeFolder,
    addNode,
    removeNode,
    moveNode,
    renameNode,
    findNode,
    ensureFolder,
    updateEntryContent,
    checkpointEntry,
    hasUncheckpointedChanges,
    restoreSnapshot,
    pushRecent,
    LIBRARY_VERSION,
    Now,
    IdGen,
} from './model'

// Deterministic id/clock so the pure model is fully assertable. `now()`
// auto-increments per call so updatedAt/createdAt orderings are observable.
function fixtures(): { now: Now; id: IdGen } {
    let t = 1000
    let n = 0
    return { now: () => (t += 1), id: () => `id${n++}` }
}

describe('ensurePack', () => {
    it('creates a pack subtree with a stable scratchpad on first use', () => {
        const { now } = fixtures()
        const state = createLibrary()
        expect(state.version).toBe(LIBRARY_VERSION)

        const tree = ensurePack(state, 'space-age', now)
        expect(tree.pack).toBe('space-age')
        expect(tree.children).toEqual([])
        expect(tree.recents).toEqual([])
        expect(tree.scratchpad.id).toBe('scratchpad:space-age')
        expect(tree.scratchpad.name).toBe('Scratchpad')
        expect(tree.scratchpad.encoded).toBe('')
    })

    it('is idempotent — returns the same subtree, not a fresh one', () => {
        const state = createLibrary()
        const a = ensurePack(state, 'vanilla-2.0')
        a.children.push(makeFolder('keep'))
        const b = ensurePack(state, 'vanilla-2.0')
        expect(b).toBe(a)
        expect(b.children).toHaveLength(1)
    })
})

describe('tree mutation', () => {
    it('adds nodes at the root and inside folders', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const folder = makeFolder('logistics', now, id)
        expect(addNode(tree, folder)).toBe(true)

        const bp = makeBlueprint('mall', '0aaa', now, id)
        expect(addNode(tree, bp, folder.id)).toBe(true)
        expect(folder.children).toContain(bp)

        // Unknown / non-folder parents are rejected.
        expect(addNode(tree, makeBlueprint('x', '', now, id), 'nope')).toBe(false)
        expect(addNode(tree, makeBlueprint('y', '', now, id), bp.id)).toBe(false)
    })

    it('finds nodes anywhere, including nested and the scratchpad', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const folder = makeFolder('f', now, id)
        const bp = makeBlueprint('deep', '0x', now, id)
        addNode(tree, folder)
        addNode(tree, bp, folder.id)

        expect(findNode(tree, bp.id)).toBe(bp)
        expect(findNode(tree, tree.scratchpad.id)).toBe(tree.scratchpad)
        expect(findNode(tree, 'missing')).toBeNull()
    })

    it('removes a node and drops it from recents; never removes the scratchpad', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('a', '0a', now, id)
        addNode(tree, bp)
        pushRecent(tree, bp.id)
        expect(tree.recents).toContain(bp.id)

        expect(removeNode(tree, bp.id)).toBe(true)
        expect(findNode(tree, bp.id)).toBeNull()
        expect(tree.recents).not.toContain(bp.id)

        expect(removeNode(tree, tree.scratchpad.id)).toBe(false)
        expect(removeNode(tree, 'missing')).toBe(false)
    })

    it('renames any node and bumps updatedAt', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('old', '0a', now, id)
        addNode(tree, bp)
        const before = bp.updatedAt
        expect(renameNode(tree, bp.id, 'new', now)).toBe(true)
        expect(bp.name).toBe('new')
        expect(bp.updatedAt).toBeGreaterThan(before)
    })
})

describe('moveNode', () => {
    it('moves a node into a folder and back to the root', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const folder = makeFolder('f', now, id)
        const bp = makeBlueprint('a', '0a', now, id)
        addNode(tree, folder)
        addNode(tree, bp) // at root

        expect(moveNode(tree, bp.id, folder.id)).toBe(true)
        expect(folder.children).toContain(bp)
        expect(tree.children).not.toContain(bp)

        expect(moveNode(tree, bp.id)).toBe(true) // back to root
        expect(tree.children).toContain(bp)
        expect(folder.children).not.toContain(bp)
    })

    it('refuses to move a folder into its own descendant, or the scratchpad', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const outer = makeFolder('outer', now, id)
        const inner = makeFolder('inner', now, id)
        addNode(tree, outer)
        addNode(tree, inner, outer.id)

        expect(moveNode(tree, outer.id, inner.id)).toBe(false)
        expect(moveNode(tree, outer.id, outer.id)).toBe(false)
        expect(moveNode(tree, tree.scratchpad.id, outer.id)).toBe(false)
        // Sanity: structure is untouched after the rejected moves.
        expect(tree.children).toContain(outer)
        expect(outer.children).toContain(inner)
    })
})

describe('ensureFolder', () => {
    it('creates a top-level folder once, then returns the same one', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const a = ensureFolder(tree, 'Imported', now, id)
        const b = ensureFolder(tree, 'Imported', now, id)
        expect(a).toBe(b)
        expect(tree.children.filter(c => c.kind === 'folder')).toHaveLength(1)
    })
})

describe('content: autosave vs explicit checkpoint', () => {
    it('updateEntryContent changes live content without checkpointing', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('a', '', now, id)
        addNode(tree, bp)

        updateEntryContent(tree, bp.id, '0v1', now)
        updateEntryContent(tree, bp.id, '0v2', now)
        expect(bp.encoded).toBe('0v2')
        expect(bp.snapshots).toHaveLength(0) // autosave never snapshots
    })

    it('checkpointEntry captures the current content, newest first', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('a', '0v1', now, id)
        addNode(tree, bp)

        expect(checkpointEntry(tree, bp.id, now)).toBe(true)
        updateEntryContent(tree, bp.id, '0v2', now)
        expect(checkpointEntry(tree, bp.id, now)).toBe(true)
        expect(bp.snapshots.map(s => s.encoded)).toEqual(['0v2', '0v1'])
    })

    it('checkpointEntry is a no-op on empty content or an unchanged checkpoint', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const empty = makeBlueprint('e', '', now, id)
        addNode(tree, empty)
        expect(checkpointEntry(tree, empty.id, now)).toBe(false)

        const bp = makeBlueprint('a', '0v1', now, id)
        addNode(tree, bp)
        expect(checkpointEntry(tree, bp.id, now)).toBe(true)
        expect(checkpointEntry(tree, bp.id, now)).toBe(false) // identical → skipped
        expect(bp.snapshots).toHaveLength(1)
    })

    it('prunes checkpoints to the limit', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('a', '0v0', now, id)
        addNode(tree, bp)
        for (let i = 1; i <= 5; i++) {
            updateEntryContent(tree, bp.id, `0v${i}`, now)
            checkpointEntry(tree, bp.id, now, 3)
        }
        expect(bp.snapshots).toHaveLength(3)
        expect(bp.snapshots.map(s => s.encoded)).toEqual(['0v5', '0v4', '0v3'])
    })

    it('hasUncheckpointedChanges tracks edits since the last checkpoint', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('a', '', now, id)
        addNode(tree, bp)
        expect(hasUncheckpointedChanges(bp)).toBe(false) // empty

        updateEntryContent(tree, bp.id, '0v1', now)
        expect(hasUncheckpointedChanges(bp)).toBe(true) // content, no checkpoint
        checkpointEntry(tree, bp.id, now)
        expect(hasUncheckpointedChanges(bp)).toBe(false) // matches checkpoint
        updateEntryContent(tree, bp.id, '0v2', now)
        expect(hasUncheckpointedChanges(bp)).toBe(true) // diverged again
    })

    it('restoreSnapshot brings back a version and preserves the pre-restore state', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('a', '0v1', now, id)
        addNode(tree, bp)
        checkpointEntry(tree, bp.id, now) // snapshot 0v1 (index 0)
        updateEntryContent(tree, bp.id, '0v2', now)

        expect(restoreSnapshot(tree, bp.id, 0, now)).toBe(true) // restore 0v1
        expect(bp.encoded).toBe('0v1')
        // 0v2 (the pre-restore content) was checkpointed first → newest.
        expect(bp.snapshots[0].encoded).toBe('0v2')
    })

    it('rejects content ops against folders or missing ids', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const folder = makeFolder('f', now, id)
        addNode(tree, folder)
        expect(updateEntryContent(tree, folder.id, '0x', now)).toBe(false)
        expect(checkpointEntry(tree, 'missing', now)).toBe(false)
        expect(restoreSnapshot(tree, folder.id, 0, now)).toBe(false)
    })
})

describe('pushRecent', () => {
    it('keeps most-recent first, dedupes, and caps', () => {
        const tree = ensurePack(createLibrary(), 'p')
        pushRecent(tree, 'a', 3)
        pushRecent(tree, 'b', 3)
        pushRecent(tree, 'a', 3) // re-open a → moves to front, no dupe
        expect(tree.recents).toEqual(['a', 'b'])
        pushRecent(tree, 'c', 3)
        pushRecent(tree, 'd', 3) // exceeds cap → oldest ('b') drops
        expect(tree.recents).toEqual(['d', 'c', 'a'])
    })
})
