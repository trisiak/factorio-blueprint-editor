import { Text } from 'pixi.js'
import G from '../../common/globals'
import { colors, styles } from '../style'
import { Panel } from './Panel'
import { fitToWidthScale } from '../quickbarLayout'

/**
 * Base Dialog for usage whenever a dialog shall be shown to the user
 *
 * Per default the dialog
 *  + is not visible (this.visible = false)
 *  + is interactive (this.eventMode = 'static')
 *  + has interactive children (this.interactiveChildren = true)
 *  + automatically executes 'setDialogPosition()' on Browser Resizing
 */
export abstract class Dialog extends Panel {
    /** Stores all open dialogs */
    protected static s_openDialogs: Dialog[] = []

    public constructor(width: number, height: number, title?: string) {
        super(
            width,
            height,
            colors.dialog.background.color,
            colors.dialog.background.alpha,
            colors.dialog.background.border
        )

        this.visible = true
        this.eventMode = 'static'
        this.interactiveChildren = true

        if (title !== undefined) {
            this.addLabel(12, 10, title, styles.dialog.title)
        }

        Dialog.s_openDialogs.push(this)
        Dialog.announce()
    }

    /**
     * Mirror the open-dialog count to the DOM (`fbe:dialogs`, same bridge
     * pattern as `fbe:entityinfo`/`fbe:rates`). The browser composites DOM
     * above the canvas no matter what, so a canvas dialog can never out-stack
     * the website's DOM readouts (entity-info sheet, rates drawer) — the
     * website listens and hides them while any dialog is open instead. See
     * the layering contract in docs/mobile-layout-inventory.md.
     */
    private static announce(): void {
        window.dispatchEvent(
            new CustomEvent('fbe:dialogs', { detail: Dialog.s_openDialogs.length })
        )
    }

    /** Closes last open dialog */
    public static closeLast(): void {
        if (Dialog.anyOpen()) {
            Dialog.s_openDialogs[Dialog.s_openDialogs.length - 1].close()
        }
    }

    /** Closes all open dialogs */
    public static closeAll(): void {
        for (const d of Dialog.s_openDialogs) {
            d.close()
        }
    }

    /** @returns True if there is at least one dialog open */
    public static anyOpen(): boolean {
        return Dialog.s_openDialogs.length > 0
    }

    /**
     * Whether any *modal* is open — a Pixi dialog or one of the website's DOM
     * dialogs (#98). The DOM side is read off the dialog layer's
     * `fbe-dialog-open` body class (the layering contract's shared signal;
     * it also covers Pixi, but the explicit check keeps this correct in a
     * bare-editor embedding with no website dialog layer).
     */
    public static anyModalOpen(): boolean {
        return Dialog.anyOpen() || document.body.classList.contains('fbe-dialog-open')
    }

    /**
     * Close every open modal, DOM ones included — the `fbe:closedialogs`
     * bridge is the DOM dialogs' close signal, mirrored by the dialog layer.
     */
    public static closeAllModals(): void {
        Dialog.closeAll()
        window.dispatchEvent(new CustomEvent('fbe:closedialogs'))
    }

    /** Currently open dialogs, oldest first. Read-only; used by the `?test` probe. */
    public static get openDialogs(): readonly Dialog[] {
        return Dialog.s_openDialogs
    }

    public static isOpen<T extends Dialog>(dialog: T): boolean {
        return !!Dialog.s_openDialogs.find(d => d === dialog)
    }

    /** Capitalize String */
    protected static capitalize(text: string): string {
        return text
            .split('_')
            .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' ')
    }

    /**
     * Center the dialog, scaling it down first if it's wider than the viewport.
     * The editors/dialogs are laid out at fixed desktop widths (up to 504px), so
     * on a phone in portrait they'd overflow; this mirrors the quickbar's
     * fit-to-width approach (see quickbarLayout) and clamps as a backstop.
     */
    protected override setPosition(): void {
        const sa = G.safeArea
        const scale = fitToWidthScale(sa.width, this.width)
        this.scale.set(scale)
        this.clampToSafeArea(
            sa.x + sa.width / 2 - (this.width * scale) / 2,
            sa.y + sa.height / 2 - (this.height * scale) / 2
        )
    }

    /** Close Dialog */
    public close(): void {
        Dialog.s_openDialogs = Dialog.s_openDialogs.filter(d => d !== this)
        Dialog.announce()

        this.emit('close')
        this.destroy()
    }

    /**
     * Add Label to Dialog
     * @description Defined in base dialog class so extensions of dialog can use it
     * @param x - Horizontal position of label from top left corner
     * @param y - Vertical position of label from top left corner
     * @param text - Text for label
     * @param style - Style of label
     * @returns Reference to Text for further usage
     */
    protected addLabel(x = 140, y = 56, text = 'Recipe:', style = styles.dialog.label): Text {
        const label = new Text({ text, style })
        label.position.set(x, y)
        this.addChild(label)

        // Return label in case extension wants to use it
        return label
    }
}
