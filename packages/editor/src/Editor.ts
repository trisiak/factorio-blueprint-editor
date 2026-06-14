// import pixi modules first (they will register themselves as extensions)
import 'pixi.js/app'
import 'pixi.js/events'
import 'pixi.js/filters'
import 'pixi.js/sprite-tiling'
import 'pixi.js/text'
import 'pixi.js/graphics'
import 'pixi.js/basis'

import { Application, TextureSource, setBasisTranscoderPath, Assets } from 'pixi.js'
import EventEmitter from 'eventemitter3'
import basisTranscoderJS from './basis/transcoder.1.16.4.js?url'
import basisTranscoderWASM from './basis/transcoder.1.16.4.wasm?url'
import { loadData } from './core/factorioData'
import G, { DATA_URL, Logger } from './common/globals'
import { Entity } from './core/Entity'
import { Blueprint, oilOutpostSettings, IOilOutpostSettings } from './core/Blueprint'
import { BlueprintContainer, EditorMode, GridPattern } from './containers/BlueprintContainer'
import { PaintTileContainer } from './containers/PaintTileContainer'
import { UIContainer } from './UI/UIContainer'
import { Dialog } from './UI/controls/Dialog'
import { ActionRegistry, MouseButton } from './actions'

export class Editor {
    // Stable mode emitter. The BlueprintContainer is swapped out on every
    // blueprint load, so DOM consumers (the on-screen toolbar) subscribe here
    // once and we re-forward each new container's mode changes onto it.
    private readonly m_modeEmitter = new EventEmitter<{ mode: [EditorMode] }>()
    // Stable blueprint-change emitter. Like the mode emitter, the active Blueprint
    // is swapped on load, so DOM consumers (the action rail, which gates the
    // box-select button on a non-empty blueprint) subscribe here once and we
    // re-forward each new blueprint's create/remove-entity events onto it.
    private readonly m_bpEmitter = new EventEmitter<{ change: [] }>()

    // Viewport insets (CSS px) reserved for DOM chrome — e.g. the mobile action
    // rail's left gutter. The canvas is sized to the remaining area and offset by
    // the insets, so the Pixi UI (which lays out off `app.screen`) reflows out of
    // the reserved bands instead of being covered. The "restrict the canvas" half
    // of the gutter idea; see docs/mobile-layout-inventory.md.
    private m_insets = { left: 0, top: 0, right: 0, bottom: 0 }

    private readonly applyCanvasSize = (): void => {
        const { left, top, right, bottom } = this.m_insets
        const w = Math.max(1, window.innerWidth - left - right)
        const h = Math.max(1, window.innerHeight - top - bottom)
        G.app.renderer.resize(w, h)
        const canvas = G.app.canvas as HTMLCanvasElement
        canvas.style.left = `${left}px`
        canvas.style.top = `${top}px`
    }

    public async init(canvas: HTMLCanvasElement, logger?: Logger): Promise<void> {
        setBasisTranscoderPath({ jsUrl: basisTranscoderJS, wasmUrl: basisTranscoderWASM })

        TextureSource.defaultOptions.scaleMode = 'linear'
        TextureSource.defaultOptions.addressMode = 'repeat'

        if (logger) {
            G.logger = logger
        }

        const app = new Application()

        await Promise.all([
            fetch(`${DATA_URL}/data.json`)
                .then(res => res.text())
                .then(modules => loadData(modules)),
            app.init({
                canvas,
                preference: 'webgpu',
                resolution: window.devicePixelRatio,
                autoDensity: true,
                skipExtensionImports: true,
                roundPixels: true,
                bezierSmoothness: 0.75,
                hello: true,
            }),
            Assets.init(),
        ])

        G.app = app

        this.applyCanvasSize()
        window.addEventListener('resize', this.applyCanvasSize, false)

        this.initActions()

        G.bp = new Blueprint()
        G.BPC = new BlueprintContainer(G.bp)
        this.bindBPCMode()
        G.app.stage.addChild(G.BPC)

        G.UI = new UIContainer()
        G.app.stage.addChild(G.UI)
        G.UI.showDebuggingLayer = G.debug
    }

    /** Re-emit the active container's mode + the blueprint's entity changes on the stable emitters. */
    private bindBPCMode(): void {
        G.BPC.on('mode', (mode: EditorMode) => this.m_modeEmitter.emit('mode', mode))
        G.bp.on('create-entity', () => this.m_bpEmitter.emit('change'))
        G.bp.on('remove-entity', () => this.m_bpEmitter.emit('change'))
        // Nudge consumers for the freshly-bound blueprint (e.g. after a load swaps
        // it in). No-op at boot — nobody's subscribed yet (the rail's own initial
        // layout covers the empty-blueprint start).
        this.m_bpEmitter.emit('change')
    }

    /** Current editor mode (NONE / EDIT / PAINT / PAN / COPY / DELETE / SELECT). */
    public get mode(): EditorMode {
        return G.BPC.mode
    }

    /** Subscribe to editor mode changes — e.g. to show a "cancel paint" control. */
    public onModeChange(cb: (mode: EditorMode) => void): void {
        this.m_modeEmitter.on('mode', cb)
    }

    /** Subscribe to blueprint entity add/remove (across blueprint swaps on load). */
    public onBlueprintChange(cb: () => void): void {
        this.m_bpEmitter.on('change', cb)
    }

    /** Whether the working blueprint has no entities/tiles (gates the rail's Select). */
    public get blueprintEmpty(): boolean {
        return G.bp.isEmpty()
    }

    /**
     * Whether the current flip target can actually be flipped — a held cursor
     * (a pasted blueprint, or a single held entity that's directional or chiral),
     * a placed entity being edited, or a single-entity marquee selection (#55).
     * Gates the rail's Flip buttons so they only show when flipping does something.
     */
    public get cursorCanFlip(): boolean {
        const mode = G.BPC.mode
        if (mode === EditorMode.PAINT) return !!G.BPC.paintContainer?.canFlip()
        if (mode === EditorMode.EDIT) return !!G.BPC.hoverContainer?.entity?.canFlip
        if (mode === EditorMode.SELECT) return G.BPC.marqueeCanFlip
        return false
    }

    // --- Touch marquee (#21) — thin delegators for the website's Select button
    // and the Copy/Cut/Delete bar (the gesture itself lives in BlueprintContainer).
    /** Arm the marquee: the next one-finger drag draws a selection box (mobile). */
    public armMarquee(): void {
        G.BPC.armMarquee()
    }
    /** Entities in the held marquee selection (0 when not in SELECT mode). */
    public get marqueeCount(): number {
        return G.BPC.marqueeCount
    }
    public copyMarquee(): void {
        G.BPC.copyMarquee()
    }
    public cutMarquee(): void {
        G.BPC.cutMarquee()
    }
    public deleteMarquee(): void {
        G.BPC.deleteMarquee()
    }
    public cancelMarquee(): void {
        G.BPC.cancelMarquee()
    }
    /** Nudge the held selection one tile in place (preserves wiring). */
    public nudgeSelection(offset: { x: number; y: number }): void {
        G.BPC.nudgeSelection(offset)
    }
    /** EDIT bar: promote the tapped entity into a one-entity held selection. */
    public selectHovered(): void {
        G.BPC.selectHovered()
    }
    /** EDIT bar: open the tapped entity's editor. */
    public editHovered(): void {
        G.BPC.editHovered()
    }

    /**
     * Reserve viewport edges (CSS px) for DOM chrome; the canvas shrinks into the
     * remaining area and the Pixi UI reflows accordingly. Pass only the edges you
     * want to change. Used by the mobile action rail to claim a left gutter.
     */
    public setViewportInsets(
        insets: Partial<{ left: number; top: number; right: number; bottom: number }>
    ): void {
        const next = { ...this.m_insets, ...insets }
        const changed =
            next.left !== this.m_insets.left ||
            next.top !== this.m_insets.top ||
            next.right !== this.m_insets.right ||
            next.bottom !== this.m_insets.bottom
        this.m_insets = next
        this.applyCanvasSize()
        // `renderer.resize` doesn't fire a window 'resize', and we can't redispatch
        // 'resize' (the action rail listens to it → it sets insets → loop). So nudge
        // the Pixi panels to re-anchor to the new canvas size via a private event.
        if (changed) window.dispatchEvent(new Event('fbe:viewportchange'))
    }

    public get moveSpeed(): number {
        return G.BPC.moveSpeed
    }
    public set moveSpeed(speed: number) {
        G.BPC.moveSpeed = speed
    }

    public get gridColor(): number {
        return G.BPC.gridColor
    }
    public set gridColor(color: number) {
        G.BPC.gridColor = color
    }

    public get gridPattern(): GridPattern {
        return G.BPC.gridPattern
    }
    public set gridPattern(pattern: GridPattern) {
        G.BPC.gridPattern = pattern
    }

    public get quickbarItems(): string[] {
        return G.UI.quickbarPanel.serialize()
    }
    public set quickbarItems(items: string[]) {
        G.UI.quickbarPanel.generateSlots(items)
    }

    public get limitWireReach(): boolean {
        return G.BPC.limitWireReach
    }
    public set limitWireReach(limit: boolean) {
        G.BPC.limitWireReach = limit
    }

    public get oilOutpostSettings(): IOilOutpostSettings {
        return oilOutpostSettings
    }
    public set oilOutpostSettings(settings: IOilOutpostSettings) {
        for (const key in oilOutpostSettings) {
            if (settings[key]) {
                oilOutpostSettings[key] = settings[key]
            }
        }
    }

    public get debug(): boolean {
        return G.debug
    }
    public set debug(debug: boolean) {
        G.debug = debug
        G.UI.showDebuggingLayer = debug
        if (G.bp) {
            G.bp.history.logging = debug
        }
    }

    public getPicture(): Promise<Blob> {
        return G.BPC.getPicture()
    }

    public haveBlueprint(): boolean {
        return !G.bp.isEmpty()
    }

    public async appendBlueprint(bp: Blueprint): Promise<void> {
        // Keep the copies bound to the *source* blueprint `bp`, not the target
        // `G.BPC.bp`: `PaintBlueprintContainer` rebuilds its ghost from
        // `entities[0].Blueprint.wireConnections` (serializing the wires between the
        // pasted entities), so binding to the empty target dropped every wire — a
        // pasted blueprint placed with no circuit/copper connections. `bp` still
        // holds the connections parsed on import, so the ghost (and the place that
        // follows) carries them through.
        const result = bp.entities.valuesArray().map(e => new Entity(e.rawEntity, bp))

        G.BPC.spawnPaintContainer(result, 0)
    }

    public async loadBlueprint(bp: Blueprint): Promise<void> {
        const last = G.BPC
        let i = 0
        try {
            i = G.app.stage.getChildIndex(last)
        } catch {
            i = G.app.stage.children.length
        }

        G.bp = bp

        G.BPC = new BlueprintContainer(bp)
        this.bindBPCMode()
        G.BPC.initBP()
        Dialog.closeAll()
        G.app.stage.addChildAt(G.BPC, i)
        if (last.parent) {
            last.destroy()
        }
    }

    private initActions(): void {
        G.actions = new ActionRegistry({
            // NONE -> PAN
            pan: {
                trigger: {
                    button: MouseButton.Left,
                },
                callbacks: {
                    onPress: () => G.BPC.panStart(),
                    onRelease: () => G.BPC.panEnd(),
                },
            },
            // PAINT
            build: {
                trigger: {
                    button: MouseButton.Left,
                },
                callbacks: {
                    onPress: () => G.BPC.buildStart(),
                    onRelease: () => G.BPC.buildEnd(),
                },
            },
            // PAINT | EDIT
            mine: {
                trigger: {
                    button: MouseButton.Right,
                },
                callbacks: {
                    onPress: () => G.BPC.mineStart(),
                    onRelease: () => G.BPC.mineEnd(),
                },
            },
            // EDIT
            openEntityGUI: {
                trigger: {
                    button: MouseButton.Left,
                },
                callbacks: {
                    onPress: () => G.BPC.openEditor(),
                },
            },
            // EDIT
            copyEntitySettings: {
                trigger: {
                    button: MouseButton.Right,
                },
                modifiers: {
                    shift: true,
                },
                callbacks: {
                    onPress: () => G.BPC.copyEntitySettings(),
                },
            },
            // EDIT
            pasteEntitySettings: {
                trigger: {
                    button: MouseButton.Left,
                },
                modifiers: {
                    shift: true,
                },
                callbacks: {
                    onPress: () => G.BPC.pasteEntitySettingsStart(),
                    onRelease: () => G.BPC.pasteEntitySettingsEnd(),
                },
                modifierCallbacks: {
                    onPress: () => G.BPC.pasteEntitySettingsModifiersStart(),
                    onRelease: () => G.BPC.pasteEntitySettingsModifiersEnd(),
                },
            },
            // any -> COPY
            copySelection: {
                trigger: {
                    button: MouseButton.Left,
                },
                modifiers: {
                    control: true,
                },
                callbacks: {
                    onPress: () => G.BPC.enterCopyMode(),
                    onRelease: () => G.BPC.exitCopyMode(),
                },
            },
            // any -> DELETE
            deleteSelection: {
                trigger: {
                    button: MouseButton.Right,
                },
                modifiers: {
                    control: true,
                },
                callbacks: {
                    onPress: () => G.BPC.enterDeleteMode(),
                    onRelease: () => G.BPC.exitDeleteMode(),
                },
            },

            moveUp: {
                trigger: {
                    code: 'KeyW',
                },
                callbacks: {
                    onPress: () => G.BPC.moveStart('up'),
                    onRelease: () => G.BPC.moveEnd('up'),
                },
            },
            moveLeft: {
                trigger: {
                    code: 'KeyA',
                },
                callbacks: {
                    onPress: () => G.BPC.moveStart('left'),
                    onRelease: () => G.BPC.moveEnd('left'),
                },
            },
            moveDown: {
                trigger: {
                    code: 'KeyS',
                },
                callbacks: {
                    onPress: () => G.BPC.moveStart('down'),
                    onRelease: () => G.BPC.moveEnd('down'),
                },
            },
            moveRight: {
                trigger: {
                    code: 'KeyD',
                },
                callbacks: {
                    onPress: () => G.BPC.moveStart('right'),
                    onRelease: () => G.BPC.moveEnd('right'),
                },
            },
            showInfo: {
                trigger: {
                    code: 'AltLeft',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.overlayContainer.toggleEntityInfoVisibility()
                        return true
                    },
                },
            },
            closeWindow: {
                trigger: {
                    code: 'Escape',
                },
                callbacks: {
                    onPress: () => {
                        // Escape is the universal "get me out": close the topmost
                        // dialog if one is open, otherwise cancel an in-progress
                        // paint / copy / delete cursor. The toolbar's cancel
                        // button routes through this same action.
                        if (Dialog.anyOpen()) {
                            Dialog.closeLast()
                        } else {
                            G.BPC.clearCursor()
                        }
                        return true
                    },
                },
            },
            // Commit the held paint cursor at its previewed tile. Pairs with
            // touch's deferred placement (tap to position, confirm to place); the
            // on-screen Place (✓) button routes through here too.
            confirmPlacement: {
                trigger: {
                    code: 'Enter',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.confirmPlacement()
                        return true
                    },
                },
            },
            inventory: {
                trigger: {
                    code: 'KeyE',
                },
                callbacks: {
                    onPress: () => {
                        // If there is a dialog open, assume user wants to close it
                        if (Dialog.anyOpen()) {
                            Dialog.closeLast()
                        } else {
                            G.UI.createInventory(
                                'Inventory',
                                undefined,
                                G.BPC.spawnPaintContainer.bind(G.BPC),
                                'items'
                            )
                        }
                        return true
                    },
                },
            },
            focus: {
                trigger: {
                    code: 'KeyF',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.centerViewport()
                        return true
                    },
                },
            },
            rotate: {
                trigger: {
                    code: 'KeyR',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.rotate(false)
                        return true
                    },
                },
            },
            reverseRotate: {
                trigger: {
                    code: 'KeyR',
                },
                modifiers: { shift: true },
                callbacks: {
                    onPress: () => {
                        G.BPC.rotate(true)
                        return true
                    },
                },
            },
            flipHorizontal: {
                trigger: {
                    code: 'KeyF',
                },
                modifiers: { shift: true },
                callbacks: {
                    onPress: () => {
                        G.BPC.flip(false)
                        return true
                    },
                },
            },
            flipVertical: {
                trigger: {
                    code: 'KeyG',
                },
                modifiers: { shift: true },
                callbacks: {
                    onPress: () => {
                        G.BPC.flip(true)
                        return true
                    },
                },
            },
            pipette: {
                trigger: {
                    code: 'KeyQ',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.pipette()
                        return true
                    },
                },
            },
            increaseTileBuildingArea: {
                trigger: {
                    code: 'BracketRight',
                },
                callbacks: {
                    onPress: () => {
                        if (G.BPC.paintContainer instanceof PaintTileContainer) {
                            G.BPC.paintContainer.increaseSize()
                        }
                        return true
                    },
                },
            },
            decreaseTileBuildingArea: {
                trigger: {
                    code: 'BracketLeft',
                },
                callbacks: {
                    onPress: () => {
                        if (G.BPC.paintContainer instanceof PaintTileContainer) {
                            G.BPC.paintContainer.decreaseSize()
                        }
                        return true
                    },
                },
            },
            undo: {
                trigger: {
                    code: 'KeyZ',
                },
                modifiers: { control: true },
                callbacks: {
                    onPress: () => {
                        G.bp.history.undo()
                        return true
                    },
                },
            },
            redo: {
                trigger: {
                    code: 'KeyY',
                },
                modifiers: { control: true },
                callbacks: {
                    onPress: () => {
                        G.bp.history.redo()
                        return true
                    },
                },
            },
            moveEntityUp: {
                trigger: {
                    code: 'ArrowUp',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.moveEntity({ x: 0, y: -1 })
                        return true
                    },
                },
            },
            moveEntityLeft: {
                trigger: {
                    code: 'ArrowLeft',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.moveEntity({ x: -1, y: 0 })
                        return true
                    },
                },
            },
            moveEntityDown: {
                trigger: {
                    code: 'ArrowDown',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.moveEntity({ x: 0, y: 1 })
                        return true
                    },
                },
            },
            moveEntityRight: {
                trigger: {
                    code: 'ArrowRight',
                },
                callbacks: {
                    onPress: () => {
                        G.BPC.moveEntity({ x: 1, y: 0 })
                        return true
                    },
                },
            },
            quickbar1: {
                trigger: { code: 'Digit1' },
                callbacks: { onPress: () => bindKeyToSlot(0) },
            },
            quickbar2: {
                trigger: { code: 'Digit2' },
                callbacks: { onPress: () => bindKeyToSlot(1) },
            },
            quickbar3: {
                trigger: { code: 'Digit3' },
                callbacks: { onPress: () => bindKeyToSlot(2) },
            },
            quickbar4: {
                trigger: { code: 'Digit4' },
                callbacks: { onPress: () => bindKeyToSlot(3) },
            },
            quickbar5: {
                trigger: { code: 'Digit5' },
                callbacks: { onPress: () => bindKeyToSlot(4) },
            },
            quickbar6: {
                trigger: { code: 'Digit1' },
                modifiers: { shift: true },
                callbacks: { onPress: () => bindKeyToSlot(5) },
            },
            quickbar7: {
                trigger: { code: 'Digit2' },
                modifiers: { shift: true },
                callbacks: { onPress: () => bindKeyToSlot(6) },
            },
            quickbar8: {
                trigger: { code: 'Digit3' },
                modifiers: { shift: true },
                callbacks: { onPress: () => bindKeyToSlot(7) },
            },
            quickbar9: {
                trigger: { code: 'Digit4' },
                modifiers: { shift: true },
                callbacks: { onPress: () => bindKeyToSlot(8) },
            },
            quickbar10: {
                trigger: { code: 'Digit5' },
                modifiers: { shift: true },
                callbacks: { onPress: () => bindKeyToSlot(9) },
            },
            changeActiveQuickbar: {
                trigger: { code: 'KeyX' },
                callbacks: {
                    onPress: () => {
                        G.UI.quickbarPanel.changeActiveQuickbar()
                        return true
                    },
                },
            },
        })

        const bindKeyToSlot = (slot: number): boolean => {
            G.UI.quickbarPanel.bindKeyToSlot(slot)
            return true
        }

        const pointerup = (e: PointerEvent): void => {
            G.actions.releaseButton(e)
        }

        window.addEventListener('pointerup', pointerup)

        const keydown = (e: KeyboardEvent): void => {
            if (e.repeat) return
            if (e.target instanceof HTMLInputElement) return
            if (e.target instanceof HTMLTextAreaElement) return
            G.actions.pressKey(e)
        }

        const keyup = (e: KeyboardEvent): void => {
            if (e.target instanceof HTMLInputElement) return
            if (e.target instanceof HTMLTextAreaElement) return
            G.actions.releaseKey(e)
        }

        const releaseAll = (): void => {
            G.actions.releaseAll()
        }

        window.addEventListener('keydown', keydown)
        window.addEventListener('keyup', keyup)
        window.addEventListener('blur', releaseAll)
    }
}
