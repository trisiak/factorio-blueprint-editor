import { Container, Graphics, Text } from 'pixi.js'
import FD from '../core/factorioData'
import { ISignal, SignalType } from '../types'
import F from './controls/functions'
import { Button } from './controls/Button'
import { Dialog } from './controls/Dialog'
import { styles } from './style'

type Category = 'item' | 'fluid' | 'virtual'

/**
 * Signal selection dialog for circuit editing. Unlike the item-only
 * `InventoryDialog` (which is driven by `inventoryLayout` and so can't show
 * fluids or virtual signals), this presents the full signal universe — items,
 * fluids and virtual signals — read live from `FD`, so it adapts to whatever the
 * active data pack defines (mod-safe by construction).
 *
 * Touch-first: big 36px tap targets, a scrollable masked grid driven by both the
 * mouse wheel and explicit ▲/▼ buttons (no keyboard or precise drag needed), and
 * it scales to narrow viewports via the base `Dialog` fit-to-width logic.
 */
export class SignalPicker extends Dialog {
    private static readonly W = 404
    private static readonly H = 470
    private static readonly PAD = 12
    private static readonly TAB_Y = 40
    private static readonly TAB_H = 34
    private static readonly GRID_Y = 84
    private static readonly STEP = 38

    private readonly viewW = SignalPicker.W - SignalPicker.PAD * 2 - 24 // leave room for arrows
    private readonly viewH = SignalPicker.H - SignalPicker.GRID_Y - SignalPicker.PAD

    private readonly grid = new Container()
    private scroll = 0
    private maxScroll = 0

    /**
     * @param title - dialog header
     * @param onSelect - called with the chosen signal `{ name, type }`
     * @param allowSpecial - include the combinator-only `each`/`everything`/
     *   `anything` virtual signals (valid for combinators, not constant combinators)
     */
    public constructor(
        title: string,
        private readonly onSelect: (signal: ISignal) => void,
        private readonly allowSpecial = true
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
            const tab = new Button<Category>(112, SignalPicker.TAB_H)
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

        // Scroll arrows
        const up = this.arrow('▲', () => this.scrollBy(-SignalPicker.STEP * 3))
        up.position.set(SignalPicker.W - SignalPicker.PAD - 22, SignalPicker.GRID_Y)
        const down = this.arrow('▼', () => this.scrollBy(SignalPicker.STEP * 3))
        down.position.set(
            SignalPicker.W - SignalPicker.PAD - 22,
            SignalPicker.GRID_Y + this.viewH - 22
        )
        this.addChild(up, down)

        // Wheel scrolling over the body
        this.eventMode = 'static'
        this.on('wheel', e => {
            e.preventDefault?.()
            this.scrollBy(Math.sign((e as WheelEvent).deltaY) * SignalPicker.STEP)
        })

        this.showCategory('item', tabButtons, tabButtons[0], cols)
    }

    private arrow(glyph: string, onTap: () => void): Button {
        const b = new Button(22, 22)
        const t = new Text({ text: glyph, style: styles.dialog.label })
        t.anchor.set(0.5)
        b.content = t
        b.on('pointertap', onTap)
        return b
    }

    private scrollBy(dy: number): void {
        this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + dy))
        this.grid.position.y = SignalPicker.GRID_Y - this.scroll
    }

    private showCategory(
        cat: Category,
        tabs: Button<Category>[],
        active: Button<Category>,
        cols: number
    ): void {
        for (const t of tabs) t.active = t === active

        for (const c of this.grid.removeChildren()) c.destroy()
        this.scroll = 0
        this.grid.position.y = SignalPicker.GRID_Y

        const names = SignalPicker.namesFor(cat, this.allowSpecial)
        names.forEach((name, i) => {
            const button = new Button(36, 36)
            // Some names can lack an icon in oddly-shaped modded dumps; guard so
            // one bad entry can't blank the whole picker.
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
            button.on('pointertap', () => {
                this.onSelect({ name, type: cat as SignalType })
                this.close()
            })
            this.grid.addChild(button)
        })

        const rows = Math.ceil(names.length / cols)
        const gridH = rows * SignalPicker.STEP
        this.maxScroll = Math.max(0, gridH - this.viewH)
    }

    /** Build the ordered name list for a category from the active data pack. */
    private static namesFor(cat: Category, allowSpecial: boolean): string[] {
        if (cat === 'fluid') return Object.keys(FD.fluids)
        if (cat === 'virtual') {
            const special = new Set(['signal-each', 'signal-everything', 'signal-anything'])
            return Object.keys(FD.signals).filter(n => allowSpecial || !special.has(n))
        }
        // Items, in inventory/group order, then any stragglers not in a group.
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
