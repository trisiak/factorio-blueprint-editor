import { Application, Texture, Assets, Renderer } from 'pixi.js'
import { Blueprint } from '../core/Blueprint'
import { UIContainer } from '../UI/UIContainer'
import { BlueprintContainer } from '../containers/BlueprintContainer'
import { ActionRegistry } from '../actions'
import { TextureTransforms, mapRectToFrame } from '../core/textureTransform'
import {
    PackManifestEntry,
    canonicalPackId,
    packMayHaveTextureTransforms,
} from '../core/packManifest'

const debug = false

/**
 * Root URL under which the per-pack data lives (each pack is a sub-directory
 * holding its own `data.json` + `*.basis` atlas, e.g. `<root>/vanilla-2.0/` and
 * `<root>/space-age/`; a `packs.json` manifest sits alongside them).
 *
 * Injected at build time by Vite's `define` (see website `vite.config.js`).
 * The data itself is not part of this repo or of `dist/`: every build points at
 * the dedicated data plane (`trisiak/factorio-pack-data` on GitHub Pages, CORS
 * `*`) via `VITE_DATA_URL`, while `vite` dev keeps the app-relative `<base>data`
 * that the dev server proxies to the exporter's `:8081`. The `typeof` guard
 * keeps it working outside Vite (e.g. vitest), where the constant isn't
 * substituted — hence the `/data` fallback here.
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

let manifestPromise: Promise<PackManifestEntry[]> | null = null
let canonicalDataPack = DATA_PACK

/**
 * Fetch (once, then cached) the `packs.json` manifest and resolve the active
 * pack's canonical id from it. Every consumer — the settings pane's pack
 * selector, the library panel's pack list, the library controller's scoping —
 * shares this one fetch. A missing/unreadable manifest yields an empty list, in
 * which case the active pack is its own canonical id (the pre-variant behaviour).
 */
export function loadPackManifest(): Promise<PackManifestEntry[]> {
    manifestPromise ??= fetch(`${DATA_ROOT}/packs.json`)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((packs: PackManifestEntry[]) => {
            canonicalDataPack = canonicalPackId(packs, DATA_PACK)
            return packs
        })
        .catch(() => [] as PackManifestEntry[])
    return manifestPromise
}

/**
 * The active pack's canonical id — `DATA_PACK` until `loadPackManifest()` has
 * resolved (and forever, for a base pack or a manifest-less deploy). Call it
 * after awaiting the manifest before using it to scope user state.
 */
export function getCanonicalDataPack(): string {
    return canonicalDataPack
}

/**
 * Texture transforms for the active pack (`textures.json`), or `undefined` when
 * the pack ships none — a full pack, which is the identity transform everywhere.
 */
let textureTransforms: TextureTransforms | undefined

/**
 * Fetch the active pack's `textures.json` sidecar, if it has one. A 404 (or any
 * failure) leaves the transforms undefined, i.e. identity: full packs and older
 * deploys are completely unaffected by variant support.
 *
 * The manifest decides whether to ask at all (#101 A13): only a graphics variant
 * publishes the sidecar, so probing a full pack just logged a red 404 on every
 * load. `loadPackManifest()` is the same cached fetch the settings pane and the
 * library use and never rejects; with no manifest (or an unlisted pack) the
 * probe happens as before. Awaited alongside `data.json` at editor init, so the
 * transforms are in place before the first `getTexture`.
 */
export function loadTextureTransforms(): Promise<void> {
    return loadPackManifest().then(manifest => {
        if (!packMayHaveTextureTransforms(manifest, DATA_PACK)) return
        return fetchTextureTransforms()
    })
}

function fetchTextureTransforms(): Promise<void> {
    return fetch(`${DATA_URL}/textures.json`)
        .then(res => (res.ok ? res.json() : undefined))
        .then((transforms?: TextureTransforms) => {
            if (!transforms) return
            textureTransforms = transforms
            console.log(
                `textures.json: ${Object.keys(transforms).length} transformed texture file(s)`
            )
        })
        .catch(() => {
            // Absent or malformed — identity. Not an error condition: only variant
            // packs ship this file.
        })
}

export interface ILogMessage {
    text: string
    type: 'success' | 'info' | 'warning' | 'error'
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

/**
 * Paths already reported as requesting a rect outside their crop. A variant pack
 * whose crop missed a code path would otherwise log once per sprite instance —
 * thousands of identical lines. One line per file, naming the first offending
 * rect, is the diagnosable signal.
 */
const warnedOutsideCrop = new Set<string>()

function getTexture(path: string, x = 0, y = 0, w = 0, h = 0): Texture {
    const key = `${DATA_URL}/${path.replace('.png', '.basis')}`
    const KK = `${key}-${x}-${y}-${w}-${h}`
    let t = textureCache.get(KK)
    if (t) return t

    // Graphics-variant packs ship the base pack's data.json (rects in the
    // ORIGINAL image's pixel space) plus a textures.json describing how each
    // shipped file was cropped + downscaled. Undefined transform = identity, so a
    // full pack takes exactly the old path.
    const transform = textureTransforms?.[path]
    const frame = mapRectToFrame(transform, { x, y, w, h })
    if (!frame) {
        // The census (which drives the crops) missed this rect, or a newer editor
        // draws something the variant wasn't built for. Fail soft to the loud
        // checkerboard rather than sampling a wrong region, and say so once.
        if (!warnedOutsideCrop.has(path)) {
            warnedOutsideCrop.add(path)
            console.warn(
                `getTexture: rect (${x}, ${y}, ${w}, ${h}) of '${path}' falls outside this ` +
                    `pack's shipped crop [${transform?.crop.join(', ')}] — showing the ` +
                    'missing-texture placeholder. (Further rects of this file are not reported.)'
            )
        }
        t = new Texture({ source: getFailedTextureSource(), dynamic: false })
        t.noFrame = false
        t.frame.x = 0
        t.frame.y = 0
        t.frame.width = w || 32
        t.frame.height = h || 32
        t.update()
        textureCache.set(KK, t)
        return t
    }

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
            // THE TRANSFORM'S SCALE IS APPLIED VIA `TextureSource.resolution`, not
            // by scaling frames or sprites. PixiJS treats a source's logical size
            // as `pixelWidth / resolution`, so resolution = 0.5 makes a half-size
            // file measure exactly like the original: frames stay in original
            // units (only shifted by the crop origin), `texture.width/height`
            // — which EntitySprite's anchors/`squishY`, TileContainer's tiling and
            // the UI icon sizing all read — keep reporting original dimensions,
            // and `updateUvs` divides by the same resolution-adjusted size so the
            // UVs land on the right texels. That makes this a ONE-LINE change at
            // the single seam: the alternative (frames in file space + a 1/scale
            // sprite scale) would have to be compensated at every consumer, and
            // would fight `data.scale`, `squishY` and `sprite.width` arithmetic in
            // EntitySprite. Set per shared source, idempotent, and a no-op at
            // scale 1.
            if (transform) bt.source.resolution = transform.scale
            t.source = bt.source
            t.frame.x = frame.x
            t.frame.y = frame.y
            // `source.width/height` (not `bt.width/height`): the source's logical
            // size is recomputed the moment resolution changes, whereas the
            // loader's own Texture keeps the frame it was built with.
            t.frame.width = frame.w || bt.source.width
            t.frame.height = frame.h || bt.source.height
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
    /**
     * The UI safe area (CSS px): the viewport minus the edges reserved for DOM
     * chrome (the mobile action rail's left gutter, the top logo/pill band).
     * The canvas renders **full-bleed** underneath — the world shows through
     * the reserved bands — so this rect is a *layout* constraint, not a crop:
     * Pixi panels/dialogs anchor and clamp within it (see `Panel.clampToSafeArea`).
     * Kept current by `Editor.applyCanvasSize` (viewport resizes + inset changes,
     * the latter signalled via `fbe:viewportchange`). Equals the full screen
     * whenever nothing is reserved (desktop). See docs/mobile-layout-inventory.md.
     */
    safeArea: { x: 0, y: 0, width: 0, height: 0 },
}
