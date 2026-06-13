import { Text } from 'pixi.js'
import G from '../../../common/globals'
import { ISignal } from '../../../types'
import { Slot } from '../../controls/Slot'
import { bindSlotGestures } from '../../controls/gestures'
import { styles } from '../../style'
import F from '../../controls/functions'

/**
 * A single tappable signal slot used throughout the circuit editors. Shows the
 * current signal's icon (or a `+` placeholder when empty); a left tap opens the
 * `SignalPicker`, a right-click (or long-press handled by the picker) clears it.
 * Selection goes through the picker dialog rather than an inline list so the
 * editor itself stays compact on small screens.
 */
export class SignalSlot extends Slot<undefined> {
    private m_signal: ISignal | undefined

    public constructor(
        signal: ISignal | undefined,
        private readonly onChange: (signal: ISignal | undefined) => void,
        private readonly allowSpecial = true,
        private readonly title = 'Select a signal'
    ) {
        super(36, 36)
        this.m_signal = signal
        this.updateContent()
        bindSlotGestures(
            this,
            () => this.openPicker(),
            () => {
                this.signal = undefined
                this.onChange(undefined)
            }
        )
    }

    public get signal(): ISignal | undefined {
        return this.m_signal
    }

    public set signal(signal: ISignal | undefined) {
        this.m_signal = signal
        this.updateContent()
    }

    private updateContent(): void {
        if (this.m_signal?.name) {
            try {
                this.content = F.CreateIcon(this.m_signal.name)
                return
            } catch {
                // fall through to placeholder for an unknown/iconless signal name
            }
        }
        const placeholder = new Text({ text: '+', style: styles.dialog.label })
        placeholder.anchor.set(0.5)
        this.content = placeholder
    }

    private openPicker(): void {
        G.UI.createSignalPicker(
            this.title,
            choice => {
                this.signal = choice.signal
                this.onChange(choice.signal)
            },
            this.allowSpecial
        )
    }
}
