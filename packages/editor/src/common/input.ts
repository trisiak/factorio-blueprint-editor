import EventEmitter from 'eventemitter3'

/**
 * Which input scheme the editor is driving. The two are mutually exclusive: in
 * `desktop` the mouse/keyboard pipeline is live and touch is ignored; in
 * `mobile` the touch (pinch / tap / drag) pipeline is live and mouse is ignored.
 * Keeping exactly one active is what stops a touch tap from double-firing
 * through the browser's synthetic ("compatibility") mouse events.
 */
export type InputMode = 'desktop' | 'mobile'

const STORAGE_KEY = 'fbe:inputMode'

/** Default to touch when the primary pointer is coarse / the device reports touch. */
function detectDefault(): InputMode {
    if (typeof window === 'undefined') return 'desktop'
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
    const touch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || false
    return coarse || touch ? 'mobile' : 'desktop'
}

function loadPersisted(): InputMode | null {
    try {
        const v = localStorage.getItem(STORAGE_KEY)
        return v === 'desktop' || v === 'mobile' ? v : null
    } catch {
        return null
    }
}

interface InputModeEvents {
    change: [InputMode]
}

class InputModeController extends EventEmitter<InputModeEvents> {
    private _mode: InputMode
    /** true while the mode is still the auto-detected default (no explicit choice yet) */
    public readonly autodetected: boolean

    public constructor() {
        super()
        const persisted = loadPersisted()
        this.autodetected = persisted === null
        this._mode = persisted ?? detectDefault()
    }

    public get mode(): InputMode {
        return this._mode
    }

    public set mode(next: InputMode) {
        if (next === this._mode) return
        this._mode = next
        try {
            localStorage.setItem(STORAGE_KEY, next)
        } catch {
            /* persistence is best-effort */
        }
        this.emit('change', next)
    }

    public toggle(): void {
        this.mode = this._mode === 'desktop' ? 'mobile' : 'desktop'
    }
}

/** Process-wide input-mode state. Read `.mode`, set it, or listen for `'change'`. */
export const inputMode = new InputModeController()
