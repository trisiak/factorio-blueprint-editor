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
    saveEntryContent,
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

describe('saveEntryContent + snapshots', () => {
    it('snapshots the prior version on a real change, newest first', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('a', '', now, id)
        addNode(tree, bp)

        saveEntryContent(tree, bp.id, '0v1', now)
        expect(bp.encoded).toBe('0v1')
        expect(bp.snapshots).toHaveLength(0) // nothing to snapshot (was empty)

        saveEntryContent(tree, bp.id, '0v2', now)
        expect(bp.encoded).toBe('0v2')
        expect(bp.snapshots.map(s => s.encoded)).toEqual(['0v1'])

        saveEntryContent(tree, bp.id, '0v3', now)
        expect(bp.snapshots.map(s => s.encoded)).toEqual(['0v2', '0v1'])
    })

    it('does not snapshot a no-op save (identical content)', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('a', '0same', now, id)
        addNode(tree, bp)
        saveEntryContent(tree, bp.id, '0same', now)
        expect(bp.snapshots).toHaveLength(0)
    })

    it('prunes snapshots to the limit', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('a', '0v0', now, id)
        addNode(tree, bp)
        for (let i = 1; i <= 5; i++) saveEntryContent(tree, bp.id, `0v${i}`, now, 3)
        expect(bp.snapshots).toHaveLength(3)
        // Newest-first: the three most recent prior versions.
        expect(bp.snapshots.map(s => s.encoded)).toEqual(['0v4', '0v3', '0v2'])
    })

    it('restoreSnapshot brings back a version and snapshots the pre-restore state', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const bp = makeBlueprint('a', '0v1', now, id)
        addNode(tree, bp)
        saveEntryContent(tree, bp.id, '0v2', now) // snapshots 0v1
        expect(restoreSnapshot(tree, bp.id, 0, now)).toBe(true) // restore 0v1
        expect(bp.encoded).toBe('0v1')
        // 0v2 (the pre-restore content) is now the newest snapshot.
        expect(bp.snapshots[0].encoded).toBe('0v2')
    })

    it('rejects saves/restores against folders or missing ids', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const folder = makeFolder('f', now, id)
        addNode(tree, folder)
        expect(saveEntryContent(tree, folder.id, '0x', now)).toBe(false)
        expect(saveEntryContent(tree, 'missing', '0x', now)).toBe(false)
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
