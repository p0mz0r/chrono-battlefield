# Which cells around a high bridge are deck?

Issue #80. Follows [ra2-bridge-deck-width.md](ra2-bridge-deck-width.md) (#66) and [ra2-locomotion.md](ra2-locomotion.md) §5.

Tags: **[YR]** read from `gamemd` itself, either its code or its memory during a run. **[TS]** from OpenTS, a source reconstruction of Tiberian Sun whose bridge code matches YR's. **[Inf]** inference.

## Answer

1. **Each high-bridge overlay cell makes a deck three cells wide: the cell itself and one cell either side, across the line.** For `BRIDGE1`/`BRIDGEB1` (a line along x) that is rows y−1, y and y+1. For `BRIDGE2`/`BRIDGEB2` (a line along y) it is columns x−1, x and x+1. This holds for every overlay cell, the two end cells included, and nothing reaches past the ends. **[YR]**
2. **At the ends, the deck meets a three-cell-wide approach at deck height.** Past each end of the line, the bridgehead cells at the line ±1 sit 4 levels above the ground under the deck, so all three lanes drive straight on and off. The cells at ±2 beside the bridgehead are at ground level, and Rock (impassable). That holds on Hills' wooden bridge and on `xgoldst`'s concrete one: there the approach (42..43 and 58..59, 109..111) is Road at level 6, and the flanks (43/58, 108 and 112) are Rock at level 2 **[YR]**. The cells beside the end overlay cells are ordinary deck. Rhinos parked on them at deck height on both bridges: (76, 74) and (97, 76) on Hills, (44, 109) and (57, 111) on `xgoldst` **[YR]**. The same level layout shows up on every concrete and wooden bridge checked **[Install]**.
3. **Concrete and wooden bridges behave the same.** `gamemd` handles them with two functions that are byte-for-byte identical except for their own jump targets. Their rules sections differ only in `Image=` and `Name=`. In game, `xgoldst`'s concrete bridge got the same flags as Hills' wooden ones, and Rhinos parked on its side cells at deck height, mid-span and beside both ends. **[YR] [Install]**
4. **The side cells are full deck cells for occupancy, destruction and repair.** **[YR]**
   - Side cells hold units in the cell's second (bridge) layer, `AltObject`.
   - Destroying a bridge clears the deck flags on each overlay cell's whole three-cell column, plus a fourth cell, in one go.
   - Rhinos parked on side cells, beside both ends and mid-span, fall when the bridge goes and are dead about 15 s later. This held for both bridge kinds.
   - Repair puts back exactly the flags the bridge started with, side cells included.

For #80: a high bridge's deck is the overlay line widened by one cell each side across it, for its full length, with no special case at the ends. Each of those cells belongs to the bridge for occupancy, the `G` overlay, and destroy and repair.

## How gamemd marks the cells

Placing a bridge overlay calls one routine per overlay cell. The routine takes the axis across the deck, `facing`, and a flag for laying the bridge down or tearing it out. It then writes `CellClass::Flags` (offset 0x140) on up to six cells. **[YR]** The constructor code at `0x5FC5D3`–`0x5FC62C` sits in the range YRpp gives for `OverlayClass` (constructor at `0x5FC380`). It sends overlay 24 `BRIDGE1` to `0x47E040(facing 0, true)` and 25 `BRIDGE2` to `0x47E040(6, true)`. It sends 237 `BRIDGEB1` to `0x47E470(0, true)` and 238 `BRIDGEB2` to `0x47E470(6, true)`. Facing 0 is North, (0, −1). Facing 6 is West, (−1, 0) (YRpp `FacingType`). Before that, the same code refuses the overlay on a cell whose slope byte at +0x11C is above 4. OpenTS `OverlayClass::Mark` has the same structure, including that check.

YRpp names these bits, but some names mislead. The meanings below come from OpenTS's `CellClass` bitfields, which sit in the same order, and from what the dumps show.

| Bit | YRpp name | Meaning (OpenTS name) | Set on |
| --- | --- | --- | --- |
| `0x80` | `BridgeOwner` | holds the deck piece, the overlay cell (`IsBridgeDeck`) | overlay cell |
| `0x100` | `BridgeHead` | under the bridge, so it has a deck layer; this is the bit `ContainsBridge()` tests, and `GetLevel()` adds 4 for it (`IsUnderBridge`) | overlay cell, ±1 across, +2 across |
| `0x200` | `Unknown_200` | units can drive on the deck here (`IsBridgeTraversable`) | overlay cell, ±1 across |
| `0x400` | `BridgeBody` | was under a bridge that has since been destroyed (`WasUnderBridge`) | set instead of `0x100` after a destroy |
| `0x800` | `BridgeDir` | the line runs along x (`IsBridgeEastWest`) | all of the above, on `*1` bridges |
| `0x1000` | `PixelFX` (sic) | the drawn deck covers this cell (`IsBridgeSurface`) | overlay cell, +1, +2, +3 across |
| `0x2000` | `Unknown_2000` | the bridge is damaged (`IsBridgeDamaged`) | seen on bridgehead cells after a hit |
| `0x10000` | `DrawDarkenIfInAir` | in the deck's shadow (`IsOvershadowed`) | the under cells; on `*2` bridges also one more cell |

"Across" means steps in `facing`. So on `*1` bridges +1 is y−1 and −1 is y+1, and on `*2` bridges +1 is x−1 and −1 is x+1. Every flagged cell except the overlay cell gets `BridgeOwnerCell` (offset 0x2C), which points back to its overlay cell. In the dumps, (86, 74) and (86, 76) both point to (86, 75).

Per overlay cell, then:

- **−1 across** (y+1 or x+1): under, can be driven, not drawn surface.
- **The overlay cell**: deck piece, under, can be driven, surface.
- **+1 across** (y−1 or x−1): under, can be driven, surface.
- **+2 across**: under and surface, but **not** drivable. OpenTS: "a unit cannot step off the far edge of the deck here". OpenTS's map check leaves this cell out of the bridge zones.
- **+3 across**: surface only, because the deck is drawn raised.
- **`*2` bridges only:** the cell two steps the other way (x+2) gets only `0x10000` and an owner pointer.

So the drivable deck is exactly −1, 0 and +1: three cells, as #66 saw. Movement uses `0x100` and `0x200`. In OpenTS `FootClass::Can_Reach`, a step onto deck height needs the destination cell to be under the bridge and drivable. The level is each cell's own `Level` + 4 (YRpp `CellClass::GetLevel`), not the overlay cell's. **[YR]** layout, **[TS]** movement rule.

### Measured on Hills

Cell flags read from `gamemd`'s memory during a run. In the grids, each entry is `Flags >> 7`, so bit 0 = `0x80` … bit 6 = `0x2000`, and `O` marks an overlay cell.

```
BRIDGEB1, line (76..97, 75); every column 76..97 is the same
  y 72: 20        surface only                  (+3)
  y 73: 32        under | x-line | surface      (+2, not drivable)
  y 74: 36        under | drivable | x-line | surface    (+1)
  y 75: O37       deck | under | drivable | x-line | surface
  y 76: 16        under | drivable | x-line     (-1)
BRIDGEB2, line (65, 67..71); every row 67..71 is the same
  x:  62  63  64  65   66
      20  22  26  O27  06
```

This is the same pattern OpenTS `CellClass::Set_Under_Bridge` writes for TS. Nothing is flagged at x 75 or 98 (`BRIDGEB1`) or at y 66 or 72 (`BRIDGEB2`), so the deck doesn't reach past the line's end cells.

### Concrete vs wooden

- **Code.** `0x47E040` (concrete) and `0x47E470` (wood) disassemble to the same 301 instructions. The 17 lines that differ are all branches into their own bodies. **[YR]**
- **Rules.** rulesmd `[BRIDGE1]` and `[BRIDGEB1]` differ only in `Image=` (`BRIDGE`, `BRIDGB`) and `Name`. Both have `LegalTarget=true`, `Overrides=yes` and `NoUseTileLandType=false`. **[Install]**
- **In-game** (run 6). `xgoldst`'s concrete `BRIDGE1` line (44..57, 110) carries the same flags as Hills' wooden line, row for row. Four Rhinos parked in the bridge layer (`AltObject`, `AltOccupationFlags` `0x20`): two beside the end cells, (44, 109) and (57, 111), and two mid-span, (50, 109) and (50, 111):

  ```
  y 107: 20   y 108: 32   y 109: 36   y 110: O37   y 111: 16    (every column 44..57)
  ```

So concrete bridges (`BRIDGE1/2`, overlays 24/25) and wooden ones (`BRIDGEB1/2`, 237/238) get identical deck cells. TS has only the concrete routine and uses the second one for rail bridges. YR uses it for wood, and the overlay-placement code shown above doesn't handle `RAILBRDG1/2` (59/60). No scanned map uses them anyway ([supported-battlefields.md](supported-battlefields.md) §3).

### The ends

Levels from the maps' `[IsoMapPack5]`, for every high bridge in `xhills.map` (wood), `xgoldst.map` and `xkaliforn.map` (concrete), both directions. Ground under the deck is L, the deck is L+4. **[Install]**

```
xgoldst, BRIDGE1 line (44..57, 110), west end (columns x 41..46):
  y 108:  5  6  2  2 ...    ±2: low ground
  y 109:  6  6  6  2 ...    +1: approach at deck level (6 = 2 + 4)
  y 110:  6  6  6  2* ...   line
  y 111:  6  6  6  2 ...    -1: approach at deck level
  y 112:  6  6  2  2 ...    ±2: low ground
```

At both ends of every bridge checked, the bridgehead cells at line −1, 0 and +1 are at deck level, and the cells at ±2 drop to the lower level. On Hills these were read from memory too:

- **Approaches.** (74..75, 74..76) and (98..99, 74..76) are `LandType` Road at level 6.
- **Flanks.** (75, 73), (75, 77), (98, 73) and (98, 77) are Rock at level 2.
- **End overlay cells.** (76, 75) is Rock on the ground under the deck, with the deck above.

Two Rhinos sent to (76, 74) and (97, 76), the side cells of the two end overlay cells, parked in the deck layer. **[YR]**

So at the ends:

- **Beside the end overlay cell:** deck, the same as mid-span.
- **Beside the bridgehead, at line ±1:** ordinary ground at deck level. These are the lanes that lead onto the side cells.
- **At ±2:** low ground, Rock on Hills. Our grid gets this from the tile data and the cliff rule already.

No end-specific rule is needed. [Inf]

## Occupancy, destruction, repair

- **Occupancy.** A Rhino parked on a side cell is in the bridge layer. On (76, 74), (86, 74), (86, 76), (97, 76), (83, 74) and (83, 76), `AltObject` (+0xE8) was set and `AltOccupationFlags` (+0x128) = `0x20` (vehicle). `FirstObject` and `OccupationFlags` were empty. **[YR]** Ground under a side cell is a separate layer, as under the line ([ra2-locomotion.md](ra2-locomotion.md) §2).
- **Destroying a cell clears its whole column.** With `BridgeStrength=1` set in the map, a lightning bolt at (80, 75) removed the overlay there. Two things changed in one game frame **[YR]**:
  - (80, 73), (80, 74), (80, 75) and (80, 76) went from `0x11Bxx` to `0xC0x`: under and drivable cleared, was-under set, x-line kept.
  - (80, 72) lost `0x1000`, the drawn deck.

  So a gap in the line is a gap across all three lanes, and in the far (+2) cell. The bridgehead cells (74..76, 73..77) gained `0x2000` (damaged). Its neighbours' overlay frames changed to damaged art. The disassembly agrees: when tearing out, the routine calls `CellClass::BlowUpBridge` (`0x47DD70`) on the overlay cell, ±1 and +2.
- **How much breaks.** Weapon hits break the deck in pieces. Under lightning, YR broke Hills' wooden bridge in sections of 1, 8 and 10 cells across three runs (runs 2–4), each starting where the strikes landed. The repair hut's route takes the whole bridge. An Ivan bomb on the hut calls `MapClass::DestroyWoodBridgeAt` / `DestroyConcreteBridgeAt` (`0x574C20` / `0x574000`) with the hut's cell, from `BombClass::Detonate` at `0x43896A`. `BuildingClass` makes the same call at `0x440301`. Called the same way, both destroyed every overlay cell of the bridge at once (runs 6 and 7). That matches our whole-bridge destroy ([ADR 0005](../adr/0005-ra2-cell-locomotion.md), the glossary's "Bridge").
- **The whole-bridge destroy, cell by cell** (runs 6 and 7, both bridge kinds):
  - Each overlay cell, its ±1 cells and its +2 cell go from `under | drivable (| deck)` to `was-under`. That is `0xC00` with the x-line bit kept, shown as `18` in the grids.
  - Each overlay is removed, and the +3 cells lose `0x1000`.
  - The bridgehead cells, two columns past each end, gain `0x2000` (damaged). On the end overlay columns this shows as `58`.

  ```
  Hills after the destroy (columns 74..98), rows 73..76:
    40 40 58 18 18 ... 18 40 40
  row 77:
    40 40 40 00 00 ... 00 40 40
  ```
- **Units on destroyed side cells fall and die** **[YR]**. The code in `BlowUpBridge` does two things:
  - Each ground occupant (`FirstObject` chain) takes damage equal to its own health (+0x6C), with the warhead at `Rules+0xFA8` (C4, per OpenTS).
  - Each deck occupant (`AltObject` chain) gets one argument-free virtual call, `vtable+0xEC`.

  OpenTS `CellClass::Destroy_Bridge` does the same: `Take_Damage(Strength, …, C4Warhead)` for ground occupants, and `Fall_From_Height()` for deck ones, which marks them falling and set to explode on landing. **[TS]**

  What run 7 (wood) showed:
  - **Before.** Four Rhinos were parked on side cells: (80, 74), (80, 76), (76, 74) and (97, 76). All four were in the bridge layer.
  - **0.3 s after the destroy.** The bridge layer was empty. (80, 76) and (97, 76) held vehicles in the ground layer instead, and the map had 7 ground-unit cells instead of 4: the Rhinos were falling.
  - **15 s later.** The count was back to 4 and none of the Rhinos existed. The video shows the bridge exploding with them on it.

  Run 6 (concrete) gave the same result: all four Rhinos, on (44, 109), (57, 111), (50, 109) and (50, 111), left the bridge layer, never stood on the ground afterwards (ground-unit cells 28 before and after), and were gone. Nothing hit them except the collapse: the destroy was called directly, with no weapon fired.
- **Repair restores the side cells** **[YR]**. An engineer entering the hut calls `MapClass::RepairWoodBridgeAt` / `RepairConcreteBridgeAt` (`0x570050` / `0x573540`) with the hut's cell (`0x519CF6` / `0x519D12`). Called the same way, it put every overlay back. The flags of every cell from y−3 to y+1 along the line came back identical to the start, side cells included (`36`, `37`, `16`, with `32` on +2 and `20` on +3), and the bridgehead damage bit cleared. That was in both runs 6 and 7. OpenTS (`Repair_High_Bridge_Span` → `new OverlayClass` → `Set_Under_Bridge(true)`) gives the same mechanism. **[TS]**

## What the implementer should know

- **The deck runs the whole line.** Every high-bridge overlay cell gives deck to itself and to its two neighbours across the line: y±1 for `*1` types, x±1 for `*2`. Nothing is added past the ends.
- **Deck level is per cell.** RA2 gives each deck cell its own ground `Level` + 4. On every bridge checked, the ground under all three lanes is level, so this matches `level[overlay cell] + 4` there. [Inf]
- **The far cell isn't deck.** RA2 also marks the +2 cell (y−2 or x−2) as under the bridge, but tanks can't drive on its deck. It can stay plain ground for us. Its `ContainsBridge()` is true, though, so RA2 itself treats it oddly (see Open).
- **Side cells belong to the bridge.** RA2 links each one to its overlay cell (`BridgeOwnerCell`). Our side cells need the same `bridge` id so that destroy, repair, "on or under it are moved off" and the route check cover them.
- **Two bridges side by side** (one or two cells apart) would claim the same side cells. RA2 has no guard: the last overlay placed wins the owner pointer. None was looked for in the maps. [Inf]
- **Same for both materials.** No special case for concrete vs wooden.

## Test

Scripts in a scratch folder, not committed:

- `probe.py` runs a map through `corner_cut_test.run()` (Syringe, the spawner, Ares and Phobos, as in [ra2-corner-cutting.md](ra2-corner-cutting.md)). Meanwhile it reads `MapClass::Instance` (`0x87F7E8`) from `gamemd-spawn.exe` with `ReadProcessMemory` every 10 s. It finds the cell vector at `+0x13C` by scanning for capacity `0x40000`, and dumps each cell's coords (+0x24), `BridgeOwnerCell`, `OverlayTypeIndex` (+0x44), `FirstObject`/`AltObject`, `LandType` (+0xEC), `Level` (+0x11B), occupation flags and `Flags` (+0x140). Offsets are from YRpp `CellClass.h`. The dumped coords match the cells' indices, which confirms them.
- `hills80.py` is `bridge_side_test.py` with four Rhinos and timed trigger strikes. Two Rhinos head for side cells mid-span, (86 or 83 or 80, 74/76). Two head for the end side cells (76, 74) and (97, 76). The strikes are action 90 (lightning bolt), 102 (lightning storm) and 42 (explosion), with `[CombatDamage] BridgeStrength=1` added to the map.
- `probe2.py` launches the game itself, with the same spawn files and the same backups. It sets `RA2MD.ini [Audio]` `SoundVolume`, `VoiceVolume` and `ScoreVolume` to 0 for the run, and restores them with the rest. Once the map has loaded, it brings the game window to the front and checks `GetForegroundWindow()`. It lists the visible windows above the game, and records only if none is there besides the game's own DDrawCompat presentation window. The run stops the moment the game loses focus. It dumps every 5 s, as `probe.py` does. Once all the Rhinos are parked on the deck, it suspends the game's threads and runs a remote thread that calls the destroy function above with the hut's cell. 15 s later it calls the repair function the same way, dumping just before and 0.3 s after each call. The two calls are what Ivan's bomb on the hut and an engineer in the hut do. Calling them directly skips the infantry and the explosion, so no weapon touches the Rhinos.
- `iso.py` decodes `[IsoMapPack5]` (LZO1X) and `[OverlayPack]` for the level grids above.
- `disgm.py` disassembles `gamemd-spawn.exe` with capstone.

Runs on the owner's install, 2026-11-01:

1. Flags only: Hills with the #66 map.
2. The four Rhinos parked on the deck layer. A ground-level explosion (action 42, `HE`) didn't damage the deck. A bolt and storm took out (77..84, 75).
3. Rhinos at (83, 74/76): a storm and bolts took out (78..87, 75), and both those Rhinos died. The storm's random bolts could have hit them, so this run alone doesn't show the collapse killed them. Runs 6 and 7 settle that.
4. Bolts only, Rhinos at (83, 74/76): only (80, 75) went. This run gave the before/after flag diff above.
5. Rhinos on (80, 74/76) under bolts only: aborted. The game window wasn't in front, so nothing ran.

`probe2.py` runs, 2026-11-01, game in the foreground throughout:

6. **Concrete**, `xgoldst.map`, hut (41, 112). An earlier attempt started with the Discord overlay above the game, so it wasn't recorded. Its destroy came before the Rhinos arrived, but it gave the same flags, destroy and repair. In the recorded run:
   - Rhinos parked at (44, 109), (57, 111), (50, 109) and (50, 111), about 15 s in.
   - Destroy, then repair 15 s later.
7. **Wood**, `xhills.map`, hut (73, 73). Sound off, recorded.
   - Rhinos parked at (80, 74), (80, 76), (76, 74) and (97, 76).
   - A single bolt (action 90) at (80, 75), trigger time 300, didn't break the deck, so the hut-path destroy and repair followed, about 60 s in.

## Caveats

- **Modified engine.** The runs inject Ares and Phobos. Phobos at commit `1e6360b` hooks nothing in the bridge routines (`0x47E040`–`0x47E88F`), `BlowUpBridge` or the overlay-placement branch. The public Ares source isn't the shipped `Ares.dll`, so Ares isn't fully ruled out. The disassembly is of `gamemd-spawn.exe`, the CnCNet build. The YRpp addresses all matched it.
- **Bit names are inferred.** YRpp leaves `0x200` and `0x2000` unnamed and calls `0x1000` `PixelFX`. The meanings in the table rest on OpenTS's matching bit order plus the dumps. The movement meaning of `0x200` is **[TS]**.
- **Destroy and repair were called, not played.** The calls are the ones the bomb and engineer code make, with the same argument, the hut's cell. No Ivan or engineer was used. The weapon-hit path (`BlowUpBridge` per cell) was seen under lightning in runs 2–4.
- **Two maps in game**, one bridge each for the deck tests: Hills' long wooden line and `xgoldst`'s (44..57, 110) concrete line. Hills' `BRIDGEB2` lines were checked for flags only. Concrete `BRIDGE2` lines rest on the identical code.

## Open

- **The +2 cell.** How RA2 handles ground units on the +2 cell (under-bridge bit set, not drivable on deck) wasn't looked at.

## Sources

- **YR game code.** Disassembly of the install's `gamemd-spawn.exe` (4,813,072 bytes):
  - Overlay placement at `0x5FC5D3`–`0x5FC62C`.
  - Concrete deck routine `0x47E040`–`0x47E45F`; wooden `0x47E470`–`0x47E88F`.
  - `CellClass::BlowUpBridge` at `0x47DD70`–`0x47DDD3`.
  - Hut destroy calls at `0x43896A` (`BombClass::Detonate`, YRpp `BombClass.h`) and `0x440301`. Hut repair calls at `0x519CF6` and `0x519D12`. Targets: `MapClass::Destroy/Repair{Wood,Concrete}BridgeAt` (YRpp `MapClass.h` L544–L555).
- **YR memory.** Dumps from runs 1–4, 6 and 7 above.
- **YRpp** @ [`f14642c`](https://github.com/Phobos-developers/YRpp/tree/f14642c8652bacdbc6b84833cedd006d1148a800):
  - [`CellClass.h`](https://github.com/Phobos-developers/YRpp/blob/f14642c8652bacdbc6b84833cedd006d1148a800/CellClass.h): `ContainsBridge` and `GetLevel` L256–L270, `BridgeOwnerCell` L405, `Flags` L488, `BlowUpBridge` L124.
  - [`GeneralDefinitions.h`](https://github.com/Phobos-developers/YRpp/blob/f14642c8652bacdbc6b84833cedd006d1148a800/GeneralDefinitions.h): `CellFlags` L697–L726, `FacingType` L759, `LandType` L895.
  - [`MapClass.h`](https://github.com/Phobos-developers/YRpp/blob/f14642c8652bacdbc6b84833cedd006d1148a800/MapClass.h): `Instance` L176, `Cells` L590, `GetCellIndex` L253.
  - [`OverlayClass.h`](https://github.com/Phobos-developers/YRpp/blob/f14642c8652bacdbc6b84833cedd006d1148a800/OverlayClass.h): bridge overlay ids L25–L29.
- **OpenTS** @ [`27819b0`](https://github.com/OpenTS-Developers/OpenTS/tree/27819b079a30159e6421be64430f0c2c1aeed769) (TS 2.03 reconstruction):
  - [`code/cell.h`](https://github.com/OpenTS-Developers/OpenTS/blob/27819b079a30159e6421be64430f0c2c1aeed769/code/cell.h#L404-L450): bridge bitfields L404–L450, `BridgeDeckCell` L85–L89.
  - [`code/cell.cpp`](https://github.com/OpenTS-Developers/OpenTS/blob/27819b079a30159e6421be64430f0c2c1aeed769/code/cell.cpp#L1469-L1597): `Set_Under_Bridge` L1469–L1597, `Destroy_Bridge` L1434.
  - [`code/overlay.cpp`](https://github.com/OpenTS-Developers/OpenTS/blob/27819b079a30159e6421be64430f0c2c1aeed769/code/overlay.cpp#L154-L183): `Mark` L154–L183.
  - [`code/foot.cpp`](https://github.com/OpenTS-Developers/OpenTS/blob/27819b079a30159e6421be64430f0c2c1aeed769/code/foot.cpp#L2767-L2822): `Can_Reach` L2767.
  - [`code/object.cpp`](https://github.com/OpenTS-Developers/OpenTS/blob/27819b079a30159e6421be64430f0c2c1aeed769/code/object.cpp#L333): `Fall_From_Height` L333.
  - [`code/map.cpp`](https://github.com/OpenTS-Developers/OpenTS/blob/27819b079a30159e6421be64430f0c2c1aeed769/code/map.cpp#L1364-L1530): `Repair_High_Bridge_Span` L1364–L1530; map check L12200.
  - Manual: [`keys/bridgestrength.md`](https://github.com/OpenTS-Developers/OpenTS/blob/27819b079a30159e6421be64430f0c2c1aeed769/manual/content/keys/bridgestrength.md), [`keys/bridgemiddle1.md`](https://github.com/OpenTS-Developers/OpenTS/blob/27819b079a30159e6421be64430f0c2c1aeed769/manual/content/keys/bridgemiddle1.md).
- **Phobos** @ [`1e6360b`](https://github.com/Phobos-developers/Phobos/tree/1e6360b5995b2fff172aff69ecc2d89dd7c7059c): hooks checked for the bridge routines (none). `src/Misc/Hooks.BugFixes.cpp` L1424 uses `BridgeDir` with the north/west neighbour, consistent with the table.
- **Game data.** rulesmd `[BRIDGE1]` L29869 and `[BRIDGEB1]` L29885; `[CombatDamage] BridgeStrength=1500` L816; `LightningDamage=250` L131; `[IonWH]`; `[HTNK] Strength=400`. Maps: `Maps/Yuri's Revenge/xhills.map`, `xgoldst.map`, `xkaliforn.map` (`[IsoMapPack5]`, `[OverlayPack]`). FA2 `FAData.ini` `[ActionsRA2]` 42, 90 and 102 for the trigger actions.
