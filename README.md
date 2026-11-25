# Rhino Race

A chat-driven race of RA2 Rhino tanks over a real Red Alert 2 / Yuri's Revenge battlefield, run in its own Edge window that OBS captures. It reads the art and maps from the operator's own RA2 + YR install; no EA asset is in this repo or its builds. The spec is [#34](https://github.com/p0mz0r/chrono-battlefield/issues/34); terms follow [`GLOSSARY.md`](GLOSSARY.md), decisions are in [`docs/adr/`](docs/adr/).

## Develop

Needs Node 24 and an RA2 + YR install. Set `RA2_DIR` to the install folder.

- `npm run dev` serves the page and the install (under `/ra2/`). It loads a bundled course (`?course=<name>`, default the last chosen course) over its battlefield and runs races on it. The **test-chat panel** (bottom right, dev only) has a name and text box to chat as any viewer, "Add N fake viewers" (`!rhino` from random names) and a seeded chaos toggle at a set rate. `?autoopen=1&fake=N&chaos=R&join=S&finish=S&chatSeed=N` does the same from the URL, `?fast=N` runs at N times game speed, `?seed=N` sets the first race's seed (each race logs `Rhino Race seed N` to the console, and from the launcher to `rhino-race.log` beside it; the same seed and chat lines replay that race), e.g. `?seed=1&autoopen=1&fake=5&chaos=2&join=10&fast=3` runs a whole race to results in under a minute. `G` (or `?grid=1`) overlays passability (red impassable or blocked, yellow slow, blue ramp, cyan high-bridge deck), the ideal line and the waypoints. `?zoom=N` follows the leading tank, `?cell=x,y&zoom=1` centres on a cell, and ghosting tanks draw at half alpha. An unsupported map, or a course whose map hash doesn't match, shows why it was refused.
- `?edit=1&course=hills-bridge-run` opens the dev-only course editor over the battlefield. Choose a tool and click a cell to place starts, finish, waypoints or bridges; drag markers to move them, wheel to zoom, middle-drag to pan. The panel inserts/deletes waypoints, sets lap sections and counts, and reorders suggested bridges. Validation and the ideal-line time update live; Save writes `courses/<name>.json` only when valid. `?edit=1&map=Hills.mmx` starts a new course over an install map. To use a custom `.map`/`.yrm`/`.mpr`, upload it in the editor, then enter its author and source link before saving; it ships in `courses/maps/` beside the course. `courses/hills-sprint.json` was saved in the editor over the real Hills battlefield.
- `npm test` runs the tests. Tests that read the install skip when `RA2_DIR` is unset. `npm install` also turns on `.githooks/pre-commit`, which runs the typecheck and tests before each commit.
- `npm run typecheck`. `npm run build` builds the operator's page to `dist/` without the editor or test-chat panel, then `tools/release.mjs` builds the launcher with it embedded (needs [Go](https://go.dev/dl/) on `PATH`) and zips `rhino-race.exe`, the operator README ([`public/README.txt`](public/README.txt), with shipped custom maps credited) and `LICENSE` as `release/rhino-race.zip`, with a `courses/` folder holding the courses in [`release-courses/`](release-courses/) as export files (the game imports that folder on every start; unlike bundled courses, an operator can remove them). It refuses to build with any EA file type in `dist/`.
- `go test` in `launcher/` tests the launcher's server. The launcher ([ADR 0009](docs/adr/0009-launcher-runs-the-game-in-an-edge-app-window.md)) serves the game on `http://127.0.0.1:27135`, the install by absolute path under `/abs/`, and opens an Edge app window; closing it stops the server.

## Operator keys

`S` opens race setup. The keys work while the game window has focus. `Enter` opens the join window. `P` pauses or resumes. Press `E` twice within three seconds to end or cancel the race. `C` switches Overview and Director. In Overview, drag to pan and use the wheel to zoom. In Director, `1`–`9` and `0` cut to the tank in that place of the standings (`0` tenth), unless it has finished. `M` mutes or unmutes and `−` / `+` turn the game volume down or up in 10% steps; both are remembered, and unmuting returns to the chosen volume. `F2` opens setup between races; it opens by itself on the first start. Setup and race setup list these keys too.

## Layout

| Path | What |
|---|---|
| `src/install/` | Install access. `readInstall(path)` is the one function every install read goes through (ADR 0009). |
| `src/ra2/` | RA2 file readers copied from openra2 (MIX, INI, map, TMP, SHP, VXL/HVA, PAL, IDX/BAG audio), its voxel prerenderer (`render/`), and `mount.ts`, which mounts the game MIXes for one theater and loads map files. |
| `src/battlefield/` | Battlefield import: `importBattlefield(read, path)` turns a map plus the stock install files into terrain chunks, placed overlay/tree/building images and the cell grid, or refuses it under the support rule. `grid.ts` is the cell grid movement drives on, as plain data. |
| `src/movement/` | RA2 cell locomotion (ADR 0005): `createField`, `addTank`, `orderMove`, `tick`. Pure, no DOM. |
| `src/race/` | `course.ts` loads a course file over its battlefield's grid (hash check, lap unrolling, ideal line, finish area, course progress). `race.ts` is the headless race: phases, bots, finishing, placings, and `chat(race, { viewerId, name, text })` returning `{ ok, reason }`, the one entry for chat commands. `devPanel.ts` is the dev-only test-chat panel. |
| `courses/` | Course files, bundled at build. A course names its map file with `mapHash` (`crc32:` of the file); custom maps will ship in `courses/maps/` (ADR 0006). |
| `src/main.ts` | The page. |
| `test/` | Test helpers (reading `RA2_DIR`). Tests sit next to the code as `*.test.ts`. |
| `vite.config.ts` | Includes the dev middleware that serves `RA2_DIR`. |
| `public/` | Copied into the build: the operator README. |
| `launcher/` | The Go launcher, `rhino-race.exe`: serves the embedded build and the install, opens the Edge window. |
| `tools/release.mjs` | Builds the launcher and zips it for operators (`npm run build`). |
| `tools/shot.mjs` | Screenshots a dev page in headless Chromium for agents (`docs/agents/ra2-install.md`). |
| `tools/attach.mjs` | Reads the launcher's own Edge window (errors, failed requests, screenshot) for agents (`docs/agents/ra2-install.md`). |
| `.githooks/` | The pre-commit gate: typecheck and tests, turned on by `npm install`. |

## Licence and credits

GPL-3.0-or-later, see [`LICENSE`](LICENSE) and [ADR 0003](docs/adr/0003-gpl-with-readers-ported-from-openra2.md).

The readers in `src/ra2/` are copied from [openra2](https://github.com/harshilmathur/openra2) at commit [`8ba59f0`](https://github.com/harshilmathur/openra2/tree/8ba59f0bcd48ba0c89892c0455eeca7da4408f4c) (GPL-3.0-or-later), from `packages/formats/src` and `apps/client/dev` (`theater.ts` and the voxel prerenderer in `src/ra2/render/`), and maintained here from then on. openra2 in turn ports code from the [XCC](https://github.com/OlafvdSpek/xcc) library by Olaf van der Spek (GPLv3), the FinalSun/Final Alert 2 Mission Editor by Matthias Wagner, © Electronic Arts (GPLv3), and [minilzo-js](https://github.com/abraidwood/minilzo-js) by Alistair Braidwood (GPL-2.0-or-later), from LZO by Markus F.X.J. Oberhumer. Each copied file keeps its notice.

Red Alert 2 and Yuri's Revenge are trademarks of Electronic Arts. This project is not affiliated with EA.
