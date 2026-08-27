import type { Editor, Entity } from '@fbe/editor'
import { itemDisplayName } from '@fbe/editor'
import { applyAnyPackIcon } from '../packIcons'
import { openDialogShell } from './shell'
import { openItemPicker } from './itemPicker'

// The DOM entity editor (#98 Slice 2) — the mobile presentation of an
// entity's editor dialog, one entity kind at a time. The editor package
// routes here from `UIContainer.openEntityEditor` over `fbe:openentityeditor`
// for the kinds whose DOM editor has shipped (today: 'machine' — assembling
// machines, i.e. the recipe+modules form behind the recipe-changing bug);
// every other kind keeps its Pixi editor until its slice lands.
//
// The event detail carries the live `Entity` — same JS runtime, no
// serialization — so this is a straight port of the Pixi components' pattern:
// read the entity's accessors, write through its History-wrapped setters, and
// subscribe to its change events so undo/redo and concurrent edits reflect
// live. Slots keep the touch semantics the Pixi editors established: tap
// opens the filtered picker (recipes confirm-gated, modules commit-on-tap),
// long-press clears, and the picker's ✕ Clear/Cancel is the no-gesture route.
//
// #98 open decision, resolved for v1: no live sprite preview — the Pixi
// preview renders from the .basis atlas (canvas-only); the header carries the
// entity's pack-sheet icon instead. Revisit with a render-to-texture
// extraction if the preview is missed.

/** How long a press must hold to clear a slot — matches the Pixi editors. */
const LONG_PRESS_MS = 450

export function initEntityEditor(editor: Editor): void {
    window.addEventListener('fbe:openentityeditor', e => {
        // Kinds are gated editor-side (UIContainer.openEntityEditor), so
        // whatever arrives here has a DOM editor; today that's machines only.
        openMachineEditor(editor, (e as CustomEvent<{ entity: Entity }>).detail.entity)
    })
}

function openMachineEditor(editor: Editor, entity: Entity): void {
    const cleanups: (() => void)[] = []
    const shell = openDialogShell({
        title: (entity.entityData.localised_name as string) ?? entity.name,
        className: 'entity-editor',
        onClose: () => {
            for (const fn of cleanups) fn()
        },
    })
    // Entity's emitter API is exact-typed per event; this editor subscribes to
    // a hand-picked few, so a narrow string-keyed view keeps the port simple.
    const events = entity as unknown as {
        on: (event: string, fn: () => void) => void
        off: (event: string, fn: () => void) => void
        once: (event: string, fn: () => void) => void
    }
    const onEntityChange = (event: string, fn: () => void): void => {
        events.on(event, fn)
        cleanups.push(() => events.off(event, fn))
    }

    // Header icon: the entity's own item icon stands in for the Pixi sprite
    // preview (see the file comment).
    const headerIcon = document.createElement('span')
    headerIcon.className = 'ee-icon'
    applyAnyPackIcon(headerIcon, entity.name, 28)
    shell.header.insertBefore(headerIcon, shell.header.firstChild)

    /**
     * A tappable slot with the shared gesture wiring: tap → `open`, hold
     * `LONG_PRESS_MS` → `clear` (and the tap is swallowed). The pointer-timer
     * shape mirrors the Pixi `bindSlotGestures`.
     */
    const slot = (className: string, open: () => void, clear: () => void): HTMLButtonElement => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = `ee-slot ${className}`
        let timer: ReturnType<typeof setTimeout> | undefined
        let held = false
        btn.addEventListener('pointerdown', () => {
            held = false
            timer = setTimeout(() => {
                timer = undefined
                held = true
                clear()
            }, LONG_PRESS_MS)
        })
        const cancel = (): void => {
            if (timer) clearTimeout(timer)
            timer = undefined
        }
        btn.addEventListener('pointerleave', cancel)
        btn.addEventListener('pointercancel', cancel)
        btn.addEventListener('pointerup', cancel)
        btn.addEventListener('click', () => {
            // A click always follows pointerup; swallow it when the hold fired.
            if (held) {
                held = false
                return
            }
            open()
        })
        return btn
    }

    const slotIcon = (btn: HTMLElement, name: string | undefined): void => {
        btn.replaceChildren()
        if (name === undefined) return
        const icon = document.createElement('span')
        if (!applyAnyPackIcon(icon, name, 32)) icon.textContent = itemDisplayName(name)
        btn.appendChild(icon)
    }

    const row = (label: string): { row: HTMLElement; slots: HTMLElement } => {
        const el = document.createElement('div')
        el.className = 'ee-row'
        const lbl = document.createElement('span')
        lbl.className = 'ee-label'
        lbl.textContent = label
        const slots = document.createElement('span')
        slots.className = 'ee-slots'
        el.append(lbl, slots)
        shell.body.appendChild(el)
        return { row: el, slots }
    }

    // --- Recipe -------------------------------------------------------------
    const clearRecipe = (): void => {
        entity.recipe = undefined
    }
    const recipeSlot = slot(
        'ee-recipe-slot',
        () =>
            openItemPicker(editor, {
                title: 'Select Recipe',
                itemsFilter: entity.acceptedRecipes,
                recentsKey: 'recipes',
                onPick: name => {
                    entity.recipe = name
                },
                // "✕ Clear" once a recipe is set, "✕ Cancel" before then — a
                // first-time pick needs a way out too.
                clear: { onClear: clearRecipe, filled: entity.recipe !== undefined },
            }),
        clearRecipe
    )
    row('Recipe:').slots.appendChild(recipeSlot)
    slotIcon(recipeSlot, entity.recipe)
    onEntityChange('recipe', () => slotIcon(recipeSlot, entity.recipe))

    // --- Modules ------------------------------------------------------------
    if (entity.moduleSlots !== 0) {
        const { slots } = row('Modules:')
        const moduleSlots: HTMLElement[] = []
        const clearModule = (index: number): void => {
            const modules = entity.modules
            modules[index] = undefined
            entity.modules = modules
        }
        for (let i = 0; i < entity.moduleSlots; i++) {
            const btn = slot(
                'ee-module-slot',
                () =>
                    openItemPicker(editor, {
                        title: 'Select Module',
                        itemsFilter: entity.acceptedModules,
                        recentsKey: 'modules',
                        // One picker per slot for near-identical icons — the
                        // confirm step doubles the taps for a known choice.
                        commitOnTap: true,
                        onPick: name => {
                            const modules = entity.modules
                            modules[i] = name
                            entity.modules = modules
                        },
                        clear: {
                            onClear: () => clearModule(i),
                            filled: entity.modules[i] !== undefined,
                        },
                    }),
                () => clearModule(i)
            )
            btn.dataset.index = String(i)
            slots.appendChild(btn)
            moduleSlots.push(btn)
            slotIcon(btn, entity.modules[i])
        }
        onEntityChange('modules', () => {
            const modules = entity.modules
            moduleSlots.forEach((btn, i) => slotIcon(btn, modules[i]))
        })
    }

    // The clear-a-slot hint — the same discoverability line the Pixi editors
    // reserve a footer band for. This editor only exists on touch, so the
    // gesture named is the hold.
    const hint = document.createElement('div')
    hint.className = 'ee-hint'
    hint.textContent = 'Hold a slot to clear it'
    shell.body.appendChild(hint)

    // The entity vanishing (deleted, undone) takes its editor with it.
    const onDestroy = (): void => shell.close()
    events.once('destroy', onDestroy)
    cleanups.push(() => events.off('destroy', onDestroy))
}
