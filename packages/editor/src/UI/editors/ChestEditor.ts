import { Text } from 'pixi.js'
import { Entity } from '../../core/Entity'
import { styles } from '../style'
import { NumericField } from '../controls/NumericField'
import { Checkbox } from '../controls/Checkbox'
import { CycleButton } from '../controls/CycleButton'
import { Editor } from './Editor'

/** `circuit_mode_of_operation` labels, index-aligned with the define (0/1/2). */
const CHEST_CIRCUIT_MODES = ['send contents', 'set requests', 'none'] as const

/**
 * Logistic chest editor — the request list for requester/buffer chests and the
 * single filter of a storage chest.
 *
 * - **storage** — 1 slot, no count.
 * - **requester** — request list + "request from buffer chests".
 * - **buffer** — request list.
 *
 * Counts use the canvas-rendered `NumericField`/`NumericKeypad` rather than the
 * DOM `TextInput`, which was unusable on touch when this editor was built (#56,
 * since fixed) — and the keypad remains the better fit here: fewer taps than an
 * OS keyboard for small counts. That also drops the old slider: the keypad
 * covers the same range without a drag target that fights the dialog for
 * pointer events.
 */
export class ChestEditor extends Editor {
    /** Whether this chest has request *counts* (storage chests filter only). */
    private readonly m_Amount: boolean

    /** Slot index whose count the field is currently editing, or -1 for none. */
    private m_Filter: number

    public constructor(entity: Entity) {
        const hasFilters = entity.filterSlots > 0
        const rows = Math.ceil(entity.filterSlots / 6)
        const filterAreaHeight = hasFilters ? rows * 38 + Math.min(0, rows - 1) * 2 : 0
        const isRequester = entity.logisticMode === 'requester'
        const hasCount = hasFilters && entity.logisticMode !== 'storage'
        const requesterCheckboxHeight = isRequester ? 23 + 6 : 0
        const countAreaHeight = hasCount ? 32 + 6 : 0
        const circuitY = 45 + filterAreaHeight + requesterCheckboxHeight + countAreaHeight + 6

        super(446, Math.max(171, circuitY + 32 + 12), entity)

        this.m_Amount = hasCount
        this.m_Filter = -1

        let yOffset = 45

        if (hasFilters) {
            this.addLabel(140, 56, `Filter${this.m_Entity.filterSlots === 1 ? '' : 's'}:`)
        }
        // Providers request nothing (filterSlots 0) and used to open no editor
        // at all — the circuit mode below is what makes one worth opening now.
        const filters = hasFilters ? this.addFilters(208, yOffset, this.m_Amount) : undefined
        yOffset += filterAreaHeight

        // What the wired chest does with the circuit network: broadcast its
        // contents (the default, omitted from the export), have its requests
        // set from signals, or nothing. "Set requests" only exists for chests
        // that *have* requests — requester/buffer — so the cycle skips it for
        // storage and provider chests (the labels still map to the full enum,
        // so 'none' keeps its define value 2).
        const canSetRequests =
            this.m_Entity.logisticMode === 'requester' || this.m_Entity.logisticMode === 'buffer'
        const availableModes = canSetRequests
            ? (CHEST_CIRCUIT_MODES as unknown as (typeof CHEST_CIRCUIT_MODES)[number][])
            : CHEST_CIRCUIT_MODES.filter(m => m !== 'set requests')
        this.addLabel(140, circuitY + 10, 'Circuit:')
        const circuitMode = new CycleButton<(typeof CHEST_CIRCUIT_MODES)[number]>(
            availableModes,
            CHEST_CIRCUIT_MODES[this.m_Entity.chestCircuitMode] ?? 'send contents',
            v => {
                this.m_Entity.chestCircuitMode = CHEST_CIRCUIT_MODES.indexOf(v)
            },
            110
        )
        circuitMode.position.set(208, circuitY)
        this.addChild(this.registerControl('circuitMode', circuitMode))
        this.onEntityChange('controlBehavior', () => {
            circuitMode.value =
                CHEST_CIRCUIT_MODES[this.m_Entity.chestCircuitMode] ?? 'send contents'
        })

        // A storage chest has no counts, so the rest of the form doesn't apply.
        if (!this.m_Amount) return

        if (isRequester) {
            const checkbox = new Checkbox(
                this.m_Entity.requestFromBufferChest,
                'Request from buffer chests'
            )
            yOffset += 6
            checkbox.position.set(208, yOffset)
            yOffset += 22
            checkbox.on('changed', () => {
                this.m_Entity.requestFromBufferChest = checkbox.checked
            })
            this.onEntityChange('requestFromBufferChest', () => {
                checkbox.checked = this.m_Entity.requestFromBufferChest
            })
            this.addChild(checkbox)
        }

        const label = new Text({ text: 'Count:', style: styles.dialog.label })
        label.position.set(140, yOffset + 14)
        label.visible = false
        this.addChild(label)

        const count = new NumericField(
            undefined,
            value => filters.updateFilter(this.m_Filter, value),
            'Request count',
            80,
            false // a request count is never negative
        )
        count.position.set(208, yOffset + 6)
        count.visible = false
        this.addChild(count)

        const showCount = (visible: boolean): void => {
            label.visible = visible
            count.visible = visible
        }

        // `selected` fires with the slot index and its count when a filled slot is
        // tapped (and with -1 when one is cleared), which is what drives the count
        // field in and out of view.
        filters.on('selected', (index: number, value: number) => {
            if (index < 0) {
                this.m_Filter = -1
                showCount(false)
                return
            }
            this.m_Filter = index
            count.value = value
            showCount(true)
        })

        this.onEntityChange('filters', () => {
            if (this.m_Filter < 0) return
            const value = filters.getFilterCount(this.m_Filter)
            count.value = value
            // The slot behind the field was cleared — stop offering a count for it.
            if (value === undefined) {
                this.m_Filter = -1
                showCount(false)
            }
        })
    }
}
