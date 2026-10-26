# Rhino Race

A chat-driven race of RA2 Rhino tanks over a real Red Alert 2 / Yuri's Revenge battlefield, run as an OBS browser source. It reads the art and maps from the operator's own RA2 + YR install; no EA asset is in this repo or its builds. The spec is [#34](https://github.com/p0mz0r/chrono-battlefield/issues/34); terms follow [`GLOSSARY.md`](GLOSSARY.md), decisions are in [`docs/adr/`](docs/adr/).

## Develop

Needs Node 24 and an RA2 + YR install. Set `RA2_DIR` to the install folder.

- `npm run dev` serves the page and the install (under `/ra2/`). It draws one battlefield's terrain: `?map=<path inside the install>`, e.g. `?map=SinkSwim.yro` or `?map=Maps/Yuri's Revenge/2_lanaeris.map` (default `Hills.mmx`) and one Rhino that drives to the cell you click. More options: `?start=x,y` and `?to=x,y` (Rhino start cell and an order on load), `?zoom=N` (follow the Rhino at scale N), `?grid=1` (tint blocked cells red and slow ones yellow, and trace the Rhino's track).
- `npm test` runs the tests. Tests that read the install skip when `RA2_DIR` is unset.
- `npm run typecheck`, `npm run build` (to `dist/`).

## Layout

| Path | What |
|---|---|
| `src/install/` | Install access. `readInstall(path)` is the one function every install read goes through (ADR 0004). |
| `src/ra2/` | RA2 file readers copied from openra2 (MIX, INI, map, TMP, SHP, VXL/HVA, PAL) and `mount.ts`, which mounts the game MIXes for one theater and loads map files. `render/` holds openra2's voxel prerenderer. |
| `src/battlefield/` | Battlefield import: turns a map plus the install into what the game draws and drives on. So far, terrain baked into chunk textures. `passability.ts` is a stopgap cell grid from tile terrain bytes, ore/wall overlays and trees. |
| `src/movement/` | Movement (ADR 0005), pure code over a `CellGrid`: travel-time A* (`route.ts`), turn in place then RA1's curved tracks (`index.ts`, data in `tracks.ts`). |
| `src/assets/` | Asset prerender: the Rhino's 32 hull and 32 turret facings (`RHINO_FOOTPRINT_PX` is the size knob). |
| `src/main.ts` | The page. |
| `test/` | Test helpers (reading `RA2_DIR`). Tests sit next to the code as `*.test.ts`. |
| `vite.config.ts` | Includes the dev middleware that serves `RA2_DIR`. |

## Licence and credits

GPL-3.0-or-later, see [`LICENSE`](LICENSE) and [ADR 0003](docs/adr/0003-gpl-with-readers-ported-from-openra2.md).

The readers in `src/ra2/` are copied from [openra2](https://github.com/harshilmathur/openra2) at commit [`8ba59f0`](https://github.com/harshilmathur/openra2/tree/8ba59f0bcd48ba0c89892c0455eeca7da4408f4c) (GPL-3.0-or-later), from `packages/formats/src` and `apps/client/dev/{theater,voxelRender,sprite,atlas,sequence}.ts`, and maintained here from then on. openra2 in turn ports code from the [XCC](https://github.com/OlafvdSpek/xcc) library by Olaf van der Spek (GPLv3), the FinalSun/Final Alert 2 Mission Editor by Matthias Wagner, © Electronic Arts (GPLv3), and [minilzo-js](https://github.com/abraidwood/minilzo-js) by Alistair Braidwood (GPL-2.0-or-later), from LZO by Markus F.X.J. Oberhumer. Each copied file keeps its notice.

The drive tracks in `src/movement/tracks.ts` are converted from Red Alert's `DriveClass` in EA's [C&C Remastered Collection source](https://github.com/electronicarts/CnC_Remastered_Collection) (`REDALERT/DRIVE.CPP` at `f1f0d42`), © Electronic Arts, GPL-3.0 with additional terms under Section 7.

Red Alert 2 and Yuri's Revenge are trademarks of Electronic Arts. This project is not affiliated with EA.
