import { Container, Graphics, Text } from 'pixi.js'
import FD, { namesMissingFromInventoryLayout } from '../core/factorioData'
import G from '../common/globals'
import { inputMode } from '../common/input'
import F from './controls/functions'
import { Dialog } from './controls/Dialog'
import { Button } from './controls/Button'
import { fitToWidthScale } from './quickbarLayout'
import { isItemTappable, maxItemScroll } from './inventoryScroll'
import { getRecents, recordRecent } from './recentItems'
import { colors, styles } from './style'

/*
    Cols
    Space   @ 0     +12              ->12
    Items   @ 12    +(10*(36+2))     ->392
    Space   @ 392   +12              ->404
    Width : 12 + (10 * (36 + 2)) + 12 = 404

    Rows
    Space   @ 0   +10                ->10
    Title   @ 10  +24                ->34
    Space   @ 34  +12                ->46
    Groups  @ 46  +68                ->114
    Space   @ 114 +12                ->126
    Items   @ 126 +(8*(36+2))        ->430
    Space   @ 430 +12                ->442
    Height : 10 + 24 + 12 + 68 + 12 + (8*(36+2)) + 12 = 442

    Space   @ 0   +10                ->10
    R.Label @ 10  +16                ->26
    Space   @ 26  +10                ->36
    R.Data  @ 36  +36                ->72
    Space   @ 8   +8                 ->78
    Height : 10 + 16 + 10 + 36 + 8 = 78
*/

type InventoryItems = Container<Button<Container>>

/**
 * Wiring for the selector's escape-hatch button, passed when the dialog is
 * opened *from a slot* (so the generic quickbar inventory, which has no
 * originating slot, omits it and draws no button).
 *
 * `filled` only picks the label — "✕ Clear" vs "✕ Cancel". The action is the
 * same either way: empty the slot, then close. On an already-empty slot that
 * makes it a plain cancel.
 */
export interface SlotClear {
    onClear: () => void
    filled: boolean
}

/** Inventory Dialog - Displayed to the user if there is a need to select an item */
export class InventoryDialog extends Dialog {
    /** Container for Inventory Group Buttons */
    private readonly m_InventoryGroups: Container<Button<InventoryItems>>

    /** Container for Inventory Group Items */
    private readonly m_InventoryItems: Container<InventoryItems>

    /** Text for Recipe Tooltip */
    private readonly m_RecipeLabel: Text

    /** Container for Recipe Tooltip */
    private readonly m_RecipeContainer: Container

    /** Hovered item for item pointerout check */
    private m_hoveredItem: string

    // Scroll state. The group-tab row scrolls horizontally and the active item
    // grid vertically, each masked to its viewport and driven by arrow buttons.
    // The body width is responsive (see computeWidth), so the tab scroll only
    // engages when the tabs genuinely don't fit the screen.
    private static readonly TAB_H = 68
    private static readonly ITEMS_H = 304
    /** Item grid columns, derived from the (responsive) body width. */
    private m_cols = 10
    private m_tabScroll = 0
    private m_itemScroll = 0
    private m_tabArrows?: { left: Container; right: Container; max: number }
    private m_itemArrows?: { up: Container; down: Container }

    /** Inner content/viewport width = body width minus the 12px side margins. */
    private get viewW(): number {
        return this.width - 24
    }

    // Long-press preview state + the bottom Confirm / Pin bar it reveals.
    private m_itemsFilter?: string[]
    private m_selectedCallBack?: (name: string) => void
    private m_recentsKey?: string
    private m_recentsContainer?: Container
    private m_previewName?: string
    private m_previewButton?: Button<Container>
    private m_pressTimer?: ReturnType<typeof setTimeout>
    private m_confirmBtn?: Container
    private m_pinBtn?: Container
    private m_pinText?: Text
    private m_clearCallBack?: () => void
    private m_clearBtn?: Container
    private m_clearText?: Text
    /**
     * Whether a quick tap commits outright on touch, skipping the usual
     * tap-to-preview → ✓ Confirm two-step.
     *
     * On for the **module** selector. Filling a machine's module slots means
     * opening this dialog once per slot, and the confirm step doubles the taps
     * for a choice that's a handful of near-identical icons — you know which
     * module you want before the dialog opens. Paired with "✕ Clear" (which also
     * acts without confirmation) it makes every exit one tap: take a module, or
     * empty the slot. The misclick risk the confirm step buys elsewhere isn't
     * worth it here, since re-tapping the slot just corrects the choice.
     *
     * Long-press still previews, so the details are a hold away either way.
     */
    private readonly m_commitOnTap: boolean

    public constructor(
        title = 'Inventory',
        itemsFilter?: string[],
        selectedCallBack?: (selectedItem: string) => void,
        recentsKey?: string,
        clear?: SlotClear
    ) {
        super(InventoryDialog.computeWidth(itemsFilter, recentsKey), 442, title)

        this.m_clearCallBack = clear?.onClear
        this.m_commitOnTap = recentsKey === 'modules'

        this.m_cols = Math.floor(this.viewW / 38)
        this.m_itemsFilter = itemsFilter
        this.m_selectedCallBack = selectedCallBack
        this.m_recentsKey = recentsKey

        this.m_InventoryGroups = new Container()
        this.m_InventoryGroups.position.set(12, 46)
        this.addChild(this.m_InventoryGroups)

        this.m_InventoryItems = new Container()
        this.m_InventoryItems.position.set(12, 126)
        this.addChild(this.m_InventoryItems)

        const bindTabSwitch = (tab: Button<InventoryItems>): void => {
            tab.on('pointerdown', e => {
                e.stopPropagation()
                if (e.button !== 0) return
                if (!tab.active) {
                    for (const t of this.m_InventoryGroups.children) t.active = t === tab
                }
                if (!tab.data.visible) {
                    for (const c of this.m_InventoryItems.children) {
                        c.visible = c === tab.data
                        c.interactiveChildren = c === tab.data
                    }
                    // New group starts scrolled to the top.
                    this.m_itemScroll = 0
                    this.applyItemScroll()
                }
            })
        }

        const addTab = (content: Container, items: InventoryItems, groupIndex: number): void => {
            items.visible = groupIndex === 0
            this.m_InventoryItems.addChild(items)

            const tab = new Button<InventoryItems>(68, 68, 3)
            tab.active = groupIndex === 0
            tab.position.set(groupIndex * 70, 0)
            tab.content = content
            tab.data = items
            bindTabSwitch(tab)
            this.m_InventoryGroups.addChild(tab)
        }

        let groupIndex = 0

        // A name can occur in more than one layout entry — e.g. a recipe and its
        // like-named product item/fluid both land in the layout (`nuclear-fuel`,
        // `lubricant`, `sulfuric-acid`, …), which rendered the same choice twice
        // in the selector. Track what's already been shown and skip repeats so
        // each name gets exactly one button across every group tab.
        const placed = new Set<string>()

        // Optional "Recents" tab (first, active). Built via populateRecents so it
        // can be refreshed live when pinning/unpinning changes the quickbar.
        if (recentsKey) {
            const recentsItems = new Container()
            this.populateRecents(recentsItems)
            if (recentsItems.children.length > 0) {
                this.m_recentsContainer = recentsItems
                addTab(InventoryDialog.recentsIcon(), recentsItems as InventoryItems, groupIndex)
                groupIndex += 1
            }
        }

        for (const group of FD.inventoryLayout) {
            // Make creative entities available only in the main inventory
            if (group.name === 'creative' && itemsFilter !== undefined) {
                continue
            }

            const inventoryGroupItems = new Container<Button<Container>>()
            let itemColIndex = 0
            let itemRowIndex = 0

            // Modded dumps can carry groups with nothing placeable in them
            // (SE's 'fluids' and 'se-spoilers'): an empty Lua table serializes
            // as `{}` — an object, not an array — so guard on the shape, not
            // just nullishness. The children.length check below already hides
            // groups that end up empty.
            const subgroups = Array.isArray(group.subgroups) ? group.subgroups : []
            for (const subgroup of subgroups) {
                let subgroupHasItems = false

                const subgroupItems = Array.isArray(subgroup.items) ? subgroup.items : []
                for (const item of subgroupItems) {
                    if (!this.isAllowed(item.name)) continue
                    if (placed.has(item.name)) continue
                    placed.add(item.name)

                    if (itemColIndex === this.m_cols) {
                        itemColIndex = 0
                        itemRowIndex += 1
                    }

                    const button = this.makeItemButton(item.name)
                    button.position.set(itemColIndex * 38, itemRowIndex * 38)
                    inventoryGroupItems.addChild(button)

                    itemColIndex += 1
                    subgroupHasItems = true
                }

                if (subgroupHasItems) {
                    itemRowIndex += 1
                    itemColIndex = 0
                }
            }

            if (inventoryGroupItems.children.length > 0) {
                const icon = F.CreateIcon(group.name, group.name === 'creative' ? 32 : 64)
                addTab(icon, inventoryGroupItems, groupIndex)
                groupIndex += 1
            }
        }

        // Filtered names the layout couldn't place still need to be selectable —
        // chiefly modded recipes that inherit their subgroup from a product the
        // exporter didn't resolve (e.g. SE's `se-iron-ingot-to-plate`). Gather
        // them into a trailing "Other" tab so a valid recipe/item is never
        // silently unpickable. Only runs for filtered pickers (recipe/module/
        // item-filter); the unfiltered main inventory has no such orphans.
        if (this.m_itemsFilter !== undefined) {
            const orphans = namesMissingFromInventoryLayout(this.m_itemsFilter)
            if (orphans.length > 0) {
                const otherItems = new Container<Button<Container>>()
                let itemColIndex = 0
                let itemRowIndex = 0
                for (const name of orphans) {
                    if (placed.has(name)) continue
                    placed.add(name)
                    if (itemColIndex === this.m_cols) {
                        itemColIndex = 0
                        itemRowIndex += 1
                    }
                    const button = this.makeItemButton(name)
                    button.position.set(itemColIndex * 38, itemRowIndex * 38)
                    otherItems.addChild(button)
                    itemColIndex += 1
                }
                if (otherItems.children.length > 0) {
                    addTab(InventoryDialog.otherIcon(), otherItems, groupIndex)
                    groupIndex += 1
                }
            }
        }

        const recipePanel = new Container()
        recipePanel.position.set(0, 442)
        this.addChild(recipePanel)

        const recipeBackground = F.DrawRectangle(
            this.width,
            78,
            colors.dialog.background.color,
            colors.dialog.background.alpha,
            colors.dialog.background.border
        )
        recipeBackground.position.set(0, 0)
        recipePanel.addChild(recipeBackground)

        this.m_RecipeLabel = new Text({ text: '', style: styles.dialog.label })
        this.m_RecipeLabel.position.set(12, 10)
        recipePanel.addChild(this.m_RecipeLabel)

        this.m_RecipeContainer = new Container()
        this.m_RecipeContainer.position.set(12, 36)
        recipePanel.addChild(this.m_RecipeContainer)

        // Bottom Confirm / Pin bar (top-right of the recipe strip), revealed only
        // while an item is being long-press previewed.
        const pin = InventoryDialog.barButton('Pin', 0x2a5a7a)
        this.m_pinBtn = pin.container
        this.m_pinText = pin.text
        this.m_pinBtn.position.set(this.width - 164, 446)
        this.m_pinBtn.on('pointerup', e => {
            e.stopPropagation()
            const name = this.m_previewName
            if (!name) return
            const qb = G.UI.quickbar
            if (qb.hasItem(name)) qb.removeItem(name)
            else qb.addItem(name)
            this.updatePreviewBar()
            // Reflect the quickbar change in the Recents tab immediately.
            if (this.m_recentsContainer) {
                this.populateRecents(this.m_recentsContainer)
                this.m_previewButton = undefined // the highlighted button may be rebuilt
                this.applyItemScroll()
            }
        })
        this.addChild(this.m_pinBtn)

        const confirm = InventoryDialog.barButton('✓ Confirm', 0x2f7d32)
        this.m_confirmBtn = confirm.container
        this.m_confirmBtn.position.set(this.width - 84, 446)
        this.m_confirmBtn.on('pointerup', e => {
            e.stopPropagation()
            if (this.m_previewName) this.commitSelect(this.m_previewName)
        })
        this.addChild(this.m_confirmBtn)

        // The escape hatch, shown whenever this selector was opened *from a slot*.
        //
        // Two jobs, same action (empty the slot, then close), so one button does
        // both — only the label changes with what the slot currently holds:
        //   - filled → "✕ Clear": the discoverable equivalent of the right-click /
        //     long-press clear, which nothing on screen can otherwise advertise.
        //   - empty  → "✕ Cancel": leave without picking anything. Tapping away
        //     from the dialog also closes it, but on a phone the picker covers
        //     nearly the whole screen, so there is barely any canvas left to hit —
        //     and Escape is desktop-only. Without this the first-time case (open a
        //     recipe slot, change your mind) had no obvious way out at all.
        //
        // It sits in the title row rather than the bottom bar because it is
        // *always* available — unlike Confirm/Pin, which only appear while
        // previewing — and the bottom strip is occupied by the recipe strip.
        if (clear) {
            const btn = InventoryDialog.barButton(clear.filled ? '✕ Clear' : '✕ Cancel', 0x6b3636)
            btn.container.position.set(this.width - 84, 8)
            btn.container.visible = true
            btn.container.on('pointerup', e => {
                e.stopPropagation()
                this.m_clearCallBack?.()
                this.close()
            })
            this.addChild(btn.container)
            this.m_clearBtn = btn.container
            this.m_clearText = btn.text
        }

        this.setupTabScroll(groupIndex)
        this.setupItemScroll()
    }

    /**
     * On-screen centre (CSS px) of the "✕ Clear" button, or null when this
     * selector has nothing to clear. Backs the `?test` probe so e2e can click the
     * button for real rather than guessing at the (scaled, clamped) layout.
     */
    public clearButtonPosition(): { x: number; y: number } | null {
        if (!this.m_clearBtn) return null
        const r = this.m_clearBtn.getBounds().rectangle
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }

    /** The escape-hatch button's label ("✕ Clear" / "✕ Cancel"), for the probe. */
    public clearButtonLabel(): string | null {
        return this.m_clearText?.text ?? null
    }

    /**
     * On-screen centre of "✓ Confirm", or null while it's hidden. Only a selector
     * that previews on tap (i.e. not the module one) ever shows it, so a spec has
     * to go through here to commit a touch selection.
     */
    public confirmButtonPosition(): { x: number; y: number } | null {
        if (!this.m_confirmBtn?.visible) return null
        const r = this.m_confirmBtn.getBounds().rectangle
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }

    /**
     * On-screen centre (CSS px) of the first item button in the active group, or
     * null if the group has none. Backs the `?test` probe so e2e can tap a real
     * item without knowing which one the active tab happens to show.
     */
    public firstItemPosition(): { x: number; y: number } | null {
        // The recents tab interleaves section-header Text with the buttons, so
        // pick the first *Button* rather than the first child.
        const button = this.activeGroup()?.children.find(c => c instanceof Button)
        if (!button) return null
        const r = button.getBounds().rectangle
        if (r.width === 0 || r.height === 0) return null
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }

    /** Filter a name to what this selector allows (filter list, or placeable). */
    private isAllowed(name: string): boolean {
        return InventoryDialog.isItemAllowed(name, this.m_itemsFilter)
    }

    private static isItemAllowed(name: string, itemsFilter?: string[]): boolean {
        if (itemsFilter !== undefined) return itemsFilter.includes(name)
        const itemData = FD.items[name]
        if (!itemData) return false
        if (!itemData.place_result && !itemData.place_as_tile) return false
        // needed for robots/trains/cars
        if (itemData.place_result && !FD.entities[itemData.place_result]) return false
        return true
    }

    /**
     * Body width: wide enough to show all group tabs (Space Age has many),
     * capped to the screen, but never narrower than the 404px 10-column item
     * grid. Keeps the tab scroll from engaging when there's room to just show
     * them, and gives the item grid more columns on wider screens.
     */
    private static computeWidth(itemsFilter?: string[], recentsKey?: string): number {
        let tabs = recentsKey ? 1 : 0
        for (const group of FD.inventoryLayout) {
            if (group.name === 'creative' && itemsFilter !== undefined) continue
            // Same shape guard as the constructor: a group with nothing
            // placeable (SE) serializes its empty Lua table as `{}`, not [].
            const subgroups = Array.isArray(group.subgroups) ? group.subgroups : []
            const hasItems = subgroups.some(sg =>
                (Array.isArray(sg.items) ? sg.items : []).some(it =>
                    InventoryDialog.isItemAllowed(it.name, itemsFilter)
                )
            )
            if (hasItems) tabs += 1
        }
        // The trailing "Other" tab (layout-orphaned filter names; see constructor).
        if (itemsFilter !== undefined && namesMissingFromInventoryLayout(itemsFilter).length > 0) {
            tabs += 1
        }
        const needed = tabs * 70 + 22 // tabs (70px each, minus trailing gap) + 12px margins
        return Math.max(404, Math.min(needed, G.app.screen.width - 16))
    }

    /**
     * An item button. Desktop: click commits, long-press previews (Confirm/Pin
     * bar). Touch: tap previews/focuses (deliberate Confirm-to-select, fewer
     * misclicks) — except in a **commit-on-tap** selector, see `m_commitOnTap`.
     */
    private makeItemButton(name: string): Button<Container> {
        const button = new Button<Container>(36, 36)
        button.content = F.CreateIcon(name)

        button.on('pointerdown', e => {
            e.stopPropagation()
            if (e.button !== 0) return
            this.clearPressTimer()
            this.m_pressTimer = setTimeout(() => {
                this.m_pressTimer = undefined
                this.beginPreview(name, button)
            }, 450)
        })
        button.on('pointerup', e => {
            e.stopPropagation()
            if (this.m_pressTimer) {
                // released before the long-press fired → quick tap.
                this.clearPressTimer()
                if (inputMode.mode === 'desktop' || this.m_commitOnTap) {
                    // Desktop: a click commits immediately (precise pointer).
                    // Commit-on-tap selectors do the same on touch — see below.
                    this.commitSelect(name)
                } else {
                    // Touch: a tap *focuses* the item — shows its name/details and
                    // the Confirm/Pin bar — so selecting is a deliberate two-step
                    // (tap to inspect, Confirm to take), lowering misclicks. (Same
                    // as a long-press; the press timer just makes hold redundant.)
                    this.beginPreview(name, button)
                }
            }
        })
        button.on('pointerupoutside', () => this.clearPressTimer())

        // Recipe-on-hover is a desktop affordance; on touch a finger sliding over
        // items would spuriously trigger it (long-press shows details instead).
        button.on('pointerover', () => {
            if (inputMode.mode !== 'desktop') return
            this.m_hoveredItem = name
            this.updateRecipeVisualization(name)
        })
        button.on('pointerout', () => {
            this.clearPressTimer()
            if (inputMode.mode === 'desktop' && this.m_hoveredItem === name) {
                this.m_hoveredItem = undefined
                this.updateRecipeVisualization(undefined)
            }
        })
        return button
    }

    /**
     * (Re)fill the recents container with three colour-coded sections — Recent
     * (white), Quickbar (blue, items only) and On blueprint (orange). Recent +
     * Quickbar show in full; On blueprint only adds names not already shown.
     * Rebuilt on pin/unpin so the quickbar change shows live.
     */
    private populateRecents(container: Container): void {
        for (const c of container.removeChildren()) c.destroy()

        const key = this.m_recentsKey
        if (!key) return

        const seen = new Set<string>()
        const collect = (names: string[], dedupeAgainstShown: boolean): string[] => {
            const out: string[] = []
            const local = new Set<string>()
            for (const name of names) {
                if (!this.isAllowed(name) || local.has(name)) continue
                if (dedupeAgainstShown && seen.has(name)) continue
                local.add(name)
                out.push(name)
            }
            for (const name of out) seen.add(name)
            return out
        }

        const sections: { label: string; color: number; names: string[] }[] = []
        const recent = collect(getRecents(key), false)
        if (recent.length) sections.push({ label: 'Recent', color: 0xffffff, names: recent })
        if (key === 'items') {
            const quickbar = collect(
                G.UI.quickbar.serialize().filter((n): n is string => !!n),
                false
            )
            if (quickbar.length)
                sections.push({ label: 'Quickbar', color: 0x8fd0ff, names: quickbar })
        }
        const onBlueprint = collect(InventoryDialog.blueprintNames(key), true)
        if (onBlueprint.length)
            sections.push({ label: 'On blueprint', color: 0xffcf8f, names: onBlueprint })

        let y = 0
        for (const section of sections) {
            const header = new Text({
                text: section.label,
                style: {
                    fontFamily: "'Roboto', sans-serif",
                    fontSize: 12,
                    fontWeight: 'bold',
                    fill: section.color,
                },
            })
            header.position.set(0, y)
            container.addChild(header)
            y += 18
            section.names.forEach((name, i) => {
                const button = this.makeItemButton(name)
                button.position.set((i % this.m_cols) * 38, y + Math.floor(i / this.m_cols) * 38)
                container.addChild(button)
            })
            y += Math.ceil(section.names.length / this.m_cols) * 38 + 6
        }
    }

    private clearPressTimer(): void {
        if (this.m_pressTimer) {
            clearTimeout(this.m_pressTimer)
            this.m_pressTimer = undefined
        }
    }

    /** Quick-tap path: record + commit the selection and close. */
    private commitSelect(name: string): void {
        if (this.m_recentsKey) recordRecent(this.m_recentsKey, name)
        this.m_selectedCallBack?.(name)
        this.close()
    }

    /** Long-press path: hold the item as a pending selection without closing. */
    public beginPreview(name: string, button?: Button<Container>): void {
        if (this.destroyed) return
        if (this.m_previewButton && !this.m_previewButton.destroyed)
            this.m_previewButton.active = false
        this.m_previewName = name
        this.m_previewButton = button
        if (button) button.active = true
        this.updateRecipeVisualization(name)
        this.updatePreviewBar()
    }

    private updatePreviewBar(): void {
        const active = !!this.m_previewName
        if (this.m_confirmBtn) this.m_confirmBtn.visible = active
        if (this.m_pinBtn && this.m_pinText) {
            // The quickbar only holds items, so pinning is for the item selector.
            const canPin = active && this.m_recentsKey === 'items'
            this.m_pinBtn.visible = canPin
            if (canPin) {
                this.m_pinText.text = G.UI.quickbar.hasItem(this.m_previewName) ? 'Unpin' : 'Pin'
            }
        }
    }

    /** A small labelled action button (Confirm / Pin); hidden until previewing. */
    private static barButton(label: string, color: number): { container: Container; text: Text } {
        const c = new Container()
        const bg = new Graphics().roundRect(0, 0, 72, 26, 4).fill(color)
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
        t.position.set(36, 13)
        c.addChild(bg, t)
        c.eventMode = 'static'
        c.cursor = 'pointer'
        c.visible = false
        return { container: c, text: t }
    }

    /** Names already on the blueprint for `key`, used to seed an empty recents tab. */
    private static blueprintNames(key: string): string[] {
        const ents = G.bp.entities.valuesArray()
        if (key === 'recipes') return ents.map(e => e.recipe).filter((r): r is string => !!r)
        if (key === 'modules') return ents.flatMap(e => e.modules).filter((m): m is string => !!m)
        return ents.map(e => e.name)
    }

    /** Glyph icon for the synthetic "Other" tab (layout-orphaned filter names). */
    private static otherIcon(): Container {
        const c = new Container()
        const t = new Text({ text: '⋯', style: { fill: 0xffe6c0, fontSize: 44 } })
        t.anchor.set(0.5)
        c.addChild(t)
        return c
    }

    /** ★ glyph icon for the synthetic Recents tab. */
    private static recentsIcon(): Container {
        const c = new Container()
        const t = new Text({ text: '★', style: { fill: 0xffe6c0, fontSize: 44 } })
        t.anchor.set(0.5)
        c.addChild(t)
        return c
    }

    /** A small dark arrow button used to scroll the tabs / item grid. */
    private static arrowButton(glyph: string): Container {
        const c = new Container()
        const bg = new Graphics().roundRect(0, 0, 22, 22, 3).fill({ color: 0x202225, alpha: 0.9 })
        const t = new Text({ text: glyph, style: { fill: 0xffffff, fontSize: 15 } })
        t.anchor.set(0.5)
        t.position.set(11, 11)
        c.addChild(bg, t)
        c.eventMode = 'static'
        c.cursor = 'pointer'
        return c
    }

    /** Filled rect added as a clip mask for a scrollable region. */
    private rectMask(x: number, y: number, w: number, h: number): Graphics {
        const g = new Graphics().rect(x, y, w, h).fill(0xffffff)
        g.eventMode = 'none'
        this.addChild(g)
        return g
    }

    /** Clip the tab row and, when it overflows, add ◀ ▶ to scroll it. */
    private setupTabScroll(groupCount: number): void {
        this.m_InventoryGroups.mask = this.rectMask(12, 46, this.viewW, InventoryDialog.TAB_H)
        const contentW = groupCount > 0 ? (groupCount - 1) * 70 + 68 : 0
        const max = Math.max(0, contentW - this.viewW)
        if (max <= 0) return

        const left = InventoryDialog.arrowButton('◀')
        left.position.set(12, 46 + (InventoryDialog.TAB_H - 22) / 2)
        const right = InventoryDialog.arrowButton('▶')
        right.position.set(12 + this.viewW - 22, 46 + (InventoryDialog.TAB_H - 22) / 2)
        this.addChild(left, right)
        this.m_tabArrows = { left, right, max }

        left.on('pointerdown', e => {
            e.stopPropagation()
            this.m_tabScroll = Math.max(0, this.m_tabScroll - 140)
            this.applyTabScroll()
        })
        right.on('pointerdown', e => {
            e.stopPropagation()
            this.m_tabScroll = Math.min(max, this.m_tabScroll + 140)
            this.applyTabScroll()
        })
        this.applyTabScroll()
    }

    private applyTabScroll(): void {
        this.m_InventoryGroups.x = 12 - this.m_tabScroll
        // Pixi masks clip rendering but not hit-testing, so gate interactivity:
        // only fully-visible tabs stay tappable.
        for (const tab of this.m_InventoryGroups.children) {
            const inView =
                tab.x >= this.m_tabScroll - 1 && tab.x + 68 <= this.m_tabScroll + this.viewW + 1
            tab.eventMode = inView ? 'static' : 'none'
        }
        if (this.m_tabArrows) {
            this.m_tabArrows.left.visible = this.m_tabScroll > 0
            this.m_tabArrows.right.visible = this.m_tabScroll < this.m_tabArrows.max
        }
    }

    /** Clip the item grid and add ▲ ▼ to scroll the active group vertically. */
    private setupItemScroll(): void {
        this.m_InventoryItems.mask = this.rectMask(12, 126, this.viewW, InventoryDialog.ITEMS_H)

        const up = InventoryDialog.arrowButton('▲')
        up.position.set(12 + this.viewW - 22, 126)
        const down = InventoryDialog.arrowButton('▼')
        down.position.set(12 + this.viewW - 22, 126 + InventoryDialog.ITEMS_H - 22)
        this.addChild(up, down)
        this.m_itemArrows = { up, down }

        up.on('pointerdown', e => {
            e.stopPropagation()
            this.m_itemScroll = Math.max(0, this.m_itemScroll - 152)
            this.applyItemScroll()
        })
        down.on('pointerdown', e => {
            e.stopPropagation()
            this.m_itemScroll = Math.min(this.maxItemScroll(), this.m_itemScroll + 152)
            this.applyItemScroll()
        })
        this.applyItemScroll()
    }

    private activeGroup(): Container | undefined {
        return this.m_InventoryItems.children.find(c => c.visible)
    }

    private maxItemScroll(): number {
        const g = this.activeGroup()
        return g ? maxItemScroll(g.height, InventoryDialog.ITEMS_H) : 0
    }

    private applyItemScroll(): void {
        const g = this.activeGroup()
        this.m_itemScroll = Math.min(this.m_itemScroll, this.maxItemScroll())
        if (g) {
            g.y = -this.m_itemScroll
            // The mask clips rendering but not hit-testing, so gate interactivity
            // to the viewport (see inventoryScroll.ts — gating on the button's
            // 36px size, not the 38px pitch, keeps the bottom row clickable at
            // full scroll).
            for (const item of g.children) {
                item.eventMode = isItemTappable(item.y, this.m_itemScroll, InventoryDialog.ITEMS_H)
                    ? 'static'
                    : 'none'
            }
        }
        if (this.m_itemArrows) {
            const max = this.maxItemScroll()
            this.m_itemArrows.up.visible = this.m_itemScroll > 0
            this.m_itemArrows.down.visible = this.m_itemScroll < max
        }
    }

    /**
     * Test seam (see testHook.ts): switch to the tallest item group, scroll it
     * fully to the bottom and report the last item button's screen-space centre
     * (CSS px) plus the applied scroll — the regression surface for "the last
     * row renders but can't be clicked at full scroll". Returns null if the
     * dialog has no item buttons at all.
     */
    public scrollToLastItem(): { x: number; y: number; scroll: number } | null {
        // Measure from child positions, not `.height`: invisible containers
        // (every group but the active one) report zero-size bounds.
        const contentHeight = (c: Container): number =>
            c.children.reduce((h, ch) => Math.max(h, ch.y + 36), 0)
        let group: Container | undefined
        for (const c of this.m_InventoryItems.children) {
            if (c.children.length > 0 && (!group || contentHeight(c) > contentHeight(group)))
                group = c
        }
        if (!group) return null

        // Activate it the same way a tab tap does.
        for (const c of this.m_InventoryItems.children) {
            c.visible = c === group
            c.interactiveChildren = c === group
        }
        for (const t of this.m_InventoryGroups.children) t.active = t.data === group

        this.m_itemScroll = Number.MAX_SAFE_INTEGER // applyItemScroll clamps to max
        this.applyItemScroll()

        // Last *button* — the recents group interleaves Text section headers.
        const last = [...group.children].reverse().find(c => c instanceof Button)
        if (!last) return null
        const b = last.getBounds().rectangle
        return { x: b.x + b.width / 2, y: b.y + b.height / 2, scroll: this.m_itemScroll }
    }

    /**
     * Override the base centering: the recipe strip hangs ~78px below the 442px
     * body (~520px total), so fit against that full extent — width *and* height —
     * and center the scaled box within the UI safe area, clamped to it.
     */
    protected override setPosition(): void {
        const totalHeight = 520
        const sa = G.safeArea
        const scale = Math.min(
            fitToWidthScale(sa.width, this.width),
            fitToWidthScale(sa.height, totalHeight)
        )
        this.scale.set(scale)

        const w = this.width * scale
        const h = totalHeight * scale
        this.position.set(
            Math.max(sa.x, Math.min(sa.x + sa.width / 2 - w / 2, sa.x + sa.width - w)),
            Math.max(sa.y, Math.min(sa.y + sa.height / 2 - h / 2, sa.y + sa.height - h))
        )
    }

    /** Update recipe visualization */
    private updateRecipeVisualization(recipeName?: string): void {
        // Update Recipe Label
        this.m_RecipeLabel.text = ''

        // Update Recipe Container
        this.m_RecipeContainer.removeChildren()

        if (recipeName === undefined) return

        const item = FD.items[recipeName]
        if (item && item.subgroup === 'creative') {
            this.m_RecipeLabel.text = `[CREATIVE] - ${item.localised_name}`
        }

        const recipe = FD.recipes[recipeName]
        if (recipe === undefined) return
        this.m_RecipeLabel.text = recipe.localised_name

        F.CreateRecipe(
            this.m_RecipeContainer,
            0,
            0,
            recipe.ingredients,
            recipe.results,
            recipe.energy_required
        )
    }
}
