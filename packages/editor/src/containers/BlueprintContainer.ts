import {
    TilingSprite,
    Rectangle,
    Container,
    Graphics,
    RenderTexture,
    EventBoundary,
    FederatedPointerEvent,
    Ticker,
} from 'pixi.js'
import FD from '../core/factorioData'
import G from '../common/globals'
import { Tile } from '../core/Tile'
import { Entity } from '../core/Entity'
import { Blueprint } from '../core/Blueprint'
import { IConnection } from '../core/WireConnections'
import { IPoint } from '../types'
import { Dialog } from '../UI/controls/Dialog'
import { Viewport } from './Viewport'
import { PinchPanRecognizer, PinchPanUpdate } from './PointerGestures'
import { inputMode } from '../common/input'
import { EntitySprite } from './EntitySprite'
import { WiresContainer } from './WiresContainer'
import { UnderlayContainer } from './UnderlayContainer'
import { EntityContainer } from './EntityContainer'
import { OverlayContainer } from './OverlayContainer'
import { PaintEntityContainer } from './PaintEntityContainer'
import { TileContainer } from './TileContainer'
import { PaintTileContainer } from './PaintTileContainer'
import { PaintWireContainer } from './PaintWireContainer'
import { Axis, IllegalFlipError, PaintContainer } from './PaintContainer'
import { PaintBlueprintContainer } from './PaintBlueprintContainer'
import { GridData } from './GridData'
import { WiresPanel } from '../UI/WiresPanel'

export enum GridPattern {
    CHECKER = 'checker',
    GRID = 'grid',
}

/** max pointer travel (screen px) for a touch to still count as a tap, not a pan */
const TOUCH_TAP_MOVE_THRESHOLD = 10
/** max duration (ms) for a touch to still count as a tap */
const TOUCH_TAP_MAX_DURATION = 300

type MoveDirections = {
    up: boolean
    left: boolean
    down: boolean
    right: boolean
}

export enum EditorMode {
    /** Default */
    NONE,
    /** Active when an entity is being hovered */
    EDIT,
    /** Active when "painting" */
    PAINT,
    /** Active when panning */
    PAN,
    /** Active when selecting multiple entities for copy/stamp */
    COPY,
    /** Active when selecting multiple entities for deletion */
    DELETE,
    /**
     * Active when a touch marquee selection is *held* — the box is drawn, the
     * entities under it are highlighted, and the on-screen Copy/Cut/Delete bar is
     * waiting for the user to choose. (Desktop's copy/delete commit on
     * mouse-release; touch defers the choice, so the selection persists.)
     */
    SELECT,
}

export class BlueprintContainer extends Container {
    private static _moveSpeed = 10
    private static _gridColor = 0x303030
    private static _gridPattern = GridPattern.GRID
    private static _limitWireReach = true

    /** Nr of cunks */
    private readonly chunks = 32
    /** Chunk offset - from 0,0 - Measured in tiles */
    private readonly chunkOffset = 16
    private readonly size: IPoint = {
        x: this.chunks * 32 * 32,
        y: this.chunks * 32 * 32,
    }
    private readonly anchor: IPoint = {
        x: 0.5,
        y: 0.5,
    }
    private readonly viewport: Viewport = new Viewport(
        this.size,
        {
            x: G.app.screen.width,
            y: G.app.screen.height,
        },
        this.anchor,
        3
    )

    private _mode: EditorMode = EditorMode.NONE
    public readonly bp: Blueprint
    public readonly gridData: GridData

    // Children
    private grid: TilingSprite
    private readonly chunkGrid: TilingSprite
    private readonly tileSprites: Container<EntitySprite>
    private readonly tilePaintSlot: Container<PaintTileContainer>
    public readonly underlayContainer: UnderlayContainer
    private readonly entitySprites: Container<EntitySprite>
    public readonly wiresContainer: WiresContainer
    public readonly overlayContainer: OverlayContainer
    private readonly entityPaintSlot: Container<PaintEntityContainer | PaintBlueprintContainer>
    private readonly wirePaintSlot: Container<PaintWireContainer>

    public hoverContainer: EntityContainer
    public paintContainer: PaintContainer

    private _entityForCopyData: Entity
    /**
     * Tile the paint cursor was last positioned at by a touch tap. On mobile a
     * tap positions/previews the ghost instead of committing (there's no hover to
     * preview with); a second tap on the *same* tile is what commits. Undefined
     * until the first positioning tap of a paint session.
     */
    private lastPaintTapTile?: IPoint
    /**
     * Entity (by number) the last touch tap selected. Opening an entity's editor
     * is deferred on touch: the first tap selects/inspects it, a second tap on the
     * same entity opens the editor. Undefined when nothing is selected.
     */
    private lastEditTapEntity?: number
    private copyModeEntities: Entity[] = []
    private deleteModeEntities: Entity[] = []
    private copyModeUpdateFn: (endX: number, endY: number) => void
    private deleteModeUpdateFn: (endX: number, endY: number) => void
    private copySettingsActive = false
    /**
     * Touch marquee (#21). `marqueeArmed` = the rail's Select button was tapped
     * and the next one-finger drag should draw a selection box (instead of
     * panning). `marqueeEntities` is what the drawn box currently covers; while
     * the selection is *held* (mode SELECT) it drives the Copy/Cut/Delete bar.
     */
    private marqueeArmed = false
    private marqueeEntities: Entity[] = []
    private marqueeUpdateFn?: (endX: number, endY: number) => void
    private readonly pointerGestures = new PinchPanRecognizer()
    /** in-progress single-finger touch, pending a tap-vs-drag decision */
    private touchPan: {
        pointerId: number
        startX: number
        startY: number
        lastX: number
        lastY: number
        moved: boolean
        startTime: number
        /**
         * What the drag steers, decided once when the move threshold is crossed:
         * `pan` scrolls the camera; `ghost` grabs a held paste ghost (the drag
         * started on it) and moves it around the world instead; `marquee` draws a
         * selection box (when armed via the Select button). Tap-or-drag is
         * unknown until then, so this stays undefined while `moved` is false.
         */
        target?: 'pan' | 'ghost' | 'marquee'
        /**
         * Ghost drags preserve the grab point: the ghost's center stays
         * `grabOffset` away from the finger (in screen px) instead of teleporting
         * under it, so grabbing a big paste by its edge doesn't make it jump.
         */
        grabOffsetX?: number
        grabOffsetY?: number
    } | null = null

    // PIXI properties
    public readonly eventMode = 'static'
    public readonly interactiveChildren = false
    public readonly hitArea = new Rectangle(
        -this.size.x * this.anchor.x,
        -this.size.y * this.anchor.y,
        this.size.x,
        this.size.y
    )
    panStart: () => boolean
    panEnd: () => void
    moveStart: (dir: keyof MoveDirections) => boolean
    moveEnd: (dir: keyof MoveDirections) => void
    buildStart: () => boolean
    buildEnd: () => void
    openEditor: () => boolean
    mineStart: () => boolean
    mineEnd: () => void
    pasteEntitySettingsStart: () => boolean
    pasteEntitySettingsEnd: () => void
    pasteEntitySettingsModifiersStart: () => boolean
    pasteEntitySettingsModifiersEnd: () => void

    public constructor(bp: Blueprint) {
        super()

        this.enableRenderGroup()

        this.bp = bp
        this.gridData = new GridData(this)

        this.grid = this.generateGrid()
        this.chunkGrid = this.generateChunkGrid(this.chunkOffset)
        this.tileSprites = new Container()
        this.tilePaintSlot = new Container()
        this.underlayContainer = new UnderlayContainer()
        this.entitySprites = new Container()
        this.wiresContainer = new WiresContainer(this.bp)
        this.overlayContainer = new OverlayContainer(this)
        this.entityPaintSlot = new Container()
        this.wirePaintSlot = new Container()

        this.tileSprites.enableRenderGroup()
        this.entitySprites.enableRenderGroup()

        this.addChild(
            this.grid,
            this.chunkGrid,
            this.tileSprites,
            this.tilePaintSlot,
            this.underlayContainer,
            this.entitySprites,
            this.wiresContainer,
            this.overlayContainer,
            this.entityPaintSlot,
            this.wirePaintSlot
        )

        const update = () => {
            if (this.viewport.update()) {
                // Desktop re-anchors the grid cursor (and paint ghost) under the
                // mouse as the view scrolls/zooms. On touch the ghost is pinned to
                // its tapped tile and the camera pans/pinches around it, so don't
                // re-derive the cursor from the stale last-touch point each frame.
                if (inputMode.mode === 'desktop') {
                    this.gridData.recalculate()
                }
                const t = this.viewport.getTransform()
                this.position.set(t.tx, t.ty)
                this.scale.set(t.a, t.d)
            }
        }
        G.app.ticker.add(update)
        this.on('destroyed', () => {
            G.app.ticker.remove(update)
        })

        // Hover is a desktop-only concept. On mobile these fire for the browser's
        // synthetic ("compatibility") mouse events after a tap — and a synthetic
        // `pointerout` would hide the paint ghost we just positioned, breaking the
        // tap-to-preview flow. On touch, ghost visibility is driven explicitly by
        // the tap / Place path instead (see handlePaintTap / confirmPlacement).
        this.on('pointerover', () => {
            if (inputMode.mode !== 'desktop') return
            if (this.mode === EditorMode.PAINT) {
                this.paintContainer.show()
            }
            this.updateHoverContainer()
        })
        this.on('pointerout', () => {
            if (inputMode.mode !== 'desktop') return
            if (this.mode === EditorMode.PAINT) {
                this.paintContainer.hide()
            }
            this.updateHoverContainer()
        })

        const onUpdate32 = (): void => {
            // Instead of decreasing the global interactionFrequency, call the over and out entity events here
            // ...but not while a marquee selection is being drawn or held: the
            // box drag moves the grid cursor across entities, and churning the
            // hover/info panel would pop it up over the box you're drawing.
            if (this.marqueeUpdateFn || this.mode === EditorMode.SELECT) return
            this.updateHoverContainer()
        }

        this.gridData.on('update32', onUpdate32)

        this.on('destroyed', () => {
            this.gridData.off('update32', onUpdate32)
            this.gridData.destroy()
        })

        {
            const onResize = (): void => {
                this.viewport.setSize(G.app.screen.width, G.app.screen.height)
            }

            window.addEventListener('resize', onResize, false)
            this.on('destroyed', () => {
                window.removeEventListener('resize', onResize, false)
            })
        }

        const panModule = {
            _onPan: (e: FederatedPointerEvent): void => {
                this.viewport.translateBy(e.movement.x, e.movement.y)
            },
            panStart: (): boolean => {
                if (this.mode === EditorMode.NONE) {
                    this.cursor = 'move'
                    this.setMode(EditorMode.PAN)
                    this.on('globalpointermove', panModule._onPan)
                    return true
                }
            },
            panEnd: (): void => {
                if (this.mode === EditorMode.PAN) {
                    this.off('globalpointermove', panModule._onPan)
                    this.setMode(EditorMode.NONE)
                    this.cursor = null
                }
            },
        }
        this.panStart = panModule.panStart
        this.panEnd = panModule.panEnd

        const moveTracker = {
            directions: {
                up: false,
                left: false,
                down: false,
                right: false,
            },
            start: (dir: keyof MoveDirections): boolean => {
                moveTracker.directions[dir] = true
                return true
            },
            end: (dir: keyof MoveDirections): void => {
                moveTracker.directions[dir] = false
            },
        }
        this.moveStart = moveTracker.start
        this.moveEnd = moveTracker.end

        {
            const panCb = (ticker: Ticker): void => {
                if (this.mode !== EditorMode.PAN) {
                    const WSXOR = moveTracker.directions.up !== moveTracker.directions.down
                    const ADXOR = moveTracker.directions.left !== moveTracker.directions.right
                    if (WSXOR || ADXOR) {
                        const mult = ticker.elapsedMS / 16.66
                        const finalSpeed = (this.moveSpeed / (WSXOR && ADXOR ? 1.4142 : 1)) * mult
                        this.viewport.translateBy(
                            (ADXOR ? (moveTracker.directions.left ? 1 : -1) : 0) * finalSpeed,
                            (WSXOR ? (moveTracker.directions.up ? 1 : -1) : 0) * finalSpeed
                        )
                    }
                }
            }

            G.app.ticker.add(panCb)
            this.on('destroyed', () => {
                G.app.ticker.remove(panCb)
            })
        }

        let constraint: boolean
        const build = (_x: number, _y: number, dx: number, dy: number): void => {
            if (constraint === undefined) {
                const cX = Math.abs(Math.sign(dx))
                const cY = Math.abs(Math.sign(dy))
                if (cX !== cY) {
                    constraint = true
                    if (cX === 1) {
                        this.paintContainer.setPosConstraint(Axis.X)
                    } else {
                        this.paintContainer.setPosConstraint(Axis.Y)
                    }
                }
            }
            this.paintContainer.placeEntityContainer()
        }

        let draggingCreateMode = false
        this.buildStart = (): boolean => {
            if (this.mode !== EditorMode.PAINT) return false

            draggingCreateMode = true

            this.paintContainer.placeEntityContainer()

            this.gridData.on('update32', build)

            return true
        }
        this.buildEnd = (): void => {
            if (!draggingCreateMode) return

            draggingCreateMode = false

            constraint = undefined
            this.paintContainer.setPosConstraint(undefined)

            this.gridData.off('update32', build)
        }

        this.openEditor = (): boolean => {
            if (this.mode === EditorMode.EDIT) {
                if (G.debug) {
                    console.log(this.hoverContainer.entity.serialize())
                }

                Dialog.closeAll()
                G.UI.createEditor(this.hoverContainer.entity)
                return true
            }
            return false
        }

        let remove = false
        this.mineStart = (): boolean => {
            remove = true
            this.gridData.on('update32', mine)
            mine()
            return true
        }
        const mine = (): void => {
            if (remove) {
                if (this.mode === EditorMode.EDIT) {
                    this.bp.removeEntity(this.hoverContainer.entity)
                }
                if (this.mode === EditorMode.PAINT) {
                    this.paintContainer.removeContainerUnder()
                }
            }
        }
        this.mineEnd = (): void => {
            remove = false
            this.gridData.off('update32', mine)
        }

        this.pasteEntitySettingsStart = (): boolean => {
            const isValid = this.pasteEntitySettings()
            if (isValid) this.gridData.on('update32', this.pasteEntitySettings, this)
            return isValid
        }
        this.pasteEntitySettingsEnd = (): void => {
            this.gridData.off('update32', this.pasteEntitySettings, this)
        }
        this.pasteEntitySettingsModifiersStart = (): boolean => {
            this.copySettingsActive = true
            this.updateCopyCursorBox()
            return true
        }
        this.pasteEntitySettingsModifiersEnd = (): void => {
            this.copySettingsActive = false
            this.updateCopyCursorBox()
        }

        const onWheel = (e: WheelEvent): void => {
            e.preventDefault()
            e.stopPropagation()

            if (Math.sign(e.deltaY) === 1) {
                this.zoom(false)
            } else {
                this.zoom(true)
            }
        }

        this.addEventListener('wheel', onWheel, { passive: false })
        this.on('destroyed', () => {
            this.removeEventListener('wheel', onWheel)
        })

        // Input is either desktop (mouse) or mobile (touch) — never both at once.
        // `inputMode` is the single source of truth; each handler dispatches for
        // exactly one scheme. In mobile we ignore `mouse` pointers, so the
        // synthetic ("compatibility") mouse events the browser fires after a tap
        // can't re-trigger an action and double-act. In desktop we ignore touch.
        const applyInputMode = (): void => {
            // Mobile locks the canvas's touch-action so the browser doesn't
            // pan/zoom the page (and suppresses most synthetic mouse events).
            const canvas = G.app.canvas as HTMLCanvasElement | undefined
            if (canvas?.style) {
                canvas.style.touchAction = inputMode.mode === 'mobile' ? 'none' : ''
            }
            // Drop anything in flight when the scheme changes under us.
            G.actions.releaseAll()
            this.pointerGestures.clear()
            this.touchPan = null
        }

        const onPointerDown = (e: FederatedPointerEvent): void => {
            if (inputMode.mode === 'desktop') {
                if (e.pointerType === 'touch') return // touch ignored in desktop mode
                G.actions.pressButton(e as unknown as PointerEvent)
                return
            }
            // mobile: touch/pen gestures only; ignore mouse (incl. ghost events)
            if (e.pointerType === 'mouse') return
            this.pointerGestures.down(e.pointerId, e.global.x, e.global.y)
            if (this.pointerGestures.pointerCount >= 2) {
                // a multi-touch gesture began: cancel the pending tap and let
                // applyPinchPan drive the viewport
                G.actions.releaseAll()
                this.touchPan = null
                // If a marquee box was mid-draw, a second finger means the user
                // wants to pan/zoom — abandon the half-drawn selection cleanly so
                // it can't get stuck (re-tap Select to start over). A *held*
                // selection (mode SELECT) is left alone: panning to look around
                // shouldn't drop it.
                if (this.marqueeUpdateFn) this.cancelMarquee()
                return
            }
            // Touch has no hover, so on touchdown we can't yet tell a tap
            // (place/select) from a drag (pan). Defer to onPointerMove / Up.
            this.touchPan = {
                pointerId: e.pointerId,
                startX: e.global.x,
                startY: e.global.y,
                lastX: e.global.x,
                lastY: e.global.y,
                moved: false,
                startTime: performance.now(),
            }
        }
        const onPointerMove = (e: FederatedPointerEvent): void => {
            if (inputMode.mode === 'desktop' || e.pointerType === 'mouse') return
            const gesture = this.pointerGestures.move(e.pointerId, e.global.x, e.global.y)
            if (gesture) {
                this.applyPinchPan(gesture)
                return
            }
            const tp = this.touchPan
            if (!tp || e.pointerId !== tp.pointerId) return
            if (!tp.moved) {
                const travel = Math.hypot(e.global.x - tp.startX, e.global.y - tp.startY)
                if (travel > TOUCH_TAP_MOVE_THRESHOLD) {
                    tp.moved = true
                    // Classify the drag once, by where it *started*: when armed via
                    // the Select button it draws a marquee; on a held paste ghost
                    // it grabs and moves the ghost; anywhere else it pans the camera
                    // (so you can still scroll while holding a paste — two-finger
                    // pan/pinch also works).
                    if (this.marqueeArmed) {
                        tp.target = 'marquee'
                        this.beginMarqueeDrag(tp.startX, tp.startY)
                    } else if (this.grabsPaintGhost(tp.startX, tp.startY)) {
                        tp.target = 'ghost'
                        const t = this.viewport.getTransform()
                        tp.grabOffsetX = this.paintContainer.x * t.a + t.tx - tp.startX
                        tp.grabOffsetY = this.paintContainer.y * t.d + t.ty - tp.startY
                    } else {
                        tp.target = 'pan'
                    }
                }
            }
            if (tp.moved) {
                if (tp.target === 'marquee') {
                    // Grow the selection box: moving the grid cursor fires the
                    // update events the rect + entity-collection listen on.
                    this.gridData.moveTo(e.global.x, e.global.y)
                } else if (tp.target === 'ghost') {
                    // Steer the grid cursor (which the ghost follows, tile-snapped)
                    // to the finger, offset by the original grab point.
                    this.gridData.moveTo(e.global.x + tp.grabOffsetX, e.global.y + tp.grabOffsetY)
                } else {
                    // one-finger drag pans the viewport
                    this.viewport.translateBy(e.global.x - tp.lastX, e.global.y - tp.lastY)
                }
            }
            tp.lastX = e.global.x
            tp.lastY = e.global.y
        }
        const onPointerUp = (e: FederatedPointerEvent): void => {
            if (inputMode.mode === 'desktop' || e.pointerType === 'mouse') return
            this.pointerGestures.up(e.pointerId)
            const tp = this.touchPan
            if (!tp || e.pointerId !== tp.pointerId) return
            this.touchPan = null
            if (tp.moved && tp.target === 'marquee') {
                // The box is drawn; hold the selection and let the user pick
                // Copy / Cut / Delete from the on-screen bar.
                this.endMarqueeDrag()
                return
            }
            if (tp.moved && tp.target === 'ghost' && this.mode === EditorMode.PAINT) {
                // The drag settled the ghost on a tile. Treat that tile as the
                // last previewed one, so a follow-up tap on the ghost's (visible)
                // center commits — the same contract as tap-positioning.
                this.lastPaintTapTile = this.paintContainer.getGridPosition()
                return
            }
            const wasTap = !tp.moved && performance.now() - tp.startTime < TOUCH_TAP_MAX_DURATION
            if (wasTap) {
                // While a marquee selection is held, a tap on the canvas (outside
                // the action bar, which swallows its own taps) dismisses it.
                if (this.mode === EditorMode.SELECT) {
                    this.cancelMarquee()
                    return
                }
                // A stray tap while armed (before dragging) just stays armed —
                // don't place/select; the user still needs to drag a box.
                if (this.marqueeArmed) return
                // A tap while a dialog (entity editor, inventory, …) is open
                // dismisses it. Dialogs swallow taps that land on them, so a tap
                // reaching here is necessarily *outside* the dialog — this is the
                // touch "tap-away to close" and, crucially, stops a stale editor
                // lingering when you tap another entity. Re-tap an entity to open
                // its editor. (Desktop, which refocuses via openEntityGUI, is on a
                // separate path and unaffected.)
                if (Dialog.anyOpen()) {
                    Dialog.closeLast()
                    this.lastEditTapEntity = undefined
                    return
                }
                // A tap seeds the grid + hover at the touch point, then acts.
                this.gridData.moveTo(tp.startX, tp.startY)
                this.updateHoverContainer()
                if (this.mode === EditorMode.PAINT) {
                    // Placement is deferred on touch: a tap positions/previews the
                    // ghost (the touch analogue of desktop hover) and only a second
                    // tap on the same tile commits. This makes orientation and
                    // location previewable before the entity lands, instead of the
                    // old blind tap-to-place. The Place (✓) toolbar button is the
                    // alternative confirm. Desktop is unaffected.
                    this.handlePaintTap()
                } else if (this.mode === EditorMode.EDIT) {
                    // Opening an entity's settings is deferred like placement: the
                    // first tap selects/hovers it (which shows its info panel,
                    // highlight and range via updateHoverContainer) and only a
                    // second tap on the same entity opens the editor overlay. This
                    // keeps the canvas from being covered the instant you touch an
                    // entity you only meant to inspect. Desktop click-to-open is
                    // unaffected.
                    this.handleEditTap()
                } else {
                    // Other modes keep the original left-click pipeline so
                    // select / open / pan semantics apply unchanged.
                    this.lastEditTapEntity = undefined
                    G.actions.pressButton(e as unknown as PointerEvent)
                    G.actions.releaseButton(e as unknown as PointerEvent)
                }
            }
        }

        this.addEventListener('pointerdown', onPointerDown)
        this.on('globalpointermove', onPointerMove)
        this.addEventListener('pointerup', onPointerUp)
        this.addEventListener('pointerupoutside', onPointerUp)
        this.addEventListener('pointercancel', onPointerUp)
        inputMode.on('change', applyInputMode)
        applyInputMode()
        this.on('destroyed', () => {
            this.removeEventListener('pointerdown', onPointerDown)
            this.off('globalpointermove', onPointerMove)
            this.removeEventListener('pointerup', onPointerUp)
            this.removeEventListener('pointerupoutside', onPointerUp)
            this.removeEventListener('pointercancel', onPointerUp)
            inputMode.off('change', applyInputMode)
            this.pointerGestures.clear()
            G.actions.releaseAll()
        })
    }

    /** Apply an incremental pinch/two-finger-pan gesture to the viewport. */
    private applyPinchPan(g: PinchPanUpdate): void {
        // two-finger pan: screen-space translation of the gesture center
        if (g.panX !== 0 || g.panY !== 0) {
            this.viewport.translateBy(g.panX, g.panY)
        }
        // pinch zoom: scale multiplicatively about the gesture center. zoomBy is
        // additive on top of the (per-frame reset) scale, so `scale - 1` makes
        // the next matrix update multiply the current zoom by `scale`. Reusing
        // zoomBy keeps the existing min/max-zoom constraints intact.
        if (g.scale !== 1) {
            const [worldX, worldY] = this.toWorld(g.centerX, g.centerY)
            this.viewport.setScaleCenter(worldX, worldY)
            this.viewport.zoomBy(g.scale - 1)
        }
    }

    public get entityForCopyData(): Entity {
        return this._entityForCopyData
    }

    public copyEntitySettings(): boolean {
        if (this.mode === EditorMode.EDIT) {
            // Store reference to source entity
            this._entityForCopyData = this.hoverContainer.entity
            this.updateCopyCursorBox()
            return true
        }
        return false
    }

    public pasteEntitySettings(): boolean {
        if (this._entityForCopyData && this.mode === EditorMode.EDIT) {
            // Hand over reference of source entity to target entity for pasting data
            this.hoverContainer.entity.pasteSettings(this._entityForCopyData)
            return true
        }
        return false
    }

    public getViewportScale(): number {
        return this.viewport.getCurrentScale()
    }

    /** screen to world */
    public toWorld(x: number, y: number): [number, number] {
        const t = this.viewport.getTransform()
        return [(x - t.tx) / t.a, (y - t.ty) / t.d]
    }

    public get mode(): EditorMode {
        return this._mode
    }

    private setMode(mode: EditorMode): void {
        this._mode = mode
        this.emit('mode', mode)
    }

    public rotate(ccw: boolean): void {
        if (this.mode === EditorMode.EDIT) {
            this.hoverContainer.entity.rotate(ccw, true)
        } else if (this.mode === EditorMode.PAINT) {
            if (this.paintContainer.canFlipOrRotateByCopying()) {
                const copies = this.paintContainer.rotatedEntities(ccw)
                this.paintContainer.destroy()
                this.spawnPaintContainer(copies, 0)
            } else {
                this.paintContainer.rotate(ccw)
            }
        }
    }

    public flip(vertical: boolean): void {
        if (this.mode === EditorMode.PAINT && this.paintContainer.canFlipOrRotateByCopying()) {
            try {
                const copies = this.paintContainer.flippedEntities(vertical)
                this.paintContainer.destroy()
                this.spawnPaintContainer(copies, 0)
            } catch (e) {
                if (e instanceof IllegalFlipError) {
                    G.logger({ text: e.message, type: 'warning' })
                } else {
                    throw e
                }
            }
        }
    }

    public pipette(): void {
        if (this.mode === EditorMode.EDIT) {
            const entity = this.hoverContainer.entity
            const itemName = Entity.getItemName(entity.name)
            const direction =
                entity.directionType === 'output' ? (entity.direction + 8) % 16 : entity.direction
            this.spawnPaintContainer(itemName, direction)
        } else if (this.mode === EditorMode.PAINT) {
            this.paintContainer.destroy()
        }
        this.exitCopyMode(true)
        this.exitDeleteMode(true)
    }

    /**
     * Cancel whatever the cursor is currently doing — painting, a copy/delete
     * drag, or a held touch marquee selection — and return to NONE. Desktop
     * reaches this by toggling the trigger off (e.g. pipette again); this is the
     * single explicit "stop" that the Escape key and the on-screen toolbar's
     * cancel button both route through, since touch has no keyboard to bail with.
     */
    public clearCursor(): void {
        if (this.mode === EditorMode.PAINT) {
            this.paintContainer.destroy()
        }
        this.exitCopyMode(true)
        this.exitDeleteMode(true)
        this.cancelMarquee()
    }

    /**
     * Whether a touch starting at this screen point lands on the held ghost's
     * footprint — if so, the drag grabs and moves the ghost instead of panning.
     * Works for both a single entity and a multi-entity paste (each reports its
     * own footprint); tiles/wires opt out (containsWorldPoint defaults false).
     */
    private grabsPaintGhost(screenX: number, screenY: number): boolean {
        if (this.mode !== EditorMode.PAINT || !this.paintContainer) return false
        const [worldX, worldY] = this.toWorld(screenX, screenY)
        return this.paintContainer.containsWorldPoint(worldX, worldY)
    }

    /**
     * Handle a touch tap while holding a paint cursor: reveal + position the
     * ghost, and commit only when the tap repeats on the tile the ghost already
     * occupies. The item stays in hand after a placement (like desktop), so
     * tap-elsewhere / tap-again lets you place several quickly.
     */
    private handlePaintTap(): void {
        this.paintContainer.show()
        // The ghost ignores grid updates while hidden (moveAtCursor early-returns),
        // so the first revealing tap must re-snap it explicitly — otherwise it
        // appears (and reads its tile) at a stale, pre-hide position.
        this.paintContainer.moveAtCursor()
        const tile = this.paintContainer.getGridPosition()
        const onSameTile =
            this.lastPaintTapTile !== undefined &&
            this.lastPaintTapTile.x === tile.x &&
            this.lastPaintTapTile.y === tile.y
        if (onSameTile) {
            this.paintContainer.placeEntityContainer()
        }
        this.lastPaintTapTile = tile
    }

    /**
     * Handle a touch tap on an entity (EDIT mode). The first tap on an entity
     * just selects it — `updateHoverContainer` has already shown its info panel,
     * highlight and range — and only a second tap on the *same* entity opens the
     * editor overlay, so a glance doesn't bury the canvas under a dialog. Tapping
     * a different entity re-selects (shows the new one's info) without opening.
     */
    private handleEditTap(): void {
        const entityNumber = this.hoverContainer?.entity?.entityNumber
        if (entityNumber !== undefined && entityNumber === this.lastEditTapEntity) {
            this.openEditor()
            // Next tap starts the select→open cycle over (e.g. after closing).
            this.lastEditTapEntity = undefined
        } else {
            this.lastEditTapEntity = entityNumber
        }
    }

    /**
     * Commit the held paint cursor at its current tile. Drives the on-screen
     * Place (✓) button and the Enter key — the explicit confirm that pairs with
     * touch's deferred placement. No-op outside paint mode or before the ghost
     * has been positioned (it stays hidden until the first tap).
     */
    public confirmPlacement(): void {
        if (this.mode !== EditorMode.PAINT) return
        this.paintContainer.placeEntityContainer()
        this.lastPaintTapTile = this.paintContainer.getGridPosition()
    }

    public moveEntity(offset: IPoint) {
        if (this.mode === EditorMode.EDIT) {
            this.hoverContainer.entity.moveBy(offset)
        } else if (this.mode === EditorMode.PAINT) {
            // Fine-tune nudge for the held ghost: shift the grid cursor (which
            // the ghost follows) by whole tiles. Drives the rail's arrow buttons
            // on touch and the arrow keys on desktop. Reveal the ghost first so
            // an un-positioned cursor becomes visible & steerable, and re-snap it
            // (it ignores grid updates while hidden).
            this.paintContainer.show()
            this.paintContainer.moveAtCursor()
            this.gridData.nudge(offset.x, offset.y)
            // Keep the tap-to-commit contract: after a nudge, a tap on the
            // ghost's (visible) center tile commits.
            this.lastPaintTapTile = this.paintContainer.getGridPosition()
        }
    }

    public enterCopyMode(): boolean {
        if (this.mode === EditorMode.COPY) return false
        if (this.mode === EditorMode.PAINT) this.paintContainer.destroy()

        this.updateHoverContainer(true)
        this.setMode(EditorMode.COPY)

        this.overlayContainer.showSelectionArea(0x00d400)

        const startPos = { x: this.gridData.x32, y: this.gridData.y32 }
        this.copyModeUpdateFn = (endX: number, endY: number) => {
            const X = Math.min(startPos.x, endX)
            const Y = Math.min(startPos.y, endY)
            const W = Math.abs(endX - startPos.x) + 1
            const H = Math.abs(endY - startPos.y) + 1

            for (const e of this.copyModeEntities) {
                EntityContainer.mappings.get(e.entityNumber).cursorBox = undefined
            }

            this.copyModeEntities = this.bp.entityPositionGrid.getEntitiesInArea({
                x: X + W / 2,
                y: Y + H / 2,
                w: W,
                h: H,
            })

            for (const e of this.copyModeEntities) {
                EntityContainer.mappings.get(e.entityNumber).cursorBox = 'copy'
            }
        }
        this.copyModeUpdateFn(startPos.x, startPos.y)
        this.gridData.on('update32', this.copyModeUpdateFn, this)

        return true
    }

    public exitCopyMode(cancel = false): void {
        if (this.mode !== EditorMode.COPY) return

        this.overlayContainer.hideSelectionArea()
        this.gridData.off('update32', this.copyModeUpdateFn, this)

        this.setMode(EditorMode.NONE)
        this.updateHoverContainer()

        if (!cancel && this.copyModeEntities.length !== 0) {
            this.spawnPaintContainer(this.copyModeEntities)
        }
        for (const e of this.copyModeEntities) {
            EntityContainer.mappings.get(e.entityNumber).cursorBox = undefined
        }
        this.copyModeEntities = []
    }

    public enterDeleteMode(): boolean {
        if (this.mode === EditorMode.DELETE) return false
        if (this.mode === EditorMode.PAINT) this.paintContainer.destroy()

        this.updateHoverContainer(true)
        this.setMode(EditorMode.DELETE)

        this.overlayContainer.showSelectionArea(0xff3200)

        const startPos = { x: this.gridData.x32, y: this.gridData.y32 }
        this.deleteModeUpdateFn = (endX: number, endY: number) => {
            const X = Math.min(startPos.x, endX)
            const Y = Math.min(startPos.y, endY)
            const W = Math.abs(endX - startPos.x) + 1
            const H = Math.abs(endY - startPos.y) + 1

            for (const e of this.deleteModeEntities) {
                EntityContainer.mappings.get(e.entityNumber).cursorBox = undefined
            }

            this.deleteModeEntities = this.bp.entityPositionGrid.getEntitiesInArea({
                x: X + W / 2,
                y: Y + H / 2,
                w: W,
                h: H,
            })

            for (const e of this.deleteModeEntities) {
                EntityContainer.mappings.get(e.entityNumber).cursorBox = 'not_allowed'
            }
        }
        this.deleteModeUpdateFn(startPos.x, startPos.y)
        this.gridData.on('update32', this.deleteModeUpdateFn, this)

        return true
    }

    public exitDeleteMode(cancel = false): void {
        if (this.mode !== EditorMode.DELETE) return

        this.overlayContainer.hideSelectionArea()
        this.gridData.off('update32', this.deleteModeUpdateFn, this)

        this.setMode(EditorMode.NONE)
        this.updateHoverContainer()

        if (cancel) {
            for (const e of this.deleteModeEntities) {
                EntityContainer.mappings.get(e.entityNumber).cursorBox = undefined
            }
        } else {
            this.bp.removeEntities(this.deleteModeEntities)
        }

        this.deleteModeEntities = []
    }

    // --- Touch marquee (#21) ---------------------------------------------------
    // Desktop area-select is modifier+drag, committing on mouse-release (copy →
    // paste ghost, delete → remove). Touch has no modifier and wants to *choose*
    // the action after seeing the selection, so the flow is: arm (Select button)
    // → one-finger drag draws the box → release holds the selection (mode SELECT)
    // → the on-screen Copy/Cut/Delete bar commits. Reuses the same selection
    // rectangle + area query + cursor-box highlight as the desktop modes.

    /** Arm the marquee: the next one-finger drag draws a selection box. */
    public armMarquee(): void {
        if (inputMode.mode !== 'mobile') return
        // Drop any in-flight cursor / prior selection so the drag is unambiguous.
        this.clearCursor()
        this.cancelMarquee()
        // Clear any showing hover/info panel (e.g. from a prior tap-select, or if
        // the marquee starts on an entity): hover updates are suppressed during
        // the drag, so a lingering panel would otherwise never go away.
        this.updateHoverContainer(true)
        this.marqueeArmed = true
        G.logger({ text: 'Drag a box to select entities', type: 'info' })
    }

    /** Begin drawing the box: seed the start tile, show the rect, track coverage. */
    private beginMarqueeDrag(screenX: number, screenY: number): void {
        this.marqueeArmed = false
        this.gridData.moveTo(screenX, screenY)
        // Neutral (blue) box — the action (copy/cut/delete) is chosen afterwards.
        this.overlayContainer.showSelectionArea(0x3b9eff)

        const startPos = { x: this.gridData.x32, y: this.gridData.y32 }
        this.marqueeUpdateFn = (endX: number, endY: number) => {
            const X = Math.min(startPos.x, endX)
            const Y = Math.min(startPos.y, endY)
            const W = Math.abs(endX - startPos.x) + 1
            const H = Math.abs(endY - startPos.y) + 1

            for (const e of this.marqueeEntities) {
                const m = EntityContainer.mappings.get(e.entityNumber)
                if (m) m.cursorBox = undefined
            }
            this.marqueeEntities = this.bp.entityPositionGrid.getEntitiesInArea({
                x: X + W / 2,
                y: Y + H / 2,
                w: W,
                h: H,
            })
            for (const e of this.marqueeEntities) {
                const m = EntityContainer.mappings.get(e.entityNumber)
                if (m) m.cursorBox = 'copy'
            }
        }
        this.marqueeUpdateFn(startPos.x, startPos.y)
        this.gridData.on('update32', this.marqueeUpdateFn, this)
        // The seeding moveTo above fires update32 before the suppression guard is
        // in place, so starting the box on an entity can flash its info panel —
        // clear it now (updates stay suppressed for the rest of the drag).
        this.updateHoverContainer(true)
    }

    /** Finish drawing: freeze the box and hold the selection (or cancel if empty). */
    private endMarqueeDrag(): void {
        if (this.marqueeUpdateFn) {
            this.gridData.off('update32', this.marqueeUpdateFn, this)
            this.marqueeUpdateFn = undefined
        }
        // Stop the rectangle from following later grid updates (a tap would
        // otherwise redraw it), but keep it visible as the held selection.
        this.overlayContainer.freezeSelectionArea()
        if (this.marqueeEntities.length === 0) {
            this.cancelMarquee()
            return
        }
        this.setMode(EditorMode.SELECT)
    }

    /** Number of entities in the held marquee selection (0 when none). */
    public get marqueeCount(): number {
        return this.mode === EditorMode.SELECT ? this.marqueeEntities.length : 0
    }

    /** Top-left tile of the held selection (min entity position), or null. For e2e. */
    public get marqueeOrigin(): IPoint | undefined {
        if (this.mode !== EditorMode.SELECT || this.marqueeEntities.length === 0) return undefined
        return {
            x: Math.min(...this.marqueeEntities.map(e => e.position.x)),
            y: Math.min(...this.marqueeEntities.map(e => e.position.y)),
        }
    }

    /** Copy the selection into a paste ghost (originals stay), previewed in place. */
    public copyMarquee(): void {
        if (this.mode !== EditorMode.SELECT) return
        const entities = this.marqueeEntities
        this.clearMarqueeVisuals()
        this.setMode(EditorMode.NONE)
        if (entities.length !== 0) this.spawnGhostAtSource(entities)
    }

    /** Cut: pick the selection up as a paste ghost *and* remove the originals. */
    public cutMarquee(): void {
        if (this.mode !== EditorMode.SELECT) return
        const entities = this.marqueeEntities
        this.clearMarqueeVisuals()
        this.setMode(EditorMode.NONE)
        if (entities.length !== 0) {
            // Serialize into the ghost first, then drop the originals.
            this.spawnGhostAtSource(entities)
            this.bp.removeEntities(entities)
        }
    }

    /**
     * Spawn a paste ghost from the given entities and position it over their
     * *original* location, shown immediately — so a marquee Copy/Cut previews
     * where it came from (intuitive for cut = move-in-place) instead of jumping
     * under the finger. The user then taps to place, or drags/nudges it elsewhere.
     */
    private spawnGhostAtSource(entities: Entity[]): void {
        this.spawnPaintContainer(entities)
        const pc = this.paintContainer
        if (pc instanceof PaintBlueprintContainer) {
            const c = pc.getSourceCenter()
            pc.show()
            this.gridData.moveToWorld(c.x * 32, c.y * 32)
            this.lastPaintTapTile = pc.getGridPosition()
        }
    }

    /** Delete the selected entities. */
    public deleteMarquee(): void {
        if (this.mode !== EditorMode.SELECT) return
        const entities = this.marqueeEntities
        this.clearMarqueeVisuals()
        this.setMode(EditorMode.NONE)
        if (entities.length !== 0) this.bp.removeEntities(entities)
    }

    /** Drop the marquee (armed, drawing, or held) without acting on it. */
    public cancelMarquee(): void {
        this.marqueeArmed = false
        if (this.marqueeUpdateFn) {
            this.gridData.off('update32', this.marqueeUpdateFn, this)
            this.marqueeUpdateFn = undefined
        }
        this.clearMarqueeVisuals()
        if (this.mode === EditorMode.SELECT) this.setMode(EditorMode.NONE)
    }

    private clearMarqueeVisuals(): void {
        this.overlayContainer.hideSelectionArea()
        for (const e of this.marqueeEntities) {
            const m = EntityContainer.mappings.get(e.entityNumber)
            if (m) m.cursorBox = undefined
        }
        this.marqueeEntities = []
    }

    /**
     * Nudge the held selection one tile in place (the SELECT-mode d-pad). Moves
     * the actual entities, preserving their wiring (unlike cut/paste) — see
     * `Blueprint.moveEntitiesBy`. The frozen selection box follows so it stays
     * around the entities.
     */
    public nudgeSelection(offset: IPoint): void {
        if (this.mode !== EditorMode.SELECT || this.marqueeEntities.length === 0) return
        if (this.bp.moveEntitiesBy(this.marqueeEntities, offset)) {
            this.overlayContainer.shiftSelectionArea(offset.x, offset.y)
        }
    }

    /**
     * Promote the entity under the EDIT-mode cursor into a one-entity held
     * selection (mode SELECT), so the same nudge / Copy / Cut / Delete controls
     * apply to a single tapped entity. Drives the EDIT bar's "Select".
     */
    public selectHovered(): void {
        if (this.mode !== EditorMode.EDIT || !this.hoverContainer) return
        const entity = this.hoverContainer.entity
        this.updateHoverContainer(true) // clear hover/info + mode → NONE
        this.marqueeEntities = [entity]
        const m = EntityContainer.mappings.get(entity.entityNumber)
        if (m) m.cursorBox = 'copy'
        this.setMode(EditorMode.SELECT)
    }

    /** Open the editor for the EDIT-mode entity (the EDIT bar's "Edit"). */
    public editHovered(): void {
        if (this.mode === EditorMode.EDIT) this.openEditor()
    }

    public zoom(zoomIn = true): void {
        const zoomFactor = 0.1
        this.viewport.setScaleCenter(this.gridData.x, this.gridData.y)
        this.viewport.zoomBy(zoomFactor * (zoomIn ? 1 : -1))
    }

    private get isPointerInside(): boolean {
        const boundary = new EventBoundary(G.app.stage)
        const container = boundary.hitTest(this.gridData.x, this.gridData.y)
        return container === this
    }

    private updateHoverContainer(forceRemove = false): void {
        const removeHoverContainer = (): void => {
            this.hoverContainer.pointerOutEventHandler()
            this.hoverContainer = undefined
            this.setMode(EditorMode.NONE)
            this.cursor = 'inherit'
            this.updateCopyCursorBox()
        }

        if (forceRemove || !this.isPointerInside) {
            if (this.hoverContainer) {
                removeHoverContainer()
            }
            return
        }

        if (!this.bp) return

        const entity = this.bp.entityPositionGrid.getEntityAtPosition({
            x: this.gridData.x32,
            y: this.gridData.y32,
        })
        const eC = entity ? EntityContainer.mappings.get(entity.entityNumber) : undefined

        if (eC && this.hoverContainer === eC) return

        if (this.mode === EditorMode.EDIT) {
            removeHoverContainer()
        }

        if (eC && this.mode === EditorMode.NONE) {
            this.hoverContainer = eC
            this.setMode(EditorMode.EDIT)
            this.cursor = 'pointer'
            eC.pointerOverEventHandler()
            this.updateCopyCursorBox()
        }
    }

    private updateCopyCursorBox(): void {
        this.overlayContainer.updateCopyCursorBox(!this.copySettingsActive)
    }

    public get moveSpeed(): number {
        return BlueprintContainer._moveSpeed
    }

    public set moveSpeed(speed: number) {
        BlueprintContainer._moveSpeed = speed
    }

    public get gridColor(): number {
        return BlueprintContainer._gridColor
    }

    public set gridColor(color: number) {
        BlueprintContainer._gridColor = color
        this.grid.tint = color
    }

    public get gridPattern(): GridPattern {
        return BlueprintContainer._gridPattern
    }

    public set gridPattern(pattern: GridPattern) {
        BlueprintContainer._gridPattern = pattern

        const index = this.getChildIndex(this.grid)
        const old = this.grid
        this.grid = this.generateGrid()
        this.addChildAt(this.grid, index)
        old.destroy()
    }

    public get limitWireReach(): boolean {
        return BlueprintContainer._limitWireReach
    }

    public set limitWireReach(limit: boolean) {
        BlueprintContainer._limitWireReach = limit
    }

    private generateGrid(pattern = this.gridPattern): TilingSprite {
        const gridGraphics =
            pattern === 'checker'
                ? new Graphics()
                      .rect(0, 0, 32, 32)
                      .rect(32, 32, 32, 32)
                      .fill(0x808080)
                      .rect(0, 32, 32, 32)
                      .rect(32, 0, 32, 32)
                      .fill(0xffffff)
                : new Graphics().rect(0, 0, 32, 32).fill(0x808080).rect(1, 1, 31, 31).fill(0xffffff)

        const renderTexture = RenderTexture.create({
            width: gridGraphics.width,
            height: gridGraphics.height,
            autoGenerateMipmaps: true,
        })

        G.app.renderer.render({ container: gridGraphics, target: renderTexture })
        renderTexture.source.updateMipmaps()

        const grid = new TilingSprite({
            texture: renderTexture,
            width: this.size.x,
            height: this.size.y,
        })
        grid.anchor.set(this.anchor.x, this.anchor.y)

        grid.tint = this.gridColor

        return grid
    }

    private generateChunkGrid(chunkOffset: number): TilingSprite {
        const W = 32 * 32
        const H = 32 * 32
        const gridGraphics = new Graphics()
            .moveTo(0, 0)
            .lineTo(W, 0)
            .lineTo(W, H)
            .lineTo(0, H)
            .lineTo(0, 0)
            .stroke({ width: 2, color: 0x000000 })

        const renderTexture = RenderTexture.create({
            width: W,
            height: H,
            autoGenerateMipmaps: true,
        })

        G.app.renderer.render({ container: gridGraphics, target: renderTexture })
        renderTexture.source.updateMipmaps()

        // Add one more chunk to the size because of the offset
        const grid = new TilingSprite({
            texture: renderTexture,
            width: this.size.x + W,
            height: this.size.y + H,
        })
        // Offset chunk grid
        grid.position.set(chunkOffset * 32, chunkOffset * 32)
        grid.anchor.set(this.anchor.x, this.anchor.y)

        return grid
    }

    public initBP(): void {
        // Render Bp
        for (const [, e] of this.bp.entities) {
            new EntityContainer(e, false)
        }
        for (const [, t] of this.bp.tiles) {
            new TileContainer(t)
        }

        const onCreateEntity = (entity: Entity): void => {
            new EntityContainer(entity)
            this.updateHoverContainer()
        }
        const onRemoveEntity = (): void => {
            this.updateHoverContainer()
        }
        const onCreateTile = (tile: Tile): TileContainer => new TileContainer(tile)

        this.bp.on('create-entity', onCreateEntity)
        this.bp.on('remove-entity', onRemoveEntity)
        this.bp.on('create-tile', onCreateTile)

        const onConnectionCreated = (hash: string, connection: IConnection): void => {
            this.wiresContainer.connect(hash, connection)
        }
        const onConnectionRemoved = (hash: string, connection: IConnection): void => {
            this.wiresContainer.disconnect(hash, connection)
        }
        this.bp.wireConnections.on('create', onConnectionCreated)
        this.bp.wireConnections.on('remove', onConnectionRemoved)
        this.bp.wireConnections.forEach((connection, hash) =>
            this.wiresContainer.add(hash, connection)
        )

        this.on('destroyed', () => {
            this.bp.off('create-entity', onCreateEntity)
            this.bp.off('remove-entity', onRemoveEntity)
            this.bp.off('create-tile', onCreateTile)

            this.bp.wireConnections.off('create', onConnectionCreated)
            this.bp.wireConnections.off('remove', onConnectionRemoved)
        })

        this.sortEntities()
        this.centerViewport()
    }

    public destroy(): void {
        super.destroy({ children: true })
    }

    public addEntitySprites(entitySprites: EntitySprite[], sort = true): void {
        if (entitySprites.length === 0) return
        this.entitySprites.addChild(...entitySprites)
        if (sort) {
            this.sortEntities()
        }
    }

    public addTileSprites(tileSprites: EntitySprite[]): void {
        if (tileSprites.length === 0) return
        this.tileSprites.addChild(...tileSprites)
    }

    private sortEntities(): void {
        this.entitySprites.children.sort(EntitySprite.compareFn)
    }

    public transparentEntities(bool = true): void {
        const alpha = bool ? 0.5 : 1
        this.entitySprites.alpha = alpha
        this.wiresContainer.alpha = alpha
        this.overlayContainer.alpha = alpha
    }

    public centerViewport(): void {
        const bounds = this.bp.isEmpty()
            ? new Rectangle(-16 * 32, -16 * 32, 32 * 32, 32 * 32)
            : this.getBlueprintBounds()

        this.viewport.centerViewPort(
            {
                x: bounds.width,
                y: bounds.height,
            },
            {
                x: (this.size.x - bounds.width) / 2 - bounds.x,
                y: (this.size.y - bounds.height) / 2 - bounds.y,
            }
        )
    }

    public getBlueprintBounds(): Rectangle {
        const rect = this.entitySprites
            .getLocalBounds()
            .rectangle.enlarge(this.tileSprites.getLocalBounds().rectangle)

        const X = Math.floor(rect.x / 32) * 32
        const Y = Math.floor(rect.y / 32) * 32
        const W = Math.ceil((rect.width + rect.x - X) / 32) * 32
        const H = Math.ceil((rect.height + rect.y - Y) / 32) * 32
        rect.x = X
        rect.y = Y
        rect.width = W
        rect.height = H

        return rect
    }

    public getPicture(): Promise<Blob> {
        if (this.bp.isEmpty()) return

        const frame = this.getBlueprintBounds()
        const texture = G.app.renderer.generateTexture({
            target: this,
            frame,
            resolution: 1,
            textureSourceOptions: {
                scaleMode: 'linear',
            },
        })

        const canvas = G.app.renderer.extract.canvas(texture)

        return new Promise(resolve => {
            canvas.toBlob(blob => {
                texture.destroy(true)
                resolve(blob)
            })
        })
    }

    public spawnPaintContainer(itemNameOrEntities: string | Entity[], direction = 0): void {
        if (this.mode === EditorMode.PAINT) {
            this.paintContainer.destroy()
        }

        this.updateHoverContainer(true)
        this.setMode(EditorMode.PAINT)
        this.cursor = 'pointer'
        // Fresh cursor: the first touch tap should position, not commit; and a
        // held item supersedes any pending entity-edit selection.
        this.lastPaintTapTile = undefined
        this.lastEditTapEntity = undefined

        try {
            if (typeof itemNameOrEntities === 'string') {
                const itemData = FD.items[itemNameOrEntities]
                if (!itemData) throw new Error(`Item data not found: ${itemNameOrEntities}`)

                const wireResult =
                    WiresPanel.Wires.includes(itemNameOrEntities) && itemNameOrEntities
                const tileResult = itemData.place_as_tile && itemData.place_as_tile.result
                const placeResult = itemData.place_result || tileResult || wireResult

                if (!placeResult) throw new Error(`No place result for item: ${itemNameOrEntities}`)

                if (wireResult) {
                    this.paintContainer = this.wirePaintSlot.addChild(
                        new PaintWireContainer(this, placeResult)
                    )
                } else if (tileResult) {
                    this.paintContainer = this.tilePaintSlot.addChild(
                        new PaintTileContainer(this, placeResult)
                    )
                } else {
                    this.paintContainer = this.entityPaintSlot.addChild(
                        new PaintEntityContainer(this, placeResult, direction)
                    )
                }
            } else {
                this.paintContainer = this.entityPaintSlot.addChild(
                    new PaintBlueprintContainer(this, itemNameOrEntities)
                )
            }
        } catch (e) {
            console.error('Failed to create paint container:', e)
            this.setMode(EditorMode.NONE)
            this.cursor = 'inherit'
            return
        }

        if (!this.isPointerInside) {
            this.paintContainer.hide()
        }

        this.paintContainer.on('destroyed', () => {
            this.paintContainer = undefined
            this.setMode(EditorMode.NONE)
            this.updateHoverContainer()
            this.cursor = 'inherit'
        })
    }
}
