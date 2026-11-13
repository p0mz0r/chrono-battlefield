# Why tanks drive over cliff edges on Hills Sprint

Issue #140. Related: #141 (how RA2 draws units moving between height levels), [ra2-locomotion.md](ra2-locomotion.md) §4 (cliffs, `CliffBackImpassability`), [ADR 0002](../adr/0002-pixijs-with-prerendered-voxels.md).

Tags: **[Code]** read from this repo at `30ccb0d`. **[Install]** measured on the owner's install (`Hills.mmx`, TEMPERATE) with the repo's own readers. **[YR]** from the engine (YRpp headers, commit `29d74e9`). **[Inf]** inference, not yet checked in game.

## Answer

**The cause is draw order, not the tank's height and not the cliff art.** The whole terrain is baked into flat chunk textures that sit under every tank. A tank therefore always draws on top of every terrain pixel, including the mesa that stands in front of it. Hills Sprint has three stretches where the route runs on level-2 ground directly behind a level-6 or level-10 mesa. There the higher ground covers the tank's screen position completely, so the tank is drawn on top of the mesa's rim and top surface. On stream it looks as if the tank is driving along the top of the cliff.

- The terrain bake has no depth. `bakeTerrain` paints every cell's TMP tile, cliff `extra` art included, into RGBA buffers, back to front (`src/battlefield/terrain.ts:55-93`). **[Code]**
- The chunks are added to `world` first (`src/main.ts:163-167`), and the `things` container that holds the tanks is added after them (`src/main.ts:176`, `:191`, tanks at `:291`). Tanks are sorted only among `things`, by `zIndex = (fx + fy + 1) * 15` (`src/main.ts:380`). No terrain pixel can ever cover a tank. **[Code]**
- ADR 0002 chose this: "the battlefield's tiles are baked into chunk textures. That turns the whole scene into 2D sprites sorted by screen Y". Sprites are sorted, but the terrain itself is never sorted against them. **[Code]**
- The TMP reader already parses each tile's per-pixel Z data (`src/ra2/tmp/tmpFile.ts:243-249`), but nothing uses `zData` outside `src/ra2/tmp/`. **[Code]** On Hills, all 12,720 cells carry Z data and 730 carry `extra` art. **[Install]**

Confidence: **high** that this is the cause on Hills Sprint. The geometry is measured and the symptom is reproduced in the browser, as described below. Whether the real game hides the tank completely at these spots has not been checked in game. That question belongs to #141.

## Evidence

### Where the route runs behind higher ground

Method: a scratch Vitest run (not committed) loaded `Hills.mmx` with the repo's own `loadMap`, `Stock`, `tileLookup` and `buildGrid`. It walked the course with `findRoute`/`stepTo` from the first start-grid cell, through every waypoint, to the finish: 177 route cells. It repeated `bakeTerrain`'s paint loop with one change: for each pixel it recorded which cell painted it last, and that cell's level. For each route cell it then measured two things:

- **own visible**: the share of the cell's own 60×30 diamond still showing in the bake. 0% means higher ground in front has painted over the whole cell.
- **cover**: the pixels in a 49×35 box around the tank's draw point (`toScreen`, `src/main.ts:152`) that were painted by a cell further forward (larger x+y) and higher. 1715 is the whole box.

Results for Hills Sprint (`courses/hills-sprint.json`). Only the leg-by-leg runs that matter are shown. **[Install]**

| Route cells | Tank level | Covered by | Own visible | Cover (of 1715) |
|---|---|---|---|---|
| (71..63, 52), leg into waypoint (57, 52) | 2 | mesa at level 6 and 10, cells (67..73, 54..57) | 0% | 1277 to 1715 |
| (57, 55..58), (56, 59), (55, 60..67), leg to the finish | 2 | mesa at level 6, cells (56..60, 57..70), with level 10 at (61..62, 62..63) | 0% | 1119 to 1715 |
| (54, 76..77), (53, 78..83), same leg | 2 | mesa at level 6, cells (54..56, 78..85) | 0% | 1362 to 1715 |
| (103, 72..71), (104, 70), leg (101, 75) to (104, 48) | 6 | mesa at level 10, cells (105..107, 72..75) | 0% | 1404 to 1667 |
| (106, 60), (105, 56..54), ramps down | 5 to 2 | the next cell up the ramp | 30 to 58% | 462 to 1087 |

The cells right behind each mesa are passable. They are `Rough` (TMP terrain byte 14, `src/battlefield/grid.ts:46-49`), and `CliffBackImpassability=2` only turns Clear, Water, Beach and Ice into Rock (`src/battlefield/grid.ts:51-53`, `:86-95`; rule source in [ra2-locomotion.md](ra2-locomotion.md) §4, OpenTS `keys/cliffbackimpassability`). `rulesmd [General] CliffBackImpassability=2` was read from the install. So the route is legal by RA2's rules. It simply runs behind a 4- or 8-level wall that faces away from the camera. **[Install]**

Why the tank is fully covered: a cell is drawn at screen y = (x + y − z) × 15 (`src/battlefield/terrain.ts:61`). A cell k rows further forward and 4 levels higher lands at the same screen y when k = 4. So ground up to about four rows behind a 4-level mesa edge, or eight rows behind an 8-level one, lies under the mesa's image. **[Code]**

### Screenshots

Captured with `tools/shot.mjs` on the dev server, `?course=hills-sprint&seed=7&autoopen=1&join=3&fake=4&fast=3&zoom=1.6`, recorded with `--video`:

- About 28 s into the recording, Bot2 is on route cells (6x, 52). It is drawn on the rocky rim and top of the mesa, south of the dirt track it is really driving on. This is the symptom in the issue.
- A crop of the bake with every route cell's draw point marked shows the same thing across the whole leg into (57, 52). The marks run along the mesa top, inside the rim, and not on the low ground behind it.

The screenshots are not committed. They were saved to the agent's scratchpad (`race-t28.png`, `bake-north.png`, `bake-west.png`, `bake-east.png`, `grid-56-62.png`) and can be re-shot with the URL above.

The issue suggested comparing against a CNCMaps render. `Hills.mmx` is a top-level install map, not one under `Maps\Yuri's Revenge`, and it has no `Hills.png` beside it, so that comparison was not possible. **[Install]**

### Not the cause

- **Tank height.** A tank is drawn at the level of `tank.cell` (`src/main.ts:370`, `spotLevel` at `src/movement/route.ts:52-55`). `tank.cell` switches to the next cell once the tank is nearer that cell's centre (`src/movement/index.ts:323-326`). On the stretches in the table, the tank's level is the correct ground level, 2 or 6, with no ramp. The height is right; the tank is just drawn in front of terrain that should cover it. **[Code]**
- **Cliff art.** The mesa's tiles and `extra` overhangs are painted in the right back-to-front order in the bake. The terrain image on its own is correct. **[Code]**

### Secondary: ramps (a smaller, separate gap)

On ramp cells the tank snaps a whole level (15 px) at the halfway point between cells, because it is drawn at the cell's base level with no slope interpolation. At (74, 88) and along (106..105, 60..54), part of the next cell up the ramp should cover the tank's lower edge (cover 282 to 1087 px). This is the "climbs and drops" part of the report. RA2 places a unit at the floor height inside the cell: `CellClass::GetFloorHeight(Point2D subcoords)` at `0x47B3A0`, and `MapClass::GetCellFloorHeight` at `0x578080` (YRpp `CellClass.h`, `MapClass.h`). **[YR]** The exact in-game behaviour is the subject of #141.

### Bridge Run

`courses/hills-bridge-run.json` has the same waypoints, finish and bridge as Hills Sprint and adds two laps over waypoints 0 to 3. The same run gives the same table, so Bridge Run shows the same problem at the same cells on every lap. **[Install]**

High-bridge decks do not have it. Every deck route cell (76..97, 75) at level 6 has cover 0, because no terrain stands higher in front of the deck. Deck tanks also get `+60` on their `zIndex` (`src/main.ts:380`) against the bridge overlay's `(cx + cy + 4) * 15` (`src/battlefield/objects.ts:134`). **[Install]**

One related case: the ground cells under the deck, at level 2 in the canyon, are 0% visible in the bake. A tank sent under the bridge, for example by a move, would show the same bug. Neither course's route goes there. **[Install]**

## How RA2 decides what covers a unit

- YR keeps a Z-buffer next to the frame: `ZBuffer::Instance` at `0x887644`, with `ABuffer` at `0x87E8A4` (YRpp `Drawing.h`). Shapes are drawn with a Z value: `CC_Draw_Shape(..., int ZAdjust /* +1 = sqrt(3) px away from screen */, ZGradient, ..., SHPStruct* ZShape, ...)` at `0x4AED70` (YRpp `Surface.h`), and `Drawing::BitBlit(..., int z, ZGradient zgrad, ...)`. **[YR]**
- TS/RA2 TMP tiles carry per-pixel Z data next to the colour diamond (XCC `cc_structures.h`, `t_tmp_image_header`; see [ra2-file-formats.md](ra2-file-formats.md)). **[YR]**
- Hypothesis, not yet checked in game: the tiles write their Z values into the Z-buffer, and units are drawn with a depth test against it, so terrain in front hides them pixel by pixel. If so, at the stretches above a Rhino in YR would be partly or wholly hidden behind the mesa. **[Inf]** This is the core question of #141 and should be confirmed with an in-game capture (Rhino parked at (66, 52) and (55, 63) on Hills) before the fix is built.

## Fix directions

The terrain needs a second output: a depth the tanks are tested against. From closest to RA2 to cheapest:

1. **Terrain depth texture plus a depth test on tanks (recommended).**
   - In `bakeTerrain` (`src/battlefield/terrain.ts:68-74`, the `put` loop), write a parallel buffer that holds, for each pixel, the painting cell's depth key (x + y) and its level (for example R = x + y, G = z).
   - Ship it alongside the colour chunks: `src/main.ts:163-167` adds one texture per chunk.
   - Give each tank `view` (`src/main.ts:287-291`) a small filter or shader. It samples the depth texture under each pixel and discards the pixel where the terrain cell is further forward and higher than the tank's own cell. Pass in the tank's `fx + fy` and its level.
   - The same test can later cover trees, buildings and effects, which are also level-blind today (`src/battlefield/objects.ts:129-147`).
   - Later, refine with the TMP `zData` that `tmpFile.ts` already parses, for pixel-exact cliff faces.
   - This changes the import output, so bump `IMPORT_VERSION` (`src/install/cache.ts:6`).
   - It partly reopens ADR 0002 ("tiles baked into chunk textures", depth sorting judged not worth it). The ADR should get an addendum.
2. **Occluder sprites.** Cut out the tile art of every cell that stands in front of lower drivable ground (the level-6 and level-10 mesa rims in the table) as extra sprites in `things`, with a `zIndex` sorted like objects. Less shader work, but a 1-D `zIndex` cannot tell a tank behind the rim from a tank on the mesa just behind the same rim, so tank bottoms would clip on mesa tops. Workable only with level-aware masks. That is the depth texture again, done by hand.
3. **Ramp height** (secondary, independent of 1 and 2). Interpolate the drawn level across ramp cells, from `fx`/`fy` and the cell's `ramp` type (`src/movement/route.ts:23`), instead of snapping to `tank.cell`'s level (`src/main.ts:370`). Follow what #141 finds about `GetFloorHeight`.

**Product question, whatever the fix.** With correct occlusion the tank disappears for 9 to 13 cells at a time on three stretches of Hills Sprint and Bridge Run. On a race stream that may read worse than the current bug. Options:

- Draw the hidden part of a tank as a house-colour silhouette. RA2 does not do this, but it keeps the racer visible.
- Keep the tag visible. Tags are already drawn above everything, in `tags`.
- Warn in the editor, using the "own visible = 0%" measure above, and re-lay the course one or two cells further from the mesa.

This is for the operator to decide before or alongside the follow-up ticket.

## Open questions

- In game, is a Rhino at (66, 52) or (55, 63) on Hills hidden fully, partly, or not at all? This needs an in-game capture (#141).
- Does YR's Z test compare per tile (cell depth) or per pixel using the TMP Z data? This decides whether option 1 needs `zData` or only the cell key.
- Should hidden tanks stay visible on stream (silhouette, tag), and should the editor flag routes through hidden ground?

## Sources

- This repo at `30ccb0d`: `src/battlefield/terrain.ts`, `src/battlefield/grid.ts`, `src/battlefield/objects.ts`, `src/main.ts`, `src/movement/index.ts`, `src/movement/route.ts`, `src/ra2/tmp/tmpFile.ts`, `src/install/cache.ts`, `courses/hills-sprint.json`, `courses/hills-bridge-run.json`, ADR 0002.
- Install measurements: `Hills.mmx` with `rulesmd.ini` from the install in `RA2_DIR`, read through the repo's readers in a scratch Vitest run, plus `tools/shot.mjs` captures on the dev server.
- YRpp ([Phobos-developers/YRpp](https://github.com/Phobos-developers/YRpp) at `29d74e92`): `Drawing.h` (`ZBuffer` `0x887644`, `ABuffer` `0x87E8A4`, `BitBlit` z/zgrad), `Surface.h` (`CC_Draw_Shape` `0x4AED70`, `ZAdjust`, `ZShape`), `CellClass.h` (`GetFloorHeight` `0x47B3A0`, `GetCellCoords` "factors in cell height from ramps"), `MapClass.h` (`GetCellFloorHeight` `0x578080`).
- XCC [`misc/cc_structures.h`](https://github.com/OlafvdSpek/xcc/blob/master/misc/cc_structures.h): TMP image header with Z data.
- OpenTS `manual/content/keys/cliffbackimpassability.md` (via [ra2-locomotion.md](ra2-locomotion.md)).
