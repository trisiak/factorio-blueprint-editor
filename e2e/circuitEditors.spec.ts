import { test, expect, type Page } from '@playwright/test'
import { isTouchProject } from './projects'

/**
 * The circuit-editors expansion: lamp / roboport / display-panel / provider
 * chest get editors, the inserter gains read-hand-contents, and the decider
 * grows the full 2.0 multi-condition/multi-output form. These specs drive the
 * real canvas controls via the generic `editorControlPos` probe and read the
 * committed state back through `entityControlBehavior` — the entity is the
 * source of truth, so a tap only counts once it reaches the blueprint.
 *
 * The headline regression here is the decider's clause preservation: the old
 * editor committed 1-element arrays, deleting the other clauses of a
 * multi-clause combinator on any edit. The fixture carries 3 conditions and 2
 * outputs; editing must keep them. (Serialized shapes are pinned unit-side in
 * `core/deciderClauses.test.ts` and friends — this file proves the same holds
 * end-to-end through real input.)
 */

// small-lamp, roboport, display-panel, provider + requester chests,
// fast-inserter, and a decider with 3 conditions (one AND-chained, one
// red-only) + 2 outputs (one fixed-value 7). Regenerate with a node zlib
// one-liner if the layout ever needs to change.
const BP =
    '0eNqdlOuOmzAQhd9lfpuKZIEoqF1p25dotVohBya7Vo3tjge6KPK7V4Y0FxHSyy80vnxzDj72AXa6Q0fKMJQHULU1HsrnA3j1aqSOYzw4hBIUYwsCjGxj1WCtGqSktu1OGcmWIAhQpsF3KFfhRQAaVqxwoo3FUJmu3SFBuTpxfCu1TrRsHQhw1itW1sSu71CmH3IBw/gNQcwg6xOE7M46SzxHFCNgfWv7w9mL8k7LIXHSoJ4z1vdlZCeOk96rHhNHtp9+zhv6G6Ky+8D87At/dOj5z6TsNqk4kfbSc6KMR2KkZYsLnM29Y188tjwIaBRhPc2lAmprmKyudvgme2UpbjgSq9qaZqT4OHpZPR9gr8hzNYtkr4g7qc+pnFYkTzGLtW2dpFFiCY8wdvcsY85XaTT5j9DPM+inK2j6exarI0maBsRVm8og/7T0ffRI2EDJ1KGAV0I0UO6l9hj+Q9uXmbaPV9ryeCFtx67jhdu9RP4Ko56/Xv9tUuKGqrad4WpPtq2UcR0f7V3K2oSXEKK08W0pL54iAT2SH3OTF+tttt3mWbopis1DCL8AzKGW0Q=='

interface CircuitHook {
    openEntityEditor: (name: string) => boolean
    editorControlPos: (control: string) => { x: number; y: number } | null
    entityControlBehavior: (name: string) => Record<string, unknown> | null
    entityDisplayPanel: (name: string) => {
        text: string
        alwaysShow: boolean
        showInChart: boolean
        icon: string | null
    } | null
    getState: () => { dialogOpen: boolean }
}

async function waitForAppReady(page: Page): Promise<void> {
    await expect(page.locator('#editor')).toBeVisible()
    await expect(page.locator('#loadingScreen')).not.toHaveClass(/active/, { timeout: 60_000 })
}

async function openEditor(page: Page, name: string): Promise<void> {
    const opened = await page.evaluate(n => {
        const w = window as unknown as { __FBE_TEST__?: CircuitHook }
        if (!w.__FBE_TEST__) throw new Error('FBE test hook missing — load the page with ?test')
        return w.__FBE_TEST__.openEntityEditor(n)
    }, name)
    expect(opened, `the ${name} editor should open`).toBe(true)
}

const readCb = (page: Page, name: string): Promise<Record<string, unknown> | null> =>
    page.evaluate(
        n =>
            (window as unknown as { __FBE_TEST__: CircuitHook }).__FBE_TEST__.entityControlBehavior(
                n
            ),
        name
    )

async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
    const box = await page.locator('#editor').boundingBox()
    return { x: box?.x ?? 0, y: box?.y ?? 0 }
}

async function tapControl(page: Page, control: string): Promise<void> {
    // Clear any toasts first — the bottom-right stack is pointer-events: auto
    // and can swallow a tap aimed at a dialog's lower rows (see trainStop.spec).
    await page.evaluate(() => document.querySelectorAll('.toasts-toast').forEach(t => t.remove()))
    const pos = await page.evaluate(
        name =>
            (window as unknown as { __FBE_TEST__: CircuitHook }).__FBE_TEST__.editorControlPos(
                name
            ),
        control
    )
    expect(pos, `control "${control}" should be locatable in the open editor`).not.toBeNull()
    const o = await canvasOrigin(page)
    if (isTouchProject()) await page.touchscreen.tap(o.x + pos.x, o.y + pos.y)
    else await page.mouse.click(o.x + pos.x, o.y + pos.y)
}

/**
 * Tap `control` until `predicate` holds on the entity's committed
 * control_behavior — absorbs both the toast race and the async touch
 * compositor path (see trainStop.spec's tapFlag for the full rationale).
 */
async function tapUntil(
    page: Page,
    control: string,
    entity: string,
    predicate: (cb: Record<string, unknown> | null) => boolean
): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        await tapControl(page, control)
        try {
            await expect
                .poll(async () => predicate(await readCb(page, entity)), { timeout: 2_000 })
                .toBe(true)
            return
        } catch (e) {
            if (attempt >= 2) throw e
        }
    }
}

test.beforeEach(async ({ page }) => {
    await page.goto(`/?test&source=${encodeURIComponent(BP)}`)
    await waitForAppReady(page)
})

test.describe('newly routed editors open', () => {
    for (const name of ['small-lamp', 'roboport', 'display-panel', 'passive-provider-chest']) {
        test(`${name} opens an editor without errors`, async ({ page }) => {
            const errors: string[] = []
            page.on('pageerror', e => errors.push(e.message))

            await openEditor(page, name)
            const state = await page.evaluate(() =>
                (window as unknown as { __FBE_TEST__: CircuitHook }).__FBE_TEST__.getState()
            )
            expect(state.dialogOpen).toBe(true)
            expect(errors).toEqual([])
        })
    }
})

test.describe('decider 2.0 clauses', () => {
    type Decider = {
        decider_conditions?: {
            conditions?: unknown[]
            outputs?: { copy_count_from_input?: boolean }[]
        }
    }
    const clauses = (cb: Record<string, unknown> | null): { c: number; o: number } => {
        const dc = (cb as Decider)?.decider_conditions
        return { c: dc?.conditions?.length ?? 0, o: dc?.outputs?.length ?? 0 }
    }

    test('editing one row preserves every other clause', async ({ page }) => {
        expect(clauses(await readCb(page, 'decider-combinator'))).toEqual({ c: 3, o: 2 })

        await openEditor(page, 'decider-combinator')
        // Cycle row 0's comparator — with the old editor this single tap
        // rewrote conditions/outputs down to one element each.
        await tapUntil(page, 'cond-0-cmp', 'decider-combinator', cb => {
            const dc = (cb as Decider)?.decider_conditions
            return dc?.conditions?.length === 3 && dc?.outputs?.length === 2
        })
    })

    test('rows can be added and removed, rebuilding the dialog', async ({ page }) => {
        await openEditor(page, 'decider-combinator')

        await tapUntil(page, 'addCondition', 'decider-combinator', cb => clauses(cb).c === 4)
        // The editor reopens itself to re-size — it must still be usable.
        await tapUntil(page, 'cond-3-remove', 'decider-combinator', cb => clauses(cb).c === 3)

        await tapUntil(page, 'addOutput', 'decider-combinator', cb => clauses(cb).o === 3)
        await tapUntil(page, 'out-2-remove', 'decider-combinator', cb => clauses(cb).o === 2)
    })

    test('the per-operand network toggle commits a red/green filter', async ({ page }) => {
        await openEditor(page, 'decider-combinator')
        // The toggle is two stacked squares; its centre lands on the red/green
        // boundary, so a tap hits one of them — either way the filter narrows
        // from the both-on default and the field materializes.
        await tapUntil(page, 'cond-0-firstNet', 'decider-combinator', cb => {
            const dc = (cb as Decider)?.decider_conditions
            const cond = dc?.conditions?.[0] as { first_signal_networks?: unknown } | undefined
            return cond?.first_signal_networks !== undefined
        })
    })
})

test.describe('read-mode editing', () => {
    test('inserter: read hand contents seeds pulse', async ({ page }) => {
        await openEditor(page, 'fast-inserter')
        await tapUntil(page, 'readHandContents', 'fast-inserter', cb => {
            return cb?.circuit_read_hand_contents === true && cb?.circuit_hand_read_mode === 1
        })
    })

    test('inserter: the Use filters toggle commits root-level use_filters', async ({ page }) => {
        // The flag that makes an inserter's filters apply in-game (post 2.0);
        // it lives at the entity root, so assert via the inserter probe.
        const readInserter = (): Promise<{ useFilters: boolean } | null> =>
            page.evaluate(() =>
                (
                    window as unknown as {
                        __FBE_TEST__: {
                            entityInserter: (n: string) => { useFilters: boolean } | null
                        }
                    }
                ).__FBE_TEST__.entityInserter('fast-inserter')
            )
        await openEditor(page, 'fast-inserter')
        expect((await readInserter()).useFilters).toBe(false)

        for (let attempt = 0; ; attempt++) {
            await tapControl(page, 'useFilters')
            try {
                await expect
                    .poll(async () => (await readInserter()).useFilters, { timeout: 2_000 })
                    .toBe(true)
                return
            } catch (e) {
                if (attempt >= 2) throw e
            }
        }
    })

    test('lamp: use colors + colour mode commit', async ({ page }) => {
        await openEditor(page, 'small-lamp')
        await tapUntil(page, 'useColors', 'small-lamp', cb => cb?.use_colors === true)
        // One tap cycles mapping (0, omitted) → RGB components (1).
        await tapUntil(page, 'colorMode', 'small-lamp', cb => cb?.color_mode === 1)
    })

    test('roboport: read mode cycles and robot stats toggle', async ({ page }) => {
        await openEditor(page, 'roboport')
        await tapUntil(page, 'readItemsMode', 'roboport', cb => cb?.read_items_mode === 1)
        await tapUntil(page, 'readRobotStats', 'roboport', cb => cb?.read_robot_stats === true)
    })

    test('provider chest: circuit mode is editable — and skips "set requests"', async ({
        page,
    }) => {
        // Providers used to open no editor — the mode row is why one opens now.
        // They have no requests, so the cycle goes straight from the
        // send-contents default to none (define value 2), never offering 1.
        await openEditor(page, 'passive-provider-chest')
        await tapUntil(
            page,
            'circuitMode',
            'passive-provider-chest',
            cb => cb?.circuit_mode_of_operation === 2
        )
    })

    test('requester chest: circuit mode offers set requests', async ({ page }) => {
        await openEditor(page, 'requester-chest')
        await tapUntil(
            page,
            'circuitMode',
            'requester-chest',
            cb => cb?.circuit_mode_of_operation === 1
        )
    })
})

test.describe('display panel', () => {
    const readPanel = (page: Page): Promise<ReturnType<CircuitHook['entityDisplayPanel']>> =>
        page.evaluate(() =>
            (window as unknown as { __FBE_TEST__: CircuitHook }).__FBE_TEST__.entityDisplayPanel(
                'display-panel'
            )
        )

    test('text types through the DOM overlay and the flags commit', async ({ page }) => {
        await openEditor(page, 'display-panel')

        // The panel text rides the same DOM-overlay TextInput the station name
        // uses (#56) — tap, focus, type, committed to the root `text` field.
        const input = page.locator('input[maxlength="500"]')
        await expect(input).toBeVisible()
        const box = await input.boundingBox()
        if (isTouchProject())
            await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
        else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
        await expect(input).toBeFocused()
        await page.keyboard.type('Outpost 7')
        await expect.poll(async () => (await readPanel(page)).text).toBe('Outpost 7')

        // Root flags are not control_behavior, so assert via the panel probe.
        await tapControl(page, 'alwaysShow')
        await expect.poll(async () => (await readPanel(page)).alwaysShow).toBe(true)
    })
})
