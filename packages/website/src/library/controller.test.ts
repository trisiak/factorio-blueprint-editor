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
        await a.remove(a.getActivePack(), leaf.id)

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

    it('save checkpoints a named leaf and reports whether a version was made', async () => {
        const { ctl } = newController()
        await ctl.init()
        await ctl.saveAs('proj', '0v1') // move active off the scratchpad; checkpoints 0v1
        expect(ctl.getActive().snapshots.map(s => s.encoded)).toEqual(['0v1'])
        expect(await ctl.save('0v1')).toBe(false) // unchanged → no new version
        expect(await ctl.save('0v2')).toBe(true)
        expect(ctl.getActive().snapshots.map(s => s.encoded)).toEqual(['0v2', '0v1'])
    })

    it('isModified compares a named leaf to its last checkpoint', async () => {
        const { ctl } = newController()
        await ctl.init()
        await ctl.saveAs('proj', '0v1') // checkpoints 0v1
        expect(ctl.isModified('0v1')).toBe(false)
        expect(ctl.isModified('0v2')).toBe(true)
    })

    it('the scratchpad is always live — it holds no versions and is never modified', async () => {
        const { ctl } = newController()
        await ctl.init() // active = scratchpad
        await ctl.autosave('0work')
        // Saving the scratchpad never checkpoints it.
        expect(await ctl.save('0work')).toBe(false)
        expect(ctl.getActive().snapshots).toHaveLength(0)
        // ...and it's never reported as modified, however much it changes.
        expect(ctl.isModified('0work')).toBe(false)
        expect(ctl.isModified('0other')).toBe(false)
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
        const p = ctl.getActivePack()
        const leaf = await ctl.saveAs('x', '0x')
        expect(await ctl.remove(p, ctl.getTree().scratchpad.id)).toBe(false)

        expect(await ctl.remove(p, leaf.id)).toBe(true)
        expect(ctl.isScratchpad(ctl.getActiveId())).toBe(true)
    })
})

describe('organization (Phase 2)', () => {
    it('creates folders, moves a leaf into one, and renames nodes', async () => {
        const { ctl } = newController()
        await ctl.init()
        const p = ctl.getActivePack()
        const leaf = await ctl.saveAs('mall', '0mall') // at root
        await ctl.createFolder(p, 'Logistics')
        const folder = ctl
            .getTree()
            .children.find(c => c.kind === 'folder' && c.name === 'Logistics')!

        expect(await ctl.move(p, leaf.id, folder.id)).toBe(true)
        expect(folder.kind === 'folder' && folder.children.some(c => c.id === leaf.id)).toBe(true)
        expect(ctl.getTree().children).not.toContain(leaf)

        await ctl.rename(p, folder.id, 'Logistics v2')
        expect(ctl.getTree().children.find(c => c.id === folder.id)?.name).toBe('Logistics v2')
    })

    it('duplicates a leaf in place without its version history', async () => {
        const { ctl } = newController()
        await ctl.init()
        const p = ctl.getActivePack()
        const leaf = await ctl.saveAs('belt', '0belt')
        await ctl.save('0belt2') // give the original a version
        expect(ctl.getActive().snapshots.length).toBeGreaterThan(0)

        const clone = await ctl.duplicate(p, leaf.id)
        expect(clone?.kind).toBe('blueprint')
        if (clone?.kind === 'blueprint') {
            expect(clone.name).toBe('belt (copy)')
            expect(clone.encoded).toBe(ctl.getActive().encoded) // current content copied
            expect(clone.snapshots).toHaveLength(0) // history does not travel
        }
    })
})

describe('versioning (Phase 3)', () => {
    it('restore overwrites live content with a chosen version; delete removes one', async () => {
        const { ctl } = newController()
        await ctl.init()
        const p = ctl.getActivePack()
        const leaf = await ctl.saveAs('proj', '0v1') // versions: ['0v1']
        await ctl.save('0v2') // versions: ['0v2','0v1']
        expect(ctl.getEntry(p, leaf.id)?.snapshots.map(s => s.encoded)).toEqual(['0v2', '0v1'])

        // Restore the older version into live content (no implicit checkpoint).
        expect(await ctl.restore(p, leaf.id, 1)).toBe(true)
        expect(ctl.getEntry(p, leaf.id)?.encoded).toBe('0v1')
        expect(ctl.getEntry(p, leaf.id)?.snapshots.map(s => s.encoded)).toEqual(['0v2', '0v1'])

        // Delete the newest version.
        expect(await ctl.deleteSnapshot(p, leaf.id, 0)).toBe(true)
        expect(ctl.getEntry(p, leaf.id)?.snapshots.map(s => s.encoded)).toEqual(['0v1'])
    })

    it('getEntry returns null for folders / unknown ids', async () => {
        const { ctl } = newController()
        await ctl.init()
        const p = ctl.getActivePack()
        await ctl.createFolder(p, 'F')
        const folder = ctl.getTree().children.find(c => c.name === 'F')!
        expect(ctl.getEntry(p, folder.id)).toBeNull()
        expect(ctl.getEntry(p, 'missing')).toBeNull()
    })
})

describe('cross-pack copy / move (Phase 2)', () => {
    it('copies a leaf into another pack (optimistic, no history) and leaves the original', async () => {
        const { ctl } = newController()
        await ctl.init()
        const from = ctl.getActivePack()
        const leaf = await ctl.saveAs('reactor', '0reactor')
        await ctl.save('0reactor2') // a version on the original

        const clone = await ctl.copyToPack(from, leaf.id, 'space-age')
        expect(clone?.kind).toBe('blueprint')
        // Original stays put...
        expect(ctl.getTreeFor(from).children.some(c => c.id === leaf.id)).toBe(true)
        // ...and the copy lands in the target pack without snapshots.
        const target = ctl.getTreeFor('space-age')
        const copied = target.children.find(c => c.id === clone!.id)
        expect(copied?.kind).toBe('blueprint')
        if (copied?.kind === 'blueprint') {
            expect(copied.encoded).toBe('0reactor2')
            expect(copied.snapshots).toHaveLength(0)
        }
        expect(ctl.getPacks()).toContain('space-age')
    })

    it('moves a leaf to another pack and removes the original', async () => {
        const { ctl } = newController()
        await ctl.init()
        const from = ctl.getActivePack()
        const leaf = await ctl.saveAs('outpost', '0outpost')

        expect(await ctl.moveToPack(from, leaf.id, 'space-age')).toBe(true)
        expect(ctl.getTreeFor(from).children.some(c => c.id === leaf.id)).toBe(false)
        expect(ctl.getTreeFor('space-age').children.some(c => c.kind === 'blueprint')).toBe(true)
        // Active leaf was moved out of the active pack → falls back to scratchpad.
        expect(ctl.isScratchpad(ctl.getActiveId())).toBe(true)
    })

    it('setActiveForPack records the cross-pack-open handoff', async () => {
        const store = new InMemoryLibraryStore()
        const a = newController(store).ctl
        await a.init()
        const clone = await a.copyToPack(
            a.getActivePack(),
            (await a.saveAs('x', '0x')).id,
            'space-age'
        )
        expect(await a.setActiveForPack('space-age', clone!.id)).toBe(true)

        // A controller booting on space-age reopens that entry.
        const { now, id } = fixtures()
        const b = new LibraryController(store, 'space-age', now, id)
        await b.init()
        expect(b.getActiveId()).toBe(clone!.id)
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
