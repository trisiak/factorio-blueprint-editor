/**
 * The three wire items that are *painted* rather than built.
 *
 * They are placeable like an entity (a held wire connects the two poles/
 * combinators it is clicked on) but they are not inventory items, so
 * `spawnPaintContainer` has to recognise them by name — see the wire branch in
 * `BlueprintContainer.spawnPaintContainer`.
 *
 * The list used to live on the Pixi `WiresPanel`, which was the desktop-only
 * affordance for spawning them. That panel is retired (#101 Slice 4): the
 * universal action rail carries the three toggles for every input, so the
 * constant moved here — to the domain layer that actually needs it — rather
 * than dragging a UI class along for a string array.
 */
export const WIRE_ITEMS = ['copper-wire', 'red-wire', 'green-wire']
