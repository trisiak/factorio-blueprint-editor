import { Container, Text, TextStyle } from 'pixi.js'
import { Entity } from '../core/Entity'

const RED = 0xc83718
const GREEN = 0x588c38

const COMBINATOR_TYPES = new Set([
    'arithmetic-combinator',
    'decider-combinator',
    'selector-combinator',
])

const badgeStyle = (fill: number): TextStyle =>
    new TextStyle({
        fill,
        fontFamily: 'sans-serif',
        fontSize: 14,
        fontWeight: '700' as TextStyle['fontWeight'],
        stroke: { color: 0x000000, width: 3 },
    })

/**
 * Renders the entity's circuit network ids as small red/green numbers — the
 * same idea the game shows (each network has a per-colour id) so the user can
 * trace which entities share a network. For combinators the input (side 1) and
 * output (side 2) networks are labelled `in`/`out`. Returns an empty container
 * when the entity isn't wired into any circuit network.
 */
export function createCircuitNetworkBadges(entity: Entity): Container {
    const container = new Container()
    const nets = entity.circuitNetworks
    if (nets.length === 0) return container

    const isCombinator = COMBINATOR_TYPES.has(entity.type)
    let x = 0
    for (const { color, side, id } of nets) {
        const prefix = isCombinator ? (side === 2 ? 'out ' : 'in ') : ''
        const label = new Text({
            text: `${prefix}${id}`,
            style: badgeStyle(color === 'red' ? RED : GREEN),
        })
        label.position.set(x, 0)
        container.addChild(label)
        x += label.width + 10
    }
    return container
}
