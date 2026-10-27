# Rhino Race

A chat-driven race of RA2 Rhino tanks over a real Red Alert 2 / Yuri's Revenge battlefield, run as an OBS browser source. It reads the art and maps from the operator's own RA2 + YR install; no EA asset is in this repo or its builds. The spec is [#34](https://github.com/p0mz0r/chrono-battlefield/issues/34); terms follow [`GLOSSARY.md`](GLOSSARY.md), decisions are in [`docs/adr/`](docs/adr/).

## Develop

Needs Node 24 and an RA2 + YR install. Set `RA2_DIR` to the install folder.

- `npm run dev` serves the page and the install (under `/ra2/`). It imports and draws one battlefield: `?map=<path inside the install>`, e.g. `?map=SinkSwim.yro` or `?map=Maps/Yuri's Revenge/2_lanaeris.map` (default `Hills.mmx`). An unsupported map shows why it was refused. `G` (or `?grid=1`) overlays the cell grid's passability: red impassable or blocked, yellow slow, blue ramp, cyan high-bridge deck. `?cell=x,y&zoom=1` centres on a cell. Ten Rhinos (`?tanks=N`) stand around `?start=x,y`; click to send each to its own cell near the clicked one, or `?to=x,y` to order them on load (e.g. `?start=70,75&to=103,75&cell=86,75&zoom=1` sends them single file over Hills' bridge). `?seed=N` sets the resolve order, `?zoom=N` follows the first tank, and ghosting tanks draw at half alpha.
- `npm test` runs the tests. Tests that read the install skip when `RA2_DIR` is unset.
- `npm run typecheck`, `npm run build` (to `dist/`).

## Layout

| Path | What |
|---|---|
| `src/install/` | Install access. `readInstall(path)` is the one function every install read goes through (ADR 0004). |
| `src/ra2/` | RA2 file readers copied from openra2 (MIX, INI, map, TMP, SHP, VXL/HVA, PAL) and `mount.ts`, which mounts the game MIXes for one theater and loads map files. |
| `src/battlefield/` | Battlefield import: `importBattlefield(read, path)` turns a map plus the stock install files into terrain chunks, placed overlay/tree/building images and the cell grid, or refuses it under the support rule. `grid.ts` is the cell grid movement drives on, as plain data. |
| `src/main.ts` | The page. |
| `test/` | Test helpers (reading `RA2_DIR`). Tests sit next to the code as `*.test.ts`. |
| `vite.config.ts` | Includes the dev middleware that serves `RA2_DIR`. |

## Licence and credits

GPL-3.0-or-later, see [`LICENSE`](LICENSE) and [ADR 0003](docs/adr/0003-gpl-with-readers-ported-from-openra2.md).

The readers in `src/ra2/` are copied from [openra2](https://github.com/harshilmathur/openra2) at commit [`8ba59f0`](https://github.com/harshilmathur/openra2/tree/8ba59f0bcd48ba0c89892c0455eeca7da4408f4c) (GPL-3.0-or-later), from `packages/formats/src` and `apps/client/dev/theater.ts`, and maintained here from then on. openra2 in turn ports code from the [XCC](https://github.com/OlafvdSpek/xcc) library by Olaf van der Spek (GPLv3), the FinalSun/Final Alert 2 Mission Editor by Matthias Wagner, © Electronic Arts (GPLv3), and [minilzo-js](https://github.com/abraidwood/minilzo-js) by Alistair Braidwood (GPL-2.0-or-later), from LZO by Markus F.X.J. Oberhumer. Each copied file keeps its notice.

Red Alert 2 and Yuri's Revenge are trademarks of Electronic Arts. This project is not affiliated with EA.
