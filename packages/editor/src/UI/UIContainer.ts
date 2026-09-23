import { Container } from 'pixi.js'
import { Entity } from '../core/Entity'
import G from '../common/globals'
import { inputMode } from '../common/input'
import { DebugContainer } from './DebugContainer'
import { QuickbarPanel } from './QuickbarPanel'
import { buildEntityInfo } from './entityInfo'
import { InventoryDialog, SlotClear } from './InventoryDialog'
import { SignalPicker, SignalChoice } from './SignalPicker'
import { NumericKeypad } from './NumericKeypad'
import { RatesModel } from './ratesModel'
import { Editor } from './editors/Editor'
import { createEditor, editorKindFor, EditorKind } from './editors/factory'

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

    /**
     * Entity kinds whose DOM editor has shipped (#98 Slice 2 →): on mobile
     * these route to the website's DOM editor instead of the Pixi one. Grows
     * kind by kind as the migration slices land. 'temp' is the generic
     * crafting-machine form (furnaces, refineries, chem plants, and every
     * modded/expansion machine the name switch doesn't know) — same
     * recipe+modules shape as 'machine', gated by `Entity.hasRecipeSlot`.
     */
    private static readonly DOM_EDITOR_KINDS: ReadonlySet<EditorKind> = new Set(['machine', 'temp'])

    /** @returns The created editor, or undefined if the entity has none. */
    public createEditor(entity: Entity): Editor | undefined {
        const editor = createEditor(entity)
        if (editor) {
            this.dialogsContainer.addChild(editor)
        }
        return editor
    }

    /**
     * Open `entity`'s editor — THE entry point (the EDIT bar / double-click /
     * the `?test` probe), one presentation per input mode (#98): kinds whose
     * DOM editor has shipped present in DOM on mobile (handed off over
     * `fbe:openentityeditor`, carrying the live Entity — same JS runtime);
     * everything else, and all of desktop, keeps the Pixi editor.
     * @returns Whether an editor opened (false = the entity has none).
     */
    public openEntityEditor(entity: Entity): boolean {
        const kind = editorKindFor(entity)
        if (kind === undefined) return false
        if (inputMode.mode === 'mobile' && UIContainer.DOM_EDITOR_KINDS.has(kind)) {
            window.dispatchEvent(new CustomEvent('fbe:openentityeditor', { detail: { entity } }))
            return true
        }
        return this.createEditor(entity) !== undefined
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

    /**
     * Open the *main* item selector — the E-key / rail "Items" surface, whose
     * pick lands on the cursor as a paint ghost. One entry, one presentation
     * per input mode (#98): desktop keeps the Pixi InventoryDialog; mobile
     * hands off to the website's DOM selector over `fbe:openinventory` (the
     * same bridge pattern as `fbe:entityinfo`), passing an optional item to
     * open pre-previewed (the storyboard/test path). The editor-embedded
     * pickers (recipe/module/filter slots) still call createInventory directly
     * — they migrate with their editors, not before.
     */
    public openMainInventory(preview?: string): void {
        if (inputMode.mode === 'mobile') {
            window.dispatchEvent(new CustomEvent('fbe:openinventory', { detail: { preview } }))
            return
        }
        const inv = this.createInventory(
            'Inventory',
            undefined,
            G.BPC.spawnPaintContainer.bind(G.BPC),
            'items'
        )
        if (preview) inv.beginPreview(preview)
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
