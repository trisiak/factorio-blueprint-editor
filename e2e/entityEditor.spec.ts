import { test, expect, type Page } from '@playwright/test'
import type { EditorTestState } from '@fbe/editor'

/**
 * The DOM entity editor (#98 Slice 2) — the mobile presentation of the
 * migrated editor kinds (machines so far). Ratchets:
 *  - per-mode presentation: mobile machines get the DOM editor and NOT the
 *    Pixi dialog; desktop keeps Pixi (seam: UIContainer.openEntityEditor);
 *  - the recipe-change path end-to-end: recipe slot → filtered DOM picker
 *    (stacked over the editor) → search → ✓ Confirm → the entity's recipe
 *    actually changes and the editor reflects it;
 *  - a live mobile→desktop switch closes the DOM editor (presentation follows
 *    mode — the Pixi-editor counterpart invariant lives in clearSlots.spec.ts).
 *
 * The slot/picker *gesture* matrix (long-press clear, ✕ Clear/Cancel labels,
 * module commit-on-tap, recipe confirm-gating) is covered in
 * clearSlots.spec.ts, which drives whichever presentation the mode routes to
 * through the DOM-aware `?test` hook.
 */

const isMobileProject = (): boolean => test.info().project.name === 'mobile-chromium'

async function readTestState(page: Page): Promise<EditorTestState> {
    return (await page.evaluate(() => {
        const w = window as unknown as { __FBE_TEST__?: { getState: () => unknown } }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.getState()
    })) as EditorTestState
}

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
    await page.locator('.dg.main').waitFor({ state: 'attached' })
}

// The storyboard's sample blueprint (all vanilla): an assembling-machine-3
// holding the processing-unit recipe with free module slots.
const ASSEMBLER_BP =
    '0eJyd0tuKgzAQgOF3mWuFrYdu66sspcQ42x2IE0nGUhHffUcLpdDj7o2QxHx/Ahmhdj12gVigGoEEW6iu5hJwpkanc84Mvpc0Gm5qf9KFI4ZInqEq19m22G7LvMhW+SpLgKznCNXXCJEObNwsy9ChKksgATbtPDIxYls74kPaGvtDjGkOkwLc4Amq1bRLAFlICM/eMhj23Lc1Bv3huZRA56Nung85goIfCQz61UJAS8uBuuAtxjhv7JlE6zeV7I+V8raCDq0Ez2RTS8H290P5v65TXodMczRssXmWKS6ZbxMlJY4YRBceXGT2G9LCeaW4I5YX8TGWL1j+GltfMAmGY+eDpPoE5RG5eU1+vk0W75Kbt8nyPrmbpl8tsiv1'

const openEditor = (page: Page, name: string): Promise<boolean> =>
    page.evaluate(
        n =>
            (
                window as unknown as { __FBE_TEST__: { openEntityEditor: (x: string) => boolean } }
            ).__FBE_TEST__.openEntityEditor(n),
        name
    )

const readRecipe = (page: Page, name: string): Promise<string | null> =>
    page.evaluate(
        n =>
            (
                window as unknown as {
                    __FBE_TEST__: { entityRecipe: (x: string) => string | null }
                }
            ).__FBE_TEST__.entityRecipe(n),
        name
    )

async function gotoWithAssembler(page: Page): Promise<void> {
    await page.goto(`/?test&source=${encodeURIComponent(ASSEMBLER_BP)}`)
    await waitForAppReady(page)
    await expect
        .poll(async () => (await readTestState(page)).blueprint.entityCount, { timeout: 30_000 })
        .toBeGreaterThan(0)
}

test.describe('DOM entity editor (#98 Slice 2)', () => {
    test('mobile: a machine opens the DOM editor, not the Pixi dialog; other kinds stay Pixi', async ({
        page,
    }) => {
        test.skip(!isMobileProject(), 'mobile-only: the DOM editor only presents on touch')

        await gotoWithAssembler(page)

        expect(await openEditor(page, 'assembling-machine-3')).toBe(true)
        const editor = page.locator('.fbe-dialog.entity-editor')
        await expect(editor).toBeVisible()
        // The machine's form is there: a recipe slot and four module slots.
        await expect(editor.locator('.ee-recipe-slot')).toBeVisible()
        await expect(editor.locator('.ee-module-slot')).toHaveCount(4)
        await expect(editor.locator('.ee-hint')).toHaveText('Hold a slot to clear it')
        // No Pixi dialog behind it — the presentation moved, not doubled.
        expect((await readTestState(page)).dialogOpen).toBe(false)
        // The modal tier holds (readouts yield while it's open).
        await expect(page.locator('body')).toHaveClass(/fbe-dialog-open/)

        // A non-migrated kind (the inserter) still opens its Pixi editor.
        await page.evaluate(() =>
            (
                window as unknown as { __FBE_TEST__: { closeDialogs: () => void } }
            ).__FBE_TEST__.closeDialogs()
        )
        expect(await openEditor(page, 'fast-inserter')).toBe(true)
        await expect(page.locator('.fbe-dialog.entity-editor')).toBeHidden()
        expect((await readTestState(page)).dialogOpen).toBe(true)
    })

    test('desktop: machines keep the Pixi editor; the DOM editor stays out', async ({ page }) => {
        test.skip(isMobileProject(), 'desktop-only')

        await gotoWithAssembler(page)

        expect(await openEditor(page, 'assembling-machine-3')).toBe(true)
        await expect(page.locator('.fbe-dialog.entity-editor')).toBeHidden()
        expect((await readTestState(page)).dialogOpen).toBe(true)
    })

    test('mobile: changing a recipe end-to-end through the DOM editor + picker', async ({
        page,
    }) => {
        test.skip(!isMobileProject(), 'mobile-only')

        await gotoWithAssembler(page)
        expect(await readRecipe(page, 'assembling-machine-3')).toBe('processing-unit')

        expect(await openEditor(page, 'assembling-machine-3')).toBe(true)
        await page.locator('.ee-recipe-slot').click()

        // The filtered picker stacks over the editor; its search narrows the
        // machine's accepted recipes.
        const picker = page.locator('.fbe-dialog.item-picker')
        await expect(picker).toBeVisible()
        await picker.locator('.is-search').fill('iron gear')
        const cell = picker.locator('.is-cell[data-item="iron-gear-wheel"]')
        await expect(cell).toBeVisible()

        // Recipes keep the deliberate two-step: tap previews, ✓ commits.
        await cell.click()
        expect(await readRecipe(page, 'assembling-machine-3')).toBe('processing-unit')
        await picker.locator('.is-confirm').click()

        await expect(picker).toBeHidden()
        await expect.poll(() => readRecipe(page, 'assembling-machine-3')).toBe('iron-gear-wheel')
        // The editor stayed open underneath and now shows the new recipe
        // (the slot re-rendered off the entity's change event: non-empty).
        await expect(page.locator('.fbe-dialog.entity-editor')).toBeVisible()
        await expect(page.locator('.ee-recipe-slot span')).toBeVisible()
    })

    test('mobile: a live switch to desktop closes the DOM editor', async ({ page }) => {
        test.skip(!isMobileProject(), 'mobile-only')

        await gotoWithAssembler(page)
        expect(await openEditor(page, 'assembling-machine-3')).toBe(true)
        await expect(page.locator('.fbe-dialog.entity-editor')).toBeVisible()

        await page.evaluate(() =>
            (
                window as unknown as {
                    __FBE_TEST__: { setInputMode: (m: 'desktop' | 'mobile') => void }
                }
            ).__FBE_TEST__.setInputMode('desktop')
        )
        // Presentation follows mode: the mobile dialog doesn't outlive the mode.
        await expect(page.locator('.fbe-dialog.entity-editor')).toBeHidden()
        await expect(page.locator('body')).not.toHaveClass(/fbe-dialog-open/)
    })
})
