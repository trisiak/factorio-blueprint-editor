/**
 * Tiny browser-sniffing helpers. Sniffing is a last resort — everywhere else we
 * feature-detect — but a couple of input quirks are *browser* behaviours with no
 * feature to probe for, most notably Firefox's Shift+right-click (see #101):
 *
 * Firefox always opens its own context menu on Shift+right-click and does not
 * dispatch the `contextmenu` event to the page at all, so the app's global
 * `preventDefault` can't suppress it (Bugzilla 897379; the user-side opt-out is
 * `dom.event.contextmenu.shift_suppresses_event=false`, available since Firefox
 * 117 — bug 1759303). That makes `Shift+RMB` unusable as a binding there, so the
 * default for `copyEntitySettings` differs on Firefox.
 *
 * Kept framework-free and parameterised by the UA string so it is unit-testable.
 */

/**
 * Whether `userAgent` looks like Firefox (desktop or the iOS `FxiOS` build).
 * Defaults to the live `navigator.userAgent`, and reports `false` when there is
 * no `navigator` at all (node/vitest, SSR).
 */
export function isFirefox(userAgent?: string): boolean {
    const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : (navigator.userAgent ?? ''))
    // `Seamonkey` also carries `Firefox/`, but it shares the quirk, so matching
    // it is correct rather than a false positive.
    return /firefox\/|fxios\//i.test(ua)
}
