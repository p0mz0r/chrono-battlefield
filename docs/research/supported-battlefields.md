# Which battlefields can a course use?

Research for [#27](https://github.com/p0mz0r/chrono-battlefield/issues/27), part of the map in [#1](https://github.com/p0mz0r/chrono-battlefield/issues/1). Feeds the course editor's validation ([#10](https://github.com/p0mz0r/chrono-battlefield/issues/10)). Researched 2026-10-25.

Tags:
- **[Install]**: checked against the owner's RA2 + YR install (`RA2_DIR`) with the #5 prototype's readers (openra2 `8ba59f0`).
- **[V]**: read in the primary source linked next to it: the game INIs inside the MIXes, EA's GPL Final Alert 2 source, CNCMaps, OpenRA's RA2 mod.
- **[Inf]**: my inference.

ModEnc was unreachable during this research (direct: HTTP 403, Wayback: 429), so nothing here rests on it.

## Answer

1. **All six theaters import with all their art.** Each theater's control INI, its three palettes and its MIXes are present in a combined install, and every tile that a scanned map uses resolves. **[Install]**
2. **Most maps pass.** 609 of the 684 maps on the install pass the rule below, including all 53 Westwood maps. The 75 that fail need art or rules that only CnCNet's client files supply, or they point at art that exists nowhere. **[Install]**
3. **Overlay:** an overlay's number in a map is its position in `rulesmd.ini [OverlayTypes]`, not its key. Ore, gems, walls and both bridge kinds have art in every theater. **[V] [Install]**
4. **Bridges:** RA2 has high bridges (concrete `BRIDGE1/2` and wood `BRIDGEB1/2`, with a railway variant that no scanned map uses) and low bridges (`LOBRDG*` and `LOBRDB*`). The stock rules make bridges destroyable. A bridge repair hut (`CABHUT`) repairs them when an engineer enters it. **Lunar has no high bridges at all.** `!bridge B1` should target high bridges only. **[V] [Install]**
5. **A custom map can't be supported** when it needs any of these: a tile or object whose art isn't in that theater's MIXes; an object type that only CnCNet's `cncnet.mix` / `ra2mode.mix` rules define; or an `Image=` that points at art the install doesn't have. A map can't embed art (map files are INI text, and every `.mmx`/`.yro` holds just the map and its `.pkt`). Its rules overrides are common (588 of 684 maps) and mostly harmless to us.
6. **Proposed rule:** [§5](#5-proposed-supported-map-rule). It reads stock files only, checks tiles, overlay, trees and buildings in the map's own theater, honours the map's `Image=` and type lists, and ignores units and gameplay rules.

## 1. Theaters

YR mounts these MIXes per theater, from CNCMaps' YR defaults ([ModConfig.cs L254-357 @56712d7](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.Shared/ModConfig.cs#L254-L357)). The other columns come from the install. **[V] [Install]**

| Theater | Control INI | Theater MIXes found (ra2.mix / ra2md.mix) | Ext / NewTheater letter | Tile files on disk / listed | Unit voxels |
|---|---|---|---|---|---|
| Temperate | `temperatmd.ini` | isotemp, temperat, tem / isotemmd | `.tem` / T | 511 / 838 | yes |
| Snow | `snowmd.ini` | isosnow, snow, sno / isosnomd, snowmd | `.sno` / A | 563 / 964 | yes |
| Urban | `urbanmd.ini` | isourb, urb, urban / isourbmd | `.urb` / U | 712 / 1081 | yes |
| New Urban (YR) | `urbannmd.ini` | — / isoubnmd, isoubn, ubn, urbann | `.ubn` / N | 806 / 1175 | yes |
| Desert (YR) | `desertmd.ini` | — / isodesmd, desert, des, isodes | `.des` / D | 726 / 726 | yes |
| Lunar (YR) | `lunarmd.ini` | — / isolunmd, isolun, lun, lunar | `.lun` / L | 154 / 198 | yes |

- The palettes `iso<ext>.pal`, `unit<ext>.pal` and `<theater>.pal` are present for all six. **[Install]**
- **The missing tile files don't matter.** They are sets that the theater INIs still list but the game doesn't ship: TS-era leftovers such as `mslop*` and Lunar's duplicate `hyte*` sets. No Westwood map uses them, and only 2 of 684 maps reference a missing tile, one cell each. They still count towards tile numbering, so a reader must keep counting `TilesInSet` across them (as the prototype's `buildTileSlots` does). **[Install]**
- **New Urban, Lunar and Temperate drew fine as data.** #5 drew only Desert and Snow. This scan resolved every tile, overlay, tree and building in 609 maps across all six theaters, but it didn't render them. **[Install]**
- The three YR theaters live only in `ra2md.mix`. The YR theater MIX names have no `md` suffix (`desert`, `isodes`, `urbann`, `isoubn`, `lunar`, `isolun`), matching `docs/agents/ra2-install.md`. **[Install]**

### Art lookup rule (the prototype gets this wrong)

CNCMaps resolves an object's image file like this ([Drawable.cs L87-L90](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.Engine/Drawables/Drawable.cs#L87-L90), [ObjectCollection.cs L237-L272](https://github.com/zzattack/ccmaps-net/blob/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a/CNCMaps.Engine/Game/ObjectCollection.cs#L237-L272)) **[V]**:

- `Image=` comes from rules, then art, else the type ID.
- `Theater=yes` (trees, overlay) gives `<image>.<theater ext>`.
- Otherwise, in RA2/YR, the NewTheater swap is applied **regardless of the art INI's `NewTheater=` flag**. That swap applies when the ID's 2nd letter is one of A, T, U, D, L, N (vanilla YR also requires a 1st letter of G, N, C or Y). It replaces the 2nd letter with the theater letter, and if that file is missing, with `G` (generic), then falls back to the original name.

The install confirms this. `CAUSFGL` (US flag) has `NewTheater=no` in `artmd.ini`, and `causfgl.shp` exists only in `isosnow.mix`. Westwood's own Urban maps (Arena, Bermuda, GoldSt) still place it, and their art is `cuusfgl.shp` in `isourb.mix`. **[Install]** The #5 prototype swaps only when `NewTheater=yes` (`main.ts`, the `NewTheater` line). That would drop such buildings, so the real reader has to follow CNCMaps here. Objects with `InvisibleInGame=yes` (light posts such as `INYELWLAMP`) have no art by design.

## 2. Overlay

- **Index = list position.** `[OverlayTypes]` in `rulesmd.ini` has keys `1=GASAND`…`253=LUNRK6` with gaps (40, 41 and 183 are missing or commented out). The game indexes by order, which gives 250 entries, 0–249. That order puts the bridges at the indices FA2 hard-codes: `BRIDGE1/2` = 24/25 (0x18/0x19), `RAILBRDG1/2` = 59/60 (0x3B/0x3C), `BRIDGEB1/2` = 237/238 (0xED/0xEE) ([FA2 inlines.h `isBigBridge` L275-L282](https://github.com/electronicarts/CNC_TS_and_RA2_Mission_Editor/blob/6abf0f557469baea73079c6bf6550709e2e3584e/MissionEditor/inlines.h#L275-L282)), and the low-bridge starts at 74 (0x4A) and 205 (0xCD) ([IsoView.cpp L3345](https://github.com/electronicarts/CNC_TS_and_RA2_Mission_Editor/blob/6abf0f557469baea73079c6bf6550709e2e3584e/MissionEditor/IsoView.cpp#L3345)). So the indices are positional. **[V] [Install]** A map can carry its own `[OverlayTypes]`, but none of the 684 does. The reader should still prefer the map's list.
- **Ore and gems:** `TIB01–20`, `TIB2_*` and `TIB3_*` (named "Tiberium" but they are ore) and `GEM01–12`, all `Tiberium=yes` (rulesmd `[GEM01]`, `[TIB01]`). The art is `Theater=yes`, so it's `<image>.<ext>`, present in all six theaters. 495 of 684 maps have ore. Overlay data holds the growth frame [Inf]. Ore doesn't block movement (#3).
- **Walls:** `GAWALL`, `NAWALL`, `GASAND`, `GAFWLL`, the fences `CAFNC*` and others: `Wall=yes`, with `Strength` and `Armor` in rulesmd. Their art follows NewTheater, e.g. `gtwall/guwall/gnwall/gdwall/glwall.shp` and generic `ggfwll.shp`, present in all theaters. The connection frame is in overlay data [Inf]. Walls are hard blockers (ADR 0005).
- **Overlay with no art anywhere:** `CYCL`, `BARB`, `WOOD`, `V16–V18` and `FENC` (TS/RA1 leftovers), plus `LUNRK1–6` outside the YR theaters. No scanned map uses any of them. **[Install]**

## 3. Bridges

| Kind | Overlay (index) | rulesmd name | Theater art | Ends come from | Maps using it (of 684) |
|---|---|---|---|---|---|
| High concrete | `BRIDGE1`/`BRIDGE2` (24/25), one per direction | "Bridge 1/2", `LegalTarget=true` | `bridge.<ext>`, all six | theater `BridgeSet` (19) tiles | 91 / 89 |
| High wood | `BRIDGEB1`/`BRIDGEB2` (237/238) | "Wood Bridge 1/2" | `bridgb.<ext>`, all six | `WoodBridgeSet` (80; Snow 73; Urban, New Urban 101) | 68 / 60 |
| High railway | `RAILBRDG1/2` (59/60) | "Railroad Bridge" | `railbrdg.<ext>` | `TrainBridgeSet` | 0 |
| Low | `LOBRDG01–28` (74–101), `LOBRDGE1–4` ends | "Low Bridge", `Land=Road` | all six | overlay only, 3 cells wide | 215 maps have low-bridge overlay (`LOBRDG*` or `LOBRDB*`) |
| Low concrete | `LOBRDB01–28` (205–232), `LOBRDGB1–4` ends | "Concrete Low Bridge" | all six | overlay only | (included above) |
| Decorative | buildings such as `CASANF04` "Golden Gate Bridge" | `BuildingTypes`, `WaterBound=yes` | building art | — | — |

Sources: rulesmd `[BRIDGE1]` L29869, `[LOBRDG01]` L29342, `[CASANF04]` L15854; the theater INIs' `[General] BridgeSet/WoodBridgeSet/TrainBridgeSet`; FA2 places high bridges as a line of one overlay per cell, a deck 4 height levels above the start ([IsoView.cpp L3186-L3344](https://github.com/electronicarts/CNC_TS_and_RA2_Mission_Editor/blob/6abf0f557469baea73079c6bf6550709e2e3584e/MissionEditor/IsoView.cpp#L3186-L3344)), and low bridges as 3-cell-wide strips (L3345 on). **[V] [Install]**

- **Lunar has no high bridges.** In `lunarmd.ini`, `[TileSet0019]` "Bridges" and `[TileSet0080]` "Wood Bridges" have `TilesInSet = 0` and `AllowToPlace=no` (L429, L1175), so there are no ends to build one from. The other five theaters have all 16/16 end tiles. Of the 193 maps with high bridges, 91 are Temperate, 48 Snow, 31 Urban, 21 New Urban, 2 Desert and 0 Lunar. **[Install]**
- **Destroyable:** rulesmd `[CombatDamage] DestroyableBridges=yes` (L804) and `BridgeStrength=1500` (L816); `[MultiplayerDialogSettings] BridgeDestruction=yes` (L3029); `BridgeVoxelMax`, "debris from each destroyed bridge section" (L419). A map can turn this off with `[SpecialFlags] DestroyableBridges=` ([FA2 SpecialFlags.cpp L110](https://github.com/electronicarts/CNC_TS_and_RA2_Mission_Editor/blob/6abf0f557469baea73079c6bf6550709e2e3584e/MissionEditor/SpecialFlags.cpp#L110)): 44 maps set `no`, 633 `yes`, 7 leave it unset. FA2 says "a bridge is considered destroyed when an impassable gap is created in the bridge" (trigger event 31, [FAData.ini L1042](https://github.com/electronicarts/CNC_TS_and_RA2_Mission_Editor/blob/6abf0f557469baea73079c6bf6550709e2e3584e/MissionEditor/data/FinalAlert2/FAData.ini#L1042)). **[V] [Install]**
- **Low bridges are destroyable too.** OpenRA's RA2 import maps low-bridge overlay numbers to Undamaged/Heavy/Critical states ([ImportRA2MapCommand.cs L225-L285 @61e24e3](https://github.com/OpenRA/ra2/blob/61e24e3c1d7b586aa55a86096d29e1559aa9b994/OpenRA.Mods.RA2/UtilityCommands/ImportRA2MapCommand.cs#L225-L285)) and gives low bridges `HP: 500` with dead variants. OpenRA models high bridges only as `^ElevatedBridgePlaceholder` with no health ([bridges.yaml L38-L49, L301 on](https://github.com/OpenRA/ra2/blob/61e24e3c1d7b586aa55a86096d29e1559aa9b994/mods/ra2/rules/bridges.yaml)). This is from OpenRA, not the original game. **[V for OpenRA; Inf for YR]**
- **Repair:** `[CABHUT]` "Bridge repair hut", `BridgeRepairHut=yes`, `Immune=yes` (rulesmd L16336–L16348); `RepairBridgeSound=BridgeRepaired` (L721). OpenRA's `cabhut` repairs the bridge within ±2 cells (`BridgeHut NeighbourOffsets`). 278 maps place a hut. That an engineer entering the hut triggers the repair is standard RA2 behaviour; I didn't verify it here. **[V] [Inf]**
- **What this means for `!bridge B1` [Inf]:** our game does its own destroying and repairing (ADR 0005, #9), so the RA2 mechanics only matter for faithfulness. Targets are the high bridges the course labels (per the glossary). Low bridges stay drivable terrain, not targets. A label should cover one contiguous run of `BRIDGE*`/`BRIDGEB*` cells. Huts and the map's `DestroyableBridges` flag can be ignored.

## 4. What makes a custom map unsupportable

Per-map scan of every `Maps\**\*.map` (631, CnCNet client's map pool plus downloads) and every root `.mmx`/`.yro` package (53, Westwood's maps) **[Install]**:

| Reason | Maps | Examples |
|---|---|---|
| Trees whose art is only in CnCNet's `cncnet.mix` (`TREE29–36`, `SPKR01`) | 25 | `blitz_heck_landrush`, `8_oceania_mod` |
| Survival/mod maps whose `Image=` points at art the install lacks (`CATECH01`, `GAGAP`, `GAPOWR`, …) | 20 | 31 of the 32 `Survival\` maps fail for some reason |
| Building art only in another theater's MIX (snow-only `CALUNR0x`, `CASTRT0x`, `CAURB03`, flags in Desert/Lunar) | 22 | `2_dannath_revisited`, `8_device` |
| Types that stock rules don't define (`TREE38–46`, `GAGATE_B`, `CALA03A`; some are added by `cncnet.mix`'s rulesmd) | 6 | `8_black_sea_mod` |
| One cell referencing a tile the theater doesn't ship | 2 | `4_limbo_of_the_lost` |

Notes:
- **Cross-theater art.** In the real game such a building is probably just invisible [Inf]. Evidence for that: CnCNet ships `cglunr01/02.shp`, `cgurb03.shp` and `ctlond05.shp` in `cncnet.mix` to fill exactly these gaps. For us, an invisible blocker is bad (tanks stop at nothing), so reject the map.
- **CnCNet files aren't the install.** `cncnet.mix` and `ra2mode.mix` each carry their own `rulesmd.ini`/`artmd.ini`. `cncnet.mix` adds 5 building types, and `ra2mode.mix` (RA2-in-YR mode) **reorders `[OverlayTypes]`**. Also, the loose `art.ini` in the install root is RA2's. Our reader must take `rulesmd.ini` from `expandmd01.mix` and `artmd.ini` from `localmd.mix`, and never pick these up. That matches the owner's other streamers, who may not run CnCNet [Inf].
- **Map-embedded art: none possible.** `.map`/`.yrm`/`.mpr` are INI text. All 53 packages hold exactly 2 entries (`.map` + `.pkt`). Mods ship art as extra MIXes in the game folder, and our reader ignores those.
- **Rules overrides are common and mostly harmless.** 588 maps carry rules sections (`NAYARD`/`GAYARD` 400+, `[General]` 258, `[HTNK]` 36). Only these change what we read: object `Image=` (honour it, key by key over rulesmd: a map `[APOC]` without `Image=` keeps rulesmd's `Image=MTNK`), the type lists (honour them; `[TerrainTypes]` in 2 maps, `[BuildingTypes]` in 167), and `[OverlayTypes]` (none). Land-type speed sections (`[Rough]` in 10 maps, `[Road]`, `[Railroad]` in 1) and `[HTNK]` would change Rhino behaviour. Rhino stats are fixed plain data (#1 decisions), so ignore them and show a warning. **[Install] [Inf]**
- Units, infantry and aircraft placed in a map aren't part of a battlefield, so skip them. Checking them would fail only 1 more map (civilian cars whose `Image=` the map overrides).

## 5. Proposed supported-map rule

A map file is **supported** when, reading only stock files (`ra2.mix`, `ra2md.mix`, `expandmd01.mix` and their nested MIXes; `rulesmd.ini` from `expandmd01.mix`), all of these hold:

1. **It parses.** It's an INI with `[Map] Theater` set to one of `TEMPERATE`, `SNOW`, `URBAN`, `NEWURBAN`, `DESERT`, `LUNAR`; `IsoMapPack5` decodes, and so do `OverlayPack`/`OverlayDataPack` if present. A `.mmx`/`.yro` is opened as a MIX holding the `.map`.
2. **Tiles.** Every cell's tile number (other than `0xFFFF`, which means clear) maps through the theater INI's `[TileSetNNNN]` count to a TMP file that exists in **that theater's** MIX set, and its sub-tile index is within that TMP.
3. **Overlay.** Every overlay byte other than `0xFF` indexes into `[OverlayTypes]` (the map's list if it has one, else rulesmd) by position, and that type's art resolves in that theater.
4. **Trees and buildings.** Every `[Terrain]` and `[Structures]` type is in the stock or map type list, and its art resolves in that theater by the CNCMaps rule (§1): `Image=` merged key by key (map over rules), then `Theater=`, then the NewTheater swap, `G` fallback, original name. `InvisibleInGame=yes` needs no art.
5. **Ignored, with a warning listing them:** other rules overrides (land-type speeds, `[HTNK]`, `[General]`, `[SpecialFlags]`), and units, infantry, aircraft, triggers and AI.
6. **Bridges in play** (`B1`…): each must be a contiguous run of `BRIDGE1/2` or `BRIDGEB1/2` overlay cells. Lunar maps can't have any.

Under this rule, 609 of the 684 maps on the install pass: all 53 Westwood maps; Temperate 280/310, Snow 142/158, Urban 68/84, New Urban 29/35, Desert 86/89, Lunar 4/8. **[Install]** The check is cheap enough to run live in the editor [Inf]: one map plus its theater's file lookups, with no decoding of TMP pixels beyond reading the header.

## Method and gaps

- **How it was checked.** Throwaway Node scripts (not committed) bundled the prototype's `vendor/formats` readers. For each theater, they mounted the common MIXes (`local`, `cache`, `conquer`, `generic`, `isogen` and the `md` versions) plus only that theater's MIXes, as the game does, and checked file presence by MIX ID. Then they walked all 684 maps. Cross-checks used a one-level search of every top-level MIX in the install.
- **Not checked.**
  - Nothing was rendered.
  - RA2-only maps inside `multi.mix`/`multimd.mix` weren't enumerated (names unknown without a name list). The loose Westwood packages cover YR's and RA2's shipped multiplayer maps.
  - The in-game behaviour of cross-theater buildings and of the hut repair wasn't observed.
  - Whether vanilla YR destroys low bridges rests on OpenRA, not on a run of the game.

## Sources

- Game INIs, read from the install: `rulesmd.ini` (`expandmd01.mix`, YR 1.001), `artmd.ini` (`ra2md.mix > localmd.mix`), and the six `*md.ini` theater INIs (`localmd.mix`).
- EA, [CNC_TS_and_RA2_Mission_Editor @6abf0f5](https://github.com/electronicarts/CNC_TS_and_RA2_Mission_Editor/tree/6abf0f557469baea73079c6bf6550709e2e3584e) (GPL-3.0): `inlines.h`, `IsoView.cpp`, `SpecialFlags.cpp`, `data/FinalAlert2/FAData.ini`.
- zzattack, [ccmaps-net @56712d7](https://github.com/zzattack/ccmaps-net/tree/56712d7c9c5048afbfe9bddb01c0ec43f6fc008a) (GPL-3.0): `ModConfig.cs`, `ObjectCollection.cs`, `Drawable.cs`.
- OpenRA, [ra2 @61e24e3](https://github.com/OpenRA/ra2/tree/61e24e3c1d7b586aa55a86096d29e1559aa9b994) (GPL-3.0): `ImportRA2MapCommand.cs`, `mods/ra2/rules/bridges.yaml`.
- Prototype readers: branch `prototype/battlefield-and-rhino`, `prototype-battlefield/vendor/` (openra2 `8ba59f0`).
