import { describe, it, expect } from 'vitest'
import { LibraryController, IMPORTED_FOLDER } from './controller'
import { InMemoryLibraryStore } from './store'
import { Now, IdGen } from './model'

// Deterministic id/clock, shared by a controller and any reload of it.
function fixtures(): { now: Now; id: IdGen } {
    let t = 1000
    let n = 0
    return { now: () => (t += 1), id: () => `id${n++}` }
}

function newController(store = new InMemoryLibraryStore()): {
    ctl: LibraryController
    store: InMemoryLibraryStore
} {
    const { now, id } = fixtures()
    return { ctl: new LibraryController(store, 'vanilla-2.0', now, id), store }
}

describe('LibraryController.init', () => {
    it('creates the pack and defaults the working context to the scratchpad', async () => {
        const { ctl } = newController()
        await ctl.init()
        expect(ctl.getTree().pack).toBe('vanilla-2.0')
        expect(ctl.getActiveId()).toBe(ctl.getTree().scratchpad.id)
        expect(ctl.isScratchpad(ctl.getActiveId())).toBe(true)
    })

    it('restores a persisted active leaf across a reload', async () => {
        const store = new InMemoryLibraryStore()
        const a = newController(store).ctl
        await a.init()
        const leaf = await a.saveAs('mall', '0mall', undefined)

        const b = newController(store).ctl
        await b.init()
        expect(b.getActiveId()).toBe(leaf.id)
        expect(b.getActiveName()).toBe('mall')
    })

    it('falls back to the scratchpad when the persisted active leaf is gone', async () => {
        const store = new InMemoryLibraryStore()
        const a = newController(store).ctl
        await a.init()
        const leaf = await a.saveAs('temp', '0temp')
        await a.remove(leaf.id)

        const b = newController(store).ctl
        await b.init()
        expect(b.isScratchpad(b.getActiveId())).toBe(true)
    })
})

describe('autosave vs save', () => {
    it('autosave mirrors content without checkpointing', async () => {
        const { ctl } = newController()
        await ctl.init()
        await ctl.autosave('0draft')
        expect(ctl.getActive().encoded).toBe('0draft')
        expect(ctl.getActive().snapshots).toHaveLength(0)
    })

    it('save checkpoints the active leaf and reports whether a version was made', async () => {
        const { ctl } = newController()
        await ctl.init()
        expect(await ctl.save('0v1')).toBe(true)
        expect(ctl.getActive().snapshots.map(s => s.encoded)).toEqual(['0v1'])
        expect(await ctl.save('0v1')).toBe(false) // unchanged → no new version
        expect(await ctl.save('0v2')).toBe(true)
        expect(ctl.getActive().snapshots.map(s => s.encoded)).toEqual(['0v2', '0v1'])
    })

    it('isModified compares the canvas to the last checkpoint', async () => {
        const { ctl } = newController()
        await ctl.init()
        expect(ctl.isModified('')).toBe(false)
        expect(ctl.isModified('0v1')).toBe(true)
        await ctl.save('0v1')
        expect(ctl.isModified('0v1')).toBe(false)
        expect(ctl.isModified('0v2')).toBe(true)
    })
})

describe('saveAs / open / recents', () => {
    it('saveAs creates a new active leaf, checkpoints it, and records a recent', async () => {
        const { ctl } = newController()
        await ctl.init()
        const leaf = await ctl.saveAs('belt balancer', '0bb')
        expect(ctl.getActiveId()).toBe(leaf.id)
        expect(leaf.snapshots.map(s => s.encoded)).toEqual(['0bb'])
        expect(ctl.getRecents().map(r => r.id)).toEqual([leaf.id])
    })

    it('open switches the working context and returns the leaf content', async () => {
        const { ctl } = newController()
        await ctl.init()
        const a = await ctl.saveAs('a', '0a')
        const b = await ctl.saveAs('b', '0b')
        expect(ctl.getActiveId()).toBe(b.id)

        expect(await ctl.open(a.id)).toBe('0a')
        expect(ctl.getActiveId()).toBe(a.id)
        // Most-recently-opened first.
        expect(ctl.getRecents().map(r => r.id)).toEqual([a.id, b.id])
        expect(await ctl.open('missing')).toBeNull()
    })
})

describe('import / new / remove', () => {
    it('importEntry files under the Imported folder and activates it', async () => {
        const { ctl } = newController()
        await ctl.init()
        const leaf = await ctl.importEntry('Imported blueprint', '0imp')
        expect(ctl.getActiveId()).toBe(leaf.id)
        const imported = ctl.getTree().children.find(c => c.name === IMPORTED_FOLDER)
        expect(imported?.kind).toBe('folder')
        if (imported?.kind === 'folder') {
            expect(imported.children).toContain(leaf)
        }
        // A second import reuses the same folder.
        await ctl.importEntry('another', '0imp2')
        expect(ctl.getTree().children.filter(c => c.name === IMPORTED_FOLDER)).toHaveLength(1)
    })

    it('newScratch clears the scratchpad and makes it active', async () => {
        const { ctl } = newController()
        await ctl.init()
        await ctl.autosave('0work')
        await ctl.save('0work')
        await ctl.saveAs('named', '0named') // move active off the scratchpad

        await ctl.newScratch()
        const tree = ctl.getTree()
        expect(ctl.getActiveId()).toBe(tree.scratchpad.id)
        expect(tree.scratchpad.encoded).toBe('')
        expect(tree.scratchpad.snapshots).toHaveLength(0)
    })

    it('remove refuses the scratchpad and reassigns active to it', async () => {
        const { ctl } = newController()
        await ctl.init()
        const leaf = await ctl.saveAs('x', '0x')
        expect(await ctl.remove(ctl.getTree().scratchpad.id)).toBe(false)

        expect(await ctl.remove(leaf.id)).toBe(true)
        expect(ctl.isScratchpad(ctl.getActiveId())).toBe(true)
    })
})

describe('seedScratchpad (legacy migration)', () => {
    it('seeds an empty scratchpad once and never clobbers existing work', async () => {
        const { ctl } = newController()
        await ctl.init()
        expect(await ctl.seedScratchpad('0legacy')).toBe(true)
        expect(ctl.getTree().scratchpad.encoded).toBe('0legacy')
        expect(await ctl.seedScratchpad('0other')).toBe(false)
        expect(ctl.getTree().scratchpad.encoded).toBe('0legacy')
    })
})
