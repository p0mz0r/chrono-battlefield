# Rhino Race

A chat-driven race of RA2 Rhino tanks over a real Red Alert 2 / Yuri's Revenge battlefield, run as an OBS browser source. It reads the art and maps from the operator's own RA2 + YR install; no EA asset is in this repo or its builds. The spec is [#34](https://github.com/p0mz0r/chrono-battlefield/issues/34); terms follow [`GLOSSARY.md`](GLOSSARY.md), decisions are in [`docs/adr/`](docs/adr/).

## Develop

Needs Node 24 and an RA2 + YR install. Set `RA2_DIR` to the install folder.

- `npm run dev` serves the page and the install (under `/ra2/`). It loads a bundled course (`?course=<name>`, default the last chosen course) over its battlefield and runs races on it. The **test-chat panel** (bottom right, dev only) has a name and text box to chat as any viewer, "Add N fake viewers" (`!rhino` from random names) and a seeded chaos toggle at a set rate. `?autoopen=1&fake=N&chaos=R&join=S&finish=S&chatSeed=N` does the same from the URL, `?fast=N` runs at N times game speed, `?seed=N` fixes the race seed, e.g. `?seed=1&autoopen=1&fake=5&chaos=2&join=10&fast=3` runs a whole race to results in under a minute. `G` (or `?grid=1`) overlays passability (red impassable or blocked, yellow slow, blue ramp, cyan high-bridge deck), the ideal line and the waypoints. `?zoom=N` follows the leading tank, `?cell=x,y&zoom=1` centres on a cell, and ghosting tanks draw at half alpha. An unsupported map, or a course whose map hash doesn't match, shows why it was refused.
- `?edit=1&course=hills-bridge-run` opens the dev-only course editor over the battlefield. Choose a tool and click a cell to place starts, finish, waypoints or bridges; drag markers to move them, wheel to zoom, middle-drag to pan. The panel inserts/deletes waypoints, sets lap sections and counts, and reorders suggested bridges. Validation and the ideal-line time update live; Save writes `courses/<name>.json` only when valid. `?edit=1&map=Hills.mmx` starts a new course over an install map. To use a custom `.map`/`.yrm`/`.mpr`, upload it in the editor, then enter its author and source link before saving; it ships in `courses/maps/` beside the course. `courses/hills-sprint.json` was saved in the editor over the real Hills battlefield.
- `npm test` runs the tests. Tests that read the install skip when `RA2_DIR` is unset.
- `npm run typecheck`, `npm run build` (to `dist/`).

## Operator keys

`S` opens race setup; choose a course and options through Interact. `Enter` opens the join window. `P` pauses or resumes. Press `E` twice within three seconds to end or cancel the race. `C` switches Overview and Director; `M` saves the mute choice. `F2` opens install setup. The setup screen lists these keys too.

For controls without Interact focus, add [`chrono-battlefield.lua`](public/chrono-battlefield.lua) in OBS **Tools > Scripts**. Select the Rhino Race browser source in the script settings. In **Settings > Hotkeys**, bind the five **Rhino Race** actions: Start race, Pause / resume, End race, Camera mode, and Mute. Press End race twice within three seconds. Start race uses the last saved race setup, or opens race setup if none has been saved. The OBS hotkeys also work from a Stream Deck **System > Hotkey** button while OBS is unfocused. Choose combinations that other apps leave unbound, and avoid the page's `Enter`, `P`, `E`, `C`, and `M` keys for OBS hotkeys; typing those in Interact also runs the page keys. Keep the browser source visible and disable **Shut down source when not visible** so it can receive controls.

An obs-websocket client can send the same page event through `CallVendorRequest` to vendor `obs-browser`, request `emit_event`, with `{"event_name":"chronoOperator","event_data":{"action":"start"}}`. Other actions are `pause`, `end`, `camera`, and `mute`.
## Layout

| Path | What |
|---|---|
| `src/install/` | Install access. `readInstall(path)` is the one function every install read goes through (ADR 0004). |
| `src/ra2/` | RA2 file readers copied from openra2 (MIX, INI, map, TMP, SHP, VXL/HVA, PAL) and `mount.ts`, which mounts the game MIXes for one theater and loads map files. |
| `src/battlefield/` | Battlefield import: `importBattlefield(read, path)` turns a map plus the stock install files into terrain chunks, placed overlay/tree/building images and the cell grid, or refuses it under the support rule. `grid.ts` is the cell grid movement drives on, as plain data. |
| `src/movement/` | RA2 cell locomotion (ADR 0005): `createField`, `addTank`, `orderMove`, `tick`. Pure, no DOM. |
| `src/race/` | `course.ts` loads a course file over its battlefield's grid (hash check, lap unrolling, ideal line, finish area, course progress). `race.ts` is the headless race: phases, bots, finishing, placings, and `chat(race, { viewerId, name, text })` returning `{ ok, reason }`, the one entry for chat commands. `devPanel.ts` is the dev-only test-chat panel. |
| `courses/` | Course files, bundled at build. A course names its map file with `mapHash` (`crc32:` of the file); custom maps will ship in `courses/maps/` (ADR 0006). |
| `src/main.ts` | The page. |
| `test/` | Test helpers (reading `RA2_DIR`). Tests sit next to the code as `*.test.ts`. |
| `vite.config.ts` | Includes the dev middleware that serves `RA2_DIR`. |

## Licence and credits

GPL-3.0-or-later, see [`LICENSE`](LICENSE) and [ADR 0003](docs/adr/0003-gpl-with-readers-ported-from-openra2.md).

The readers in `src/ra2/` are copied from [openra2](https://github.com/harshilmathur/openra2) at commit [`8ba59f0`](https://github.com/harshilmathur/openra2/tree/8ba59f0bcd48ba0c89892c0455eeca7da4408f4c) (GPL-3.0-or-later), from `packages/formats/src` and `apps/client/dev/theater.ts`, and maintained here from then on. openra2 in turn ports code from the [XCC](https://github.com/OlafvdSpek/xcc) library by Olaf van der Spek (GPLv3), the FinalSun/Final Alert 2 Mission Editor by Matthias Wagner, © Electronic Arts (GPLv3), and [minilzo-js](https://github.com/abraidwood/minilzo-js) by Alistair Braidwood (GPL-2.0-or-later), from LZO by Markus F.X.J. Oberhumer. Each copied file keeps its notice.

Red Alert 2 and Yuri's Revenge are trademarks of Electronic Arts. This project is not affiliated with EA.
