import { test, type TestInfo } from '@playwright/test'

/**
 * Which *kind* of project is a spec running under?
 *
 * The matrix used to be Chromium-only, so specs guarded on the literal project
 * name (`project.name !== 'desktop-chromium'`). Adding `desktop-firefox` (#103)
 * broke that reading: those guards mean "needs a mouse + keyboard", not "needs
 * Chrome". So the guards key off **capabilities** instead — a project is a touch
 * project iff its device descriptor sets `hasTouch` — and every new browser in
 * the desktop half of the matrix picks up the whole desktop suite for free.
 *
 * Use these rather than open-coding a project-name comparison:
 *
 * ```ts
 * test.beforeEach(() => {
 *     test.skip(!isDesktopProject(), 'desktop mouse pipeline only')
 * })
 * ```
 *
 * The one guard that legitimately stays browser-specific is
 * {@link isChromiumProject} — see its comment.
 */

/** A touch project (Pixel 7 & friends): `hasTouch`, so the mobile input mode auto-detects. */
export function isTouchProject(info: TestInfo = test.info()): boolean {
    return !!info.project.use.hasTouch
}

/** A desktop project (`desktop-chromium`, `desktop-firefox`): mouse + keyboard, no touch. */
export function isDesktopProject(info: TestInfo = test.info()): boolean {
    return !isTouchProject(info)
}

/**
 * A Chromium-backed project. Only for things that genuinely need Chrome, not for
 * "desktop" — today that's raw CDP (`page.context().newCDPSession`, the only way
 * to synthesize multi-touch or a one-finger drag) and the Chromium-only clipboard
 * surface (`navigator.clipboard.readText` isn't exposed to pages in Firefox).
 * Every use of this must carry a comment saying *which* of those it is.
 */
export function isChromiumProject(info: TestInfo = test.info()): boolean {
    return info.project.name.endsWith('-chromium')
}
