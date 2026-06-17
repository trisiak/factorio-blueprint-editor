// Blueprint library — native-string interchange (Phase 4).
//
// Export any node to a native Factorio string, and decompose an imported book
// back into library nodes. The native book format nests books, so folders ↔
// nested blueprint-books and a subtree round-trips structurally.
//
// This is pure and editor-free: it uses the same wire codec as the editor's
// bpString (`0` + base64(deflate(JSON))) directly via pako, operating on the raw
// `{ blueprint } | { blueprint_book }` JSON. That keeps it unit-testable in the
// node env (the editor's `decode` needs loaded game data) and is the right tool
// for interchange — strings we store are already valid, and an imported book is
// only decomposed *structurally* (its blueprints are re-stored verbatim and get
// validated / unknown-entity-stripped by the editor when actually opened).

import pako from 'pako'
import { Buffer } from 'buffer'
import {
    LibraryNode,
    PackTree,
    LibraryState,
    makeBlueprint,
    makeFolder,
    Now,
    IdGen,
    genId,
} from './model'

// Minimal structural subset of the editor's IBlueprint / IBlueprintBook — just
// the fields interchange touches (the rest rides along untouched via the codec).
interface RawBlueprint {
    item: 'blueprint'
    label?: string
    version?: number
    [k: string]: unknown
}
interface RawBook {
    item: 'blueprint-book'
    active_index: number
    version?: number
    label?: string
    blueprints?: RawEntry[]
    [k: string]: unknown
}
interface RawEntry {
    index: number
    blueprint?: RawBlueprint
    blueprint_book?: RawBook
    upgrade_planner?: unknown
    deconstruction_planner?: unknown
}
export type RawData = { blueprint?: RawBlueprint; blueprint_book?: RawBook }

/** Factorio version stamp for assembled books when no child carries one (2.0.45,
 *  mirroring the editor's `getFactorioVersion()` default). */
const FALLBACK_VERSION = (45 << 16) + (2 << 16) * 0xffffffff

/** Decode a `0`-prefixed blueprint string into its raw JSON. Throws if malformed. */
export function decodeRaw(str: string): RawData {
    const json = pako.inflate(Buffer.from(str.slice(1), 'base64'), { to: 'string' })
    return JSON.parse(json)
}

/** Encode raw JSON back into a `0`-prefixed blueprint string. */
export function encodeRaw(data: RawData): string {
    return `0${Buffer.from(pako.deflate(JSON.stringify(data))).toString('base64')}`
}

function firstVersion(entries: RawEntry[]): number | undefined {
    for (const e of entries) {
        if (e.blueprint?.version !== undefined) return e.blueprint.version
        if (e.blueprint_book?.version !== undefined) return e.blueprint_book.version
    }
    return undefined
}

// A book entry for a node, or null when it carries no blueprint (empty leaves and
// empty folders are skipped — a book needs at least one blueprint to be valid).
// The library entry's name becomes the entry's label (the user's name is the
// authoritative one for organization).
function entryFor(node: LibraryNode, index: number): RawEntry | null {
    if (node.kind === 'folder') {
        const book = bookFromChildren(node.children, node.name)
        return book ? { index, blueprint_book: book } : null
    }
    if (!node.encoded) return null
    const raw = decodeRaw(node.encoded)
    if (raw.blueprint) return { index, blueprint: { ...raw.blueprint, label: node.name } }
    if (raw.blueprint_book)
        return { index, blueprint_book: { ...raw.blueprint_book, label: node.name } }
    return null
}

// Assemble a blueprint-book from children, or null if it has no blueprints.
function bookFromChildren(children: LibraryNode[], label?: string): RawBook | null {
    const entries: RawEntry[] = []
    for (const child of children) {
        const e = entryFor(child, entries.length)
        if (e) entries.push(e)
    }
    if (entries.length === 0) return null
    return {
        item: 'blueprint-book',
        active_index: 0,
        version: firstVersion(entries) ?? FALLBACK_VERSION,
        label,
        blueprints: entries,
    }
}

/**
 * Export a single node to a native string: a blueprint leaf → its blueprint
 * string as-is; a folder → a nested book. Returns null if there's nothing
 * exportable (an empty leaf / a folder with no blueprints).
 */
export function exportNode(node: LibraryNode): string | null {
    if (node.kind === 'blueprint') return node.encoded || null
    const book = bookFromChildren(node.children, node.name)
    return book ? encodeRaw({ blueprint_book: book }) : null
}

/**
 * Export a whole pack as a book labelled with the pack id (the modpack-label
 * convention, so a re-import can recognise where it came from).
 */
export function exportPack(tree: PackTree): string | null {
    const book = bookFromChildren(tree.children, tree.pack)
    return book ? encodeRaw({ blueprint_book: book }) : null
}

/** Export the whole library as a book of per-pack books (each labelled pack id). */
export function exportLibrary(state: LibraryState): string | null {
    const entries: RawEntry[] = []
    for (const pack of Object.keys(state.packs)) {
        const book = bookFromChildren(state.packs[pack].children, pack)
        if (book) entries.push({ index: entries.length, blueprint_book: book })
    }
    if (entries.length === 0) return null
    return encodeRaw({
        blueprint_book: {
            item: 'blueprint-book',
            active_index: 0,
            version: firstVersion(entries) ?? FALLBACK_VERSION,
            label: 'Library',
            blueprints: entries,
        },
    })
}

export interface ImportResult {
    /** The top-level node to graft: a folder for a book, a leaf for a single bp. */
    node: LibraryNode
    /** The top-level book's label, if any — may match a pack id (routing hint). */
    packHint?: string
}

function entriesToNodes(
    entries: RawEntry[],
    defaultName: string,
    now: Now,
    id: IdGen
): LibraryNode[] {
    const nodes: LibraryNode[] = []
    for (const e of entries) {
        if (e.blueprint) {
            nodes.push(
                makeBlueprint(
                    e.blueprint.label || defaultName,
                    encodeRaw({ blueprint: e.blueprint }),
                    now,
                    id
                )
            )
        } else if (e.blueprint_book) {
            const folder = makeFolder(e.blueprint_book.label || 'Book', now, id)
            folder.children = entriesToNodes(
                e.blueprint_book.blueprints ?? [],
                defaultName,
                now,
                id
            )
            nodes.push(folder)
        }
        // upgrade/deconstruction planners are skipped — the library holds blueprints.
    }
    return nodes
}

/**
 * Decompose a pasted `0`-prefixed string into library nodes: a single blueprint
 * → a leaf; a book → a folder (named after the book) whose subtree mirrors the
 * book's nesting. Throws on a malformed / non-blueprint string.
 */
export function importString(
    str: string,
    defaultName = 'Imported blueprint',
    now: Now = Date.now,
    id: IdGen = genId
): ImportResult {
    const data = decodeRaw(str)
    if (data.blueprint_book) {
        const book = data.blueprint_book
        const folder = makeFolder(book.label || 'Imported book', now, id)
        folder.children = entriesToNodes(book.blueprints ?? [], defaultName, now, id)
        return { node: folder, packHint: book.label }
    }
    if (data.blueprint) {
        const name = data.blueprint.label || defaultName
        return { node: makeBlueprint(name, encodeRaw({ blueprint: data.blueprint }), now, id) }
    }
    throw new Error('Not a blueprint or blueprint book')
}
