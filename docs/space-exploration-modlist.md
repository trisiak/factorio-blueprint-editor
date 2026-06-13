# Space Exploration modpack — extracted mod list

Source: a Space Exploration save (`se.zip`), parsed from the save's
binary header (`level-init.dat`) — Factorio doesn't store a clean mod-list
file in the save. Save engine version: **2.0.76** (matches the exporter pin).
Space Exploration itself is **0.7.56**.

Total: **35 mods** — 2 ship with the game (expansion build), 33 from the mod portal.

## Ships with the game (expansion build)

- `base` 2.0.76
- `elevated-rails` 2.0.76

## Portal mods (need download for slice 2)

- `aai-containers` 0.3.2
- `aai-signal-transmission` 0.5.3
- `aai-vehicles-ironclad` 0.7.5
- `alien-biomes-graphics` 0.7.1
- `bullet-trails` 0.7.1
- `DiscoScience` 2.0.1
- `EvenDistributionLite` 1.4.5
- `flib` 0.16.5
- `grappling-gun` 0.4.1
- `informatron` 0.4.0
- `InserterFuelLeech` 1.0.4
- `jetpack` 0.4.17
- `ModuleInserterSimplified` 2.1.1
- `robot_attrition` 0.6.6
- `space-exploration-graphics` 0.7.5
- `space-exploration-graphics-2` 0.7.2
- `space-exploration-graphics-3` 0.7.2
- `space-exploration-graphics-4` 0.7.2
- `space-exploration-graphics-5` 0.7.3
- `space-exploration-menu-simulations` 0.7.4
- `textplates` 0.7.2
- `aai-industry` 0.6.16
- `alien-biomes` 0.7.4
- `combat-mechanics-overhaul` 0.7.2
- `equipment-gantry` 0.2.4
- `Milestones` 1.4.7
- `RecipeBook` 4.0.8
- `shield-projector` 0.2.2
- `space-exploration` 0.7.56
- `rocket-log` 2.0.3
- `space-exploration-official-modpack` 0.6.4
- `space-exploration-postprocess` 0.7.5
- `BottleneckLite` 1.3.4

## Draft `packs.json` entry

```json
{
    "id": "space-exploration",
    "label": "Space Exploration (2.0)",
    "factorioVersion": "2.0",
    "mods": [
        "base",
        "aai-containers",
        "aai-signal-transmission",
        "aai-vehicles-ironclad",
        "alien-biomes-graphics",
        "bullet-trails",
        "DiscoScience",
        "elevated-rails",
        "EvenDistributionLite",
        "flib",
        "grappling-gun",
        "informatron",
        "InserterFuelLeech",
        "jetpack",
        "ModuleInserterSimplified",
        "robot_attrition",
        "space-exploration-graphics",
        "space-exploration-graphics-2",
        "space-exploration-graphics-3",
        "space-exploration-graphics-4",
        "space-exploration-graphics-5",
        "space-exploration-menu-simulations",
        "textplates",
        "aai-industry",
        "alien-biomes",
        "combat-mechanics-overhaul",
        "equipment-gantry",
        "Milestones",
        "RecipeBook",
        "shield-projector",
        "space-exploration",
        "rocket-log",
        "space-exploration-official-modpack",
        "space-exploration-postprocess",
        "BottleneckLite"
    ]
}
```

## Per-mod impact on the data pack (A/B verified)

Each verdict comes from disabling the mod(s) and byte-diffing the regenerated
`data.json` against the full-modset baseline (the dump is deterministic, so
`IDENTICAL` is a proof, not a heuristic).

| Mod | Verdict |
| --- | --- |
| `EvenDistributionLite`, `InserterFuelLeech`, `BottleneckLite`, `rocket-log` | **No impact** — dump byte-identical without them (runtime-only QoL) |
| `space-exploration-official-modpack` | **No impact on data**, but it's the meta mod pinning the canonical SE mod set — keep it |
| `DiscoScience` (−304 B), `RecipeBook` (+5.8 KB) | Real data impact — keep |
| `alien-biomes` (+`-graphics`), `bullet-trails`, `robot_attrition`, `space-exploration-menu-simulations` | Hard dependencies of `space-exploration` — unprunable |
| `ModuleInserterSimplified`, `Milestones` | Hard dependencies of `official-modpack` — unprunable while it stays |

Sprite attribution (refs per `__mod__` prefix in `data.json`): ~46% of the
pack's 4478 sprite refs come from portal mods, led by `textplates` (944),
`space-exploration-graphics` (860) and `aai-industry` (235). The known gap:
4 refs to base's 1.1-era `nuclear-reactor/connection-patch-*.png` (copied by
SE's energy-transmitter/antimatter-reactor, removed in base 2.0) are skipped
by the exporter with a warning — a missing heat-pipe overlay at worst.
