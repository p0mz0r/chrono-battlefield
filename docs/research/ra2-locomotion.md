# How RA2 / Yuri's Revenge moves ground vehicles

Research for issue #3, part of the map in #1. The question: how does RA2/YR move a ground vehicle like the Rhino? This covers cell occupancy, passability, height and bridges, pathfinding, speed and turning, and what happens when a unit is blocked.

## Confidence tags

Every claim carries one of these tags:

- **[YR]**: verified against Yuri's Revenge itself. That means the shipped `rulesmd.ini` or the reverse-engineered YR headers (YRpp, which mirror `gamemd.exe` memory layouts and function addresses) or Phobos.
- **[TS]**: verified for the Tiberian Sun engine, which RA2/YR is built on. The main source is the OpenTS manual, a reverse-engineered behaviour reference for TS. These claims are assumed to carry over to YR. Where YR structures visibly match (for example the A* layout), the tag says so.
- **[RA1]**: from EA's GPL Red Alert 1 source. The lineage is shared and some identifiers are identical, but RA1 is older code. Treat it as illustration only.
- **[Inf]**: my inference, not read from any source.

ModEnc (modenc.renegadeprojects.com) returned HTTP 403 to every automated fetch, so it is **not** cited. All rules values below come from the game's own data file instead, which is a better primary source anyway.

## Sources

| Short name | What | Where |
|---|---|---|
| rulesmd | YR 1.001 `rulesmd.ini` (the patched copy the game loads, from `expandmd01.mix`) | extracted from the local install `D:\GAMES\Origin\Command and Conquer Red Alert II\expandmd01.mix` with the `ra2mix` PyPI package; line numbers below refer to that file |
| YRpp | reverse-engineered YR headers | https://github.com/Phobos-developers/YRpp: `Fundamentals.h`, `CellClass.h`, `GeneralDefinitions.h`, `AStarClass.h`, `DriveLocomotionClass.h`, `LocomotionClass.h`, `Facing.h`, `Dir.h`, `TechnoTypeClass.h` |
| Phobos | YR engine extension, its docs and source | https://github.com/Phobos-developers/Phobos: `docs/Fixed-or-Improved-Logics.md`, `src/Utilities/INIParser.h`, `src/Ext/TechnoType/Hooks.cpp` |
| OpenTS | TS reverse-engineering manual | https://github.com/OpenTS-Developers/OpenTS: `manual/content/systems/movement-and-terrain.md`, `.../systems/route-search.md`, `.../keys/{crusher,closeenough,pathdelay,blockagepathdelay,trackeduphill,trackeddownhill,toobigtofitunderbridge,cliffbackimpassability,land,nousetilelandtype,scatter--global-rules}.md` |
| Vinifera | TS engine extension | https://github.com/Vinifera-Developers/Vinifera: `src/extensions/astar/astarext_hooks.cpp` |
| RA1 | EA GPL source release | https://github.com/electronicarts/CnC_Remastered_Collection: `REDALERT/DRIVE.CPP` |
| OpenRA | OpenRA's tileset importer and RA2 mod | https://github.com/OpenRA/OpenRA: `OpenRA.Mods.Cnc/UtilityCommands/LegacyTilesetImporter.cs`; https://github.com/OpenRA/ra2: `mods/ra2/rules/world.yaml`, `soviet-vehicles.yaml` |
| Prior attempt | rhino-race-2 navigation model, for comparison only | `D:\orca-workspaces\rhino-race-2\p34-assets-batch-7-p1-civilian-buildings-and-lan\docs\product\rhino-race.md` (section "Tank movement and race rules"), `docs\product\shared-map-format-v4.md` (sections "Coordinates and lattices", "Navigation"), `docs\features\native-map-conversion.md` |

Chrono Divide, the browser RA2 reimplementation, publishes no implementation notes I could find, so it is not used.

---

## 1. Cell grid and coordinates

- **One cell is 256 leptons across.** **[YR]** YRpp `Fundamentals.h`: `LeptonsPerCell = 256`.
- **One height level is 104 leptons.** **[YR]** YRpp `Fundamentals.h`: `LevelHeight = 104`, `CellHeight = 208`.
- **On screen a cell is a 60×30 px isometric diamond.** **[YR]** YRpp `Fundamentals.h`: `CellWidthInPixels = 60`, `CellHeightInPixels = 30`.
- **A position is a 3D lepton `CoordStruct`. Its cell is the position divided by 256.** **[YR]** YRpp; **[TS]** OpenTS, "The cell".
- **Each cell stores a `Level` (height 0–15), a `SlopeIndex` (ramp shape) and a `LandType`.** **[YR]** YRpp `CellClass.h`: fields `Level`, `Height`, `SlopeIndex`, `LandType`, `IsoTileTypeIndex`, `OverlayTypeIndex`, `Passability`.
- **Facings are 16-bit binary angles.** North is `0x0000` and south is `0x8000`. There are 8 coarse `FacingType` directions for grid steps. **[YR]** YRpp `Dir.h`, `GeneralDefinitions.h`.

## 2. Cell occupancy

- **A vehicle takes the whole cell, one per cell. Infantry use sub-cells.** **[YR]** YRpp `CellClass.h`, comment on `OccupationFlags`:
  - infantry spots: `0x1` center, `0x2` top (abandoned), `0x4` right, `0x8` left, `0x10` down
  - `0x20` units (vehicles), `0x40` aircraft, `0x80` buildings

  **[TS]** OpenTS: "Three of them are open to infantry ... A vehicle or a structure takes the whole cell."
- **A cell under a high bridge has a second, independent occupancy layer for the deck.** **[YR]** YRpp `CellClass.h` has `FirstObject` / `AltObject` and `OccupationFlags` / `AltOccupationFlags`. **[TS]** OpenTS: "the ground under the deck and the deck itself are occupied independently". So one tank can be on the bridge while another is under it.
- **A moving vehicle reserves the cell it is heading into.** **[TS]** OpenTS, per-step test item 10: "A cell that another object has claimed for its next step counts as blocked by something moving." **[RA1]** `DriveClass::Mark_Track` sets the vehicle occupancy flag on the head-to cell, and on the midpoint cell of a two-cell track. In practice a driving tank holds both its current cell and its next cell. **[Inf]** for YR specifically.
- **Crushing.**
  - **[YR]** The Rhino has `Crusher=yes` (rulesmd `[HTNK]`). The rulesmd docs say `Crusher` = "Is this vehicle able to crush infantry".
  - **[TS]** OpenTS `keys/crusher`: a crusher drives over **non-allied** `Crushable=yes` objects and treats their cell as passable. It also drives over crushable walls. In YR the `Crushable=yes` set is: infantry types `E1, GGI, JUMPJET, GHOST`, the `LUNR` unit, and the overlays `GASAND` (sandbags) and `CAFNCB/CAFNCW/CAFNCP` (fences) (rulesmd, `Crushable=yes` grep).
  - **[YR]** Vehicles are not crushable by a plain `Crusher`. Crushing vehicles needs `OmniCrusher=yes`, which only the Battle Fortress has. Real walls (`GAWALL`, `NAWALL`) need `MovementZone=CrusherAll` (rulesmd `[BFRT]` comments: "OmniCrush handles crushing tanks and such, this handles walls").
  - **Consequence: a Rhino can never crush another Rhino.** Two tanks must physically queue or detour around each other.

## 3. Land types and passability (SpeedType = Track)

**Which column a vehicle reads.**

- **[YR]** There are 12 land types: `Clear, Road, Water, Rock, Wall, Tiberium, Beach, Rough, Ice, Railroad, Tunnel, Weeds` (YRpp `LandType` enum). Each has a `rulesmd` section with a percentage per SpeedType.
- **[YR]** `[HTNK]` sets no `SpeedType`. **[TS]** OpenTS `keys/crusher`: a UnitType's default SpeedType is `Track` if `Crusher=yes`, else `Wheel`. So **the Rhino is Track**. **[Inf]** for YR, but consistent with every vanilla YR tank: only hover, float and amphibious units set `SpeedType` explicitly.

**`Track=` column, from rulesmd lines 30191–30330** **[YR]**:

| LandType | Track | Notes |
|---|---|---|
| Clear | 100% | |
| Road | 100% | |
| Rough | 100% | YR raised this from the old 60% (the old line is still commented out above it) |
| Railroad | 100% | |
| Tunnel | 100% | |
| Ice | 80% | |
| Tiberium (= **ore/gems** in RA2) | 70% | ore fields slow tanks |
| Weeds | 70% | |
| Water | **0% (impassable)** | |
| Rock (cliffs) | **0%** | |
| Wall | **0%** | |
| Beach | **0%** | see the quirk below |

- **[TS]** Exactly 0 means impassable. Any other value is a fraction of top speed, and only the **Drive** locomotor applies it (OpenTS "The terrain table"). **The route search does not price terrain.** Road and rough cost the same to the pathfinder. Terrain only changes speed (OpenTS "The route search prices no terrain").

**The "Beach" quirk.** **[YR + OpenRA]** The `[Beach]` land type is impassable to tracks, yet vehicles drive on sandy beaches in RA2. Each sub-tile of a theater TMP tile carries a terrain byte (0–15), and the engine maps that byte to a LandType. OpenRA's importer table (`LegacyTilesetImporter.cs`) shows byte 10 is "Beach" in TS terms, with the comment "TS defines this as 'Beach', but uses it for water...?". The visible sand is Clear or Rough. **[Inf]** "Beach" in practice means shoreline water, passable only to ships (`FloatBeach=100%`). **Map import must take the land type from the tile's per-cell terrain byte, not from how the tile looks.**

**Overlays.**

- **[YR]** Ore and gem overlays (`TIB01..TIB20`, `GEM01..GEM12` …) have `Tiberium=yes`. **[TS]** OpenTS `keys/land`: a `Tiberium=yes` overlay that leaves `Land` at default reports LandType `Tiberium`, so tanks drive at 70% on ore.
- **[YR]** Low bridges (`LOBRDG*`) set `Land=Road` with `NoUseTileLandType=true`. They are driveable at ground level over the water tile beneath.
- **[YR]** Rail overlays use `Land=Railroad`, and 52 overlays use `Land=Rock` (rulesmd `Land=` counts).
- **[TS]** Walls block through `Wall=yes`, not through land type (OpenTS `keys/land`).

**Terrain objects (trees and similar).**

- **[YR]** `[TREE01]` and the other trees declare `TemperateOccupationBits` / `SnowOccupationBits`, which are infantry-spot masks.
- **[TS]** OpenTS per-step test: a vehicle is refused a tree cell **unless** the warhead it would fire has `Wood=yes` and the tree is not `Immune`. In that case the tree counts as a "destroyable" obstruction.
- **[YR]** The Rhino's `120mm` uses warhead `AP`, which has `Wood=yes` and `Wall=yes`. **So a vanilla Rhino will path through trees and walls by shooting them.**
- **Rhino Race should not do that.** Treat trees, walls and buildings as hard blockers (MovementZone `Normal` semantics, see below).

**Buildings.** **[YR]** `OccupationFlags 0x80`. **[TS]** A building in the cell refuses vehicles. The only exceptions are things like a refinery bib for a docking harvester or a repair bay being entered (OpenTS per-step test item 8).

**MovementZone.** This decides reachability, not per-step passability.

- **[YR]** The Rhino is `MovementZone=Destroyer`. That surprised me; I expected `Normal`. The YR enum is `Normal, Crusher, Destroyer, AmphibiousDestroyer, AmphibiousCrusher, Amphibious, Subterrannean, Infantry, InfantryDestroyer, Fly, Water, WaterBeach, CrusherAll`.
- **[TS]** OpenTS "The zone map": every cell gets a blockage rating (Outside, Crushable, Blocked (wall), Impassable, Water, Partly blocked (tree), Open land). Each MovementZone accepts a subset:
  - `Normal` accepts open land only.
  - `Crusher` also accepts crushable.
  - `Destroyer` also accepts crushable and blocked.

  Connected accepted cells form a zone. An order to a cell in another zone is refused before any search runs.

## 4. Height levels, slopes, cliffs

- **[TS]** Every step compares the levels of the two cells (OpenTS "Height, ramps and bridges"):
  - **same level**: allowed;
  - **one level apart**: allowed only across a ramp (sloped tile), and the ramp must be the lower cell;
  - **four levels apart**: the bridge case only;
  - **anything else**: refused. A two-level cliff stops every ground unit.
- **[YR]** Cliff tiles also carry LandType `Rock` (0% Track).
- **[YR]** **`CliffBackImpassability=2`** (rulesmd line 409). **[TS]** OpenTS `keys/cliffbackimpassability`: with `2`, a Clear, Water, Beach or Ice cell becomes `Rock` when a nearby cell stands at least four levels above it. The engine checks 6 specific neighbour offsets: `(0,-1) (-1,0) (+1,-1) (-1,+1) (+1,+1) (+2,+2)`.

  **So ground at the foot of a cliff is impassable in a strip on some sides.** This contradicts the prior attempt's rule "same-level land beside a cliff remains driveable".
- **[YR]** Slope speed multipliers (rulesmd lines 401–404): `TrackedUphill=1.0` and `TrackedDownhill=1.2`. **[TS]** Both are capped at full speed, so on 100% terrain neither changes anything. They only matter on slower terrain such as ore or ice. The route search ignores them (OpenTS `keys/trackeduphill`).
- **[YR]** `IsTilter=yes` on `[HTNK]` is visual tilt on slopes only.

## 5. Bridges

- **High bridges (overlays `BRIDGE1/2`, wood `BRIDGEB1/2`, rail `RAILBRDG1/2`).**
  - **[YR]** The deck sits `BridgeLevels = 4` levels (416 leptons) above the cell (YRpp `CellClass.h`). `CellClass::GetLevel()` adds 4 when the cell has a bridge.
  - **[TS]** A unit on the deck is tested at deck height. The terrain figure is skipped and `[Road]` speed is used, which is how a Track unit crosses water on a bridge. Under the bridge, the cell is tested as normal ground.
  - **[TS]** A destination under a bridge must be reached at deck height ("A destination spanned by a bridge must be reached at deck height"). This is a known source of odd routing.
  - **[YR]** Bridges link zones that the ground would otherwise split.
  - **[Inf]** The deck is wider than the one overlay line FA2 places (three cells, as the art shows): in one run of YR with Ares and Phobos injected, tanks passed each other on it and stopped on the side cells at deck height ([ra2-bridge-deck-width.md](ra2-bridge-deck-width.md), #66).
- **Units cannot stop under a high bridge.** **[YR]** Phobos `Fixed-or-Improved-Logics.md`: "Technos are still not allowed to stop moving under the elevated bridge". In vanilla, units also could not stop on top of one; Phobos fixed only that half.
- **`TooBigToFitUnderBridge=true`** is set on the Rhino and most tanks, but **[TS]** it is drawing-only. It splits the voxel image for depth sorting and does not restrict movement (OpenTS `keys/toobigtofitunderbridge`).
- **Low bridges (`LOBRDG*`).** **[YR]** These are ground-level overlays with `Land=Road` over water. No over/under.
- **[YR]** Bridges are destructible (`BridgeStrength=1500`, `BridgeDestruction=yes`) and repairable from bridge-repair huts (`CellFlags::BridgeOwner`).

## 6. Pathfinding

- **The algorithm is hierarchical A\*.** **[TS]** OpenTS "Route search":
  - **Block stage.** Plans over connected blocks at 8×8, then 4×4, then 2×2 cell squares, and produces a corridor.
  - **Cell stage.** An 8-neighbour A\* restricted to the corridor. The heuristic is the straight-line distance in cells.
- **YR uses the same structure.** **[YR]** YRpp `AStarClass` has `FindPath`, `AttemptPath`, three hierarchy levels (`ZoneIndices[3]`, `PassabilityData[3]` with `Indices[500]`) and a `PathCostFactor`. The 500-entry limit matches OpenTS's "chain of 500 blocks" exactly. Vinifera patches `AStarClass::Find_Path_Hierarchical` in TS, and Phobos fixed YR crashes in the same pathfinding node buffers ("Fixed pathfinding crashes ... due to too small pathfinding node buffer").
- **[TS] Step cost depends on what occupies the cell, never on terrain.**

  | Cell verdict | Cost |
  |---|---|
  | clear | 1 |
  | moving object | 1, 4 or 1000 (see below) |
  | friendly unit standing still | 8 |
  | enemy destroyable obstacle | 20 |
  | friendly destroyable obstacle | 60 |
  | cloaked enemy | 1000 |
  | prohibited | never entered |

  Tiny direction tie-breakers favour straight steps: 0.001–0.004 for orthogonal, 0.005–0.008 for diagonal.
- **[TS] Known quirks:**
  - The heuristic overestimates on diagonals, and a reached cell never gets a cheaper parent, so **routes are often not shortest**. Diagonal and straight steps cost the same.
  - The finished route is "straightened" in two passes, which can change the ground covered.
  - A unit keeps only the next **24 steps** and re-searches after that.
  - Routes of 2,000 or more steps are never returned. A route found on exactly the 10,000th cell is discarded.
  - Corridors longer than 500 blocks are abandoned.
  - At most **5 passes** per request.
- **Diagonal corner-cutting.** **Allowed**, even with both orthogonal neighbours blocked. Settled by an in-game test for #18: see [ra2-corner-cutting.md](ra2-corner-cutting.md).

## 7. Rhino stats and speed / turn model

`[HTNK]` in rulesmd **[YR]**:

```
Speed=6  ROT=5  Crusher=yes  Turret=yes  IsTilter=yes  Accelerates=false
Locomotor={4A582741-9839-11d1-B709-00A024DDAFD1}   ; Drive (YRpp DriveLocomotionClass.h header comment; Phobos alias "Drive")
MovementZone=Destroyer  TooBigToFitUnderBridge=true  Weight=3.5
VeteranAbilities=STRONGER,FIREPOWER,SIGHT,FASTER   ; FASTER = VeteranSpeed=1.2
```

- **Speed units.**
  - **[YR]** Phobos docs: the INI `Speed` is clamped to 100, then multiplied by 256/100, then truncated, then clamped to 255. The result is **leptons per game frame**. Phobos replaces the vanilla read at `0x71464A` with this same formula (`INIParser.h` `ReadSpeed`).
  - So **Rhino top speed = 15 leptons/frame**.
- **Per-frame distance for a Drive unit.** **[TS]** OpenTS "Why it is slower than its Speed says" gives the chain:
  - terrain % of the *destination* cell
  - × slope multiplier
  - × 0.75 once health is yellow (`ConditionYellow=50%`)
  - × top speed
  - × house ground-speed bias (difficulty `Groundspeed`=1.0 × `GameSpeedBias`=1.6 in YR rulesmd)
  - × crate and veteran multipliers

  Several integer truncations happen along the way.
- **Rough figure.** **[Inf]** About 15 × 1.6 ≈ 24 leptons/frame on clear ground, so about 10–11 frames per orthogonal cell.
- **Game time.** **[YR]** Rules time values are in minutes. **[TS]** They convert at 900 frames per game minute (15 fps nominal). The real tick rate depends on the game-speed setting, which I did not verify for YR.
- **Turning.**
  - **[YR]** YRpp `Facing.h` / `Dir.h`: `SetROT(rate)` stores `rate × 256` in 1/65536-turn units, and a turn takes `|Δfacing| / (ROT×256)` frames.
  - So **ROT=5 is about 7.03° per frame: 90° takes 12 frames and 180° takes 25 frames.** The turret has its own facing.
- **Turn before move.** **[RA1]** `DriveClass::Start_Of_Move`: if the body facing differs from the first step's direction, the unit calls `Do_Turn` and **rotates in place before starting the track**.
- **Track system.** **[YR]** `DriveLocomotionClass` keeps the same machinery: `TurnTrack[72]`, `RawTrack[16]`, `TrackNumber`, `TrackIndex`, `IsOnShortTrack`, `IsRotating`. Units move along **precomputed curved track paths** chosen by (current step direction, next step direction). Turns between consecutive steps are smooth arcs, not in-place pivots. **[RA1]** comments: "track jumping" lets a unit switch mid-track to the next curve.
- **[TS]** A Drive vehicle **without** a turret stops until a turn finishes. One **with** a turret, like the Rhino, keeps moving while turning.
- **Acceleration.** **[YR]** `Accelerates=false` on the Rhino, so speed changes are instant. That is useful for a deterministic race.

## 8. Blocked units: waiting, re-pathing, scattering

These come from OpenTS key pages and RA1 `Start_Of_Move`, with the values from YR rulesmd. **[TS]** unless marked.

- **Blocked step.** The unit stops and re-runs the per-step test. The `Move` verdict enum is the same in YR and RA1: `OK, Cloak, MovingBlock, ClosedGate, FriendlyDestroyable, Destroyable, Temp, No` (**[YR]** YRpp `Move`; **[RA1]** `MoveType`).
  - **Temporarily blocked by a stationary friendly** (`Temp`): the blocker is asked to move aside. The cell gets `Incoming`, so the friendly scatters out of the way (RA1: `Map[destcell].Incoming(0, true, true)`).
  - **Blocked by a moving unit** (`MovingBlock`): the unit just waits and retries next tick (RA1), keeping its path.
  - **Destroyable obstacle** (enemy unit, wall, tree): a Destroyer **attacks** it.
- **`BlockagePathDelay=60` frames** (rulesmd line 3107). For 60 frames after first being blocked by a mover, a new search prices moving-blocker cells at 4×, so the unit usually waits. After that they cost 1000×, so it detours unless no detour exists.
- **`PathDelay=.01` min**, about 9 frames (rulesmd line 3106). This is the wait before re-searching after a failed search. A Drive unit **gives up after the 11th failed search** in a row.
- **`CloseEnough=2.25` cells** (rulesmd line 58). A blocked unit within this distance of its destination drops the order and counts as arrived. An occupied destination farther away is swapped for a nearby free cell.
- **Scatter.** **[YR]** `[IQ] Scatter=2`, `PlayerScatter=no`. **[TS]** The houses whose IQ is at or above `Scatter` scatter from incoming threats on their own. The threats are aircraft fire, slow infantry fire, and a crusher driving onto infantry. A vehicle that is driving does not dodge (OpenTS `keys/scatter--global-rules`). Being asked to make way (`Temp`, above) is a separate mechanism.
- **[TS]** `MaxBlockCount` is read but never acted on.

---

## Implications for Rhino Race

This is inference to feed the movement-model decision (#9), not research fact.

1. **Use the native cell as the navigation unit.** One tank per cell, plus the cell it is heading into reserved. This replaces the prior attempt's coarse lattice with lanes and lane reservations. RA2 has no lanes; overtaking emerges from per-cell blocking and re-pathing.
2. **Passability comes from data.** Take the per-cell LandType from the tile's TMP terrain byte (with overlay overrides). Apply rulesmd `Track=` (0 = blocked), then add buildings, terrain objects and walls as hard blockers. Apply cliff-back Rock (`CliffBackImpassability=2`) and the level-difference rule (±1 only via ramp; bridge decks at +4). Ore at 70% and ice at 80% are speed-only.
3. **Deliberately diverge from vanilla where it would look wrong in a race.** Treat everything a Destroyer would shoot (trees, walls, enemy tanks) as impassable or wait-for, i.e. `Normal` zone semantics. All tanks are mutually non-crushable.
4. **Keep the pathfinder simple.** Plain 8-neighbour A\* with the occupancy-based costs (clear 1, moving 4/1000, standing 8) and a re-search on block reproduces the RA2 feel. The hierarchical corridor is a performance trick, not a behaviour we need. Its non-optimal-route quirks are optional flavour.
5. **Speed.** Top speed 15 leptons/frame × bias, times the terrain % of the destination cell. Turn at ROT 5 (about 7°/frame), in place before the first step, then on curved tracks between steps.

## Open questions that may deserve their own ticket

- **Map import, per-cell land type.** Can the map importer read each tile's per-cell terrain byte, ramp/slope index and level from the theater TMP files? Passability depends on it, including the Beach-is-water quirk and cliff-back Rock.
- ~~**Diagonal corner-cutting.**~~ Settled: allowed ([ra2-corner-cutting.md](ra2-corner-cutting.md)).
- **Real tick rate.** What is YR's real frame rate per game-speed setting, and what race duration and tank pacing follow from it?
- **How racers relate to each other.** Should tanks be "friendly" (they ask each other to move aside, cost 8) or "enemy" (destroyable, which we would neuter)? This changes how jams resolve.
- **Bridge-deck destinations.** Do bridge-deck destinations and "cannot stop under a bridge" need special handling for course waypoints placed near bridges?
