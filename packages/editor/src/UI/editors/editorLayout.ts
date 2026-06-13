/**
 * Shared sizing for the inline editor form (preview on the left, a label at
 * x=140 and its content — recipe slot / module grid — at x=208).
 *
 * Module slots used to be laid out in a single row, which ran off the dialog
 * for modded entities with many slots (SE's wide beacons have up to 20). These
 * helpers wrap the slots into a grid and grow the dialog to fit, so any slot
 * count stays on-screen. Small counts (vanilla's ≤4) still render as one row,
 * unchanged.
 */
const SLOT = 38
const MODULES_X = 208
const MAX_MODULE_COLUMNS = 8
const DIALOG_MIN_W = 402
const DIALOG_MIN_H = 171

/** Columns for a module grid of `slots` (single row until it would overflow). */
export function moduleColumns(slots: number): number {
    return Math.min(MAX_MODULE_COLUMNS, Math.max(1, slots))
}

/**
 * Dialog dimensions + module-grid column count for an editor whose module grid
 * starts at content-y `modulesY`. With `slots === 0` the grid contributes no
 * rows (the dialog only needs to fit whatever sits above `modulesY`).
 */
export function editorSize(
    slots: number,
    modulesY: number
): { width: number; height: number; columns: number } {
    const columns = moduleColumns(slots)
    const rows = slots > 0 ? Math.ceil(slots / columns) : 0
    const width = Math.max(DIALOG_MIN_W, MODULES_X + columns * SLOT + 12)
    const height = Math.max(DIALOG_MIN_H, modulesY + rows * SLOT + 12)
    return { width, height, columns }
}
