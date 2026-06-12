import { Container, Graphics, Text } from 'pixi.js'
import FD from '../core/factorioData'
import G from '../common/globals'
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

    // Scroll state. The group-tab row (Space Age adds enough groups to overflow
    // the 404px body) scrolls horizontally; the active group's item grid scrolls
    // vertically so any number of items is reachable. Both are masked to their
    // viewport and driven by arrow buttons (drag-pan + tap-to-confirm come later).
    private static readonly VIEW_W = 380
    private static readonly TAB_H = 68
    private static readonly ITEMS_H = 304
    private m_tabScroll = 0
    private m_itemScroll = 0
    private m_tabArrows?: { left: Container; right: Container; max: number }
    private m_itemArrows?: { up: Container; down: Container }

    public constructor(
        title = 'Inventory',
        itemsFilter?: string[],
        selectedCallBack?: (selectedItem: string) => void,
        recentsKey?: string
    ) {
        super(404, 442, title)

        this.m_InventoryGroups = new Container()
        this.m_InventoryGroups.position.set(12, 46)
        this.addChild(this.m_InventoryGroups)

        this.m_InventoryItems = new Container()
        this.m_InventoryItems.position.set(12, 126)
        this.addChild(this.m_InventoryItems)

        // Filter a name to what this selector allows (an explicit filter list, or
        // any placeable item for the main inventory). Shared by the FD groups and
        // the recents tab.
        const isAllowed = (name: string): boolean => {
            if (itemsFilter !== undefined) return itemsFilter.includes(name)
            const itemData = FD.items[name]
            if (!itemData) return false
            if (!itemData.place_result && !itemData.place_as_tile) return false
            // needed for robots/trains/cars
            if (itemData.place_result && !FD.entities[itemData.place_result]) return false
            return true
        }

        const makeItemButton = (name: string): Button<Container> => {
            const button = new Button<Container>(36, 36)
            button.content = F.CreateIcon(name)
            button.on('pointerdown', e => {
                e.stopPropagation()
                if (e.button === 0) {
                    if (recentsKey) recordRecent(recentsKey, name)
                    selectedCallBack?.(name)
                    this.close()
                }
            })
            button.on('pointerover', () => {
                this.m_hoveredItem = name
                this.updateRecipeVisualization(name)
            })
            button.on('pointerout', () => {
                // we have to check this because pointerout can fire after pointerover
                if (this.m_hoveredItem === name) {
                    this.m_hoveredItem = undefined
                    this.updateRecipeVisualization(undefined)
                }
            })
            return button
        }

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

        // Optional "Recents" tab (first, active): three labelled sections —
        // recently picked, the quickbar (items only), and what's on the blueprint
        // (so it's never empty) — each filtered to what this selector allows and
        // colour-coded so the sources read apart. Recent + Quickbar are shown in
        // full; "On blueprint" only adds names not already shown above.
        if (recentsKey) {
            const seen = new Set<string>()
            const collect = (names: string[], dedupeAgainstShown: boolean): string[] => {
                const out: string[] = []
                const local = new Set<string>()
                for (const name of names) {
                    if (!isAllowed(name) || local.has(name)) continue
                    if (dedupeAgainstShown && seen.has(name)) continue
                    local.add(name)
                    out.push(name)
                }
                for (const name of out) seen.add(name)
                return out
            }

            const sections: { label: string; color: number; names: string[] }[] = []
            const recent = collect(getRecents(recentsKey), false)
            if (recent.length) sections.push({ label: 'Recent', color: 0xffffff, names: recent })
            if (recentsKey === 'items') {
                const quickbar = collect(
                    G.UI.quickbarPanel.serialize().filter((n): n is string => !!n),
                    false
                )
                if (quickbar.length)
                    sections.push({ label: 'Quickbar', color: 0x8fd0ff, names: quickbar })
            }
            const onBlueprint = collect(InventoryDialog.blueprintNames(recentsKey), true)
            if (onBlueprint.length)
                sections.push({ label: 'On blueprint', color: 0xffcf8f, names: onBlueprint })

            if (sections.length > 0) {
                const recentsItems = new Container()
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
                    recentsItems.addChild(header)
                    y += 18
                    section.names.forEach((name, i) => {
                        const button = makeItemButton(name)
                        button.position.set((i % 10) * 38, y + Math.floor(i / 10) * 38)
                        recentsItems.addChild(button)
                    })
                    y += Math.ceil(section.names.length / 10) * 38 + 6
                }
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

            for (const subgroup of group.subgroups) {
                let subgroupHasItems = false

                for (const item of subgroup.items) {
                    if (!isAllowed(item.name)) continue

                    if (itemColIndex === 10) {
                        itemColIndex = 0
                        itemRowIndex += 1
                    }

                    const button = makeItemButton(item.name)
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
            404,
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

        this.setupTabScroll(groupIndex)
        this.setupItemScroll()
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
        this.m_InventoryGroups.mask = this.rectMask(
            12,
            46,
            InventoryDialog.VIEW_W,
            InventoryDialog.TAB_H
        )
        const contentW = groupCount > 0 ? (groupCount - 1) * 70 + 68 : 0
        const max = Math.max(0, contentW - InventoryDialog.VIEW_W)
        if (max <= 0) return

        const left = InventoryDialog.arrowButton('◀')
        left.position.set(12, 46 + (InventoryDialog.TAB_H - 22) / 2)
        const right = InventoryDialog.arrowButton('▶')
        right.position.set(12 + InventoryDialog.VIEW_W - 22, 46 + (InventoryDialog.TAB_H - 22) / 2)
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
                tab.x >= this.m_tabScroll - 1 &&
                tab.x + 68 <= this.m_tabScroll + InventoryDialog.VIEW_W + 1
            tab.eventMode = inView ? 'static' : 'none'
        }
        if (this.m_tabArrows) {
            this.m_tabArrows.left.visible = this.m_tabScroll > 0
            this.m_tabArrows.right.visible = this.m_tabScroll < this.m_tabArrows.max
        }
    }

    /** Clip the item grid and add ▲ ▼ to scroll the active group vertically. */
    private setupItemScroll(): void {
        this.m_InventoryItems.mask = this.rectMask(
            12,
            126,
            InventoryDialog.VIEW_W,
            InventoryDialog.ITEMS_H
        )

        const up = InventoryDialog.arrowButton('▲')
        up.position.set(12 + InventoryDialog.VIEW_W - 22, 126)
        const down = InventoryDialog.arrowButton('▼')
        down.position.set(12 + InventoryDialog.VIEW_W - 22, 126 + InventoryDialog.ITEMS_H - 22)
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
