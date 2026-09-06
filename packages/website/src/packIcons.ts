import { DATA_ROOT, getCanonicalDataPack, loadPackManifest } from '@fbe/editor'

// Pack icons for DOM chrome (#89 Phase 3): real game icons, served from the
// data plane's per-pack `browser/` artifact (`icons.webp`, 64px cells +
// `icons.json` offsets — the same sheet the sibling item-browser fork renders
// from). This is the seam that ends the "real icons only exist in the `.basis`
// atlas" era for DOM UI: any DOM element can carry a game icon as a CSS
// background crop of the sheet, no canvas involved.
//
// Keyed on the **canonical** pack id (variantOf ?? id), so slim graphics
// variants — which may not republish the browser tier — resolve to their full
// pack's sheet. Everything is progressive: until the manifest loads (or if the
// pack ships no browser artifact at all) marked elements simply keep their
// text-glyph fallback, so this can never break chrome on a pack without icons.
//
// Scope note: the sheet holds *prototype* icons (item/fluid/recipe/technology)
// — Factorio's GUI/utility sprites (undo arrows, blueprint tools, …) are not
// part of the dump. So only chrome that represents a game thing can upgrade
// (today: the rail's wire buttons); pure editor actions keep their glyphs by
// design. Phase 2's DOM panels are the intended bigger consumer.

interface IconSheet {
    sheet: { file: string; width: number; height: number; cell: number; padding: number }
    icons: Record<string, { x: number; y: number }>
}

let manifest: IconSheet | null = null
let sheetUrl = ''

/**
 * Fetch the active (canonical) pack's icon manifest and upgrade every element
 * marked `data-pack-icon="<id>"` in place. Fire-and-forget from boot; failures
 * (offline, a pack without the browser tier) leave the glyph fallbacks alone.
 */
export async function loadPackIcons(): Promise<void> {
    // getCanonicalDataPack() is only correct *after* the packs.json manifest
    // has resolved (its documented contract) — before that a graphics-variant
    // id returns itself, and slim variants publish no browser/ tier, so the
    // fetch 404'd and every icon stayed a text fallback exactly for the users
    // slim is for (phones). loadPackManifest() is cached and never rejects.
    await loadPackManifest()
    const base = `${DATA_ROOT}/${getCanonicalDataPack()}/browser`
    try {
        const res = await fetch(`${base}/icons.json`)
        if (!res.ok) return
        const data = (await res.json()) as IconSheet
        if (!data?.sheet?.file || !data.icons) return
        manifest = data
        sheetUrl = `${base}/${data.sheet.file}`
    } catch {
        return
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-pack-icon]')) {
        applyPackIcon(el, el.dataset.packIcon)
    }
    // Chrome that *re-renders* (the quickbar redraws its slots on every model
    // change) can't rely on the one-shot sweep above: it marks elements that
    // don't exist yet. Announcing the load lets such views re-apply their icons
    // once, instead of polling for the manifest.
    window.dispatchEvent(new Event('fbe:packicons'))
}

/**
 * Render icon `iconId` (e.g. `"item/red-wire"`) into `el` as a background crop
 * of the pack sheet, replacing its text content. Returns false — leaving the
 * element untouched — while the manifest isn't loaded or the id is unknown, so
 * callers can mark elements up front and rely on the glyph fallback.
 */
export function applyPackIcon(el: HTMLElement, iconId: string, size = 24): boolean {
    if (!manifest) return false
    const pos = manifest.icons[iconId]
    if (!pos) return false
    const { width, height, cell } = manifest.sheet
    const scale = size / cell
    el.textContent = ''
    el.style.display = 'block'
    el.style.margin = '0 auto'
    el.style.width = `${size}px`
    el.style.height = `${size}px`
    el.style.backgroundImage = `url("${sheetUrl}")`
    el.style.backgroundSize = `${width * scale}px ${height * scale}px`
    el.style.backgroundPosition = `${-pos.x * scale}px ${-pos.y * scale}px`
    el.style.backgroundRepeat = 'no-repeat'
    return true
}
