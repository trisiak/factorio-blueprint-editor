import { Application, Texture, Assets, Renderer } from 'pixi.js'
import { Blueprint } from '../core/Blueprint'
import { UIContainer } from '../UI/UIContainer'
import { BlueprintContainer } from '../containers/BlueprintContainer'
import { ActionRegistry } from '../actions'

const debug = false

/**
 * Root URL under which the per-pack data lives (each pack is a sub-directory
 * holding its own `data.json` + `*.basis` atlas, e.g. `<root>/vanilla-2.0/` and
 * `<root>/space-age/`; a `packs.json` manifest sits alongside them).
 *
 * Injected at build time by Vite's `define` (see website `vite.config.js`).
 * Defaults to the app's own `<base>/data`, so a root deploy resolves to `/data`
 * (unchanged) and a sub-path deploy (e.g. GitHub Pages under
 * `/factorio-blueprint-editor/`) resolves to `<base>/data`. Preview builds may
 * set `VITE_DATA_URL` to reuse another deploy's atlas. The `typeof` guard keeps
 * it working outside Vite (e.g. vitest), where the constant isn't substituted.
 */
declare const __DATA_URL__: string
export const DATA_ROOT: string = typeof __DATA_URL__ === 'string' ? __DATA_URL__ : '/data'

/**
 * Modpack support: the editor renders one data dump ("pack") at a time. The
 * SA-aware code is backwards compatible (defensive null-guards + additive draw
 * branches), so a single build renders any pack — vanilla 2.0, 2.0+Space Age,
 * etc. — selected purely by which data directory it fetches from.
 *
 * Keep this id in sync with an entry in `packs.json`.
 */
export const DEFAULT_DATA_PACK = 'vanilla-2.0'
const PACK_STORAGE_KEY = 'fbe:dataPack'

/** Active pack: `?pack=` query param > persisted choice > default. */
function resolveDataPack(): string {
    try {
        const fromQuery = new URLSearchParams(globalThis.location?.search ?? '').get('pack')
        if (fromQuery) return fromQuery
        const fromStore = globalThis.localStorage?.getItem(PACK_STORAGE_KEY)
        if (fromStore) return fromStore
    } catch {
        // non-browser (e.g. vitest) — fall through to the default
    }
    return DEFAULT_DATA_PACK
}

/** The currently selected data pack id. */
export const DATA_PACK: string = resolveDataPack()

/**
 * Base URL the active pack's `data.json` + `*.basis` atlas are fetched from.
 * Equals `<root>/<pack>`. Everything downstream (the `data.json` fetch in
 * `Editor.ts`, `getTexture` below) is pack-agnostic — it just reads this.
 */
export const DATA_URL: string = `${DATA_ROOT}/${DATA_PACK}`

/**
 * Persist a pack choice and reload. Switching packs swaps the entire data set
 * and atlas, so a full reload (re-fetch + scene rebuild) is the clean path
 * rather than trying to hot-swap textures in place.
 */
export function setDataPack(id: string): void {
    try {
        globalThis.localStorage?.setItem(PACK_STORAGE_KEY, id)
    } catch {
        // ignore storage failures (private mode, etc.)
    }
    // `?pack=` outranks the persisted choice in resolveDataPack, so a plain
    // reload of a `?pack=…` URL would ignore this new selection. Strip the param
    // (preserving any other query, e.g. `?source=`) so the dropdown choice wins;
    // fall back to a plain reload when there's no query to rewrite.
    try {
        const loc = globalThis.location
        if (loc) {
            const url = new URL(loc.href)
            if (url.searchParams.has('pack')) {
                url.searchParams.delete('pack')
                loc.href = url.toString()
                return
            }
        }
    } catch {
        // URL parsing unavailable — fall through to a plain reload
    }
    globalThis.location?.reload()
}

export interface ILogMessage {
    text: string
    type: 'success' | 'info' | 'warning' | 'error'
    /** How long to show the message (ms); `Infinity` pins it. Consumers that
     *  can't honor it (the console fallback below) just ignore it. */
    timeout?: number
    /** Optional call-to-action (e.g. "Reload" on a GPU-crash notice) — matches
     *  the website toast's action button; ignored by the console fallback. */
    action?: { text: string; callback: () => void }
}

export type Logger = (msg: ILogMessage) => void

const logger: Logger = msg => {
    switch (msg.type) {
        case 'error':
            console.error(msg.text)
            break
        case 'warning':
            console.warn(msg.text)
            break
        case 'info':
            console.info(msg.text)
            break
        case 'success':
            console.log(msg.text)
            break
    }
}

let app: Application<Renderer<HTMLCanvasElement>>
let BPC: BlueprintContainer
let UI: UIContainer
let bp: Blueprint
let actions: ActionRegistry

const started = new Map<string, Promise<Texture>>()
const textureCache = new Map<string, Texture>()

let count = 0
let T: number

function getBT(path: string): Promise<Texture> {
    if (count === 0) {
        T = performance.now()
    }
    count += 1
    return Assets.load(path).then(bt => {
        count -= 1
        if (count <= 0) {
            console.log('done', performance.now() - T)
        }
        return bt
    })
}

/**
 * A loud "missing texture" marker — a magenta/black checkerboard that tiles
 * across whatever footprint a sprite expected. Built lazily (it needs a DOM
 * canvas) and shared by every failed load. `repeat` wrap lets the 16px source
 * fill any frame size, so the marker lands at the sprite's real size instead of
 * a 1px dot. Shown ONLY on a failed load (see getTexture); a texture still in
 * flight keeps the transparent EMPTY source, so this never flashes mid-load.
 */
let failedTextureSource: Texture['source'] | undefined
function getFailedTextureSource(): Texture['source'] {
    if (failedTextureSource) return failedTextureSource
    const S = 16
    const canvas = document.createElement('canvas')
    canvas.width = S
    canvas.height = S
    const ctx = canvas.getContext('2d')
    if (ctx) {
        ctx.fillStyle = '#ff00ff'
        ctx.fillRect(0, 0, S, S)
        ctx.fillStyle = '#101010'
        ctx.fillRect(0, 0, S / 2, S / 2)
        ctx.fillRect(S / 2, S / 2, S / 2, S / 2)
    }
    const tex = Texture.from(canvas)
    tex.source.style.addressMode = 'repeat'
    tex.source.style.scaleMode = 'nearest'
    failedTextureSource = tex.source
    return failedTextureSource
}

/**
 * A calm placeholder shown while a texture's atlas file is still loading: a
 * translucent light-gray fill rather than nothing, sized to the frame the real
 * sprite will occupy, so entities fade in as a soft block instead of popping
 * out of empty space (cuts the flicker on first paint / slow fetches). Solid
 * colour, so `repeat` wrap fills any frame from one tiny shared source.
 */
let loadingTextureSource: Texture['source'] | undefined
function getLoadingTextureSource(): Texture['source'] {
    if (loadingTextureSource) return loadingTextureSource
    const S = 8
    const canvas = document.createElement('canvas')
    canvas.width = S
    canvas.height = S
    const ctx = canvas.getContext('2d')
    if (ctx) {
        ctx.fillStyle = 'rgba(150, 150, 150, 0.3)'
        ctx.fillRect(0, 0, S, S)
    }
    const tex = Texture.from(canvas)
    tex.source.style.addressMode = 'repeat'
    loadingTextureSource = tex.source
    return loadingTextureSource
}

function getTexture(path: string, x = 0, y = 0, w = 0, h = 0): Texture {
    const key = `${DATA_URL}/${path.replace('.png', '.basis')}`
    const KK = `${key}-${x}-${y}-${w}-${h}`
    let t = textureCache.get(KK)
    if (t) return t
    t = new Texture({ source: getLoadingTextureSource(), dynamic: true })
    t.noFrame = false
    // Size the loading placeholder to the frame the real texture will fill, so
    // the entity shows a soft gray block at the right footprint while in flight
    // (the source is solid, so repeat wrap fills any size).
    t.frame.x = 0
    t.frame.y = 0
    t.frame.width = w || 32
    t.frame.height = h || 32
    t.update()
    textureCache.set(KK, t)
    let prom = started.get(key)
    if (!prom) {
        prom = getBT(key)
        started.set(key, prom)
    }
    prom.then(
        bt => {
            t.source = bt.source
            t.frame.x = x
            t.frame.y = y
            t.frame.width = w || bt.width
            t.frame.height = h || bt.height
            t.update()
            t.dynamic = false
        },
        err => {
            console.error(err)
            // Don't leave an invisible gap: swap in the shared checkerboard and
            // tile it across the frame the atlas would have filled. Loud and
            // diagnosable — the signal a partially-covered pack needs. (Distinct
            // from the in-flight state, which keeps the transparent EMPTY source.)
            t.source = getFailedTextureSource()
            t.frame.x = 0
            t.frame.y = 0
            t.frame.width = w || 32
            t.frame.height = h || 32
            t.update()
            t.dynamic = false
        }
    )
    return t
}

export default {
    debug,
    BPC,
    UI,
    app,
    bp,
    actions,
    getTexture,
    logger,
}
