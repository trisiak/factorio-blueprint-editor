import { wheelGuard } from '@fbe/editor'
import type { EntityInfoData, EntityInfoRow, EntityInfoStack, EntityInfoToken } from '@fbe/editor'
import { applyPackIcon } from './packIcons'

// Entity-info sheet: **the** presentation of the entity-info readout (#89
// Phase 2, universal since #101 Slice 5 — the Pixi panel that drew this on
// desktop is retired). The editor dispatches a render-free `EntityInfoData` on
// every hover/tap-select via the `fbe:entityinfo` window event (see
// `UIContainer.updateEntityInfo`); this module renders it as DOM, with real
// game icons through the packIcons seam.
//
// Placement is decided by the `compact` signal and orientation, never by an
// input mode (CSS does it, see index.styl):
//   - wide: a fixed top-right drawer. It used to share a flex column with the
//     rates drawer, which meant the drawer *moved* every time this sheet
//     appeared or cleared — i.e. on every hover (#101 Slice 5 review). The two
//     are independent boxes now: this one keeps the top-right corner, the
//     rates drawer owns the bottom-right one;
//   - compact portrait: a full-width band at the **top**. It appears on every
//     tap-select, and the active, reachable area of a portrait phone is the
//     bottom of the screen, so the passive readout stays out of it (and clear
//     of the bottom-centre EDIT Select/Edit bar, which always co-occurs with
//     it);
//   - compact landscape: a bottom-right drawer, complementing the rates one.
// z-index below the clusters keeps their buttons tappable on any overlap.
export function initEntityInfoSheet(): void {
    const sheet = document.createElement('div')
    sheet.id = 'entity-info-sheet'
    document.body.appendChild(sheet)
    // Scrolling this sheet must not end up zooming the canvas once the pointer
    // leaves it — see `wheelGuard` (the CSS half is `overscroll-behavior`).
    wheelGuard.watch(sheet)

    /** An icon span for `iconId`, falling back to `label` when the pack has none. */
    const iconSpan = (className: string, iconId: string | undefined, label: string, size = 20) => {
        const icon = document.createElement('span')
        icon.className = className
        if (!iconId || !applyPackIcon(icon, iconId, size)) icon.textContent = label
        return icon
    }

    const stackSpan = (stack: EntityInfoStack): HTMLElement => {
        const wrap = document.createElement('span')
        wrap.className = 'eis-stack'
        const amount = document.createElement('span')
        amount.textContent = String(stack.amount)
        wrap.append(iconSpan('eis-icon', `${stack.type}/${stack.name}`, stack.name), amount)
        return wrap
    }

    const recipeRow = (
        label: string,
        ingredients: EntityInfoStack[],
        results: EntityInfoStack[],
        arrow: string
    ): HTMLElement => {
        const row = document.createElement('div')
        row.className = 'eis-row'
        const lbl = document.createElement('span')
        lbl.className = 'eis-dim'
        lbl.textContent = label
        row.appendChild(lbl)
        for (const i of ingredients) row.appendChild(stackSpan(i))
        const arr = document.createElement('span')
        arr.className = 'eis-dim'
        arr.textContent = arrow
        row.appendChild(arr)
        for (const r of results) row.appendChild(stackSpan(r))
        return row
    }

    // One piece of the circuit summary. The retired canvas panel drew this
    // section icon-rich, so the sheet does too — signals resolve to pack icons
    // where the browser artifact has them (item/fluid/recipe) and to their name
    // where it doesn't (Factorio's virtual signals aren't in the sheet).
    const tokenSpan = (token: EntityInfoToken): HTMLElement => {
        switch (token.kind) {
            case 'text': {
                const el = document.createElement('span')
                el.textContent = token.text
                return el
            }
            case 'signal':
                return iconSpan('eis-icon', token.icon, token.label)
            case 'count': {
                const wrap = document.createElement('span')
                wrap.className = 'eis-stack'
                const n = document.createElement('span')
                n.textContent = String(token.count)
                wrap.append(iconSpan('eis-icon', token.icon, token.label), n)
                return wrap
            }
            case 'network': {
                // A red/green network-id badge, like the game's.
                const el = document.createElement('span')
                el.className = `eis-net eis-net-${token.color}`
                el.textContent = String(token.id)
                return el
            }
        }
    }

    const circuitRow = (row: EntityInfoRow): HTMLElement => {
        const el = document.createElement('div')
        el.className = 'eis-row'
        for (const token of row) el.appendChild(tokenSpan(token))
        return el
    }

    const render = (data: EntityInfoData | null): void => {
        if (!data) {
            sheet.classList.remove('visible')
            return
        }
        sheet.replaceChildren()

        const name = document.createElement('div')
        name.className = 'eis-name'
        name.textContent = data.name
        sheet.appendChild(name)

        for (const line of data.lines) {
            const el = document.createElement('div')
            el.className = 'eis-line'
            el.textContent = line
            sheet.appendChild(el)
        }

        if (data.modules.length > 0) {
            const row = document.createElement('div')
            row.className = 'eis-row'
            const lbl = document.createElement('span')
            lbl.className = 'eis-dim'
            lbl.textContent = 'Modules:'
            row.appendChild(lbl)
            for (const m of data.modules) {
                const wrap = document.createElement('span')
                wrap.className = 'eis-stack'
                const n = document.createElement('span')
                n.textContent = `×${m.count}`
                wrap.append(iconSpan('eis-icon', m.icon, m.label), n)
                row.appendChild(wrap)
            }
            sheet.appendChild(row)
        }

        if (data.recipe) {
            sheet.appendChild(
                recipeRow(
                    'Recipe:',
                    data.recipe.ingredients,
                    data.recipe.results,
                    `=${data.recipe.time}s>`
                )
            )
        }
        if (data.effectiveRecipe) {
            sheet.appendChild(
                recipeRow(
                    'Per second:',
                    data.effectiveRecipe.ingredients,
                    data.effectiveRecipe.results,
                    '>'
                )
            )
        }

        if (data.circuit.length > 0) {
            const heading = document.createElement('div')
            heading.className = 'eis-dim'
            heading.textContent = 'Circuit network:'
            sheet.appendChild(heading)
            for (const row of data.circuit) sheet.appendChild(circuitRow(row))
        }

        sheet.classList.add('visible')
    }

    window.addEventListener('fbe:entityinfo', e =>
        render((e as CustomEvent<EntityInfoData | null>).detail)
    )
}
