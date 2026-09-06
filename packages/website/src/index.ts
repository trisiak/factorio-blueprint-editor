import './index.styl'

import { isMobile } from 'pixi.js'
import FileSaver from 'file-saver'
import EDITOR, {
    Editor,
    Blueprint,
    Book,
    TrainBlueprintError,
    ModdedBlueprintError,
    CorruptedBlueprintStringError,
    BookWithNoBlueprintsError,
    encode,
    getBlueprintOrBookFromSource,
    installTestHook,
    DATA_PACK,
    setDataPack,
    loadPackManifest,
    getCanonicalDataPack,
    canonicalPacks,
    inputMode,
} from '@fbe/editor'
import type { PackManifestEntry } from '@fbe/editor'
import { initToasts } from './toasts'
import { initSettingsPane } from './settingsPane'
import { initActionToolbar } from './actionToolbar'
import { initViewportRegions } from './viewportRegions'
import { loadPackIcons } from './packIcons'
import { initEntityInfoSheet } from './entityInfoSheet'
import { initRatesDrawer } from './ratesDrawer'
import { loadSavedBlueprint, clearSavedBlueprint } from './blueprintStorage'
import { LibraryController } from './library/controller'
import { createLibraryStore } from './library/store'
import { getWriterId } from './library/model'
import { initLibraryPanel, LibraryPanel, LibraryPanelCallbacks } from './library/libraryPanel'
import { SyncService, SyncedLibraryStore, SyncStatus, ConflictInfo } from './library/syncService'
import {
    firebaseConfigured,
    signIn,
    signOutUser,
    onAuth,
    createRemote,
    AuthUser,
} from './library/firebase'

document.addEventListener('contextmenu', e => e.preventDefault())

const editor = new Editor()

let t0 = performance.now()

const CANVAS = document.getElementById('editor') as HTMLCanvasElement

let bp: Blueprint
let book: Book

// The in-app blueprint library: a persistent, organized home for projects (see
// docs/blueprint-library.md / issue #50). The active leaf is the working context
// — the canvas edits it, autosave mirrors it, and Save checkpoints a version.
// Scoped to the active data pack (the library's top tier is per pack).
//
// Phase 6 puts the local store behind a `SyncedLibraryStore` decorator: the
// controller still writes locally (durable, offline-first), and — when a user is
// signed in — the write is mirrored to a Firebase remote via `SyncService`. On an
// unconfigured build the service simply never attaches a remote, so this is
// exactly the previous local-only behaviour.
const localStore = createLibraryStore()
// This install's write attribution, shared by the controller (via its default)
// and the sync service so the resolver can recognise our own remote echoes.
const writerId = getWriterId()
let currentUser: AuthUser | null = null
let syncStatus: SyncStatus = firebaseConfigured() ? 'signed-out' : 'disabled'
const syncService = new SyncService({
    local: localStore,
    writerId,
    onStatus: status => {
        syncStatus = status
        libraryPanel?.syncChanged()
    },
    onPulled: () => {
        void handlePulled()
    },
    onConflict: info => {
        void handleConflict(info)
    },
})
const syncedStore = new SyncedLibraryStore(localStore, syncService)
// Scoped to the CANONICAL pack id (`variantOf ?? id`), not the loaded pack id: a
// graphics variant (docs/slim-graphics.md) is the same game data with smaller
// textures, so switching `vanilla-2.0` ↔ `vanilla-2.0-slim` must keep the same
// library subtree, scratchpad and active leaf. That id is only known once
// packs.json has been fetched, so the controller is built during boot (below),
// before anything can touch it — every use site is inside a callback that runs
// after `loadInitialBlueprint`.
let library: LibraryController
let libraryPanel: LibraryPanel
let activeProjectEl: HTMLElement | null
// "Book view" (Phase 5b): opening a folder loads it as a navigable Book onto the
// canvas (flip through it with the settings BP Book Index slider). It's a *view*
// — the working context (active leaf) and autosave are suspended so we never
// write the whole book back into a leaf. Opening a leaf / New project exits it.
let viewingBook = false
let viewingBookLabel = ''
// The data-pack manifest, for the library panel's pack drop-down. Loaded once at
// init from packs.json (shared, cached fetch — the settings pane reads the same
// one); the active pack is always present even if the manifest fetch fails.
let packManifest: PackManifestEntry[] = [{ id: DATA_PACK, label: DATA_PACK }]

const loadingScreen = {
    el: document.getElementById('loadingScreen'),
    show() {
        this.el.classList.add('active')
        t0 = performance.now()
    },
    hide() {
        this.el.classList.remove('active')
        const t1 = performance.now()
        if (editor.debug) {
            console.log('Load time:', t1 - t0)
        }
    },
}

console.log(
    '\n%cLooking for the source?\nhttps://github.com/Teoxoy/factorio-blueprint-editor\n',
    'color: #1f79aa; font-weight: bold'
)

const createToast = initToasts()

// Input signals as body classes (#101 Slice 1). Detection is no longer a
// desktop/mobile switch: `coarse` (primary pointer), `keys` (a physical keyboard
// is present), `compact` (narrow viewport) and `touch-recent` (the last pointer
// event was a touch) are orthogonal and live, so most device gating can become
// plain CSS instead of a JS branch. They sit *alongside* the legacy `body.mobile`
// (still driven by the derived mode in settingsPane.ts) while the surfaces
// migrate one slice at a time.
const syncInputSignalClasses = (): void => {
    const { coarse, keys, compact, touchRecent } = inputMode.signals
    const cl = document.body.classList
    cl.toggle('coarse', coarse)
    cl.toggle('keys', keys)
    cl.toggle('compact', compact)
    cl.toggle('touch-recent', touchRecent)
}
syncInputSignalClasses()
inputMode.on('signals', syncInputSignalClasses)

// Touch support is a work in progress (pinch-to-zoom and two-finger pan are
// wired up; tap-to-place and on-screen controls are still to come). The app
// used to hard-refuse to load on any mobile device; that block is now opt-in
// via `?desktopOnly` so touch work can be exercised on real devices.
const forceDesktopOnly = window.location.search.includes('desktopOnly')
if (isMobile.any && forceDesktopOnly) {
    createToast({
        text:
            'Application is not compatible with mobile devices.<br>' +
            'If you think this is a mistake, feel free to report this bug on github.',
        type: 'error',
        timeout: Infinity,
    })
    loadingScreen.el.classList.add('error')
    throw new Error('MOBILE_DEVICE_NOT_SUPPORTED')
}
// Touch support is experimental; let mobile users know — but only once. Now that
// the blueprint persists across reloads, reloading is a normal part of the
// workflow, and re-showing this on every load is just noise.
if (isMobile.any && localStorage.getItem('fbe:touchToastSeen') !== 'true') {
    localStorage.setItem('fbe:touchToastSeen', 'true')
    createToast({
        text:
            'Touch support is experimental.<br>' +
            'Pinch to zoom and drag with two fingers to pan.',
        type: 'info',
        timeout: 8000,
    })
}

if (typeof WebAssembly !== 'object' && typeof WebAssembly.instantiate !== 'function') {
    createToast({
        text:
            "Current browser doesn't support WebAssembly.<br>" +
            'If you think this is a mistake, feel free to report this bug on github.',
        type: 'error',
        timeout: Infinity,
    })
    loadingScreen.el.classList.add('error')
    throw new Error('WEB_ASSEMBLY_NOT_SUPPORTED')
}

// Parse with URLSearchParams so a `?source=<value>` is read whole and decoded —
// the old hand-split on '=' truncated raw blueprint strings at their base64
// padding ('='), and didn't percent-decode. `null` (param absent) is normalized
// to `undefined` so the loader treats it as "no source given".
const params = new URLSearchParams(window.location.search)
const bpSource: string | undefined = params.get('source') ?? undefined
const bpIndex = params.get('index') ? Number(params.get('index')) : 0

let changeBookForIndexSelector: (bpOrBook: Book | Blueprint) => void

editor
    .init(CANVAS, createToast)
    .then(async () => {
        if (localStorage.getItem('quickbarItemNames')) {
            const quickbarItems = JSON.parse(localStorage.getItem('quickbarItemNames'))
            editor.quickbarItems = quickbarItems
        }

        registerActions()
        initActionToolbar(editor, {
            copyBlueprint: copyBlueprintToClipboard,
            clear: confirmClearBlueprint,
        })
        initViewportRegions(editor)
        // Upgrade marked chrome (the rail's wire buttons) to real game icons
        // from the pack's browser/ sheet — progressive, glyphs stay on failure.
        void loadPackIcons()
        // Mobile presentations of the status readouts (#89 Phase 2).
        initEntityInfoSheet()
        initRatesDrawer()
        // Layering contract: DOM always composites above the canvas, so a Pixi
        // dialog (entity editor, inventory) can never paint over the readouts —
        // instead they yield while any dialog is open. The editor mirrors its
        // open-dialog count over `fbe:dialogs`; the body class hides the sheet
        // and drawer via CSS, and their state restores itself on close (the
        // selection and the rates toggle live in the editor, untouched).
        window.addEventListener('fbe:dialogs', e => {
            document.body.classList.toggle('fbe-dialog-open', (e as CustomEvent<number>).detail > 0)
        })

        // Opt-in e2e probe for on-canvas state that the DOM can't expose.
        if (new URLSearchParams(window.location.search).has('test')) {
            installTestHook()
        }

        const changeBookIndex = async (index: number): Promise<void> => {
            bp = book.selectBlueprint(index)
            await editor.loadBlueprint(bp)
        }
        changeBookForIndexSelector = initSettingsPane(
            editor,
            changeBookIndex,
            createToast
        ).changeBook

        // The pack manifest comes first: it resolves the active pack's canonical
        // id, which is what the library is scoped by. Best effort — an
        // unreachable manifest leaves the active pack as its own canonical id,
        // exactly the pre-variant behaviour.
        const manifest = await loadPackManifest()
        if (manifest.length > 0) packManifest = manifest
        // Bring up the library before deciding what to load: it resolves the
        // active project for this pack and owns the autosave from here on.
        library = new LibraryController(
            syncedStore,
            getCanonicalDataPack(),
            undefined,
            undefined,
            writerId
        )
        await library.init()
        // One-time migration: fold the legacy single-slot autosave into this
        // pack's scratchpad (only if the scratchpad is still empty) so existing
        // users don't lose their last blueprint when the library takes over.
        const legacy = loadSavedBlueprint()
        if (legacy) {
            await library.seedScratchpad(legacy)
            clearSavedBlueprint()
        }
        libraryPanel = initLibraryPanel(library, libraryCallbacks)
        initLibraryChrome()

        // Cloud sync (Phase 6): only wire firebase when it's configured. On an auth
        // change, attach a per-uid remote and reconcile (sign-in / returning with a
        // live session), or detach to fall back to local-only (sign-out). Signed
        // out or unconfigured ⇒ exactly the local-only behaviour above.
        if (firebaseConfigured()) {
            onAuth(user => {
                currentUser = user
                if (user) {
                    syncService.attach(user.uid, createRemote(user.uid))
                } else {
                    syncService.detach()
                }
                libraryPanel?.syncChanged()
            })
        }

        loadInitialBlueprint()
            .then(() => createWelcomeMessage())
            .catch(error => createBPImportError(error))
    })
    .catch(error => {
        createErrorMessage('Something went wrong.', error, Infinity)
        loadingScreen.el.classList.add('error')
        throw new Error('UNRECOVERABLE_ERROR')
    })

window.addEventListener('visibilitychange', () => {
    localStorage.setItem('quickbarItemNames', JSON.stringify(editor.quickbarItems))
})

// Encode the current canvas, normalizing an empty blueprint to '' so it matches
// the library's "empty leaf" convention (an empty Blueprint still encodes to a
// non-empty string otherwise).
function currentEncodedString(): Promise<string> {
    if (book === undefined && bp.isEmpty()) return Promise.resolve('')
    return encode(book || bp)
}

// Autosave the working blueprint into the active library leaf so a reload (or a
// backgrounded mobile tab being discarded) doesn't wipe it. `visibilitychange`
// (fired on tab hide / close / navigation / mobile app-switch) is the
// recommended checkpoint moment. This updates the leaf's live content only — it
// does NOT create a version snapshot; that's what an explicit Save is for.
window.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    // Push any pending remote write immediately (the tab may be discarded next),
    // over and above the autosave below. No-op when there's no remote / nothing
    // pending. Also covers the book-view / not-loaded-yet early returns.
    const flushRemote = (): void => {
        void syncedStore.flush()
    }
    // A folder book-view isn't the working context — don't autosave it back into a
    // leaf (that would clobber the previously-active leaf with the whole book) —
    // and there's nothing to autosave before the first blueprint has loaded.
    if (bp === undefined || viewingBook) {
        flushRemote()
        return
    }

    currentEncodedString()
        .then(enc => {
            refreshModifiedIndicator(enc)
            return library.autosave(enc)
        })
        .then(flushRemote)
        .catch(error => console.error('Failed to autosave blueprint', error))
})

// Returning to the tab (or a mobile app-switch back) is when the remote may have
// moved — reconcile to pull down another device's edits. Cheap when nothing
// changed (a single remote read that resolves to noop).
window.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (syncService.hasRemote()) void syncService.reconcile()
})

// A pull adopted a remote doc into the local store. Re-init the controller (it
// re-loads from the store and re-resolves the active leaf), refresh the panel,
// and — carefully — reflect the change on the canvas without clobbering unsaved
// local edits.
async function handlePulled(): Promise<void> {
    // Capture the pre-pull active leaf before re-init swaps in the remote state.
    const prevEncoded = library.getActive().encoded
    await library.init()
    libraryPanel?.refresh()
    updateActiveIndicator()

    // Nothing on the canvas yet (pull raced ahead of the first load) — the initial
    // load will pick up the freshly-adopted active leaf on its own.
    if (bp === undefined) return
    // A book-view isn't a working leaf — never swap the canvas out from under it.
    if (viewingBook) return

    const active = library.getActive()
    // The active leaf's content is unchanged by this pull — leave the canvas be.
    if (active.encoded === prevEncoded) {
        return
    }

    // The active leaf changed remotely. If the canvas holds local edits that
    // differ from the pre-pull leaf, prefer a toast over a silent swap so we never
    // clobber unsaved work; the user can reopen to load the newest version.
    const canvasEnc = await currentEncodedString().catch(() => prevEncoded)
    if (canvasEnc && canvasEnc !== prevEncoded) {
        createToast({
            text: 'Library synced from another device. Reopen this project to load the newest version.',
            type: 'info',
            timeout: 10000,
        })
        return
    }

    // Safe to adopt: reopen the active entry onto the canvas.
    const bpOrBook = active.encoded
        ? await getBlueprintOrBookFromSource(active.encoded).catch(() => undefined)
        : undefined
    await loadBp(bpOrBook || new Blueprint(), `Synced "${active.name}"`)
    refreshModifiedIndicator(active.encoded)
}

// A conflict was raised. Hand the two docs (and the conflict `kind`, which words
// the prompt) to the panel's chooser and act on the user's answer: keep-mine
// force-pushes, take-theirs pulls, sign-out aborts.
async function handleConflict(info: ConflictInfo): Promise<void> {
    if (!libraryPanel) return
    const choice = await libraryPanel.promptConflict(
        info.kind,
        { updatedAt: info.local.updatedAt },
        { updatedAt: info.remote.updatedAt }
    )
    if (choice === 'sign-out') {
        // The abort: bail all the way back to the pre-sign-in state so the user can
        // back up before choosing. INVARIANT: at the conflict path we've neither
        // pulled nor pushed, so local IndexedDB and the cloud doc are both exactly
        // as they were. signOutUser() → onAuth(null) → syncService.detach(), which
        // clears the pending conflict and returns status to signed-out — leaving
        // both stores untouched. Nothing to undo, nothing lost.
        signOutUser()
        return
    }
    if (choice) await syncService.resolveConflict(choice)
}

// Decide what to show on first load: a URL-named blueprint (imported as a new
// leaf), or the active project (scratchpad by default), or a blank canvas.
async function loadInitialBlueprint(): Promise<void> {
    if (bpSource !== undefined) {
        // The URL `?source` argument is an explicit request, so it wins.
        const bpOrBook = await getBlueprintOrBookFromSource(bpSource).catch(error => {
            createBPImportError(error)
            return undefined
        })
        await loadBp(bpOrBook || new Blueprint())
        if (bpOrBook) {
            // A URL-supplied blueprint becomes an implied entry under "Imported"
            // (it joins recents and doesn't clobber the scratchpad). Re-encode so
            // the stored string is normalized.
            const enc = await encode(book || bp).catch(() => null)
            if (enc) {
                await library.importEntry(bp.name || 'Imported blueprint', enc)
                updateActiveIndicator()
            }
        }
        return
    }

    // No URL → reopen the active project for this pack (the scratchpad by default).
    const active = library.getActive()
    if (active.encoded) {
        const bpOrBook = await getBlueprintOrBookFromSource(active.encoded).catch(error => {
            // A corrupt stored leaf shouldn't strand the user on the loading
            // screen forever — fall back to a blank canvas.
            console.error('Failed to open the active blueprint', error)
            return undefined
        })
        const message = library.isScratchpad(active.id)
            ? 'Restored your scratchpad'
            : `Opened "${active.name}"`
        await loadBp(bpOrBook || new Blueprint(), message)
        // The "modified" (uncommitted-since-last-version) state is persisted, not
        // transient — reflect it on the indicator straight from the stored content.
        refreshModifiedIndicator(active.encoded)
    } else {
        await loadBp(new Blueprint())
    }
    updateActiveIndicator()
}

async function loadBp(
    bpOrBook: Blueprint | Book,
    successMessage = 'Blueprint string loaded successfully'
): Promise<void> {
    if (bpOrBook instanceof Book) {
        book = bpOrBook
        bp = book.selectBlueprint(bpIndex ? bpIndex : undefined)
    } else {
        book = undefined
        bp = bpOrBook
    }

    try {
        await editor.loadBlueprint(bp)
        changeBookForIndexSelector(bpOrBook)
    } catch (error) {
        // Rendering can throw if the blueprint references prototype data the
        // active pack lacks — e.g. pasting a Space Age blueprint while on the
        // vanilla pack (unknown entities are stripped, but a sprite path may
        // still dereference absent data). Don't strand the user on the loading
        // screen forever: fall back to a blank canvas and surface the error.
        createErrorMessage(
            'This blueprint could not be rendered with the current data pack ' +
                '(it may require a different pack, e.g. Space Age).',
            error
        )
        book = undefined
        bp = new Blueprint()
        await editor.loadBlueprint(bp).catch(() => undefined)
        changeBookForIndexSelector(bp)
        loadingScreen.hide()
        return
    }

    loadingScreen.hide()

    const bpIsEmpty = bpOrBook instanceof Blueprint && bpOrBook.isEmpty()
    if (!bpIsEmpty) {
        createToast({ text: successMessage, type: 'success' })
    }
}

// Copy the current blueprint/book string to the clipboard. Shared by the
// `ctrl/cmd+C` document handler and the mobile action rail's "Copy BP" button
// (the rail can't use a keybind, so it gets this directly).
function copyBlueprintToClipboard(): void {
    if (bp.isEmpty()) {
        createToast({ text: 'Nothing to copy — the blueprint is empty.', type: 'info' })
        return
    }
    encode(book || bp)
        .then(s => navigator.clipboard.writeText(s))
        .then(() => createToast({ text: 'Blueprint string copied to clipboard', type: 'success' }))
        .catch(error => createErrorMessage('Blueprint string could not be generated.', error))
}

// Copy/cut a *held marquee selection* (#101 Slice 2): the selection's own
// blueprint string goes to the clipboard and the ghost is picked up at the
// source, so `Ctrl+X` → move the mouse → click reads as one move gesture. The
// clipboard (and its toasts) live here, the selection lives in the editor.
//
// `Ctrl+C` reaches us twice — once as the registry keybind below, once as the
// document `copy` event — so exactly one of them must act. The keybind claims
// the key *only* when a selection is held (returning true makes the registry
// `preventDefault` the keydown, which suppresses the `copy` event entirely);
// with nothing held it declines, the browser fires `copy`, and the handler
// below copies the whole blueprint exactly as it always has.
function copySelectionToClipboard(cut: boolean): boolean {
    const selection = editor.selectionBlueprint()
    if (!selection) return false
    // Serialize before the ghost is spawned — copy/cutMarquee consume the
    // selection (and cut removes the originals).
    const encoded = encode(selection)
    const acted = cut ? editor.cutMarquee() : editor.copyMarquee()
    if (!acted) return false
    encoded
        .then(str => navigator.clipboard.writeText(str))
        .then(() =>
            createToast({
                text: cut ? 'Selection cut to clipboard' : 'Selection copied to clipboard',
                type: 'success',
            })
        )
        .catch(error => createErrorMessage('Blueprint string could not be generated.', error))
    return true
}

document.addEventListener('copy', (e: ClipboardEvent) => {
    if (document.activeElement !== CANVAS) return
    e.preventDefault()
    if (bp.isEmpty()) return // ctrl/cmd+C on an empty blueprint stays silent
    copyBlueprintToClipboard()
})

// Reset to a blank blueprint. Routed through the library: it resets the active
// pack's scratchpad and makes it the working context. Swaps in a fresh Blueprint
// (with its own History), so it's NOT undoable.
function clearBlueprint(): void {
    library
        .newScratch()
        .then(() => loadBp(new Blueprint()))
        .then(() => {
            updateActiveIndicator()
            libraryPanel?.refresh()
        })
}

// --- library chrome (panel callbacks + the active-project indicator) ---------

// Update the top-centre indicator to the active project's name (or the book being
// viewed, in Phase 5b's book-view mode).
function updateActiveIndicator(): void {
    if (activeProjectEl) {
        activeProjectEl.textContent = viewingBook
            ? `📖 ${viewingBookLabel}`
            : library.getActiveName()
    }
}

// Toggle the indicator's "unsaved changes" dot from a known encoded snapshot of
// the canvas (cheap to do where we already have one, e.g. on autosave).
function refreshModifiedIndicator(encoded: string): void {
    activeProjectEl?.classList.toggle('modified', library.isModified(encoded))
}

// Things the library panel needs from here that touch the PixiJS canvas or the
// shared chrome (toasts/clipboard); everything else it does via the controller.
const libraryCallbacks: LibraryPanelCallbacks = {
    loadEncoded: async (encoded: string) => {
        // Opening a leaf (or starting a new project) leaves book-view.
        viewingBook = false
        if (!encoded) {
            await loadBp(new Blueprint())
            return
        }
        const bpOrBook = await getBlueprintOrBookFromSource(encoded)
        await loadBp(bpOrBook)
    },
    // Load a folder's book onto the canvas to navigate (Phase 5b) without making
    // it the working context — autosave stays suspended until a leaf is opened.
    openFolderBook: async (bookString: string, label: string) => {
        const bpOrBook = await getBlueprintOrBookFromSource(bookString)
        await loadBp(bpOrBook, `Opened "${label}" as a book`)
        viewingBook = true
        viewingBookLabel = label
        activeProjectEl?.classList.remove('modified')
        updateActiveIndicator()
    },
    isViewingBook: () => viewingBook,
    currentEncoded: currentEncodedString,
    toast: (text, type = 'info') => createToast({ text, type }),
    promptName: (message, defaultName) => window.prompt(message, defaultName),
    copyText: (text: string) => {
        navigator.clipboard
            .writeText(text)
            .then(() =>
                createToast({ text: 'Blueprint string copied to clipboard', type: 'success' })
            )
            .catch(error => createErrorMessage('Blueprint string could not be copied.', error))
    },
    onActiveChange: () => {
        updateActiveIndicator()
        activeProjectEl?.classList.remove('modified')
    },
    // Packs the panel can browse: the manifest (so you can copy into a pack you've
    // never used) unioned with whatever the library already holds.
    packList: () => {
        // Canonical ids only: the library's top tier is keyed by them, so a
        // graphics variant must not show up as a separate browsable pack (its
        // blueprints live in the base pack's subtree).
        const packs = canonicalPacks(packManifest)
        const labels = new Map(packs.map(p => [p.id, p.label]))
        const ids = new Set<string>([...packs.map(p => p.id), ...library.getPacks()])
        return [...ids].map(id => ({ id, label: labels.get(id) ?? id }))
    },
    // Switching the rendered pack swaps the whole data set + atlas, so it goes
    // through setDataPack (which persists the choice and reloads). The panel has
    // already persisted the target pack's activeId, so the reload reopens it.
    // The panel deals in canonical ids, so this loads the base (full-graphics)
    // pack; picking a graphics variant of it is the settings pane's job.
    requestPackSwitch: (pack: string) => setDataPack(pack),
    // Cloud sync surface (Phase 6). `isConfigured` gates all sync chrome, so an
    // unconfigured build renders the panel exactly as before.
    sync: {
        isConfigured: () => firebaseConfigured(),
        getUser: () => currentUser,
        getStatus: () => syncStatus,
        signIn: () => signIn(),
        signOut: () => signOutUser(),
        // The status glyph's manual "sync now" trigger. reconcile handles both
        // directions — it pulls a newer remote and pushes if local advanced — so
        // one call covers the whole round-trip. A no-op when there's no remote.
        syncNow: () => {
            if (syncService.hasRemote()) void syncService.reconcile()
        },
        // The ⚠ glyph's re-entry point: re-prompt against the live pending
        // conflict (kept fresh by raiseConflict's replace-latest dedupe). A no-op
        // when there's none; the panel guards against stacking a second modal.
        reopenConflict: () => {
            const info = syncService.getConflict()
            if (info) void handleConflict(info)
        },
    },
}

// Wire the on-screen entry points to the panel once it exists.
function initLibraryChrome(): void {
    activeProjectEl = document.getElementById('active-project')
    document
        .getElementById('library-button')
        ?.addEventListener('click', () => libraryPanel.toggle())
    activeProjectEl?.addEventListener('click', () => libraryPanel.toggle())
    updateActiveIndicator()
}

// The mobile action rail's "New" button. Because clearing can't be undone, gate
// the one-tap button behind a confirm toast (tap "Clear" to go through; tapping
// the toast body or letting it sit cancels). A no-op on an already-empty
// blueprint just resets silently — there's nothing to lose. The desktop
// `shift+N` keybind stays immediate: it's a deliberate two-key combo.
function confirmClearBlueprint(): void {
    if (book === undefined && bp.isEmpty()) {
        clearBlueprint()
        return
    }
    createToast({
        text: 'Clear the blueprint? This cannot be undone.',
        type: 'warning',
        timeout: Infinity,
        action: { text: 'Clear', callback: clearBlueprint },
    })
}

document.addEventListener('paste', (e: ClipboardEvent) => {
    if (document.activeElement !== CANVAS) return
    e.preventDefault()

    loadingScreen.show()

    navigator.clipboard
        .readText()
        .then(getBlueprintOrBookFromSource)
        .then(loadBp)
        .catch(error => {
            loadingScreen.hide()
            createBPImportError(error)
        })
})

function registerActions(): void {
    EDITOR.registerAction('clear', {
        trigger: { code: 'KeyN' },
        modifiers: { shift: true },
        callbacks: {
            onPress: () => {
                clearBlueprint()
                return true
            },
        },
    })

    EDITOR.registerAction('copySelection', {
        trigger: { code: 'KeyC' },
        modifiers: { control: true },
        callbacks: {
            onPress: () => copySelectionToClipboard(false),
        },
    })

    EDITOR.registerAction('cutSelection', {
        trigger: { code: 'KeyX' },
        modifiers: { control: true },
        callbacks: {
            onPress: () => copySelectionToClipboard(true),
        },
    })

    EDITOR.registerAction('appendBlueprint', {
        trigger: { code: 'KeyV' },
        modifiers: { shift: true, control: true },
        callbacks: {
            onPress: () => {
                navigator.clipboard
                    .readText()
                    .then(getBlueprintOrBookFromSource)
                    .then(bp =>
                        editor.appendBlueprint(bp instanceof Book ? bp.selectBlueprint(0) : bp)
                    )
                    .catch(error => {
                        createBPImportError(error)
                    })
                return true
            },
        },
    })

    EDITOR.registerAction('generateOilOutpost', {
        trigger: { code: 'KeyG' },
        callbacks: {
            onPress: () => {
                const errorMessage = bp.generatePipes()
                if (errorMessage) {
                    createToast({ text: errorMessage, type: 'warning' })
                }
                return true
            },
        },
    })

    EDITOR.registerAction('takePicture', {
        trigger: { code: 'KeyS' },
        modifiers: { control: true },
        callbacks: {
            onPress: () => {
                if (bp.isEmpty()) return

                editor.getPicture().then(blob => {
                    FileSaver.saveAs(blob, `${bp.name}.png`)
                    createToast({ text: 'Blueprint image successfully generated', type: 'success' })
                })
                return true
            },
        },
    })

    const infoPanel = document.getElementById('info-panel')
    const toggleInfoPanel = (): void => {
        infoPanel.classList.toggle('active')
    }
    const closeInfoPanel = (): void => infoPanel.classList.remove('active')

    // Touch devices have no keyboard, so the corner hint doubles as the
    // open/close button and the panel gets an on-screen close button.
    document.getElementById('corner-panel').addEventListener('click', toggleInfoPanel)
    document.getElementById('info-panel-close').addEventListener('click', closeInfoPanel)

    window.addEventListener('keydown', e => {
        if (e.target instanceof HTMLInputElement) return
        if (e.target instanceof HTMLTextAreaElement) return
        if (e.key === 'i') {
            toggleInfoPanel()
        } else if (e.key === 'Escape') {
            closeInfoPanel()
        }
    })

    EDITOR.importKeybinds(JSON.parse(localStorage.getItem('keybinds2')))

    window.addEventListener('visibilitychange', () => {
        const keybinds = EDITOR.exportKeybinds()
        if (Object.keys(keybinds).length) {
            localStorage.setItem('keybinds2', JSON.stringify(keybinds))
        } else {
            localStorage.removeItem('keybinds2')
        }
    })
}

function createWelcomeMessage(): void {
    const notFirstRun = localStorage.getItem('firstRun') === 'false'
    if (notFirstRun) return
    localStorage.setItem('firstRun', 'false')

    // Wait a bit just to capture the users attention
    // This way they will see the toast animation
    setTimeout(() => {
        createToast({
            text:
                '> To access the inventory and start building press E<br>' +
                '> To import/export a blueprint string use ctrl/cmd + C/V<br>' +
                '> For more info press I<br>' +
                '> Also check out the settings area',
            timeout: 30000,
        })
    }, 1000)
}
function createErrorMessage(text: string, error: unknown, timeout = 10000): void {
    console.error(error)
    createToast({
        text:
            `${text}<br>` +
            'Please check out the console (F12) for an error message and ' +
            'report this bug on github.',
        type: 'error',
        timeout,
    })
}
function createBPImportError(
    error:
        | Error
        | TrainBlueprintError
        | ModdedBlueprintError
        | CorruptedBlueprintStringError
        | BookWithNoBlueprintsError
): void {
    if (error instanceof TrainBlueprintError) {
        createErrorMessage(
            'Blueprint with train entities not supported yet. If you think this is a mistake:',
            error.errors
        )
        return
    }

    if (error instanceof ModdedBlueprintError) {
        createErrorMessage(
            'Blueprint with modded items not supported yet. If you think this is a mistake:',
            error.errors
        )
        return
    }

    if (error instanceof CorruptedBlueprintStringError) {
        createErrorMessage(
            'Blueprint string might be corrupted. If you think this is a mistake:',
            error.error
        )
        return
    }

    if (error instanceof BookWithNoBlueprintsError) {
        createErrorMessage(`${error.error} If you think this is a mistake:`, error.error)
        return
    }

    createErrorMessage('Blueprint string could not be loaded.', error)
}
