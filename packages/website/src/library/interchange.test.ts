import { describe, it, expect } from 'vitest'
import {
    decodeRaw,
    encodeRaw,
    exportNode,
    exportPack,
    exportLibrary,
    importString,
} from './interchange'
import { createLibrary, ensurePack, makeBlueprint, makeFolder, addNode, Now, IdGen } from './model'

function fixtures(): { now: Now; id: IdGen } {
    let t = 1000
    let n = 0
    return { now: () => (t += 1), id: () => `id${n++}` }
}

// A minimal-but-real encoded blueprint string (same wire format the app stores).
function bp(version = 100): string {
    return encodeRaw({ blueprint: { item: 'blueprint', version, entities: [{ name: 'x' }] } })
}

describe('raw codec', () => {
    it('round-trips JSON through the 0-prefixed wire format', () => {
        const s = bp(123)
        expect(s.startsWith('0')).toBe(true)
        expect(decodeRaw(s).blueprint).toMatchObject({ item: 'blueprint', version: 123 })
    })
})

describe('export', () => {
    it('a blueprint leaf exports its string as-is; an empty leaf exports null', () => {
        const leaf = makeBlueprint('a', bp())
        expect(exportNode(leaf)).toBe(leaf.encoded)
        expect(exportNode(makeBlueprint('empty', ''))).toBeNull()
    })

    it('a folder exports a nested book labelled by name, children labelled by name', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const folder = makeFolder('Logistics', now, id)
        addNode(tree, folder)
        addNode(tree, makeBlueprint('Mall', bp(), now, id), folder.id)
        addNode(tree, makeBlueprint('Belt', bp(), now, id), folder.id)

        const data = decodeRaw(exportNode(folder)!)
        expect(data.blueprint_book?.label).toBe('Logistics')
        expect(data.blueprint_book?.blueprints?.map(e => e.blueprint?.label)).toEqual([
            'Mall',
            'Belt',
        ])
    })

    it('an empty folder exports null (a book needs ≥1 blueprint)', () => {
        const { now, id } = fixtures()
        expect(exportNode(makeFolder('empty', now, id))).toBeNull()
    })

    it('exportPack labels the top-level book with the pack id', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'space-age', now)
        addNode(tree, makeBlueprint('a', bp(), now, id))
        expect(decodeRaw(exportPack(tree)!).blueprint_book?.label).toBe('space-age')
    })

    it('exportLibrary makes a book of per-pack books labelled by pack id', () => {
        const { now, id } = fixtures()
        const state = createLibrary()
        addNode(ensurePack(state, 'vanilla-2.0', now), makeBlueprint('a', bp(), now, id))
        addNode(ensurePack(state, 'space-age', now), makeBlueprint('b', bp(), now, id))
        const data = decodeRaw(exportLibrary(state)!)
        expect(data.blueprint_book?.label).toBe('Library')
        expect(data.blueprint_book?.blueprints?.map(e => e.blueprint_book?.label).sort()).toEqual([
            'space-age',
            'vanilla-2.0',
        ])
    })
})

describe('import (decompose)', () => {
    it('a single blueprint imports as a leaf named after its label', () => {
        const { now, id } = fixtures()
        const s = encodeRaw({ blueprint: { item: 'blueprint', version: 1, label: 'Solo' } })
        const { node } = importString(s, 'Imported blueprint', now, id)
        expect(node.kind).toBe('blueprint')
        expect(node.name).toBe('Solo')
    })

    it('round-trips folder book metadata (label / description / icons / active_index)', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const folder = makeFolder('My book', now, id)
        folder.description = 'a description'
        folder.icons = [{ signal: { type: 'item', name: 'iron-plate' }, index: 1 }]
        folder.activeIndex = 1
        addNode(tree, folder)
        addNode(tree, makeBlueprint('A', bp(), now, id), folder.id)
        addNode(tree, makeBlueprint('B', bp(), now, id), folder.id)

        // Export carries the metadata onto the book...
        const book = decodeRaw(exportNode(folder)!).blueprint_book!
        expect(book.label).toBe('My book')
        expect(book.description).toBe('a description')
        expect(book.icons).toEqual([{ signal: { type: 'item', name: 'iron-plate' }, index: 1 }])
        expect(book.active_index).toBe(1)

        // ...and import copies it back onto the folder.
        const { node } = importString(exportNode(folder)!, 'Imported', now, id)
        expect(node.kind).toBe('folder')
        if (node.kind === 'folder') {
            expect(node.description).toBe('a description')
            expect(node.icons).toEqual([{ signal: { type: 'item', name: 'iron-plate' }, index: 1 }])
            expect(node.activeIndex).toBe(1)
        }
    })

    it('throws on a non-blueprint string', () => {
        const junk = encodeRaw({} as never)
        const { now, id } = fixtures()
        expect(() => importString(junk, 'x', now, id)).toThrow()
    })

    it('round-trips a pack export back into an equivalent folder tree', () => {
        const { now, id } = fixtures()
        const tree = ensurePack(createLibrary(), 'p', now)
        const folder = makeFolder('Logistics', now, id)
        addNode(tree, folder)
        addNode(tree, makeBlueprint('Mall', bp(), now, id), folder.id)
        addNode(tree, makeBlueprint('Belt', bp(), now, id), folder.id)
        addNode(tree, makeBlueprint('Root BP', bp(), now, id)) // a root-level leaf too

        const { node, packHint } = importString(exportPack(tree)!, 'Imported blueprint', now, id)
        expect(packHint).toBe('p')
        expect(node.kind).toBe('folder')
        if (node.kind !== 'folder') return
        // Top-level pack book → folder 'p' with [Logistics folder, Root BP leaf].
        expect(node.name).toBe('p')
        const logistics = node.children.find(c => c.name === 'Logistics')
        expect(logistics?.kind).toBe('folder')
        if (logistics?.kind === 'folder') {
            expect(logistics.children.map(c => c.name)).toEqual(['Mall', 'Belt'])
            expect(logistics.children.every(c => c.kind === 'blueprint')).toBe(true)
        }
        expect(node.children.some(c => c.name === 'Root BP')).toBe(true)
    })
})
