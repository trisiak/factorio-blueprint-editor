import EventEmitter from 'eventemitter3'

/**
 * Input signals — the replacement for the old binary "input mode" (#101 Slice 1).
 *
 * The editor used to be in exactly one *input mode* at a time (`desktop` vs
 * `mobile`), auto-detected from `(pointer: coarse) || navigator.maxTouchPoints`.
 * That conflated three things that vary independently and excluded real
 * hardware: a touchscreen laptop reports `maxTouchPoints > 0` and booted into
 * the touch UI with the quickbar gone, despite having a mouse and a keyboard
 * (#101 B1).
 *
 * So detection is now a set of **orthogonal, live signals**, and *what kind of
 * pointer is acting* is no longer a global at all — `BlueprintContainer` routes
 * every pointer event by its own `pointerType` (#101 §1). The signals below only
 * describe the *environment*, and drive chrome/sizing:
 *
 * | signal        | source                                            |
 * |---------------|---------------------------------------------------|
 * | `coarse`      | `(pointer: coarse), (hover: none)` — the *primary* pointer, live |
 * | `keys`        | true on a fine pointer; on a coarse one, false until a real keydown |
 * | `compact`     | narrow viewport (live on resize / orientation)      |
 * | `touchRecent` | the last pointer event on `window` was `touch`      |
 *
 * `preset` (`auto` | `mouse` | `touch`) is a debugging/odd-hardware override of
 * the *inputs*, not a third pipeline: it forces which pointer types are accepted
 * and pins the derived compatibility mode below.
 *
 * **Compatibility.** `inputMode.mode` survives as a *derived* value (forced
 * preset wins, else `coarse ? 'mobile' : 'desktop'`) and still emits `change`,
 * so every consumer that hasn't been migrated yet (the website clusters, the
 * Pixi panels, `armMarquee`, …) keeps its current behaviour until its own slice
 * moves it onto the signals. It disappears once nothing reads it.
 */
export type InputMode = 'desktop' | 'mobile'

/** Override of the environment signals: auto-detect, or force one pointer kind. */
export type InputPreset = 'auto' | 'mouse' | 'touch'

export interface InputSignals {
    /** The primary pointer is coarse / can't hover (touch-first hardware). */
    coarse: boolean
    /** A physical keyboard is (assumed) present, so keybinds/hints are useful. */
    keys: boolean
    /** Narrow viewport — chrome should reflow (rail overflow, sheets, rows). */
    compact: boolean
    /** The most recent pointer event was a touch (micro-affordances only). */
    touchRecent: boolean
}

/** Where the preset is persisted. */
const PRESET_KEY = 'fbe:inputPreset'
/** The pre-#101 persisted *mode* choice; migrated to `auto`, then removed. */
const LEGACY_MODE_KEY = 'fbe:inputMode'

/**
 * Primary-pointer query. A comma-separated media-query *list* matches when
 * either half does: coarse pointer (touch/stylus) or no hover (same devices,
 * reported differently by some browsers). `maxTouchPoints` is deliberately not
 * consulted — a hybrid has touch points *and* a mouse, and it was exactly that
 * OR which mis-detected them (#101 B1).
 */
export const COARSE_QUERY = '(pointer: coarse), (hover: none)'

/**
 * Compact viewport threshold. `index.styl` has no width breakpoint of its own
 * today (its mobile blocks key off `body.mobile` plus `(orientation: …)`), so
 * this is the one place the number lives: 768 px is the portrait-tablet edge —
 * every phone in portrait, and a phone in landscape, is below it, while the
 * hybrid laptops this slice is about (1280 px+) are not.
 */
export const COMPACT_MAX_WIDTH = 768

// --- Pure decision logic (unit-tested in input.test.ts) ---------------------

/**
 * Resolve the persisted preset, migrating the pre-#101 `fbe:inputMode` value.
 *
 * The old key held a *forced* `desktop`/`mobile` choice, usually written by the
 * auto-detect-then-persist behaviour rather than by a deliberate pick. Carrying
 * it over would re-freeze the bug it caused, so it migrates to `auto` (the new
 * detection is strictly better) and the old key is dropped.
 */
export function migratePreset(
    rawPreset: string | null,
    legacyMode: string | null
): { preset: InputPreset; clearLegacy: boolean } {
    const preset =
        rawPreset === 'auto' || rawPreset === 'mouse' || rawPreset === 'touch' ? rawPreset : 'auto'
    return { preset, clearLegacy: legacyMode !== null }
}

/** The compatibility `mode`: a forced preset wins, else the primary pointer. */
export function deriveMode(preset: InputPreset, coarse: boolean): InputMode {
    if (preset === 'mouse') return 'desktop'
    if (preset === 'touch') return 'mobile'
    return coarse ? 'mobile' : 'desktop'
}

/** Setting the legacy `mode` is expressed as forcing the matching preset. */
export function presetForMode(mode: InputMode): InputPreset {
    return mode === 'mobile' ? 'touch' : 'mouse'
}

/**
 * A keyboard is assumed on a fine pointer (laptops/desktops always have one);
 * on touch-first hardware we wait for evidence — the first real keydown, e.g.
 * from a paired Bluetooth keyboard.
 */
export function deriveKeys(coarse: boolean, sawRealKeydown: boolean): boolean {
    return !coarse || sawRealKeydown
}

/** Compact is a viewport-width question, not a device one. */
export function isCompactWidth(width: number): boolean {
    return width <= COMPACT_MAX_WIDTH
}

/** `touchRecent` is a per-event reducer: touch sets it, mouse/pen clear it. */
export function reduceTouchRecent(prev: boolean, pointerType: string | undefined): boolean {
    if (pointerType === 'touch') return true
    if (pointerType === 'mouse' || pointerType === 'pen') return false
    return prev
}

/**
 * Does this keydown prove a *physical* keyboard?
 *
 * Rejected: synthetic events (`isTrusted === false` — our own e2e/test code, or
 * a script), IME/virtual-keyboard composition (`keyCode === 229` / an
 * `Unidentified` key), and anything typed into a focused text field on a coarse
 * device — that's the on-screen keyboard, which appears *because* a field got
 * focus and says nothing about hardware.
 */
export function isRealKeydown(e: {
    isTrusted?: boolean
    key?: string
    keyCode?: number
    intoEditable?: boolean
    coarse?: boolean
}): boolean {
    if (e.isTrusted === false) return false
    if (e.keyCode === 229 || e.key === 'Unidentified' || e.key === undefined) return false
    if (e.coarse && e.intoEditable) return false
    return true
}

/**
 * Which pointer types the *preset* lets through. `auto` accepts everything and
 * lets per-event routing decide; the two forced presets reproduce exactly what
 * the old binary mode did (desktop dropped touch, mobile dropped mouse).
 */
export function acceptsPointerType(preset: InputPreset, pointerType: string): boolean {
    if (preset === 'mouse') return pointerType !== 'touch'
    if (preset === 'touch') return pointerType !== 'mouse'
    return true
}

/** Pointers routed to the mouse/keyboard pipeline; touch gets the gesture one. */
export function isMousePipeline(pointerType: string): boolean {
    return pointerType !== 'touch'
}

// --- Controller -------------------------------------------------------------

interface InputEvents {
    /** The derived compatibility mode changed (legacy consumers). */
    change: [InputMode]
    /** Any environment signal changed. */
    signals: [InputSignals]
    /** The user (or a test) changed the preset. */
    preset: [InputPreset]
}

const isEditableTarget = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null
    if (!el || !el.tagName) return false
    const tag = el.tagName.toUpperCase()
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true
}

class InputController extends EventEmitter<InputEvents> {
    private _preset: InputPreset = 'auto'
    private _coarse = false
    private _compact = false
    private _touchRecent = false
    private _sawKeydown = false
    /** `?test`-only signal overrides (see `overrideSignals`). */
    private _overrides: Partial<Pick<InputSignals, 'coarse' | 'compact'>> = {}
    /** Last emitted derived mode, so `change` fires exactly on transitions. */
    private _mode: InputMode = 'desktop'

    public constructor() {
        super()
        if (typeof window === 'undefined') return

        const { preset, clearLegacy } = migratePreset(
            readStorage(PRESET_KEY),
            readStorage(LEGACY_MODE_KEY)
        )
        this._preset = preset
        if (clearLegacy) removeStorage(LEGACY_MODE_KEY)

        // Live media queries: a detachable keyboard / an external monitor flips
        // these without a reload, and so should the chrome that keys off them.
        const coarseMQ = window.matchMedia?.(COARSE_QUERY)
        this._coarse = coarseMQ?.matches ?? false
        coarseMQ?.addEventListener?.('change', e => {
            this._coarse = e.matches
            this.settle()
        })

        const compactMQ = window.matchMedia?.(`(max-width: ${COMPACT_MAX_WIDTH}px)`)
        this._compact = compactMQ?.matches ?? isCompactWidth(window.innerWidth ?? 0)
        compactMQ?.addEventListener?.('change', e => {
            this._compact = e.matches
            this.settle()
        })
        // Belt and braces for browsers whose MQL doesn't re-evaluate on an
        // orientation change (and it keeps the signal honest if the viewport is
        // resized by chrome insets rather than by the window).
        window.addEventListener('orientationchange', () => this.syncCompact())
        window.addEventListener('resize', () => this.syncCompact())

        // `touchRecent` follows the *last* pointer event anywhere on the page —
        // capture phase so a handler that stops propagation can't blind it.
        const notePointer = (e: PointerEvent): void => this.notePointerType(e.pointerType)
        window.addEventListener('pointerdown', notePointer, true)
        window.addEventListener('pointermove', notePointer, true)
        window.addEventListener('pointerup', notePointer, true)

        window.addEventListener(
            'keydown',
            (e: KeyboardEvent) => {
                if (this._sawKeydown) return
                if (
                    !isRealKeydown({
                        isTrusted: e.isTrusted,
                        key: e.key,
                        keyCode: e.keyCode,
                        intoEditable: isEditableTarget(e.target),
                        coarse: this.coarse,
                    })
                ) {
                    return
                }
                this._sawKeydown = true
                this.settle()
            },
            true
        )

        this._mode = deriveMode(this._preset, this.coarse)
    }

    private syncCompact(): void {
        if (typeof window === 'undefined') return
        const next = isCompactWidth(window.innerWidth)
        if (next === this._compact) return
        this._compact = next
        this.settle()
    }

    /** Fold a pointer event's type into `touchRecent`, emitting on a flip. */
    public notePointerType(pointerType: string | undefined): void {
        const next = reduceTouchRecent(this._touchRecent, pointerType)
        if (next === this._touchRecent) return
        this._touchRecent = next
        this.settle()
    }

    /**
     * Recompute the derived mode and announce. `signals` is for the new
     * consumers; `change` keeps firing on mode transitions for the ones that
     * still read `.mode`.
     */
    private settle(): void {
        this.emit('signals', this.signals)
        const next = deriveMode(this._preset, this.coarse)
        if (next === this._mode) return
        this._mode = next
        this.emit('change', next)
    }

    public get coarse(): boolean {
        return this._overrides.coarse ?? this._coarse
    }

    public get compact(): boolean {
        return this._overrides.compact ?? this._compact
    }

    public get keys(): boolean {
        return deriveKeys(this.coarse, this._sawKeydown)
    }

    public get touchRecent(): boolean {
        return this._touchRecent
    }

    public get signals(): InputSignals {
        return {
            coarse: this.coarse,
            keys: this.keys,
            compact: this.compact,
            touchRecent: this._touchRecent,
        }
    }

    public get preset(): InputPreset {
        return this._preset
    }

    public set preset(next: InputPreset) {
        if (next === this._preset) return
        this._preset = next
        writeStorage(PRESET_KEY, next)
        this.emit('preset', next)
        this.settle()
    }

    /**
     * Derived compatibility mode (#101 Slice 1). Read-only in spirit: consumers
     * that still branch on it keep working, and the setter below only exists so
     * the settings dropdown / `?test` hook can force the preset by mode name.
     */
    public get mode(): InputMode {
        return deriveMode(this._preset, this.coarse)
    }

    public set mode(next: InputMode) {
        this.preset = presetForMode(next)
    }

    /** true while nothing has been forced — the signals are in charge. */
    public get autodetected(): boolean {
        return this._preset === 'auto'
    }

    public toggle(): void {
        this.mode = this.mode === 'desktop' ? 'mobile' : 'desktop'
    }

    /**
     * `?test`-only: pin `coarse` / `compact` regardless of what the browser
     * reports. Headless Chromium ties `(pointer: coarse)` to its `isMobile`
     * emulation, so the hybrid e2e project (fine pointer + touch) can't
     * *observe* the coarse branches without this. Passing `undefined` for a key
     * releases the override back to the real media query.
     */
    public overrideSignals(next: Partial<Pick<InputSignals, 'coarse' | 'compact'>>): void {
        this._overrides = { ...this._overrides, ...next }
        for (const k of Object.keys(next) as (keyof typeof next)[]) {
            if (next[k] === undefined) delete this._overrides[k]
        }
        this.settle()
    }
}

function readStorage(key: string): string | null {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function writeStorage(key: string, value: string): void {
    try {
        localStorage.setItem(key, value)
    } catch {
        /* persistence is best-effort */
    }
}

function removeStorage(key: string): void {
    try {
        localStorage.removeItem(key)
    } catch {
        /* persistence is best-effort */
    }
}

/**
 * Process-wide input state. Read the signals (`coarse` / `keys` / `compact` /
 * `touchRecent`) or the `preset`; `.mode` is the derived legacy value.
 */
export const inputMode = new InputController()
