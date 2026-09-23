import { Entity } from '../../core/Entity'
import { ISignal } from '../../types'
import { Checkbox } from '../controls/Checkbox'
import { TextInput } from '../controls/TextInput'
import { NumericField } from '../controls/NumericField'
import { SignalSlot } from './components/SignalSlot'
import { ColorSwatches } from './components/ColorSwatches'
import { Editor } from './Editor'
import G from '../../common/globals'

/**
 * Train Stop Editor — the full post-2.0 configuration surface: station name,
 * manual trains limit, priority (2.0), the sign colour (preset swatches +
 * reset) and the circuit pane (enable condition, send-to/read-from train, and
 * the four flag+signal outputs). The name and
 * limit stay DOM `TextInput`s — free text needs the OS keyboard (#56 made that
 * overlay work on touch); priority uses the canvas `NumericField` like every
 * other pure-numeric field, and the circuit rows reuse the combinator editors'
 * touch-first building blocks (`Checkbox` fires on pointerdown, `SignalSlot`
 * long-press-clears via the picker).
 */
export class TrainStopEditor extends Editor {
    public constructor(entity: Entity) {
        super(446, 390, entity)

        this.addLabel(140, 46, 'Station Name:')
        // The length is arbitrary, but the Textbox doesn't work right without it
        const stationTextBox = new TextInput(G.app.renderer, 250, entity.station, 100)
        stationTextBox.position.set(140, 65)
        this.addChild(stationTextBox)

        const isLimitDefined = this.m_Entity.manualTrainsLimit !== undefined
        const limitCheckBox = new Checkbox(isLimitDefined, 'Enable train limit')
        limitCheckBox.position.set(140, 97)
        this.addChild(limitCheckBox)

        const trainsLimitString =
            this.m_Entity.manualTrainsLimit === undefined
                ? ''
                : this.m_Entity.manualTrainsLimit.toString()
        const limitTextbox = new TextInput(G.app.renderer, 30, trainsLimitString, 3, true)
        limitTextbox.position.set(275, 95)
        this.addChild(limitTextbox)

        // 2.0 priority — 0-255, 50 = default. The setter clamps and treats 50 as
        // "unset" (the game omits the default), so read back after writing rather
        // than trusting the keypad's raw value.
        this.addLabel(140, 130, 'Priority:')
        const priorityField = new NumericField(
            this.m_Entity.trainStopPriority,
            v => {
                this.m_Entity.trainStopPriority = v
                priorityField.value = this.m_Entity.trainStopPriority
            },
            'Station priority (0-255)',
            64,
            false // 0-255, so no sign key / `-` keybind
        )
        priorityField.position.set(275, 122)
        this.addChild(this.registerControl('priority', priorityField))

        // Colour of the station sign: one tap per swatch, live on the sprite
        // (`EntityContainer` rebuilds on the `color` event). ✕ resets to the
        // prototype default (removes `color` from the export, like the game).
        this.addLabel(140, 166, 'Color:')
        const swatches = new ColorSwatches(this.m_Entity.trainStopColor, color => {
            this.m_Entity.trainStopColor = color
        })
        swatches.position.set(210, 158)
        this.addChild(swatches)

        this.addLabel(12, 196, 'Circuit network')
        this.addCircuitCondition(12, 216)

        // The circuit flags, wired checkbox → entity setter. Rows with an output
        // signal sit in the right column beside the enable-condition block; the
        // slot-less pair fills the space under it. Each SignalSlot writes through
        // its own setter so a picked signal survives the flag being toggled.
        const flag = (
            x: number,
            y: number,
            text: string,
            checked: boolean,
            onChange: (checked: boolean) => void
        ): Checkbox => {
            const box = new Checkbox(checked, text)
            box.position.set(x, y)
            box.on('changed', () => onChange(box.checked))
            this.addChild(box)
            return box
        }
        const signal = (
            x: number,
            y: number,
            current: ISignal | undefined,
            title: string,
            onChange: (signal: ISignal | undefined) => void
        ): SignalSlot => {
            const slot = new SignalSlot(current, onChange, true, title)
            slot.position.set(x, y)
            this.addChild(slot)
            return slot
        }

        const sendToTrain = flag(12, 316, 'Send to train', this.m_Entity.sendToTrain, v => {
            this.m_Entity.sendToTrain = v
        })
        const readFromTrain = flag(12, 342, 'Read from train', this.m_Entity.readFromTrain, v => {
            this.m_Entity.readFromTrain = v
        })

        const col = 230
        const slotX = col + 158
        const readStopped = flag(
            col,
            225,
            'Read stopped train',
            this.m_Entity.readStoppedTrain,
            v => {
                this.m_Entity.readStoppedTrain = v
            }
        )
        const stoppedSignal = signal(
            slotX,
            216,
            this.m_Entity.trainStoppedSignal,
            'Stopped train signal',
            s => {
                this.m_Entity.trainStoppedSignal = s
            }
        )
        const setLimit = flag(col, 267, 'Set trains limit', this.m_Entity.setTrainsLimit, v => {
            this.m_Entity.setTrainsLimit = v
        })
        const limitSignal = signal(
            slotX,
            258,
            this.m_Entity.trainsLimitSignal,
            'Trains limit signal',
            s => {
                this.m_Entity.trainsLimitSignal = s
            }
        )
        const readCount = flag(col, 309, 'Read trains count', this.m_Entity.readTrainsCount, v => {
            this.m_Entity.readTrainsCount = v
        })
        const countSignal = signal(
            slotX,
            300,
            this.m_Entity.trainsCountSignal,
            'Trains count signal',
            s => {
                this.m_Entity.trainsCountSignal = s
            }
        )
        const setPriority = flag(col, 351, 'Set priority', this.m_Entity.setPriority, v => {
            this.m_Entity.setPriority = v
        })
        const prioritySignal = signal(
            slotX,
            342,
            this.m_Entity.prioritySignal,
            'Priority signal',
            s => {
                this.m_Entity.prioritySignal = s
            }
        )

        stationTextBox.on('changed', () => {
            this.m_Entity.station = stationTextBox.text
        })

        limitCheckBox.on('changed', () => {
            if (limitCheckBox.checked) {
                this.m_Entity.manualTrainsLimit = 0
                limitTextbox.text = '0'
            } else {
                this.m_Entity.manualTrainsLimit = undefined
                limitTextbox.text = ''
            }
        })

        limitTextbox.on('changed', () => {
            let limit: number = parseInt(limitTextbox.text)
            if (isNaN(limit)) {
                limit = undefined
            }

            this.m_Entity.manualTrainsLimit = limit
            limitCheckBox.checked = limit !== undefined && limit >= 0
        })

        this.onEntityChange('station', () => {
            stationTextBox.text = this.m_Entity.station
        })

        this.onEntityChange('manualTrainsLimit', () => {
            const limit = this.m_Entity.manualTrainsLimit
            limitTextbox.text = limit === undefined ? '' : `${limit}`
            limitCheckBox.checked = limit !== undefined && limit >= 0
        })

        this.onEntityChange('trainStopPriority', () => {
            priorityField.value = this.m_Entity.trainStopPriority
        })

        this.onEntityChange('color', () => {
            swatches.value = this.m_Entity.trainStopColor
        })

        // Every circuit mutation lands as one `controlBehavior` event (undo/redo
        // and paste-settings included), so one refresh syncs the whole pane —
        // e.g. enabling "read stopped train" seeds signal-T, which has to appear
        // in the slot without the slot having been touched.
        this.onEntityChange('controlBehavior', () => {
            sendToTrain.checked = this.m_Entity.sendToTrain
            readFromTrain.checked = this.m_Entity.readFromTrain
            readStopped.checked = this.m_Entity.readStoppedTrain
            stoppedSignal.signal = this.m_Entity.trainStoppedSignal
            setLimit.checked = this.m_Entity.setTrainsLimit
            limitSignal.signal = this.m_Entity.trainsLimitSignal
            readCount.checked = this.m_Entity.readTrainsCount
            countSignal.signal = this.m_Entity.trainsCountSignal
            setPriority.checked = this.m_Entity.setPriority
            prioritySignal.signal = this.m_Entity.prioritySignal
        })

        // e2e probe targets — the canvas has no DOM to query, so the spec asks
        // for these controls' on-screen centres by name (`editorControlPos`).
        this.registerControl('priority', priorityField)
        this.registerControl('colorRed', swatches.firstSwatch)
        this.registerControl('colorReset', swatches.resetSwatch)
        this.registerControl('sendToTrain', sendToTrain)
        this.registerControl('readFromTrain', readFromTrain)
        this.registerControl('readStoppedTrain', readStopped)
        this.registerControl('stoppedSignal', stoppedSignal)
        this.registerControl('setTrainsLimit', setLimit)
        this.registerControl('limitSignal', limitSignal)
        this.registerControl('readTrainsCount', readCount)
        this.registerControl('countSignal', countSignal)
        this.registerControl('setPriority', setPriority)
        this.registerControl('prioritySignal', prioritySignal)
    }
}
