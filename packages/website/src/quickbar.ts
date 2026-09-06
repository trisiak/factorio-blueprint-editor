import EDITOR, { type Editor, EditorMode, inputMode, WIRE_ITEMS } from '@fbe/editor'
import { formatKeyCombo } from './keyCombo'
import { applyPackIcon } from './packIcons'

// The quickbar (#101 Slice 5) — one DOM bar for every input.
//
// It used to be a Pixi panel pinned to the bottom of the canvas and hidden on
// touch, so touch users had no pinned items at all and desktop users had a
// second, canvas-only place where slots behaved unlike every other slot. The
// panel is retired: the editor keeps the slot model (`UI/quickbarModel.ts` —
// persistence, the activation rules, the number keys, pin/unpin from the
// inventory) and this module is its only view, following the model's `change`
// event.
//
// Everything device-ish here is a *signal*, not a mode:
//   - `coarse` → 44 px cells instead of 36 px (a finger vs a mouse);
//   - `keys`   → the number-key badges, read live from the action registry
//     (they're user-rebindable, and a badge is noise without a keyboard);
//   - `compact` → 5 columns instead of 10, so the bar fits a phone; the swap
//     button (X) rotates the rows, so every slot stays reachable.
//
// The three **wire toggles** live here too, appended after the slots. They were
// a Pixi panel beside the desktop quickbar and three buttons on the rail for
// touch — two affordances for one action (#101 Slice 4 retired the panel, this
// retires the rail entry). They aren't inventory items (the Items dialog can't
// reach them), so a pinned cell is exactly what they need.
//
// Bottom-band etiquette: the contextual clusters (PAINT d-pad, SELECT controls,
// EDIT bar) own the bottom-centre band on a compact viewport, so the quickbar
// yields to them there rather than overlapping — see `bandIsTaken`. On a wide
// viewport nothing else claims the band, and the quickbar reserves it as a
// bottom inset of `G.safeArea` so Pixi dialogs stay clear of it.
//
// Note it does *not* subscribe to the `body.fbe-dialog-open` gate the passive
// readouts use: it is an interactive surface with a reserved band (tier 4 of
// the layering contract in docs/mobile-layout-inventory.md), so a modal never
// needs the pixels it occupies — canvas dialogs clamp inside the safe area
// this inset shrinks, and DOM dialogs rank above it.

/**
 * Captions for the three wire toggles. They live here rather than in the
 * editor's `WIRE_ITEMS` (a domain list of prototype names) for the same reason
 * the rail's captions did: the wording is a UI decision.
 */
const WIRE_LABELS: Record<string, string> = {
    'copper-wire': 'Copper',
    'red-wire': 'Red wire',
    'green-wire': 'Green wire',
}

/** Cell size by primary pointer: a finger needs a 44 px target, a mouse doesn't. */
const COARSE_CELL = 44
const FINE_CELL = 36

/** Columns per row: the game's ten, or five when the viewport is `compact`. */
const WIDE_COLUMNS = 10
const COMPACT_COLUMNS = 5

/**
 * Long-press duration for "clear this slot" on touch — the same 500 ms the Pixi
 * slots use (`UI/controls/gestures.ts`), so the gesture contract is identical
 * across canvas and DOM slots.
 */
const LONG_PRESS_MS = 500

/**
 * Editor modes whose on-screen cluster takes the bottom-centre band. EDIT only
 * counts when the last pointer was a touch: with a mouse, EDIT is a transient
 * hover state with no bar, and blinking the quickbar on every hover would be
 * absurd.
 */
function bandIsTaken(mode: EditorMode): boolean {
    if (mode === EditorMode.PAINT || mode === EditorMode.SELECT) return true
    if (mode === EditorMode.COPY || mode === EditorMode.DELETE) return true
    return mode === EditorMode.EDIT && inputMode.touchRecent
}

/** Fallback glyph for a slot whose item has no pack icon yet: its initials. */
function initials(itemName: string): string {
    return itemName
        .split('-')
        .slice(0, 2)
        .map(part => part[0]?.toUpperCase() ?? '')
        .join('')
}

export function initQuickbar(editor: Editor): void {
    const model = editor.quickbar

    const bar = document.createElement('div')
    bar.id = 'quickbar'

    const grid = document.createElement('div')
    grid.className = 'qb-grid'

    const wires = document.createElement('div')
    wires.className = 'qb-wires'

    // Rotate the rows (the `changeActiveQuickbar` action, X by default): the
    // Pixi panel had a little triangle for this, and on a compact viewport —
    // where only one row's worth of columns fits — it's how the other slots are
    // reached at all.
    const swap = document.createElement('button')
    swap.type = 'button'
    swap.className = 'qb-swap'
    swap.title = 'Switch quickbar'
    swap.setAttribute('aria-label', 'Switch quickbar')
    swap.textContent = '▲'
    swap.addEventListener('click', () => EDITOR.callAction('changeActiveQuickbar'))

    bar.append(grid, swap, wires)
    document.body.appendChild(bar)

    /**
     * Tap/click activates, right-click or long-press clears — the contract the
     * canvas slots have (`bindSlotGestures`), reproduced for DOM: a pointer
     * that leaves the cell or lingers past the long press must not also fire
     * the activation.
     */
    const bindSlotGestures = (el: HTMLElement, activate: () => void, clear: () => void): void => {
        let timer: ReturnType<typeof setTimeout> | undefined
        let longFired = false
        const cancel = (): void => {
            if (timer) clearTimeout(timer)
            timer = undefined
        }
        el.addEventListener('pointerdown', e => {
            if (e.button === 2) {
                clear()
                return
            }
            if (e.button !== 0) return
            longFired = false
            timer = setTimeout(() => {
                timer = undefined
                longFired = true
                clear()
            }, LONG_PRESS_MS)
        })
        el.addEventListener('pointerup', e => {
            if (e.button !== 0) return
            const pending = timer !== undefined
            cancel()
            if (pending && !longFired) activate()
        })
        el.addEventListener('pointerleave', cancel)
        el.addEventListener('pointercancel', cancel)
        // The page suppresses the native menu globally (index.ts), but the
        // right-click must not reach the canvas as a "mine entity" either.
        el.addEventListener('contextmenu', e => e.preventDefault())
    }

    /** One slot cell: icon (or initials), number-key badge, gestures. */
    const makeSlot = (index: number): HTMLButtonElement => {
        const cell = document.createElement('button')
        cell.type = 'button'
        // `qb-cell` is the shared box; `qb-slot` marks an *item* slot, which is
        // what the `?test` probe counts (the wire cells are not slots).
        cell.className = 'qb-cell qb-slot'
        cell.dataset.index = String(index)

        const icon = document.createElement('span')
        icon.className = 'qb-icon'
        cell.appendChild(icon)

        const hint = document.createElement('span')
        hint.className = 'qb-key'
        cell.appendChild(hint)

        bindSlotGestures(
            cell,
            () => model.activate(index),
            () => model.clear(index)
        )
        return cell
    }

    const slots = Array.from({ length: model.size }, (_, i) => makeSlot(i))

    // The wire toggles: paint items, so a tap holds the wire and a second tap
    // drops it (`Editor.togglePaintItem`). Colour-coded in CSS until the pack's
    // icon sheet loads and `packIcons.ts` swaps in the real sprite.
    const wireButtons = WIRE_ITEMS.map(name => {
        const label = WIRE_LABELS[name] ?? name
        const cell = document.createElement('button')
        cell.type = 'button'
        cell.className = `qb-cell qb-wire wire-${name.replace('-wire', '')}`
        cell.title = label
        cell.setAttribute('aria-label', label)
        const icon = document.createElement('span')
        icon.className = 'qb-icon'
        icon.dataset.packIcon = `item/${name}`
        icon.textContent = '∿'
        cell.appendChild(icon)
        cell.addEventListener('click', () => editor.togglePaintItem(name))
        return cell
    })
    wires.append(...wireButtons)

    /**
     * Number-key badges, read live from the registry (the Keybinds folder can
     * rebind them, and the second row is `⇧1`…`⇧5` rather than `6`…`0`).
     * Shown only when `keys` — CSS hides them otherwise.
     */
    const refreshHints = (): void => {
        const combos = new Map<string, string>()
        EDITOR.forEachAction(action => combos.set(action.name, action.keyCombo))
        slots.forEach((cell, i) => {
            const combo = combos.get(`quickbar${i + 1}`)
            const hint = cell.querySelector('.qb-key')
            if (hint) hint.textContent = combo ? formatKeyCombo(combo) : ''
            if (combo) cell.setAttribute('aria-keyshortcuts', combo)
            else cell.removeAttribute('aria-keyshortcuts')
        })
    }

    /** Paint each cell from the model (icon + title + empty/filled styling). */
    const renderSlots = (): void => {
        const items = model.serialize()
        slots.forEach((cell, i) => {
            const name = items[i]
            const icon = cell.querySelector<HTMLElement>('.qb-icon')
            cell.classList.toggle('empty', !name)
            cell.title = name ?? 'Empty slot'
            cell.setAttribute('aria-label', name ?? 'Empty quickbar slot')
            if (!icon) return
            // Reset whatever the previous item left behind before re-applying:
            // applyPackIcon writes inline background/size styles.
            icon.removeAttribute('style')
            icon.textContent = ''
            delete icon.dataset.packIcon
            if (!name) return
            icon.dataset.packIcon = `item/${name}`
            if (!applyPackIcon(icon, `item/${name}`, 28)) icon.textContent = initials(name)
        })
    }

    /**
     * Size and reflow from the signals, then publish the band we occupy.
     *
     * The bottom inset is what keeps the Pixi dialogs (which centre in
     * `G.safeArea`) off the bar — the same mechanism the rail uses for its
     * column and `viewportRegions.ts` for the top band. One writer per edge:
     * this module owns `bottom`.
     */
    const layout = (): void => {
        const { coarse, keys, compact } = inputMode.signals
        const cell = coarse ? COARSE_CELL : FINE_CELL
        const columns = compact ? COMPACT_COLUMNS : WIDE_COLUMNS

        bar.style.setProperty('--qb-cell', `${cell}px`)
        bar.classList.toggle('with-hints', keys)
        grid.style.gridTemplateColumns = `repeat(${columns}, ${cell}px)`

        // On a compact viewport only the first `columns × rows` cells are drawn;
        // the swap button rotates the rest into view. On a wide one every slot
        // is on screen and the swap button is just a shortcut.
        const shown = compact ? columns * model.rows : model.size
        slots.forEach((slotCell, i) => {
            slotCell.hidden = i >= shown
        })
        grid.replaceChildren(...slots.slice(0, shown))

        const hidden = compact && bandIsTaken(editor.mode)
        bar.classList.toggle('visible', !hidden)
        editor.setViewportInsets({
            bottom: hidden ? 0 : Math.ceil(bar.getBoundingClientRect().height) + 4,
        })
    }

    const refresh = (): void => {
        renderSlots()
        refreshHints()
        layout()
    }

    model.on('change', refresh)
    editor.onModeChange(layout)
    inputMode.on('signals', layout)
    window.addEventListener('resize', layout)
    // The pack's icon sheet lands after boot; re-render so the slots pick up
    // real sprites instead of their initials fallback.
    window.addEventListener('fbe:packicons', renderSlots)

    refresh()
}
