import { GUI } from 'dat.gui'
import EDITOR, {
    Blueprint,
    Book,
    GridPattern,
    Editor,
    FD,
    inputMode,
    DATA_ROOT,
    DATA_PACK,
    setDataPack,
} from '@fbe/editor'
import type { InputMode } from '@fbe/editor'

GUI.TEXT_CLOSED = 'Close Settings'
GUI.TEXT_OPEN = 'Open Settings'

const COLOR_DARK = 0x303030
const COLOR_LIGHT = 0xc9c9c9
const isDarkColor = (color: number): boolean => color === COLOR_DARK

export function initSettingsPane(
    editor: Editor,
    changeBookIndex: (index: number) => void
): {
    changeBook: (bpOrBook: Book | Blueprint) => void
} {
    // On touch devices the pane is more intrusive (bigger touch targets, full
    // width) so default it closed unless the user has made an explicit choice.
    const persistedClosed = localStorage.getItem('dat.gui.closed')
    const startClosed =
        persistedClosed === null ? inputMode.mode === 'mobile' : persistedClosed === 'true'

    const gui = new GUI({
        autoPlace: false,
        hideable: false,
        closeOnTop: true,
        closed: startClosed,
        width: 320,
    })

    gui.domElement.style.overflowX = 'hidden'
    gui.domElement.style.overflowY = 'auto'

    // Anchor the pane just under the top-left button stack (it's toggled by the
    // Settings button there) instead of dat.gui's default bottom-left, where its
    // open/close bar overlapped the quickbar.
    const buttonsEl = document.getElementById('buttons')
    const GAP = 4
    const positionPane = (): void => {
        const top = (buttonsEl ? Math.round(buttonsEl.getBoundingClientRect().bottom) : 80) + GAP
        gui.domElement.style.top = `${top}px`
        gui.domElement.style.maxHeight = `${window.innerHeight - top}px`
    }
    positionPane()
    window.addEventListener('resize', positionPane)
    // The stack's height changes (compact buttons on mobile, async icon loads),
    // and those reflows don't fire `resize`. A ResizeObserver re-anchors the pane
    // whenever the stack actually changes size, free of init-order races.
    if (buttonsEl && 'ResizeObserver' in window) {
        new ResizeObserver(positionPane).observe(buttonsEl)
    }

    window.addEventListener('visibilitychange', () =>
        localStorage.setItem('dat.gui.closed', String(gui.closed))
    )

    document.body.appendChild(gui.domElement)

    // dat.gui's own open/close bar is hidden (CSS); drive the pane from the
    // top-left Settings button instead.
    document.getElementById('settings-button')?.addEventListener('click', () => {
        if (gui.closed) gui.open()
        else gui.close()
    })

    const guiBPIndex = gui
        .add({ bpIndex: 0 }, 'bpIndex', 0, 0, 1)
        .name('BP Book Index')
        .onFinishChange(changeBookIndex)

    const changeBook = (bpOrBook: Book | Blueprint): void => {
        if (bpOrBook instanceof Book) {
            guiBPIndex.max(bpOrBook.lastBookIndex).setValue(bpOrBook.activeIndex)
            guiBPIndex.domElement.style.visibility = 'visible'
        } else {
            guiBPIndex.domElement.style.visibility = 'hidden'
        }
    }

    if (localStorage.getItem('moveSpeed')) {
        const moveSpeed = Number(localStorage.getItem('moveSpeed'))
        editor.moveSpeed = moveSpeed
    }
    gui.add({ moveSpeed: editor.moveSpeed }, 'moveSpeed', 5, 20)
        .name('Move Speed')
        .onChange((moveSpeed: number) => {
            localStorage.setItem('moveSpeed', moveSpeed.toString())
            editor.moveSpeed = moveSpeed
        })

    if (localStorage.getItem('pattern')) {
        const pattern = localStorage.getItem('pattern') as GridPattern
        editor.gridPattern = pattern
    }
    gui.add({ pattern: editor.gridPattern }, 'pattern', ['checker', 'grid'])
        .name('Grid Pattern')
        .onChange((pattern: GridPattern) => {
            localStorage.setItem('pattern', pattern)
            editor.gridPattern = pattern
        })

    if (localStorage.getItem('darkTheme')) {
        const darkTheme = localStorage.getItem('darkTheme') === 'true'
        editor.gridColor = darkTheme ? COLOR_DARK : COLOR_LIGHT
    }
    gui.add({ darkTheme: isDarkColor(editor.gridColor) }, 'darkTheme')
        .name('Dark Mode')
        .onChange((darkTheme: boolean) => {
            localStorage.setItem('darkTheme', darkTheme.toString())
            editor.gridColor = darkTheme ? COLOR_DARK : COLOR_LIGHT
        })

    // Input scheme: desktop (mouse/keyboard) vs mobile (touch). `inputMode`
    // owns detection + persistence; `.listen()` keeps the dropdown in sync if
    // the mode is changed elsewhere.
    const inputModeProxy = {
        get mode(): InputMode {
            return inputMode.mode
        },
        set mode(m: InputMode) {
            inputMode.mode = m
        },
    }
    gui.add(inputModeProxy, 'mode', ['desktop', 'mobile']).name('Input Mode').listen()

    // Data pack (modpack support): which game-data dump the editor renders —
    // vanilla 2.0, 2.0 + Space Age, etc. Options come from the `packs.json`
    // manifest next to the data dirs; the controller is created synchronously
    // here (so it sits right under Input Mode) and populated once the manifest
    // loads. Switching a pack reloads the app to re-fetch its atlas + data.json.
    const dataPackFolder = gui.addFolder('Data Pack')
    const dataPackProxy = { pack: DATA_PACK }
    fetch(`${DATA_ROOT}/packs.json`)
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((packs: { id: string; label?: string }[]) => {
            const options: Record<string, string> = {}
            for (const p of packs) options[p.label ?? p.id] = p.id
            dataPackFolder
                .add(dataPackProxy, 'pack', options)
                .name('Active pack')
                .onChange((id: string) => {
                    if (id !== DATA_PACK) setDataPack(id)
                })
            dataPackFolder.open()
        })
        .catch(() => {
            // No manifest (e.g. an old single-dump deploy) — leave the folder
            // empty rather than surfacing an error; the default pack still loads.
        })

    if (localStorage.getItem('debug')) {
        const debug = Boolean(localStorage.getItem('debug'))
        editor.debug = debug
    }
    gui.add({ debug: editor.debug }, 'debug')
        .name('Debug')
        .onChange((debug: boolean) => {
            if (debug) {
                localStorage.setItem('debug', 'true')
            } else {
                localStorage.removeItem('debug')
            }
            editor.debug = debug
        })

    if (localStorage.getItem('limitWireReach')) {
        const limitWireReach = localStorage.getItem('limitWireReach') === 'true'
        editor.limitWireReach = limitWireReach
    }
    gui.add({ limitWireReach: editor.limitWireReach }, 'limitWireReach')
        .name('Limit Wires Length')
        .onChange((limitWireReach: boolean) => {
            localStorage.setItem('limitWireReach', limitWireReach.toString())
            editor.limitWireReach = limitWireReach
        })

    // Idle-state entity animations (#29). Off by default; mirrors the Animate
    // button on the action rail. An accessor proxy over editor.animationsEnabled
    // means .listen() reflects rail toggles back into the checkbox (and vice
    // versa) — both sides read/write the single editor setting.
    const animationsProxy = {
        get animations(): boolean {
            return editor.animationsEnabled
        },
        set animations(on: boolean) {
            editor.animationsEnabled = on
        },
    }
    gui.add(animationsProxy, 'animations').name('Animations').listen()

    if (localStorage.getItem('oilOutpostSettings')) {
        const settings = JSON.parse(localStorage.getItem('oilOutpostSettings'))
        editor.oilOutpostSettings = settings
    }
    window.addEventListener('visibilitychange', () =>
        localStorage.setItem('oilOutpostSettings', JSON.stringify(editor.oilOutpostSettings))
    )

    const oilOutpostSettings = new Proxy(editor.oilOutpostSettings, {
        set: (settings, key, value) => {
            settings[key as string] = value
            editor.oilOutpostSettings = settings
            return true
        },
    })

    function getModulesObjFor(entityName: string): Record<string, string> {
        return FD.getModulesFor(entityName)
            .sort((a, b) => a.order.localeCompare(b.order))
            .reduce<Record<string, string>>(
                (obj, item) => {
                    obj[item.localised_name as string] = item.name
                    return obj
                },
                { None: 'none' }
            )
    }

    const oilOutpostFolder = gui.addFolder('Oil Outpost Generator Settings')
    oilOutpostFolder.add(oilOutpostSettings, 'DEBUG').name('Debug')
    oilOutpostFolder
        .add(oilOutpostSettings, 'PUMPJACK_MODULE', getModulesObjFor('pumpjack'))
        .name('Pumpjack Modules')
    oilOutpostFolder
        .add(oilOutpostSettings, 'MIN_GAP_BETWEEN_UNDERGROUNDS', 1, 9, 1)
        .name('Min Gap > < UPipes')
    oilOutpostFolder.add(oilOutpostSettings, 'BEACONS').name('Beacons')
    oilOutpostFolder
        .add(oilOutpostSettings, 'MIN_AFFECTED_ENTITIES', 1, 12, 1)
        .name('Min Affect. Pumpjacks')
    oilOutpostFolder
        .add(oilOutpostSettings, 'BEACON_MODULE', getModulesObjFor('beacon'))
        .name('Beacon Modules')

    // Keybinds folder
    const keybindsFolder = gui.addFolder('Keybinds')

    EDITOR.forEachAction(action => {
        const name = action.prettyName
        if (name.includes('Quickbar')) return
        keybindsFolder.add(action, 'keyCombo').name(name).listen()
    })

    const quickbarFolder = keybindsFolder.addFolder('Quickbar')

    EDITOR.forEachAction(action => {
        const name = action.prettyName
        if (!name.includes('Quickbar')) return
        quickbarFolder.add(action, 'keyCombo').name(name).listen()
    })

    keybindsFolder
        .add({ resetDefaults: () => EDITOR.resetKeybinds() }, 'resetDefaults')
        .name('Reset Defaults')

    // Mobile-friendliness: drive a `body.mobile` class off the input mode (CSS in
    // index.styl widens the pane and enlarges touch targets), and hide the
    // Keybinds folder — it edits keyboard combos, which are meaningless without a
    // keyboard and otherwise dominate the pane's height.
    const syncMobileLayout = (mode: InputMode): void => {
        const mobile = mode === 'mobile'
        document.body.classList.toggle('mobile', mobile)
        keybindsFolder.domElement.parentElement.style.display = mobile ? 'none' : ''
        // (the ResizeObserver on #buttons re-anchors the pane when its height changes)
    }
    syncMobileLayout(inputMode.mode)
    inputMode.on('change', syncMobileLayout)

    return { changeBook }
}
