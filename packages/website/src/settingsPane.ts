import { GUI } from 'dat.gui'
import EDITOR, {
    Blueprint,
    Book,
    GridPattern,
    Editor,
    FD,
    inputMode,
    DATA_PACK,
    setDataPack,
    loadPackManifest,
    canonicalPackId,
    canonicalPacks,
    graphicsOptions,
} from '@fbe/editor'
import type { InputMode, InputPreset } from '@fbe/editor'
import type { IToastsOptions } from './toasts'

GUI.TEXT_CLOSED = 'Close Settings'
GUI.TEXT_OPEN = 'Open Settings'

const COLOR_DARK = 0x303030
const COLOR_LIGHT = 0xc9c9c9
const isDarkColor = (color: number): boolean => color === COLOR_DARK

export function initSettingsPane(
    editor: Editor,
    changeBookIndex: (index: number) => void,
    createToast: (options: IToastsOptions) => void
): {
    changeBook: (bpOrBook: Book | Blueprint) => void
} {
    // On touch devices the pane is more intrusive (bigger touch targets, full
    // width) so default it closed unless the user has made an explicit choice.
    // Keyed on the `coarse` signal rather than the derived mode — it is the hit-
    // target question, which is exactly what that signal answers (#101 §2).
    const persistedClosed = localStorage.getItem('dat.gui.closed')
    const startClosed = persistedClosed === null ? inputMode.coarse : persistedClosed === 'true'

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
    //
    // Since the action rail became universal (#101 Slice 4) the column continues
    // *below* that stack in every layout, so on a fine pointer the pane also
    // steps to the right of the rail — otherwise a 320 px pane, open by default
    // on desktop, would sit on top of the actions it shares an edge with. On a
    // coarse pointer it stays a deliberate full-width overlay at left: 0 (it
    // outranks the rail at z5 there, as before) — the screen is too narrow to
    // put anything beside it.
    const buttonsEl = document.getElementById('buttons')
    const railEl = document.getElementById('action-toolbar')
    const GAP = 4
    const positionPane = (): void => {
        const top = (buttonsEl ? Math.round(buttonsEl.getBoundingClientRect().bottom) : 80) + GAP
        const railWidth =
            railEl && railEl.classList.contains('visible')
                ? Math.round(railEl.getBoundingClientRect().width)
                : 0
        gui.domElement.style.top = `${top}px`
        gui.domElement.style.left = inputMode.coarse ? '0px' : `${railWidth}px`
        gui.domElement.style.maxHeight = `${window.innerHeight - top}px`
    }
    positionPane()
    window.addEventListener('resize', positionPane)
    // The signals move both anchors: `coarse` swaps the overlay/beside-the-rail
    // placement and resizes the rail's cells (hence its width).
    inputMode.on('signals', positionPane)
    // The stack's height changes (compact buttons on mobile, async icon loads),
    // and those reflows don't fire `resize`. A ResizeObserver re-anchors the pane
    // whenever the stack — or the rail beside it — actually changes size, free of
    // init-order races.
    if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(positionPane)
        if (buttonsEl) observer.observe(buttonsEl)
        if (railEl) observer.observe(railEl)
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

    // Input preset (#101 Slice 1). Detection is no longer a desktop/mobile
    // switch: the editor routes each pointer event by its own type and reads
    // live environment signals (`coarse` / `keys` / `compact` / `touchRecent`),
    // so the setting is an *override of the inputs* — `auto` lets the signals
    // decide, `mouse`/`touch` force one pointer kind for odd hardware and
    // debugging. `inputMode` owns persistence (`fbe:inputPreset`, migrated from
    // the old `fbe:inputMode`); `.listen()` keeps the dropdown in sync if the
    // preset is changed elsewhere (e.g. the `?test` hook).
    const inputPresetProxy = {
        get preset(): InputPreset {
            return inputMode.preset
        },
        set preset(p: InputPreset) {
            inputMode.preset = p
        },
    }
    gui.add(inputPresetProxy, 'preset', ['auto', 'mouse', 'touch']).name('Input').listen()

    // Data pack, two axes (docs/slim-graphics.md):
    //
    //   **Mod pack** — WHICH GAME DATA the editor renders (vanilla 2.0, 2.0 +
    //   Space Age, …). Canonical packs only; this is the axis blueprints and the
    //   library care about. Switching carries the graphics tier over when the
    //   target publishes the same one, else falls back to its first tier.
    //
    //   **Graphics** — WHICH TEXTURE SET draws it, orthogonal to the data (a
    //   variant is the same game, so nothing else changes). The selectable
    //   entries are the manifest's publicly hosted tiers, marked "hosted"; the
    //   unlock paths that aren't built yet — full quality from a private URL or
    //   from the user's own Factorio install — are listed as a "(planned)"
    //   placeholder, so it's visible in the UI which tiers exist publicly and
    //   which have to be brought/introduced.
    //
    // Both selects reload the app via setDataPack, so neither ever needs its
    // options rebuilt in place (dat.gui can't do that anyway). Controllers are
    // created once the manifest loads; loadPackManifest never rejects — a
    // missing manifest (e.g. an old single-dump deploy) resolves to [], and we
    // leave the folder empty rather than surfacing an error; the default pack
    // still loads.
    const dataPackFolder = gui.addFolder('Data Pack')
    loadPackManifest().then(packs => {
        if (packs.length === 0) return
        const canonical = canonicalPackId(packs, DATA_PACK)
        let graphics = graphicsOptions(packs, canonical)
        // A persisted/queried id the manifest doesn't list still gets a sane
        // pane: itself as the only ("Full") tier.
        if (graphics.length === 0) graphics = [{ id: DATA_PACK, label: 'Full' }]
        const activeTier = graphics.find(g => g.id === DATA_PACK)?.label ?? 'Full'

        const modOptions: Record<string, string> = {}
        for (const p of canonicalPacks(packs)) modOptions[p.label] = p.id
        const proxy = { modPack: canonical, graphics: DATA_PACK }
        dataPackFolder
            .add(proxy, 'modPack', modOptions)
            .name('Mod pack')
            .onChange((id: string) => {
                if (id === canonical) return
                const target = graphicsOptions(packs, id)
                const match = target.find(g => g.label === activeTier) ?? target[0]
                setDataPack(match?.id ?? id)
            })

        // Sentinel for tiers that don't exist yet — selecting it explains and
        // reverts instead of switching anything.
        const PLANNED = '__planned__'
        const gfxOptions: Record<string, string> = {}
        for (const g of graphics) gfxOptions[`${g.label} · hosted`] = g.id
        gfxOptions['Full · own game files (planned)'] = PLANNED
        const gfxController = dataPackFolder
            .add(proxy, 'graphics', gfxOptions)
            .name('Graphics')
            .onChange((id: string) => {
                if (id === PLANNED) {
                    proxy.graphics = DATA_PACK
                    gfxController.updateDisplay()
                    createToast({
                        text:
                            'Not available yet — full-quality graphics from your own ' +
                            'Factorio install (or a privately hosted URL) are planned. ' +
                            'The tiers marked "hosted" are what the public data plane ' +
                            'serves today.',
                        type: 'info',
                        timeout: 8000,
                    })
                    return
                }
                if (id !== DATA_PACK) setDataPack(id)
            })
        dataPackFolder.open()
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

    // Mobile-friendliness: drive a `body.mobile` class off the derived input mode
    // (CSS in index.styl widens the pane and enlarges touch targets), and hide the
    // Keybinds folder — it edits keyboard combos, which are meaningless without a
    // keyboard and otherwise dominate the pane's height. (Both move onto the
    // `coarse` / `keys` signals in a later slice of #101; for now the derived mode
    // keeps today's behaviour exactly.)
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
