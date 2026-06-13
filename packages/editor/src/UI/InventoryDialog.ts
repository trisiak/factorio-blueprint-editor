import { Container, Graphics, Text } from 'pixi.js'
import FD from '../core/factorioData'
import G from '../common/globals'
import { inputMode } from '../common/input'
import F from './controls/functions'
import { Dialog } from './controls/Dialog'
import { Button } from './controls/Button'
import { fitToWidthScale } from './quickbarLayout'
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

    public constructor(
        title = 'Inventory',
        itemsFilter?: string[],
        selectedCallBack?: (selectedItem: string) => void,
        recentsKey?: string
    ) {
        super(InventoryDialog.computeWidth(itemsFilter, recentsKey), 442, title)

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
            const qb = G.UI.quickbarPanel
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

        this.setupTabScroll(groupIndex)
        this.setupItemScroll()
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
        const needed = tabs * 70 + 22 // tabs (70px each, minus trailing gap) + 12px margins
        return Math.max(404, Math.min(needed, G.app.screen.width - 16))
    }

    /** An item button: quick tap commits, long-press previews (Confirm/Pin bar). */
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
                // released before the long-press fired → quick tap = commit
                this.clearPressTimer()
                this.commitSelect(name)
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
                G.UI.quickbarPanel.serialize().filter((n): n is string => !!n),
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
                this.m_pinText.text = G.UI.quickbarPanel.hasItem(this.m_previewName)
                    ? 'Unpin'
                    : 'Pin'
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
        return g ? Math.max(0, g.height - InventoryDialog.ITEMS_H) : 0
    }

    private applyItemScroll(): void {
        const g = this.activeGroup()
        this.m_itemScroll = Math.min(this.m_itemScroll, this.maxItemScroll())
        if (g) {
            g.y = -this.m_itemScroll
            for (const item of g.children) {
                const top = item.y - this.m_itemScroll
                item.eventMode =
                    top >= -1 && top + 38 <= InventoryDialog.ITEMS_H + 1 ? 'static' : 'none'
            }
        }
        if (this.m_itemArrows) {
            const max = this.maxItemScroll()
            this.m_itemArrows.up.visible = this.m_itemScroll > 0
            this.m_itemArrows.down.visible = this.m_itemScroll < max
        }
    }

    /**
     * Override the base centering: the recipe strip hangs ~78px below the 442px
     * body (~520px total), so fit against that full extent — width *and* height —
     * and center the scaled box, clamped on-screen.
     */
    protected override setPosition(): void {
        const totalHeight = 520
        const scale = Math.min(
            fitToWidthScale(G.app.screen.width, this.width),
            fitToWidthScale(G.app.screen.height, totalHeight)
        )
        this.scale.set(scale)

        const w = this.width * scale
        const h = totalHeight * scale
        this.position.set(
            Math.max(0, Math.min(G.app.screen.width / 2 - w / 2, G.app.screen.width - w)),
            Math.max(0, Math.min(G.app.screen.height / 2 - h / 2, G.app.screen.height - h))
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
