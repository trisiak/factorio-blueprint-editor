import { Container, Graphics, Text } from 'pixi.js'
import FD from '../core/factorioData'
import { ISignal, SignalType } from '../types'
import { TextInput } from './controls/TextInput'
import G from '../common/globals'
import F from './controls/functions'
import { Button } from './controls/Button'
import { Dialog } from './controls/Dialog'
import { styles } from './style'

type Category = 'item' | 'fluid' | 'virtual'

/** What the picker resolves to: a signal, or (for combinator operands) a constant. */
export interface SignalChoice {
    signal?: ISignal
    constant?: number
}

/**
 * Signal selection dialog for circuit editing. Unlike the item-only
 * `InventoryDialog` (driven by `inventoryLayout`, so it can't show fluids or
 * virtual signals), this presents the full signal universe — items, fluids and
 * virtual signals — read live from `FD`, so it adapts to whatever data pack is
 * active (mod-safe by construction).
 *
 * Styled to match `InventoryDialog`: a selection is *previewed* (highlighted +
 * its name shown in the bottom bar) and only committed via **✓ Confirm** — so
 * picking always takes a deliberate confirm, consistent with the inventory
 * dialog. Combinator operands additionally get a Constant field in that bar
 * (Factorio puts the constant in the same chooser), which is why the operand
 * itself is a single slot rather than a slot + inline number box.
 */
export class SignalPicker extends Dialog {
    private static readonly W = 404
    private static readonly H = 500
    private static readonly PAD = 12
    private static readonly TAB_Y = 40
    private static readonly GRID_Y = 84
    private static readonly STEP = 38
    private static readonly BAR_Y = SignalPicker.H - 40

    private readonly viewW = SignalPicker.W - SignalPicker.PAD * 2 - 24
    private readonly viewH = SignalPicker.BAR_Y - SignalPicker.GRID_Y - 8

    private readonly grid = new Container()
    private scroll = 0
    private maxScroll = 0

    private preview: SignalChoice = {}
    private selectedButton?: Button
    private readonly nameLabel: Text
    private readonly confirmBtn: Container
    private constantInput?: TextInput

    public constructor(
        title: string,
        private readonly onConfirm: (choice: SignalChoice) => void,
        private readonly allowSpecial = true,
        private readonly allowConstant = false
    ) {
        super(SignalPicker.W, SignalPicker.H, title)

        const cols = Math.floor(this.viewW / SignalPicker.STEP)

        // Category tabs
        const cats: { id: Category; label: string }[] = [
            { id: 'item', label: 'Items' },
            { id: 'fluid', label: 'Fluids' },
            { id: 'virtual', label: 'Signals' },
        ]
        const tabButtons: Button<Category>[] = []
        cats.forEach((cat, i) => {
            const tab = new Button<Category>(112, 34)
            tab.data = cat.id
            const label = new Text({ text: cat.label, style: styles.dialog.label })
            label.anchor.set(0.5)
            tab.content = label
            tab.position.set(SignalPicker.PAD + i * 116, SignalPicker.TAB_Y)
            tab.on('pointertap', () => this.showCategory(cat.id, tabButtons, tab, cols))
            this.addChild(tab)
            tabButtons.push(tab)
        })

        // Scrollable masked viewport for the icon grid
        this.grid.position.set(SignalPicker.PAD, SignalPicker.GRID_Y)
        const mask = new Graphics()
            .rect(SignalPicker.PAD, SignalPicker.GRID_Y, this.viewW, this.viewH)
            .fill(0xffffff)
        this.addChild(mask)
        this.grid.mask = mask
        this.addChild(this.grid)

        // Scroll arrows — same look as InventoryDialog's arrow buttons.
        const up = SignalPicker.arrowButton('▲', () => this.scrollBy(-SignalPicker.STEP * 3))
        up.position.set(SignalPicker.W - SignalPicker.PAD - 22, SignalPicker.GRID_Y)
        const down = SignalPicker.arrowButton('▼', () => this.scrollBy(SignalPicker.STEP * 3))
        down.position.set(
            SignalPicker.W - SignalPicker.PAD - 22,
            SignalPicker.GRID_Y + this.viewH - 22
        )
        this.addChild(up, down)

        // Bottom bar: preview name (left), optional constant field, ✓ Confirm (right).
        this.nameLabel = new Text({ text: '', style: styles.dialog.label })
        this.nameLabel.position.set(SignalPicker.PAD, SignalPicker.BAR_Y + 6)
        this.addChild(this.nameLabel)

        if (this.allowConstant) {
            this.constantInput = new TextInput(G.app.renderer, 64, '', 12)
            this.constantInput.restrict = /^-?\d*$/
            this.constantInput.position.set(SignalPicker.W - 180, SignalPicker.BAR_Y + 6)
            this.constantInput.on('changed', () => this.onConstantTyped())
            this.addChild(this.constantInput)
        }

        this.confirmBtn = SignalPicker.barButton('✓ Confirm', 0x2f7d32, () => this.confirm())
        this.confirmBtn.position.set(SignalPicker.W - SignalPicker.PAD - 80, SignalPicker.BAR_Y + 2)
        this.confirmBtn.visible = false
        this.addChild(this.confirmBtn)

        this.eventMode = 'static'
        this.on('wheel', e => {
            e.preventDefault?.()
            this.scrollBy(Math.sign((e as WheelEvent).deltaY) * SignalPicker.STEP)
        })

        this.showCategory('item', tabButtons, tabButtons[0], cols)
    }

    private static arrowButton(glyph: string, onTap: () => void): Container {
        const c = new Container()
        const bg = new Graphics().roundRect(0, 0, 22, 22, 3).fill({ color: 0x202225, alpha: 0.9 })
        const t = new Text({ text: glyph, style: { fill: 0xffffff, fontSize: 15 } })
        t.anchor.set(0.5)
        t.position.set(11, 11)
        c.addChild(bg, t)
        c.eventMode = 'static'
        c.cursor = 'pointer'
        c.on('pointertap', onTap)
        return c
    }

    private static barButton(label: string, color: number, onTap: () => void): Container {
        const c = new Container()
        const bg = new Graphics().roundRect(0, 0, 80, 26, 4).fill(color)
        const t = new Text({
            text: label,
            style: {
                fontFamily: "'Roboto', sans-serif",
                fontSize: 13,
                fontWeight: 'bold',
                fill: 0xffffff,
            },
        })
        t.anchor.set(0.5)
        t.position.set(40, 13)
        c.addChild(bg, t)
        c.eventMode = 'static'
        c.cursor = 'pointer'
        c.on('pointertap', onTap)
        return c
    }

    private static nameOf(name: string): string {
        const ln =
            FD.items[name]?.localised_name ??
            FD.fluids[name]?.localised_name ??
            FD.signals[name]?.localised_name
        return typeof ln === 'string' ? ln : name
    }

    private scrollBy(dy: number): void {
        this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + dy))
        this.grid.position.y = SignalPicker.GRID_Y - this.scroll
    }

    private selectSignal(name: string, type: Category, button: Button): void {
        if (this.selectedButton) this.selectedButton.active = false
        this.selectedButton = button
        button.active = true
        if (this.constantInput) this.constantInput.text = ''
        this.preview = { signal: { name, type: type as SignalType } }
        this.nameLabel.text = SignalPicker.nameOf(name)
        this.confirmBtn.visible = true
    }

    private onConstantTyped(): void {
        if (this.selectedButton) {
            this.selectedButton.active = false
            this.selectedButton = undefined
        }
        const text = this.constantInput!.text
        if (text === '' || text === '-') {
            this.preview = {}
            this.nameLabel.text = ''
            this.confirmBtn.visible = false
            return
        }
        this.preview = { constant: parseInt(text, 10) }
        this.nameLabel.text = `Constant: ${this.preview.constant}`
        this.confirmBtn.visible = true
    }

    private confirm(): void {
        if (this.preview.signal === undefined && this.preview.constant === undefined) return
        this.onConfirm(this.preview)
        this.close()
    }

    private showCategory(
        cat: Category,
        tabs: Button<Category>[],
        active: Button<Category>,
        cols: number
    ): void {
        for (const t of tabs) t.active = t === active
        this.selectedButton = undefined

        for (const c of this.grid.removeChildren()) c.destroy()
        this.scroll = 0
        this.grid.position.y = SignalPicker.GRID_Y

        const names = SignalPicker.namesFor(cat, this.allowSpecial)
        names.forEach((name, i) => {
            const button = new Button(36, 36)
            try {
                button.content = F.CreateIcon(name)
            } catch {
                const t = new Text({ text: name.slice(0, 3), style: styles.dialog.label })
                t.anchor.set(0.5)
                button.content = t
            }
            button.position.set(
                (i % cols) * SignalPicker.STEP,
                Math.floor(i / cols) * SignalPicker.STEP
            )
            button.on('pointertap', () => this.selectSignal(name, cat, button))
            this.grid.addChild(button)
        })

        const rows = Math.ceil(names.length / cols)
        this.maxScroll = Math.max(0, rows * SignalPicker.STEP - this.viewH)
    }

    /** Build the ordered name list for a category from the active data pack. */
    private static namesFor(cat: Category, allowSpecial: boolean): string[] {
        if (cat === 'fluid') return Object.keys(FD.fluids)
        if (cat === 'virtual') {
            const special = new Set(['signal-each', 'signal-everything', 'signal-anything'])
            return Object.keys(FD.signals).filter(n => allowSpecial || !special.has(n))
        }
        const seen = new Set<string>()
        const out: string[] = []
        for (const group of FD.inventoryLayout) {
            if (group.name === 'creative') continue
            const subgroups = Array.isArray(group.subgroups) ? group.subgroups : []
            for (const subgroup of subgroups) {
                const items = Array.isArray(subgroup.items) ? subgroup.items : []
                for (const item of items) {
                    if (FD.items[item.name] && !seen.has(item.name)) {
                        seen.add(item.name)
                        out.push(item.name)
                    }
                }
            }
        }
        for (const name of Object.keys(FD.items)) {
            if (!seen.has(name)) out.push(name)
        }
        return out
    }
}
