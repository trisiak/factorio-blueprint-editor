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
} from '@fbe/editor'
import { initToasts } from './toasts'
import { initFeedbackButton } from './feedbackButton'
import { initSettingsPane } from './settingsPane'
import { initActionToolbar } from './actionToolbar'
import {
    saveBlueprint,
    loadSavedBlueprint,
    clearSavedBlueprint,
    planBlueprintLoad,
} from './blueprintStorage'

document.addEventListener('contextmenu', e => e.preventDefault())

const editor = new Editor()

let t0 = performance.now()

const CANVAS = document.getElementById('editor') as HTMLCanvasElement

let bp: Blueprint
let book: Book

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

initFeedbackButton()
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
            'If you think this is a mistake, feel free to report this bug on github or using the feedback button.',
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
            'If you think this is a mistake, feel free to report this bug on github or using the feedback button.',
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
    .then(() => {
        if (localStorage.getItem('quickbarItemNames')) {
            const quickbarItems = JSON.parse(localStorage.getItem('quickbarItemNames'))
            editor.quickbarItems = quickbarItems
        }

        registerActions()
        initActionToolbar(editor)

        // Opt-in e2e probe for on-canvas state that the DOM can't expose.
        if (new URLSearchParams(window.location.search).has('test')) {
            installTestHook()
        }

        const changeBookIndex = async (index: number): Promise<void> => {
            bp = book.selectBlueprint(index)
            await editor.loadBlueprint(bp)
        }
        changeBookForIndexSelector = initSettingsPane(editor, changeBookIndex).changeBook

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

// Autosave the working blueprint so a reload (or a backgrounded mobile tab being
// discarded) doesn't wipe it. Persisting on `visibilitychange` is the
// recommended moment to checkpoint state — it fires when a tab is hidden, which
// covers tab close, navigation and mobile app-switch. An empty blueprint clears
// the save so a cleared editor stays cleared across reloads.
window.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (bp === undefined) return

    const isEmpty = book === undefined && bp.isEmpty()
    if (isEmpty) {
        clearSavedBlueprint()
        return
    }

    encode(book || bp)
        .then(saveBlueprint)
        .catch(error => console.error('Failed to autosave blueprint', error))
})

// Reads the local autosave (if any) once, before init, so the loader can weigh
// it against the URL `?source` argument.
const savedBlueprint = loadSavedBlueprint()

// Decide what to show on first load: the URL-named blueprint, the local
// autosave, or a blank canvas — and, in the mixed case (URL + autosave), offer
// to bring the autosave back.
async function loadInitialBlueprint(): Promise<void> {
    const plan = planBlueprintLoad(bpSource, savedBlueprint)

    if (plan.kind === 'empty') {
        await loadBp(new Blueprint())
        return
    }

    if (plan.kind === 'restore') {
        const bpOrBook = await getBlueprintOrBookFromSource(plan.source).catch(error => {
            // A corrupt autosave shouldn't strand the user on the loading screen
            // forever — drop it and fall back to a blank blueprint.
            console.error('Failed to restore saved blueprint', error)
            clearSavedBlueprint()
            return undefined
        })
        await loadBp(bpOrBook || new Blueprint(), 'Restored your previous blueprint')
        return
    }

    // plan.kind === 'url' — the URL argument is an explicit request, so it wins.
    const bpOrBook = await getBlueprintOrBookFromSource(plan.source).catch(error => {
        createBPImportError(error)
        return undefined
    })
    await loadBp(bpOrBook || new Blueprint())

    // Mixed state: there's also a local autosave. Only offer to restore it if it
    // actually differs from what the URL just loaded, so re-opening the same
    // link (autosave == URL blueprint) doesn't nag.
    if (plan.savedString && bpOrBook) {
        const urlString = await encode(book || bp).catch(() => null)
        if (urlString !== plan.savedString) {
            createToast({
                text: 'You have a locally saved blueprint that differs from the one in this link.',
                type: 'info',
                timeout: Infinity,
                action: {
                    text: 'Restore my saved blueprint',
                    callback: () => {
                        loadingScreen.show()
                        getBlueprintOrBookFromSource(plan.savedString)
                            .then(saved => loadBp(saved, 'Restored your saved blueprint'))
                            .catch(error => {
                                loadingScreen.hide()
                                createBPImportError(error)
                            })
                    },
                },
            })
        }
    }
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

document.addEventListener('copy', (e: ClipboardEvent) => {
    if (document.activeElement !== CANVAS) return
    e.preventDefault()

    if (bp.isEmpty()) return

    const onSuccess = (): void => {
        createToast({ text: 'Blueprint string copied to clipboard', type: 'success' })
    }

    const onError = (error: Error): void => {
        createErrorMessage('Blueprint string could not be generated.', error)
    }

    encode(book || bp)
        .then(s => navigator.clipboard.writeText(s))
        .then(onSuccess)
        .catch(onError)
})

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
                clearSavedBlueprint()
                loadBp(new Blueprint())
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
            'report this bug on github or using the feedback button.',
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
