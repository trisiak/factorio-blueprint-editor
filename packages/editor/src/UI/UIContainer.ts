import { Container } from 'pixi.js'
import { Entity } from '../core/Entity'
import { inputMode } from '../common/input'
import { DebugContainer } from './DebugContainer'
import { QuickbarPanel } from './QuickbarPanel'
import { EntityInfoPanel, buildEntityInfo } from './EntityInfoPanel'
import { InventoryDialog, SlotClear } from './InventoryDialog'
import { SignalPicker, SignalChoice } from './SignalPicker'
import { NumericKeypad } from './NumericKeypad'
import { WiresPanel } from './WiresPanel'
import { RatesPanel } from './RatesPanel'
import { Editor } from './editors/Editor'
import { createEditor } from './editors/factory'

export class UIContainer extends Container {
    private debugContainer: DebugContainer
    public quickbarPanel: QuickbarPanel
    public wiresPanel: WiresPanel
    private entityInfoPanel: EntityInfoPanel
    private ratesPanel: RatesPanel
    private dialogsContainer: Container
    private paintIconContainer: Container

    public constructor() {
        super()

        this.debugContainer = new DebugContainer()
        this.quickbarPanel = new QuickbarPanel(2)
        this.wiresPanel = new WiresPanel()
        this.entityInfoPanel = new EntityInfoPanel()
        this.ratesPanel = new RatesPanel()
        this.dialogsContainer = new Container()
        this.paintIconContainer = new Container()

        this.addChild(
            this.debugContainer,
            this.quickbarPanel,
            this.wiresPanel,
            this.entityInfoPanel,
            this.ratesPanel,
            this.dialogsContainer,
            this.paintIconContainer
        )
    }

    public updateEntityInfoPanel(entity?: Entity): void {
        // Desktop shows the canvas panel; mobile shows the website's DOM
        // bottom sheet (#89 Phase 2) — one presentation per input mode, same
        // signal. The sheet gets a render-free data projection over a window
        // event (the same DOM/canvas bridge pattern as `fbe:viewportchange`),
        // dispatched in both modes so a live mode switch has fresh data ready.
        this.entityInfoPanel.updateVisualization(inputMode.mode === 'desktop' ? entity : undefined)
        window.dispatchEvent(
            new CustomEvent('fbe:entityinfo', {
                detail: entity ? buildEntityInfo(entity) : null,
            })
        )
    }

    /** Whether the top-right entity info panel is currently shown (for e2e). */
    public get entityInfoPanelVisible(): boolean {
        return this.entityInfoPanel.visible
    }

    /**
     * Screen-space bounds of the entity info panel (CSS px, canvas-relative),
     * or null while hidden — backs the top-band e2e ratchet (#89): the panel
     * anchors to the canvas top, so with the top inset reserved its viewport
     * position must clear the DOM chrome above the canvas.
     */
    public entityInfoPanelBounds(): { x: number; y: number; width: number; height: number } | null {
        if (!this.entityInfoPanel.visible) return null
        const r = this.entityInfoPanel.getBounds().rectangle
        return { x: r.x, y: r.y, width: r.width, height: r.height }
    }

    /** Toggle the blueprint-wide production rates panel (`showRates` action). */
    public toggleRatesPanel(): void {
        this.ratesPanel.toggle()
    }

    /**
     * Whether the rates readout is open (for e2e) — logical state, true in
     * either presentation (desktop canvas panel / mobile DOM drawer).
     */
    public get ratesPanelVisible(): boolean {
        return this.ratesPanel.shown
    }

    /** The rates panel's rendered text lines, top to bottom (for e2e). */
    public ratesPanelLines(): string[] {
        return this.ratesPanel.textLines
    }

    /** Screen-space center of the rates panel's ✕ (null while hidden; for e2e). */
    public ratesPanelClosePos(): { x: number; y: number } | null {
        return this.ratesPanel.closeButtonPosition()
    }

    /** Let panels tracking `G.bp` re-attach after `loadBlueprint` swaps it. */
    public onBlueprintSwapped(): void {
        this.ratesPanel.onBlueprintSwapped()
    }

    public addPaintIcon(icon: Container): void {
        this.paintIconContainer.addChild(icon)
    }

    public set showDebuggingLayer(visible: boolean) {
        this.debugContainer.visible = visible
    }

    /** @returns The created editor, or undefined if the entity has none. */
    public createEditor(entity: Entity): Editor | undefined {
        const editor = createEditor(entity)
        if (editor) {
            this.dialogsContainer.addChild(editor)
        }
        return editor
    }

    /**
     * @param clear - Pass when the dialog is opened *from a slot*: it draws the
     * escape-hatch button that empties that slot and closes ("✕ Clear" when the
     * slot holds something, "✕ Cancel" when it doesn't). Omit it when there is no
     * originating slot (e.g. the generic quickbar inventory) so no button is drawn.
     */
    public createInventory(
        title?: string,
        itemsFilter?: string[],
        selectedCallBack?: (selectedItem: string) => void,
        recentsKey?: string,
        clear?: SlotClear
    ): InventoryDialog {
        const inv = new InventoryDialog(title, itemsFilter, selectedCallBack, recentsKey, clear)
        this.dialogsContainer.addChild(inv)
        return inv
    }

    public createSignalPicker(
        title: string,
        onConfirm: (choice: SignalChoice) => void,
        allowSpecial = true,
        allowConstant = false
    ): SignalPicker {
        const picker = new SignalPicker(title, onConfirm, allowSpecial, allowConstant)
        this.dialogsContainer.addChild(picker)
        return picker
    }

    public createNumericKeypad(
        title: string,
        initial: number | undefined,
        onConfirm: (value: number) => void,
        allowNegative = true
    ): NumericKeypad {
        const pad = new NumericKeypad(title, initial, onConfirm, allowNegative)
        this.dialogsContainer.addChild(pad)
        return pad
    }

    // public changeQuickbarRows(rows: number): void {
    //     const itemNames = this.quickbarPanel.serialize()
    //     this.quickbarPanel.destroy()
    //     this.quickbarPanel = new QuickbarContainer(rows, itemNames)

    //     const index = this.getChildIndex(this.quickbarPanel)
    //     this.addChildAt(this.quickbarPanel, index)
    // }
}
