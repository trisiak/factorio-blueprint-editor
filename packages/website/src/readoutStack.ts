// The status readouts' shared container (#101 Slice 5).
//
// Both passive readouts — the entity-info sheet and the production-rates
// drawer — present as DOM for *every* input now that their Pixi counterparts
// are retired, and on a wide viewport they share the right edge exactly as the
// two canvas panels used to (info above, rates below). Two independently
// `position: fixed` boxes cannot stack like that without hard-coding one's
// height into the other's offset, so on a wide viewport they live in this flex
// column instead and the browser does the stacking.
//
// On a `compact` viewport the column dissolves (`display: contents`, see
// index.styl) and each readout falls back to its own fixed placement — the
// portrait/landscape sheet positions that the touch layout was designed
// around, which follow the reachability rule rather than a right-edge stack.
// So placement is decided by the `compact` signal and orientation, never by an
// input mode.
export function readoutStack(): HTMLElement {
    const existing = document.getElementById('readout-stack')
    if (existing) return existing
    const stack = document.createElement('div')
    stack.id = 'readout-stack'
    document.body.appendChild(stack)
    return stack
}
