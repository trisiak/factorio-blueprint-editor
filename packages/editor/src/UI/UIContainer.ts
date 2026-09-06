import { Container } from 'pixi.js'
import { Entity } from '../core/Entity'
import { DebugContainer } from './DebugContainer'
import { QuickbarPanel } from './QuickbarPanel'
import { buildEntityInfo } from './entityInfo'
import { InventoryDialog, SlotClear } from './InventoryDialog'
import { SignalPicker, SignalChoice } from './SignalPicker'
import { NumericKeypad } from './NumericKeypad'
import { RatesModel } from './ratesModel'
import { Editor } from './editors/Editor'
import { createEditor } from './editors/factory'

export class UIContainer extends Container {
    private debugContainer: DebugContainer
    public quickbarPanel: QuickbarPanel
    /**
     * The rates readout's state holder. Not a display object any more (#101
     * Slice 5): both status readouts present as DOM now, so what the editor
     * keeps is the toggle state, the live-recompute subscriptions and the
     * projection it dispatches — see `ratesModel.ts`.
     */
    private ratesModel: RatesModel
    private dialogsContainer: Container
    private paintIconContainer: Container

    public constructor() {
        super()

        this.debugContainer = new DebugContainer()
        this.quickbarPanel = new QuickbarPanel(2)
        this.ratesModel = new RatesModel()
        this.dialogsContainer = new Container()
        this.paintIconContainer = new Container()

        this.addChild(
            this.debugContainer,
            this.quickbarPanel,
            this.dialogsContainer,
            this.paintIconContainer
        )
    }

    /**
     * Publish the hovered/selected entity to the DOM entity-info sheet, which
     * presents it for **every** input (#101 Slice 5 — the Pixi panel that used
     * to draw this on desktop is retired). The sheet gets a render-free data
     * projection over a window event, the same DOM/canvas bridge pattern as
     * `fbe:viewportchange`; `undefined` clears it.
     */
    public updateEntityInfo(entity?: Entity): void {
        window.dispatchEvent(
            new CustomEvent('fbe:entityinfo', {
                detail: entity ? buildEntityInfo(entity) : null,
            })
        )
    }

    /** Toggle the blueprint-wide production rates readout (`showRates` action). */
    public toggleRatesPanel(): void {
        this.ratesModel.toggle()
    }

    /** Whether the rates readout is open (logical state; the drawer follows it). */
    public get ratesShown(): boolean {
        return this.ratesModel.shown
    }

    /** Let state holders tracking `G.bp` re-attach after `loadBlueprint` swaps it. */
    public onBlueprintSwapped(): void {
        this.ratesModel.onBlueprintSwapped()
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
        onConfirm: (value: number) => void
    ): NumericKeypad {
        const pad = new NumericKeypad(title, initial, onConfirm)
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
