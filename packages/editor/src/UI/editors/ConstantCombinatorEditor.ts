import { Container } from 'pixi.js'
import G from '../../common/globals'
import { Entity } from '../../core/Entity'
import { ISignal, LogisticFilter } from '../../types'
import FD from '../../core/factorioData'
import { Slot } from '../controls/Slot'
import { NumericField } from '../controls/NumericField'
import { bindSlotGestures } from '../controls/gestures'
import { Editor } from './Editor'
import F from '../controls/functions'

const COLS = 6
const ROWS = 3
const SLOTS = COLS * ROWS
const STEP = 38

/**
 * Constant combinator editor: a grid of signal slots (one section). Tap an empty
 * slot to pick a signal (count defaults to 1); tap a filled slot to select it and
 * edit its value in the shared count field below; right-click clears it. Mirrors
 * the in-game layout and reuses the same big-tap-target grid as the chest editor
 * so it stays usable on a phone.
 */
export class ConstantCombinatorEditor extends Editor {
    private readonly m_filters: (LogisticFilter | undefined)[] = new Array(SLOTS).fill(undefined)
    private readonly slots: Slot<number>[] = []
    private readonly countField: NumericField
    private selected = -1

    public constructor(entity: Entity) {
        super(380, 230, entity)

        // Seed from the entity's first section, placing each filter at its slot.
        for (const f of entity.constantCombinatorSection) {
            const i = f.index - 1
            if (i >= 0 && i < SLOTS) this.m_filters[i] = { ...f }
        }

        const x = 16
        const y = 50
        for (let i = 0; i < SLOTS; i++) {
            const slot = new Slot<number>()
            slot.data = i
            slot.position.set(x + (i % COLS) * STEP, y + Math.floor(i / COLS) * STEP)
            bindSlotGestures(
                slot,
                () => this.activateSlot(i),
                () => this.clearSlot(i)
            )
            this.addChild(slot)
            this.slots.push(slot)
        }

        this.addLabel(x, y + ROWS * STEP + 8, 'Value:')
        this.countField = new NumericField(
            undefined,
            v => this.onCountChanged(v),
            'Signal value',
            70
        )
        this.countField.position.set(x + 52, y + ROWS * STEP + 4)
        this.addChild(this.countField)

        this.refreshSlots()
    }

    private clearSlot(i: number): void {
        this.m_filters[i] = undefined
        if (this.selected === i) this.select(-1)
        this.commit()
        this.refreshSlots()
    }

    private activateSlot(i: number): void {
        if (this.m_filters[i] === undefined) {
            G.UI.createSignalPicker(
                'Select a signal',
                choice => this.setSlot(i, choice.signal),
                false // constant combinators can't hold each/everything/anything
            )
        } else {
            this.select(i)
        }
    }

    private setSlot(i: number, signal: ISignal | undefined): void {
        if (!signal?.name) return
        const type = (
            FD.fluids[signal.name] ? 'fluid' : FD.signals[signal.name] ? 'virtual' : 'item'
        ) as 'item' | 'fluid' | 'virtual'
        this.m_filters[i] = {
            index: i + 1,
            name: signal.name,
            type,
            quality: 'normal',
            comparator: '=',
            count: this.m_filters[i]?.count ?? 1,
        }
        this.commit()
        this.refreshSlots()
        this.select(i)
    }

    private select(i: number): void {
        this.selected = i
        for (const [idx, slot] of this.slots.entries()) slot.active = idx === i
        this.countField.value = i >= 0 && this.m_filters[i] ? this.m_filters[i]!.count : undefined
    }

    private onCountChanged(value: number): void {
        if (this.selected < 0 || !this.m_filters[this.selected]) return
        this.m_filters[this.selected]!.count = value
        this.commit()
        this.refreshSlots()
    }

    private refreshSlots(): void {
        for (const [i, slot] of this.slots.entries()) {
            const f = this.m_filters[i]
            if (!f?.name) {
                if (slot.content !== undefined) slot.content = undefined
                continue
            }
            const container = new Container()
            try {
                F.CreateIconWithAmount(container, -16, -16, f.name, f.count)
            } catch {
                // ignore an iconless modded signal; the slot stays usable
            }
            slot.content = container
        }
    }

    private commit(): void {
        this.m_Entity.constantCombinatorSection = this.m_filters.filter(
            (f): f is LogisticFilter => f !== undefined && !!f.name
        )
    }
}
