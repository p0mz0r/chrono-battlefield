# How RA2 draws a unit moving between height levels

Issue #141. Follows [hills-sprint-cliff-occlusion.md](hills-sprint-cliff-occlusion.md) (#140), [ra2-locomotion.md](ra2-locomotion.md) §1 and §4, [ra2-low-bridge-offset.md](ra2-low-bridge-offset.md) and [ADR 0002](../adr/0002-pixijs-with-prerendered-voxels.md).

## Tags

- **[Asm]**: read from the install's own `gamemd.exe` (YR 1.001, `D:\GAMES\Origin\...\gamemd.exe`), disassembled with Capstone. Addresses are gamemd virtual addresses. Static tables were rebuilt by stepping the initializer code by hand. The unmodified file on disk was read, so Ares and Phobos patches are not included.
- **[YRpp]**: the reverse-engineered YR headers, [Phobos-developers/YRpp@9c34873](https://github.com/Phobos-developers/YRpp/tree/9c348736f6dd783db1f123080d97d71ad1f48871). These give names and addresses. They do not show behaviour.
- **[Phobos]**: [Phobos-developers/Phobos@afe5b84](https://github.com/Phobos-developers/Phobos/tree/afe5b8434901f37099d64c6d6f29f19cf099d73f), a YR engine extension. The owner's test client injects Phobos 0.4.0.2.
- **[TS++]**: the Tiberian Sun headers in Vinifera ([Vinifera-Developers/Vinifera@2aae2e7](https://github.com/Vinifera-Developers/Vinifera/tree/2aae2e722bfc17ac76ea21434dafc2ab838bde64), submodule `TSpp@8f54442`). TS is the engine RA2 is built on.
- **[vera20k]**: [YuriPlanet/vera20k@c150b75](https://github.com/YuriPlanet/vera20k/tree/c150b7591f012de01c4477431a097df59144cd4d), a GPLv3 Rust re-implementation of YR (home page [vera20k.org](https://vera20k.org/)). Its source comments cite gamemd addresses from Ghidra. It is a re-implementation, so each vera20k claim below says whether [Asm] agrees with it.
- **[Code]**: this repo at `5f6a42e`.
- **[Inf]**: inference, not checked in game.

Every [YRpp], [Phobos] and [vera20k] link below points at the commit named above.

## Answer

RA2 handles a unit changing height in four separate ways. Rhino Race does none of them in the same way.

1. **Height is continuous.** A ground vehicle's Z is the cell's floor height at its exact lepton position. On a ramp cell that height comes from a per-ramp-type plane equation. While a tank climbs a ramp it therefore rises smoothly, 104 leptons (15 px) per cell. It never jumps a whole level at once. **[Asm]**, and vera20k agrees value for value.
2. **The voxel tilts with the slope.** The Drive locomotor reads the slope type of the cell the unit's centre is in. It draws the hull and turret through one of 21 precomputed ramp matrices. When the slope type changes, it blends from the old tilt to the new one over 3 game frames. **[Asm]**, and YRpp, Phobos and vera20k agree.
3. **Terrain hides units with a per-pixel Z-buffer, not by draw order.** Tiles write their TMP Z data into a 16-bit Z-buffer. Units test against that buffer, so higher terrain in front of a unit hides the unit's pixels. The engine also deliberately pushes a unit behind a cliff further back: `ZFudgeCliff` is applied when the cell one or two steps toward the camera (x+1, y+1) stands 4 or more levels higher. **[Asm]** for the tile Z-data path and the cliff term. **[vera20k]** for the exact Z formulas.
4. **Shadows.** Ground vehicles draw a voxel shadow at their own position. The shadow point drops by the unit's height above ground, which is zero for a tank that is driving. The shadow goes through the locomotor's shadow matrix, which reads the same slope state. **[Asm]** and **[Phobos]**.

Today Rhino Race snaps the drawn level to the cell's base level at the halfway point, draws no tilt and no tank shadow, and sorts terrain only as one flat layer under the tanks. Since #140 it draws a house-colour silhouette where higher ground lies in front of a tank. RA2 hides the tank there instead. The gap list is in "What this means for us".

## 1. Vertical placement on ramps and slopes

### The floor-height function

`CellClass::GetFloorHeight(Point2D subcoords)` is at `0x47B3A0` and `MapClass::GetCellFloorHeight(CoordStruct)` is at `0x578080` ([YRpp `CellClass.h` L185](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/CellClass.h#L185), [`MapClass.h` L330](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/MapClass.h#L330)). From the disassembly **[Asm]**:

- `0x578080` takes the cell at `(X >> 8, Y >> 8)` and passes the full lepton X and Y to `0x47B3A0`.
- `0x47B3A0` computes `base = Level × 104` (Level is signed byte `+0x11B`; 104 is `LevelHeight`, [YRpp `Fundamentals.h`](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/Fundamentals.h#L20)). If `SlopeIndex` (`+0x11C`) is non-zero, it reads a 5-double record from the table at `0x81C900 + (slope − 1) × 40`. It then takes the sub-cell position `x = X & 0xFF`, `y = Y & 0xFF` and returns

  `floor = base + clamp(104·(a·x + b·y)/256 + c + d, 0, max)`

  The table is filled lazily on the first call (`0x47B3ED–0x47BA94`). Stepping that initializer gives the following, with x and y the lepton offsets inside the cell (0..255) and L = 104:

| Slope | Plane before clamp | Max | Shape |
|---|---|---|---|
| 1 | L·x/256 | L | rises toward +x |
| 2 | L·y/256 | L | rises toward +y |
| 3 | L − L·x/256 | L | rises toward −x |
| 4 | L − L·y/256 | L | rises toward −y |
| 5 | L·(x+y)/256 − L | L | one corner up (outer corner) |
| 6 | L·(y−x)/256 | L | " |
| 7 | L − L·(x+y)/256 | L | " |
| 8 | L·(x−y)/256 | L | " |
| 9 | L·(x+y)/256 | L | three corners up (inner corner) |
| 10 | L + L·(y−x)/256 | L | " |
| 11 | 2L − L·(x+y)/256 | L | " |
| 12 | L + L·(x−y)/256 | L | " |
| 13 | L·(x+y)/256 | 2L | steep: far corner 2 levels up |
| 14 | L + L·(y−x)/256 | 2L | " |
| 15 | 2L − L·(x+y)/256 | 2L | " |
| 16 | L + L·(x−y)/256 | 2L | " |
| 17–20 | constant L/2 | L/2 | double ramps: flat half level |

vera20k's `ground_slope_records` and `ground_height_with_level_height` ([`src/util/lepton.rs` L150–L237](https://github.com/YuriPlanet/vera20k/blob/c150b7591f012de01c4477431a097df59144cd4d/src/util/lepton.rs#L150-L237)) cite the same `0x47B3A0`. They hold the same 21 records and clamp the same way, so they **agree** with the table.

The 21 slope types and their names are in [TS++ `tibsun_defines.h` `TileRampType`](https://github.com/Vinifera-Developers/TSpp/blob/8f5444216175ecb65215b4b89920c7b31741901b/src/tibsun/tibsun_defines.h#L2471-L2516). TS++ names the compass corners from the tile's own view, so the table above uses x and y instead.

### The Drive locomotor uses it every step

The Drive locomotor (vtable `0x7E7EB0`, [YRpp `DriveLocomotionClass.h`](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/DriveLocomotionClass.h)) calls `GetCellFloorHeight` from 9 places between `0x4B1003` and `0x4B609A`. At `0x4B0FDC–0x4B101D` it sets the new coordinate's Z to the floor height plus `[0x8A07C4]` when cell flag `0x100` is set **[Asm]**. vera20k takes that flag as the bridge flag and gives the bridge deck as 416 leptons, or 4 levels ([`src/util/lepton.rs` `BRIDGE_DECK_HEIGHT_LEPTONS`](https://github.com/YuriPlanet/vera20k/blob/c150b7591f012de01c4477431a097df59144cd4d/src/util/lepton.rs#L145); [`src/app/presentation/instances/foot_depth.rs` L15–L26](https://github.com/YuriPlanet/vera20k/blob/c150b7591f012de01c4477431a097df59144cd4d/src/app/presentation/instances/foot_depth.rs#L15-L26)). YRpp instead calls `0x100` `BridgeHead` and marks it as unsure ([`GeneralDefinitions.h` L708](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/GeneralDefinitions.h#L708)). The two sources disagree on the name. Bridge-deck placement itself is covered in [ra2-low-bridge-offset.md](ra2-low-bridge-offset.md) and the bridge notes.

So a tank driving up a slope-1 ramp in +x rises linearly from `Level × 104` to `(Level + 1) × 104` across the cell. On screen that is 15 px per level ([ra2-locomotion.md](ra2-locomotion.md) §1: 60×30 cells, 104 leptons per level). **[Asm]** On outer and inner corner ramps the clamp folds the plane, so part of the cell is flat. **[Asm]**

## 2. Tilt: the voxel leans on slopes

- `ILocomotion::Draw_Matrix` and `Shadow_Matrix` are virtual methods of the locomotor ([YRpp `Interfaces.h` L193–L202](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/Interfaces.h#L193-L202)). Drive overrides both: in its ILocomotion vtable slot 9 is `0x4AFF60` and slot 10 is `0x4B0410` **[Asm]**.
- **Process** (`0x4B0500`) reads the `SlopeIndex` of the cell the unit is in (`+0x11C`). If it differs from `CurrentRamp`, it sets `PreviousRamp = CurrentRamp` and `CurrentRamp = SlopeIndex`, then starts `SlopeTimer` at 3 frames (`push 3` at `0x4B052D`). **Unlimbo** (`0x4B04D0`) snaps both fields to the cell's slope through `Force_New_Slope`. **[Asm]** vera20k [`src/sim/movement/slope_transition.rs` L1–L80](https://github.com/YuriPlanet/vera20k/blob/c150b7591f012de01c4477431a097df59144cd4d/src/sim/movement/slope_transition.rs#L1-L80) describes the same behaviour (`SLOPE_TRANSITION_FRAMES = 3`, citing the same addresses) and **agrees**.
- **Draw_Matrix** (`0x4AFF60`) works in two ways **[Asm]**:
  - While the timer runs, it calls `0x755A40(prev, cur, progress)`. That function slerps between two quaternions from the table at `0xB43188` and converts the result to a matrix (`0x646590`, `0x646980`).
  - Otherwise it copies `VoxelRampMatrix[CurrentRamp]` (`0x7559B0`, the table at `0xB45188`, [YRpp `Matrix3D.h` L332](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/Matrix3D.h#L332)).
  - In both cases it also folds in the unit's rocking angles (`AngleRotatedForwards` and `AngleRotatedSideways`, `+0x328` and `+0x32C`).
  - The ramp type goes into the voxel cache key. YRpp's `MainVoxelIndexKey` gives `RampType : 6` with "Drive : Loco->Ramp" ([`Drawing.h` L451–L485](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/Drawing.h#L451-L485)). This means the game renders and caches one hull image per (facing, ramp) pair.
- **How far it leans.** vera20k's copy of the quaternion table ([`src/map/voxel_slope.rs` L1–L135](https://github.com/YuriPlanet/vera20k/blob/c150b7591f012de01c4477431a097df59144cd4d/src/map/voxel_slope.rs#L1-L135)) gives these vanilla angles:
  - about 29.4° on straight ramps 1–4,
  - about 21.4° on corners 5–12,
  - about 29.4° on steep ramps 13–16,
  - 0° on 17–20.

  The real ground slope is atan(104/256) ≈ 22.1°. Phobos says vanilla over-tilts straight ramps. It patches the angle pushed at `0x75546D`, `0x755484`, `0x7554A1`, `0x7554BE`, `0x755656`, `0x755677`, `0x755698` and `0x7556B9` from `ebx` to `ebp`, which is atan(104/256) ([`Hooks.MatrixOp.cpp` L1128–L1150](https://github.com/Phobos-developers/Phobos/blob/afe5b8434901f37099d64c6d6f29f19cf099d73f/src/Ext/TechnoType/Hooks.MatrixOp.cpp#L1128-L1150); changelog: "Fixed an issue that units on the slope tilted at an excessive angle", 0.4). The vanilla `push ebx` at `0x75546D`, before `Matrix3D(rotate_z, rotate_x)` (`0x5AE6F0`), was confirmed in [Asm]. The installed `Phobos.dll` 0.4.0.2 contains patches at `0x75546D` and `0x755484`. **So the owner's client tilts straight ramps by about 22°, while unpatched YR tilts them by about 29°.**
- `UnitType` has an `IsTilter` field (`Tilter=` in the exe's strings), and `Rules` has `TiltFrames` ([YRpp `UnitTypeClass.h` L67](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/UnitTypeClass.h#L67), [`RulesClass.h` L48](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/RulesClass.h#L48)). Whether `Tilter=no` turns slope tilt off for Drive units was not traced.

## 3. What covers a unit: draw order plus a Z-buffer

### Layers and painter order

Objects are drawn in layers and sorted by `GetYSort` ([YRpp `ObjectClass.h` L107](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/ObjectClass.h#L107); the layer rules are in the `GeneralDefinitions.h` comment at L912ff, where Drive is `Ground`). TS draws the tile surface together with the Z-buffer and A-buffer first. Buildings, overlays and smudges come next, then anims, terrain objects and units ([TS++ `tactical.h` `RenderPassEnum`](https://github.com/Vinifera-Developers/TSpp/blob/8f5444216175ecb65215b4b89920c7b31741901b/src/tactical.h#L27-L32)). **[TS++]**, assumed the same in YR.

### The Z-buffer

- YR keeps one 16-bit Z value per screen pixel in `ZBuffer::Instance` at `0x887644`, next to `ABuffer` at `0x87E8A4` ([YRpp `Drawing.h`](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/Drawing.h)). The buffer is a ring buffer that scrolls with the camera ([Vinifera `zbuffer_window.cpp` L86–L94](https://github.com/Vinifera-Developers/Vinifera/blob/2aae2e722bfc17ac76ea21434dafc2ab838bde64/src/debug/zbuffer_window.cpp#L86-L94)).
- A blitter with Z read draws a pixel only where its Z is lower than the stored value (lower is nearer). A blitter with Z write also stores the new Z. When a Z-shape is in use, each pixel's Z is `z_min − zshape[pixel]` ([Vinifera `blitter_simd.h` L63–L64](https://github.com/Vinifera-Developers/Vinifera/blob/2aae2e722bfc17ac76ea21434dafc2ab838bde64/src/extensions/blitter/blitter_simd.h#L63-L64), [`blitter_simd_impl.h` L869–L881](https://github.com/Vinifera-Developers/Vinifera/blob/2aae2e722bfc17ac76ea21434dafc2ab838bde64/src/extensions/blitter/blitter_simd_impl.h#L869-L881)). Vinifera's blitters are written to be bit-exact with TS's. **[TS++]**
- **Tiles write their TMP Z data.** In gamemd, 260 instructions reference `0x887644`. One group sits in the isometric-tile blitter at `0x547E00–0x5496D6`. That code checks the TMP image header's has-Z-data flag (`test byte [edi+0x24], 2`, `0x548228`) and takes the pointer at header `+0x0C` (`ZDataOffset`, as laid out in [TS++ `IsoTileImageStruct`](https://github.com/Vinifera-Developers/TSpp/blob/8f5444216175ecb65215b4b89920c7b31741901b/src/tibsun/tibsun_defines.h#L2699-L2718)). It then writes 16-bit words into the Z-buffer row by row. **[Asm]** According to vera20k ([`src/render/native_z.rs` L14–L32](https://github.com/YuriPlanet/vera20k/blob/c150b7591f012de01c4477431a097df59144cd4d/src/render/native_z.rs#L14-L32)), `TMP_TileBlitter @ 0x547CF0` seeds `base = 0x8000 + YOrigin − y − tileH − tileH·level/2` and tests each pixel as `base + zdata ≤ zbuf`. The base write at `0x547F63–0x547F95` (`[0xAA1104]`, using the ZBuffer seed and `tileH × level / 2`) has the same shape. **[Asm] partly agrees. The full per-pixel formula is [vera20k].**
- **Units test against it.** `CC_Draw_Shape` and `BitBlit` take a `ZAdjust` ("+1 = sqrt(3) px away from screen") and a `ZGradient` ([YRpp `Surface.h` L160–L172](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/Surface.h#L160-L172)). vera20k says a unit's final voxel composite is drawn with gradient 2. That gradient is seeded at the bottom row and grows by 1 every 3 rows going down, so it is an upright billboard. The seed is `FootClass::GetZAdjustment` (`0x4DAFC0`), which starts from `−AdjustForZ(Location.Z)` (native_z.rs L25–L31, L96–L125). **[vera20k]** The same file at L3–L7 says that every draw tests the buffer, and that only buildings and tiles write to it.

### The cliff fudge

`FootClass::GetZAdjustment` (`0x4DAFC0`) returns the sum of three parts **[Asm]**:

- the locomotor's `Z_Adjust`, which is 0 for Drive (`0x4B4870`: `xor eax,eax`);
- the largest of `ZFudgeColumn × column`, `ZFudgeTunnel × tunnel`, `ZFudgeCliff × cliff`, and `ZFudgeBridge` when near a bridge;
- a terrain term from `0x704350`.

The cliff score comes from `0x704240` **[Asm]**:

- It looks at the cell one step along direction 3 from the unit's cell. Direction 3 comes from the table at `0x89F688`, entry `+0xC`, which is (+1, +1), the cell toward the camera. If that cell's `Level` is 4 or more above the unit's own, the score is 2.
- It then looks one step further. If that cell is 4 or more levels higher, the score is 1 and replaces the first result.
- On a bridge the score is 0.

`ZFudgeCliff`, `ZFudgeColumn`, `ZFudgeTunnel` and `ZFudgeBridge` are INI keys that appear among the exe's strings and in TechnoType fields `+0xDC0..+0xDCC` ([YRpp `TechnoTypeClass.h` L517–L520](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/TechnoTypeClass.h#L517-L520)). The constructor stores 5 into `ZFudgeColumn` (`0x71166A`) **[Asm]**. vera20k gives defaults of cliff 10, column 5, tunnel 10, bridge 0 ([`src/render/foot_depth.rs` L86–L97](https://github.com/YuriPlanet/vera20k/blob/c150b7591f012de01c4477431a097df59144cd4d/src/render/foot_depth.rs#L86-L97)). It has the same 2-or-1 cliff score and the same max-of-four sum (L248–L350) and **agrees**.

A positive ZAdjust pushes the unit away from the screen. **So a unit standing directly behind a cliff 4 or more levels high is pushed further behind it, and the cliff face reliably covers it.** **[Inf]**, from the sign convention and the code. It has not been seen in game.

The terrain term `0x704350`, as vera20k describes it at L268–L318, is 2 near rocks on a ramp and −1 or −2 otherwise. It depends on ramps and on tile heights over 36 px around the unit. **[vera20k]** Only the call was seen in [Asm]; the body was not read.

## 4. Shadows and height above ground

- Base `LocomotionClass::Shadow_Point` (`0x55A8C0`, which Drive inherits) returns `(0, AdjustForZ(GetHeight()))`. That is a screen offset straight down by the unit's height above its floor. For a driving tank the height is 0, so the shadow sits under the tank. **[Asm]** ([YRpp `LocomotionClass.h` L60](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/LocomotionClass.h#L60))
- Drive's `Shadow_Matrix` (`0x4B0410`) opens with the same slope-timer and rocking checks as its `Draw_Matrix`, so the shadow follows the ramp tilt. **[Asm]** for the prologue. The rest of the function was not read.
- The shadow is the voxel section `ShadowIndex`, drawn by `TechnoClass::DrawVoxelShadow` (`0x706BD0`) through `VoxelDefaultMatrix × Shadow_Matrix` at `draw point + Shadow_Point` ([Phobos `Hooks.MatrixOp.cpp` L648–L800](https://github.com/Phobos-developers/Phobos/blob/afe5b8434901f37099d64c6d6f29f19cf099d73f/src/Ext/TechnoType/Hooks.MatrixOp.cpp#L648-L800), which replaces vanilla `0x73C47A`; [YRpp `TechnoClass.h` L462](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/TechnoClass.h#L462)). By default the turret casts no shadow (`UseTurretShadow`; Phobos `DrawTurretShadow`). **[Phobos]**
- A unit's height above ground is `Location.Z − floor`. Section 1 sets that to 0 on every step for Drive units, ramps included. Only a knockback-style hop, which RA2 doesn't have for Drive units, or a bridge deck change would lift it. **[Asm]**, with the hop part being [Inf].

## What Rhino Race does today

| Point | RA2 / YR | Rhino Race | Code |
|---|---|---|---|
| Height on a ramp | linear plane inside the cell, 15 px per level, continuous | the cell's base level: `spotLevel` of `tank.cell`, which switches at the halfway point, so the tank jumps 15 px there | `src/main.ts:379`, `src/movement/route.ts:52-55`, `src/movement/index.ts:323-326` |
| Which cell counts | the cell containing the centre (`X>>8, Y>>8`) | the cell nearest the centre, the same edge for straight moves | `src/movement/index.ts:323` |
| Tilt | ramp matrix of the containing cell, slerped over 3 frames; about 22° with Phobos, about 29° vanilla | none: 32 flat facings, one prerender | `src/assets/rhino.ts:42-50`, `src/main.ts:368-370` |
| Terrain over units | per-pixel Z-buffer from TMP Z data, plus `ZFudgeCliff` behind cliffs of 4 or more levels | terrain baked flat under all tanks. Since #140 a depth layer per pixel (cell x+y and level) turns covered tank pixels into a silhouette, only when the cover is 2 or more levels higher | `src/battlefield/terrain.ts:70-77`, `src/silhouette.ts:39-49`, `src/main.ts:388-390` |
| TMP Z data | written to the Z-buffer | parsed, not used | `src/ra2/tmp/tmpFile.ts:230-249` |
| Slope type | cell `SlopeIndex` | TMP `rampType` per cell, used for passability and the debug overlay only | `src/battlefield/grid.ts:83`, `src/movement/route.ts:62-66`, `src/main.ts:71` |
| Tank shadow | voxel `ShadowIndex` shadow under the unit, tilted with the ramp | none (only the Kirov has one) | `src/main.ts:454` |
| Bridge deck | floor + 416 leptons (4 levels) | `deck` = level + 4, and `zIndex + 60` on a deck | `src/movement/route.ts:52-55`, `src/main.ts:389` |

## What this means for us

In order of how much each changes the look, cheapest first:

1. **Ramp height** (small, no import change). Replace `spotLevel(grid, on)` in `src/main.ts:379` with a `floorLevel(grid, fx, fy)` that applies the table in §1 to `grid.level` and `grid.ramp` at the fractional cell position: `level + clamp(plane, 0, max) / 104`. Keep the deck case as it is. This removes the 15 px snap halfway up a ramp. Use the same value for `zIndex` and for the silhouette's `level` uniform (`src/main.ts:389-390`). The 2-level margin in `src/silhouette.ts:48` was added "so a ramp's next cell doesn't flicker the hull". A continuous height may let that margin shrink. **[Inf]** It depends on whether our TMP `rampType` numbering equals the engine's `SlopeIndex`. Check one ramp on Hills in the browser (open question 1).
2. **Tilt** (medium, changes the prerender, so bump `IMPORT_VERSION` in `src/install/cache.ts:6`). Prerender the hull and turret for ramp types 1–16 as well as flat: 17 × 32 frames per Rhino colour, as RA2's cache key does. Apply the ramp rotation before the facing rotation in `voxelRender`. Choose the frame from the containing cell's ramp. Optionally cross-fade over 3 ticks, since RA2 slerps over 3 frames. Atlas size grows about 17×, so it may be worth limiting the set to ramp types that actually occur on course maps. Match the owner's Phobos client (about 22°), not vanilla (about 29°).
3. **Occlusion** (open product decision from #140). RA2 hides the tank. We draw a silhouette. To match RA2 more closely, keep the silhouette but compare against the true Z instead of a flat 2-level margin:
   - take the TMP `zData` (already parsed), offset per cell like `base + zdata`, into the bake's depth layer;
   - push the tank back by `ZFudgeCliff` when (x+1, y+1) or (x+2, y+2) is 4 or more levels higher.

   Whether the silhouette stays, or is swapped for true hiding, is the operator's call from #140, not a research finding.
4. **Shadow** (medium). Render the Rhino's `ShadowIndex` section as a flattened shadow sprite under the hull, tilted with the ramp frame. This needs a shadow pass in `src/ra2/render/voxelRender.ts`. No shadow is drawn there today.

Skipped: the column, tunnel and bridge fudges and the `0x704350` terrain term. They matter only for low bridges, tunnels and weapons-factory exits, which no shipped course drives through.

## Open questions

1. ~~Does our TMP `rampType` (`src/ra2/tmp/tmpFile.ts:262`) use the same numbering as the engine's `SlopeIndex` (`CellClass +0x11C`)?~~ **Answered: yes, for types 1–12.** A one-off test checked every ramp cell on the 53 install maps (`*.mmx`, `*.yro`). For each edge to a flat, drivable neighbour 0–2 levels up, it asked which §1 plane puts both shared corners at that neighbour's level. For every `rampType` 1–12 the best fit was the same engine slope number, at 99.4–100% of 3,263–8,561 edges per type. No install map had a type 13–16 cell next to a flat neighbour, so the steep ramps are untested; the double ramps 17–20 have no clean corners and were skipped. YRpp's "this + 2 == … PLACE.SHP" comment ([`CellClass.h` L465](https://github.com/Phobos-developers/YRpp/blob/9c348736f6dd783db1f123080d97d71ad1f48871/CellClass.h#L465)) is about a different index. **[Inf]** from the install's map geometry, not from the code that fills `SlopeIndex`.
2. In game, is a Rhino at (66, 52) or (55, 63) on Hills hidden by the mesa (#140)? The code says yes, but no capture was taken for this issue. That needs a Syringe run like the low-bridge test.
3. Does `Tilter=no` (or the Rhino's own art and rules) turn off slope tilt for Drive units? Are `ZFudge*` read from `rulesmd` or `artmd`, and does `[HTNK]` set any? Neither was traced.
4. The exact Z seed of a voxel unit (gradient 2, the bottom-row seed) comes from vera20k only. The unit draw path (`0x73B140`, `0x705E00`) was not disassembled.

## Not verified from primary sources

- The per-pixel tile Z formula and the unit Z seed and gradient. These are [vera20k]. The tile blitter's use of the Z-data flag and pointer is [Asm].
- The vanilla tilt angles of about 29.4° and 21.4°. These come from vera20k's dumped quaternion table and Phobos's comment. [Asm] only confirmed the instruction that Phobos patches.
- The `ZFudge` defaults other than column = 5. These are [vera20k].
- The name of cell flag `0x100` (bridge deck in vera20k, `BridgeHead` in YRpp). They disagree.
- Every visual consequence (a tank hidden behind a mesa, shadow tilt). None was checked in game.

## Sources

- `gamemd.exe` from the install, disassembled with Capstone 5.0.7:
  - floor height: `0x47B3A0` (with table `0x81C900` and its initializer `0x47B3ED–0x47BA94`), `0x578080`;
  - Drive locomotor: vtable `0x7E7EB0`, `0x4AFF60`, `0x4B0410`, `0x4B04D0`, `0x4B0500`, `0x4AFB00`, `0x4AFB40`, `0x4B0FDC–0x4B101D`, `0x4B4870`;
  - ramp matrices: `0x7559B0`, `0x755A40`, `0x75545F–0x755478`;
  - locomotor shadow point: `0x55A8C0`;
  - depth: `0x4DAFC0`, `0x704240`, tile blitter `0x547E00–0x5496D6`, TechnoType constructor `0x711664`;
  - INI key strings `ZFudge*`, `Tilter`, `TiltFrames`, `UseTurretShadow`.
- The install's `Phobos.dll` (0.4.0.2): patch addresses found by byte search.
- YRpp @ 9c34873: `CellClass.h`, `MapClass.h`, `DriveLocomotionClass.h`, `LocomotionClass.h`, `Interfaces.h`, `Drawing.h`, `Matrix3D.h`, `Surface.h`, `TechnoClass.h`, `TechnoTypeClass.h`, `UnitTypeClass.h`, `RulesClass.h`, `ObjectClass.h`, `GeneralDefinitions.h`, `Fundamentals.h`.
- Phobos @ afe5b84: `src/Ext/TechnoType/Hooks.MatrixOp.cpp`, `docs/Fixed-or-Improved-Logics.md` L201, `docs/Whats-New.md` L2959.
- Vinifera @ 2aae2e7 with TSpp @ 8f54442: `src/extensions/blitter/blitter_simd.h`, `blitter_simd_impl.h`, `src/debug/zbuffer_window.cpp`, `TSpp/src/tactical.h`, `TSpp/src/tibsun/tibsun_defines.h`, `TSpp/src/locomotors/drivelocomotion.h`.
- vera20k @ c150b75: `src/util/lepton.rs`, `src/map/voxel_slope.rs`, `src/sim/movement/slope_transition.rs`, `src/render/native_z.rs`, `src/render/foot_depth.rs`, `src/app/presentation/instances/foot_depth.rs`.
- This repo @ 5f6a42e: `src/main.ts`, `src/movement/index.ts`, `src/movement/route.ts`, `src/battlefield/terrain.ts`, `src/battlefield/grid.ts`, `src/silhouette.ts`, `src/ra2/tmp/tmpFile.ts`, `src/assets/rhino.ts`, `src/install/cache.ts`.
