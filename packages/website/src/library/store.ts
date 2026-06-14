// Blueprint library — persistence.
//
// The model (`model.ts`) is a plain JSON document; this file persists it. The
// `LibraryStore` interface keeps the backend swappable: today IndexedDB (local,
// roomier than localStorage, structured-clone storage that suits book-sized
// payloads), tomorrow an OAuth-locked remote (e.g. Firebase) — the document maps
// cleanly onto a remote doc. `InMemoryLibraryStore` backs tests and any
// environment without IndexedDB.
//
// IndexedDB itself can't be exercised in the node unit-test env, so the IDB impl
// is intentionally thin and verified by running the app; the unit tests cover the
// model and the in-memory store.

import { LibraryState, LIBRARY_VERSION } from './model'

/** Backend-agnostic persistence for the single library document. */
export interface LibraryStore {
    /** Load the saved library, or `null` if nothing has been saved yet. */
    load(): Promise<LibraryState | null>
    /** Persist the whole library document. */
    save(state: LibraryState): Promise<void>
    /** Drop the saved library entirely. */
    clear(): Promise<void>
}

/**
 * Bring a loaded document up to the current version. There are no older versions
 * yet, so this just guards the shape and stamps the version; future migrations
 * slot in here.
 */
export function migrate(state: LibraryState | null): LibraryState | null {
    if (!state || typeof state !== 'object') return null
    if (!state.packs) return null
    state.version = LIBRARY_VERSION
    return state
}

/** Volatile store — used by tests and as a fallback when IndexedDB is absent. */
export class InMemoryLibraryStore implements LibraryStore {
    private state: LibraryState | null = null

    public load(): Promise<LibraryState | null> {
        // Hand back a clone so callers can't mutate our copy out from under us
        // (mirrors a real store, which deserializes a fresh object each load).
        return Promise.resolve(this.state ? structuredClone(this.state) : null)
    }

    public save(state: LibraryState): Promise<void> {
        this.state = structuredClone(state)
        return Promise.resolve()
    }

    public clear(): Promise<void> {
        this.state = null
        return Promise.resolve()
    }
}

const DB_NAME = 'fbe'
const STORE_NAME = 'library'
const DOC_KEY = 'state'

/**
 * IndexedDB-backed store. The whole library is a single record under a fixed key
 * — simple, and a clean shape to later mirror to a remote document. All
 * operations are best-effort: a failure (private mode, blocked IDB) rejects the
 * promise, and the caller falls back to in-memory.
 */
export class IndexedDBLibraryStore implements LibraryStore {
    private dbPromise: Promise<IDBDatabase> | null = null

    private open(): Promise<IDBDatabase> {
        if (this.dbPromise) return this.dbPromise
        this.dbPromise = new Promise((resolve, reject) => {
            const idb = globalThis.indexedDB
            if (!idb) {
                reject(new Error('IndexedDB unavailable'))
                return
            }
            const req = idb.open(DB_NAME, 1)
            req.onupgradeneeded = () => {
                const db = req.result
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME)
                }
            }
            req.onsuccess = () => resolve(req.result)
            req.onerror = () => reject(req.error)
        })
        return this.dbPromise
    }

    private tx<T>(
        mode: IDBTransactionMode,
        run: (store: IDBObjectStore) => IDBRequest<T>
    ): Promise<T> {
        return this.open().then(
            db =>
                new Promise<T>((resolve, reject) => {
                    const tx = db.transaction(STORE_NAME, mode)
                    const req = run(tx.objectStore(STORE_NAME))
                    req.onsuccess = () => resolve(req.result)
                    req.onerror = () => reject(req.error)
                })
        )
    }

    public load(): Promise<LibraryState | null> {
        return this.tx<LibraryState | undefined>('readonly', s => s.get(DOC_KEY)).then(v =>
            migrate(v ?? null)
        )
    }

    public save(state: LibraryState): Promise<void> {
        return this.tx('readwrite', s => s.put(state, DOC_KEY)).then(() => undefined)
    }

    public clear(): Promise<void> {
        return this.tx('readwrite', s => s.delete(DOC_KEY)).then(() => undefined)
    }
}

/**
 * Pick the best available store: IndexedDB when present, else in-memory. (The
 * caller decides whether to surface a "your work won't persist" warning when it
 * falls back.)
 */
export function createLibraryStore(): LibraryStore {
    try {
        if (globalThis.indexedDB) return new IndexedDBLibraryStore()
    } catch {
        /* fall through to in-memory */
    }
    return new InMemoryLibraryStore()
}
