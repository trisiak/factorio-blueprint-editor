import EventEmitter from 'eventemitter3'
import { EditorMode } from '../containers/BlueprintContainer'
import G from '../common/globals'

/**
 * The quickbar's slot model — persistence, key binding, pin/unpin and the
 * activation rules, with **no renderer** (#101 Slice 5).
 *
 * The quickbar used to be a Pixi panel pinned to the bottom of the canvas, and
 * it was desktop-only: touch users got the rail's Items dialog instead. The
 * panel is retired and the website renders one DOM quickbar for every input
 * (`packages/website/src/quickbar.ts`), so what the editor keeps is exactly the
 * state and the rules — which slot holds what, what a number key or an
 * activation does — and a `change` event the view follows.
 *
 * The slot array is flat; rows are a presentation detail (10 per row, as in the
 * game, and `changeActiveQuickbar` rotates the array by one row so the number
 * keys always address the visible ten).
 */

/** Slots in one row — the ten the number keys 1…0 address. */
export const SLOTS_PER_ROW = 10

interface QuickbarEvents {
    /** Any slot changed (assign / clear / restore / row rotation). */
    change: []
}

export class QuickbarModel extends EventEmitter<QuickbarEvents> {
    private readonly m_rows: number
    private slots: (string | undefined)[]

    public constructor(rows = 2, itemNames?: string[]) {
        super()
        this.m_rows = rows
        this.slots = new Array<string | undefined>(rows * SLOTS_PER_ROW).fill(undefined)
        if (itemNames) this.generateSlots(itemNames)
    }

    public get rows(): number {
        return this.m_rows
    }

    public get size(): number {
        return this.slots.length
    }

    /** Slot contents, index-aligned (`undefined` = empty). */
    public serialize(): (string | undefined)[] {
        return [...this.slots]
    }

    public itemAt(index: number): string | undefined {
        return this.slots[index]
    }

    /**
     * Replace every slot from `itemNames` (persistence restore, and the
     * `Editor.quickbarItems` setter the website loads `quickbarItemNames` with).
     * Extra names are dropped; missing ones leave the slot empty.
     */
    public generateSlots(itemNames?: string[]): void {
        this.slots = this.slots.map((_, i) => itemNames?.[i] || undefined)
        this.emit('change')
    }

    /** Assign `itemName` to `index`. 'blueprint' is not a pinnable item. */
    public assign(index: number, itemName: string): void {
        if (itemName === 'blueprint') return
        if (index < 0 || index >= this.slots.length) return
        this.slots[index] = itemName
        this.emit('change')
    }

    public clear(index: number): void {
        if (this.slots[index] === undefined) return
        this.slots[index] = undefined
        this.emit('change')
    }

    /** Whether `name` is currently in any slot. */
    public hasItem(name: string): boolean {
        return this.slots.includes(name)
    }

    /** Pin `name` to the first empty slot (no-op if already present / full). */
    public addItem(name: string): boolean {
        if (this.hasItem(name)) return true
        const empty = this.slots.indexOf(undefined)
        if (empty === -1) return false
        this.assign(empty, name)
        return true
    }

    /** Unpin every slot holding `name`. */
    public removeItem(name: string): void {
        let changed = false
        this.slots = this.slots.map(n => {
            if (n !== name) return n
            changed = true
            return undefined
        })
        if (changed) this.emit('change')
    }

    /**
     * What a click / tap on slot `index` does. Unchanged from the Pixi panel —
     * these five cases are the quickbar's contract:
     *
     * - UC1: painting + empty slot   → pin what's held to the slot
     * - UC2: painting + filled slot  → hold that item instead…
     * - UC2.5: …unless it's the same item, which drops the cursor (a toggle)
     * - UC3: idle + empty slot       → open the inventory to fill the slot
     * - UC4: idle + filled slot      → hold the slot's item
     *
     * (UC5, clearing, is `clear()` — right-click or long-press in the view.)
     */
    public activate(index: number): void {
        const itemName = this.slots[index]
        if (G.BPC.mode === EditorMode.PAINT) {
            if (itemName) {
                if (itemName === G.BPC.paintContainer.getItemName()) {
                    G.BPC.paintContainer.destroy() // UC2.5
                } else {
                    G.BPC.spawnPaintContainer(itemName) // UC2
                }
            } else {
                this.assign(index, G.BPC.paintContainer.getItemName()) // UC1
            }
        } else if (itemName) {
            G.BPC.spawnPaintContainer(itemName) // UC4
        } else {
            // UC3 — an empty slot has nothing to clear, so no ✕ Clear button.
            G.UI.createInventory('Inventory', undefined, item => this.assign(index, item), 'items')
        }
    }

    /**
     * The number keys 1…0. Unlike `activate` this never opens a dialog and never
     * pins: an empty slot is simply a no-op, and pressing the key of the item
     * you're already holding drops it.
     */
    public bindKeyToSlot(index: number): void {
        const itemName = this.slots[index]
        if (!itemName) return

        if (G.BPC.mode === EditorMode.PAINT && G.BPC.paintContainer.getItemName() === itemName) {
            G.BPC.paintContainer.destroy()
            return
        }
        G.BPC.spawnPaintContainer(itemName)
    }

    /**
     * Rotate the rows: the second row becomes the first, so the number keys
     * (which always address slots 0…9) reach the next ten items. This is what
     * the Pixi panel's little triangle button did, and what the DOM view's swap
     * button does — it also lets a `compact` layout show one row's worth of
     * slots and still reach every item.
     */
    public changeActiveQuickbar(): void {
        this.slots = this.slots.concat(this.slots.splice(0, SLOTS_PER_ROW))
        this.emit('change')
    }
}
