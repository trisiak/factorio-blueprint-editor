import { BLEND_MODES, Sprite, Texture } from 'pixi.js'
import {
    ArithmeticOperation,
    ComparatorString,
    IPoint,
    ISignal,
    SelectorCombinatorOperation,
} from '../types'
import G from '../common/globals'
import F from '../UI/controls/functions'
import { Entity } from '../core/Entity'
import { PositionGrid } from '../core/PositionGrid'
import {
    getSpriteData,
    ExtendedSpriteData,
    SPRITE_GENERATION_FAILED,
} from '../core/spriteDataBuilder'
import { UnknownEntitySprite } from './UnknownEntitySprite'

/** How to address a multi-frame sprite's frames within its atlas sheet (#29). */
interface AnimSpec {
    filename: string
    baseX: number
    baseY: number
    w: number
    h: number
    frames: number
    /** frames per row in the sheet (`line_length`, or all-in-one-row) */
    cols: number
    /** ms per frame, from `animation_speed` (frames/tick at 60 ups) */
    frameMs: number
}
import FD, { ColorWithAlpha, getColor, getEntitySize } from '../core/factorioData'
import { BlendMode } from 'factorio:prototype'

interface IEntityData {
    name: string
    type?: string
    direction?: number
    position?: IPoint
    generateConnector?: boolean
    directionType?: string
    selectorCombinatorSelectMax?: boolean
    operator?: undefined | ComparatorString | ArithmeticOperation | SelectorCombinatorOperation
    displayPanelIcon?: undefined | ISignal
    assemblerHasFluidInputs?: boolean
    assemblerHasFluidOutputs?: boolean
    railLayer?: string
    trainStopColor?: ColorWithAlpha
    entityColor?: ColorWithAlpha
    modules?: string[]
}

/** Z-index layer assignments inspired by Factorio's render layer ordering.
 *  Lower values render behind higher values. */
const LAYER = {
    RAIL_STONE: -10,
    RAIL_TIE: -9,
    RAIL_SIGNAL: -8,
    RAIL_METAL: -7,
    TRANSPORT_BELT: -6,
    TRANSPORT_BELT_ABOVE: -5,
    FLOOR_ENTITY: -4, // pipes, underground belt entrances
    PIPE: -3,
    ENTITY_BASE: 0,
    CIRCUIT_CONNECTOR: 1,
    ARTILLERY_BARREL: 2,
    INSERTER: 3, // inserters should render above most entities
    ELEVATED_RAIL_STONE: 4,
    ELEVATED_RAIL_TIE: 5,
    ELEVATED_RAIL_METAL: 6,
} as const

export class EntitySprite extends Sprite {
    private static nextID = 0

    private id: number
    private __zIndex: number
    private zOrder: number
    private readonly entityPos: IPoint

    // --- Idle-state animation (#29) ---------------------------------------
    // A multi-frame sprite stashes how to address its frames in the atlas; the
    // shared ticker driver below swaps the texture frame when animations are on.
    private anim?: AnimSpec
    private animFrame = 0

    /** All animatable sprites currently alive — the driver iterates this. */
    private static readonly animated = new Set<EntitySprite>()
    private static animEnabled = false
    private static animTickerCb?: () => void
    private static animStartMs = 0

    public constructor(
        texture: Texture,
        data: ExtendedSpriteData,
        position: IPoint = { x: 0, y: 0 }
    ) {
        super(texture)

        this.id = EntitySprite.getNextID()

        const blend_mode = data.blend_mode || 'normal'
        const mapBlendMode = (blend_mode: BlendMode): BLEND_MODES => {
            switch (blend_mode) {
                case 'normal':
                    return 'normal'
                case 'additive':
                    return 'add'
                case 'multiplicative':
                    return 'multiply'
                case 'additive-soft':
                case 'multiplicative-with-alpha':
                case 'overwrite':
                default:
                    throw new Error('Missing blend mode mapping!')
            }
        }
        this.blendMode = mapBlendMode(blend_mode)

        this.entityPos = position
        this.position.set(position.x, position.y)

        if (data.shift) {
            this.position.x += data.shift[0] * 32
            this.position.y += data.shift[1] * 32
        }

        if (data.scale) {
            this.scale.set(data.scale)
        }

        this.anchor.x = data.anchorX === undefined ? 0.5 : data.anchorX
        this.anchor.y = data.anchorY === undefined ? 0.5 : data.anchorY

        if (data.squishY) {
            this.height /= data.squishY
        }

        if (data.rotAngle) {
            this.angle = data.rotAngle
        }

        if (data.tint) {
            F.applyTint(this, getColor(data.tint))
        } else if (data.apply_runtime_tint) {
            F.applyTint(this, {
                r: 233 / 255,
                g: 195 / 255,
                b: 153 / 255,
                a: 0.8,
            })
        }

        this.setupAnimation(data)

        return this
    }

    private static getNextID(): number {
        this.nextID += 1
        return this.nextID
    }

    /**
     * Detect a multi-frame animation on this part and register it with the
     * driver. POC scope (#29): single-sheet animations only — frames split
     * across files (`filenames`/`stripes`) keep their static frame 0 for now.
     */
    private setupAnimation(data: ExtendedSpriteData): void {
        const a = data as ExtendedSpriteData & {
            frame_count?: number
            line_length?: number
            animation_speed?: number
            filename?: string
            filenames?: unknown
            stripes?: unknown
        }
        if (!a.filename || a.filenames || a.stripes) return
        const frames = a.frame_count ?? 1
        if (frames <= 1) return
        const speed = a.animation_speed ?? 1
        if (speed <= 0) return
        const size = Array.isArray(data.size) ? data.size : [data.size, data.size]
        const w = data.width || size[0] || 0
        const h = data.height || size[1] || 0
        if (!w || !h) return
        this.anim = {
            filename: a.filename,
            baseX: data.x || 0,
            baseY: data.y || 0,
            w,
            h,
            frames,
            cols: a.line_length || frames,
            frameMs: 1000 / (speed * 60),
        }
        EntitySprite.animated.add(this)
        // Show the live frame immediately if animations are already on.
        if (EntitySprite.animEnabled) EntitySprite.stepSprite(this, performance.now())
    }

    /** Point this sprite's texture at frame `idx` of its animation. */
    private setAnimFrame(idx: number): void {
        const a = this.anim
        if (!a) return
        this.animFrame = idx
        this.texture = G.getTexture(
            a.filename,
            a.baseX + (idx % a.cols) * a.w,
            a.baseY + Math.floor(idx / a.cols) * a.h,
            a.w,
            a.h
        )
    }

    private static stepSprite(s: EntitySprite, nowMs: number): void {
        const a = s.anim
        if (!a) return
        const idx = Math.floor((nowMs - EntitySprite.animStartMs) / a.frameMs) % a.frames
        if (idx !== s.animFrame) s.setAnimFrame(idx)
    }

    public static get animationsEnabled(): boolean {
        return EntitySprite.animEnabled
    }

    /**
     * Global on/off for idle animations. When on, a single ticker advances a
     * shared clock and steps every registered sprite; when off, the ticker is
     * removed and every sprite resets to frame 0 (today's static render).
     */
    public static setAnimationsEnabled(on: boolean): void {
        if (on === EntitySprite.animEnabled) return
        EntitySprite.animEnabled = on
        if (on) {
            EntitySprite.animStartMs = performance.now()
            EntitySprite.animTickerCb = () => {
                const now = performance.now()
                for (const s of EntitySprite.animated) EntitySprite.stepSprite(s, now)
            }
            G.app.ticker.add(EntitySprite.animTickerCb)
        } else if (EntitySprite.animTickerCb) {
            G.app.ticker.remove(EntitySprite.animTickerCb)
            EntitySprite.animTickerCb = undefined
            for (const s of EntitySprite.animated) s.setAnimFrame(0)
        }
    }

    public override destroy(options?: Parameters<Sprite['destroy']>[0]): void {
        EntitySprite.animated.delete(this)
        super.destroy(options)
    }

    public static getParts(
        entity: IEntityData | Entity,
        position?: IPoint,
        positionGrid?: PositionGrid
    ): EntitySprite[] {
        const spriteData = getSpriteData({
            dir: entity.direction,

            name: entity.name,
            positionGrid,
            position: entity.position,
            generateConnector: entity.generateConnector,

            dirType: entity.directionType,
            selectorCombinatorSelectMax: entity.selectorCombinatorSelectMax,
            operator: entity.operator,
            displayPanelIcon: entity.displayPanelIcon,
            assemblerHasFluidInputs: entity.assemblerHasFluidInputs,
            assemblerHasFluidOutputs: entity.assemblerHasFluidOutputs,
            railLayer: entity.railLayer,
            trainStopColor: entity.trainStopColor,
            modules: entity.modules,
        })

        const entityColor =
            entity instanceof Entity ? entity.trainStopColor : (entity as IEntityData).entityColor

        if ((spriteData as any) === SPRITE_GENERATION_FAILED || spriteData.length === 0) {
            const fdEntity = FD.entities[entity.name]
            const size = fdEntity ? getEntitySize(fdEntity, entity.direction || 0) : { x: 1, y: 1 }
            const unknown = new UnknownEntitySprite(
                entity.name,
                position || entity.position || { x: 0, y: 0 },
                size.x || 1,
                size.y || 1
            )
            return [unknown as any]
        }

        // TODO: maybe move the __zIndex logic to spriteDataBuilder
        const parts: EntitySprite[] = []

        let foundMainBelt = false
        for (let i = 0; i < spriteData.length; i++) {
            const data = spriteData[i]
            if (!data) continue
            if (data.draw_as_shadow) continue
            if (!data.filename && (data as any).filenames) {
                // Use direction-based index if entity has direction, otherwise first file
                const dirIndex = entity.direction ? Math.floor(entity.direction / 4) : 0
                const filenames = (data as any).filenames as string[]
                data.filename = filenames[Math.min(dirIndex, filenames.length - 1)]
            }
            if (!data.filename && (data as any).stripes?.[0]?.filename) {
                // Animations whose frames are split across multiple files via
                // `stripes` (e.g. SE's core miner). Render the first frame, which
                // is the top-left of the first stripe — data.x/y default to 0.
                data.filename = (data as any).stripes[0].filename
            }
            if (!data.filename) continue

            const texture = G.getTexture(
                data.filename,
                data.x,
                data.y,
                data.width || (Array.isArray(data.size) ? data.size[0] : data.size),
                data.height || (Array.isArray(data.size) ? data.size[1] : data.size)
            )
            const sprite = new EntitySprite(texture, data, position)

            if (data.filename.includes('circuit-connector')) {
                sprite.__zIndex = LAYER.CIRCUIT_CONNECTOR
            } else if (entity.type === 'artillery-turret' && i > 0) {
                sprite.__zIndex = LAYER.ARTILLERY_BARREL
            } else if (
                (entity.type === 'rail-signal' || entity.type === 'rail-chain-signal') &&
                i === 0
            ) {
                sprite.__zIndex = LAYER.RAIL_SIGNAL
            } else if (
                entity.type === 'legacy-straight-rail' ||
                entity.type === 'straight-rail' ||
                entity.type === 'half-diagonal-rail' ||
                entity.type === 'legacy-curved-rail' ||
                entity.type === 'curved-rail-a' ||
                entity.type === 'curved-rail-b'
            ) {
                if (i < 2) {
                    sprite.__zIndex = LAYER.RAIL_STONE
                } else if (i < 4) {
                    sprite.__zIndex = LAYER.RAIL_TIE
                } else {
                    sprite.__zIndex = LAYER.RAIL_METAL
                }
            } else if (
                entity.type === 'elevated-straight-rail' ||
                entity.type === 'elevated-curved-rail-a' ||
                entity.type === 'elevated-curved-rail-b' ||
                entity.type === 'elevated-half-diagonal-rail'
            ) {
                if (i < 2) {
                    sprite.__zIndex = LAYER.ELEVATED_RAIL_STONE
                } else if (i < 4) {
                    sprite.__zIndex = LAYER.ELEVATED_RAIL_TIE
                } else {
                    sprite.__zIndex = LAYER.ELEVATED_RAIL_METAL
                }
            } else if (entity.type === 'transport-belt' || entity.type === 'heat-pipe') {
                sprite.__zIndex = i === 0 ? LAYER.TRANSPORT_BELT : LAYER.TRANSPORT_BELT_ABOVE
                if (data.filename.includes('connector') && !data.filename.includes('back-patch')) {
                    sprite.__zIndex = LAYER.ENTITY_BASE
                }
            } else if (
                entity.type === 'splitter' ||
                entity.type === 'underground-belt' ||
                entity.type === 'loader'
            ) {
                if (!foundMainBelt && data.filename.includes('transport-belt')) {
                    foundMainBelt = true
                    sprite.__zIndex = LAYER.TRANSPORT_BELT
                }
            } else if (entity.type === 'pipe' || entity.type === 'infinity-pipe') {
                sprite.__zIndex = LAYER.PIPE
            } else if (entity.type === 'inserter') {
                sprite.__zIndex = LAYER.INSERTER
            } else {
                sprite.__zIndex = LAYER.ENTITY_BASE
            }
            sprite.zOrder = i

            if (entityColor && !data.tint && !data.draw_as_shadow) {
                F.applyTint(sprite, getColor(entityColor))
            }

            parts.push(sprite)
        }

        return parts
    }

    public static compareFn(a: EntitySprite, b: EntitySprite): number {
        const dZ = a.__zIndex - b.__zIndex
        if (dZ !== 0) return dZ

        const dY = a.entityPos.y - b.entityPos.y
        if (dY !== 0) return dY

        const dO = a.zOrder - b.zOrder
        if (dO !== 0) return dO

        const dX = a.entityPos.x - b.entityPos.x
        if (dX !== 0) return dX

        return a.id - b.id
    }
}
