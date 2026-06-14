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
} from '@fbe/editor'
import { initToasts } from './toasts'
import { initSettingsPane } from './settingsPane'
import { initActionToolbar } from './actionToolbar'
import { loadSavedBlueprint, clearSavedBlueprint } from './blueprintStorage'
import { LibraryController } from './library/controller'
import { createLibraryStore } from './library/store'
import { initLibraryPanel, LibraryPanel, LibraryPanelCallbacks } from './library/libraryPanel'

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
const library = new LibraryController(createLibraryStore(), DATA_PACK)
let libraryPanel: LibraryPanel
let activeProjectEl: HTMLElement | null

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

        // Opt-in e2e probe for on-canvas state that the DOM can't expose.
        if (new URLSearchParams(window.location.search).has('test')) {
            installTestHook()
        }

        const changeBookIndex = async (index: number): Promise<void> => {
            bp = book.selectBlueprint(index)
            await editor.loadBlueprint(bp)
        }
        changeBookForIndexSelector = initSettingsPane(editor, changeBookIndex).changeBook

        // Bring up the library before deciding what to load: it resolves the
        // active project for this pack and owns the autosave from here on.
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
    if (bp === undefined) return

    currentEncodedString()
        .then(enc => {
            refreshModifiedIndicator(enc)
            return library.autosave(enc)
        })
        .catch(error => console.error('Failed to autosave blueprint', error))
})

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

// Update the top-centre indicator to the active project's name.
function updateActiveIndicator(): void {
    if (activeProjectEl) activeProjectEl.textContent = library.getActiveName()
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
        if (!encoded) {
            await loadBp(new Blueprint())
            return
        }
        const bpOrBook = await getBlueprintOrBookFromSource(encoded)
        await loadBp(bpOrBook)
    },
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
    // Confirm via a sticky toast: the action button resolves `true`; dismissing
    // the toast simply leaves the action un-taken (treated as "cancel").
    confirm: (text, confirmLabel) =>
        new Promise<boolean>(resolve => {
            createToast({
                text,
                type: 'warning',
                timeout: Infinity,
                action: { text: confirmLabel, callback: () => resolve(true) },
            })
        }),
    onActiveChange: () => {
        updateActiveIndicator()
        activeProjectEl?.classList.remove('modified')
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
