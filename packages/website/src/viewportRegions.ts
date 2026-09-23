import { Editor } from '@fbe/editor'

// Viewport regions (#89 Phase 1): the website side of the layout authority.
//
// The action rail reserves the *left* band; this module does the same for the
// *top* — the strip occupied by the fixed top DOM chrome (the corner logo and
// the active-project pill). The reservation goes through
// `editor.setViewportInsets({ top })`, which bounds `G.safeArea` — the rect the
// Pixi panels anchor and clamp within — so panels that anchor to the top
// (entity-info, rates) start *below* the chrome instead of being covered by it.
// DOM always renders above the canvas, so reserving the band is the only way a
// canvas panel can win. The canvas itself stays full-bleed: the world renders
// under the chrome and shows through the empty parts of the bands. Measured
// live (ResizeObserver), not hardcoded: the pill's height is styling, the
// logo's is an image.
//
// One writer per edge: the rail owns `left`, this module owns `top`;
// `setViewportInsets` merges partials, so they compose. It used to be
// mobile-only, like the rail — since #101 Slice 4 both run in every layout.
//
// What's reserved is *what actually overlaps the canvas*, which is why the
// rail's width is read here (never written): the logo and the folded corner
// buttons sit inside the rail's column, so they are already outside the safe
// area horizontally, and reserving a full-width band for them would cost every
// layout ~50 px of top for nothing. Only chrome that reaches past the column —
// in practice the top-centre pill — contributes.
//
// Follow-up idea (deliberately not built yet): with the top band reserved, the
// rail could *wrap around the corner* in portrait — overflow buttons flowing
// along the band instead of hiding behind the ⋯ sheet. Tracked in #89.
export function initViewportRegions(editor: Editor): void {
    const chrome = ['corner-panel', 'active-project']
        .map(id => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null)
    const rail = document.getElementById('action-toolbar')

    // Skip the redundant renderer.resize when nothing moved — layout() re-runs
    // on window resizes, where the chrome's bottom edge usually hasn't changed.
    let lastTop = -1
    const layout = (): void => {
        const railWidth =
            rail && rail.classList.contains('visible')
                ? Math.round(rail.getBoundingClientRect().width)
                : 0
        let top = 0
        for (const el of chrome) {
            const r = el.getBoundingClientRect()
            // A hidden element reports a zero rect — don't reserve for it. Nor
            // for chrome the rail's column already covers (see above).
            if (r.height > 0 && r.right > railWidth) top = Math.max(top, Math.ceil(r.bottom))
        }
        if (top !== lastTop) {
            lastTop = top
            editor.setViewportInsets({ top })
        }
    }

    layout()
    window.addEventListener('resize', layout)
    // The pill's width tracks the active project's name; the logo image loads
    // async; the rail's column widens/narrows with the `coarse` signal.
    // Re-measure when any of them actually changes size. (Not wired to
    // `fbe:viewportchange` — that event is *caused* by setViewportInsets, and
    // the chrome is position:fixed, unaffected by the canvas resizing.)
    if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(layout)
        for (const el of chrome) observer.observe(el)
        if (rail) observer.observe(rail)
    }
}
