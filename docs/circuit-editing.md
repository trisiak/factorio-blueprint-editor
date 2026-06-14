# Circuit editing

How the editor inspects and edits the **logical** side of wires — combinator
conditions, enable/disable conditions, constant-combinator signals and read/set
modes — as opposed to the physical red/green/copper wires (which
`WiresPanel` + `PaintWireContainer` already draw). Companion to the tracking
issue **#31**.

## Status

| Area                                                                                                                      | State                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Read / inspect** (info panel + combinator overlay)                                                                      | ✅ shipped — #36                                                       |
| **Edit** (combinator + enable-condition editors, signal picker, network ids)                                              | ✅ shipped — #44                                                       |
| Decider 2.0 multi-condition/output, selector per-op params, per-operand red/green network toggles, constant multi-section | ⏳ deferred (each reads/writes its primary clause, so nothing is lost) |

## Mod-safety architecture (the load-bearing decision)

The _set_ of configurable `control_behavior` fields per entity **type** is fixed
by the Factorio version (engine), not by mods — mods only add new prototypes of
existing types and new signals/items/fluids. So:

1. **Route off `entity.type`, never a hardcoded name** — `editorKindFor` in
   `UI/editors/factory.ts` switches on `type` for combinators, so any modded
   prototype of those types gets the editor.
2. **Build the signal universe from `FD` at runtime** — items ∪ fluids ∪
   virtual-signals — never hardcode signal names. This is the only genuinely
   dynamic piece.
3. **Post-2.0 only** — `sections`, decider `conditions[]`/`outputs[]`, `wires[]`.

## Reading (core/`Entity`, `EntityInfoPanel`, `OverlayContainer`)

Read-only getters on `Entity` decode `control_behavior`: `combinatorConditions`,
`combinatorConstant`/`combinatorFirstConstant`, `operator`, `circuitCondition`,
`constantCombinatorSignals`, `circuitModeSummary` (read/set-mode flags),
`circuitNetworks`. `EntityInfoPanel.renderCircuitInfo` renders a "Circuit
network" summary; `OverlayContainer` draws the operation glyph + signal icons on
combinator sprites.

## Editing (`UI/`, `UI/editors/`)

Mutators on `Entity` (`arithmeticConditions`, `deciderConditions`,
`constantCombinatorSection`, `circuitCondition`, `circuitEnabled`,
`selectorOperation`, …) clone-mutate-write `control_behavior` through
`history`, so **undo/redo and the blueprint-string round-trip come for free**,
and emit the `controlBehavior` event so the overlay / info panel / open editor
refresh.

Reusable building blocks:

- **`SignalPicker`** (`UI/SignalPicker.ts`) — the data-driven signal chooser:
  items / fluids / virtual-signals tabs, a scrollable masked grid, and a
  confirm-required bottom bar (preview name + ✓ Confirm, matching
  `InventoryDialog`). The item-only `InventoryDialog` can't show fluids/virtuals,
  hence a dedicated dialog. A **✕ None** button clears the slot.
- **`NumericKeypad` / `NumericField`** (`UI/`) — a fully canvas-rendered numeric
  pad. The DOM-overlay `TextInput` is broken on touch/high-DPI (off-screen,
  no keyboard — #56), so circuit numeric entry doesn't use it.
- **`SignalSlot`, `Operand`** (signal _or_ signed constant, single slot),
  **`CycleButton`** (tap-to-cycle operators), **`CircuitCondition`** (enable
  checkbox + condition row) — `UI/editors/components/`.
- **`bindSlotGestures`** (`UI/controls/gestures.ts`) — tap activates a slot,
  long-press (or right-click) **clears** it (touch has no right-click).
- **`createCircuitNetworkBadges`** — red/green network ids (connected components
  of the wire graph, combinator input/output separate), shown in the info panel
  and at the top of each editor.

Editors: `ArithmeticCombinatorEditor`, `DeciderCombinatorEditor`,
`ConstantCombinatorEditor`, `SelectorCombinatorEditor` and a shared
`CircuitConditionEditor` (pumps/belts); `InserterEditor`/`MiningEditor` embed
the circuit condition via `Editor.addCircuitCondition`.

> **Known debt (#59):** these editors lay out controls with absolute
> coordinates + hardcoded dialog sizes — no shared form-layout system. Fine for
> now (combinator editing isn't the main use case); revisit before the deferred
> multi-condition UIs land.

## Touch

Editing is touch-usable: selection via the full-size `SignalPicker` (the editor
itself stays compact), big tap targets, `pointerdown` handlers, the canvas
keypad (no OS keyboard), and long-press to clear. The base `Dialog` scales the
whole editor to fit a narrow viewport.

## Related tickets

- **#31** — tracking issue / index.
- **#37** — mobile: red/green circuit wires don't render (separate `WiresContainer` bug).
- **#49** — highlight connected entities/wires of a network on select.
- **#56** — DOM `TextInput` broken on touch (station name, chest counts).
- **#59** — ad-hoc editor layout / shared form-layout helper.
