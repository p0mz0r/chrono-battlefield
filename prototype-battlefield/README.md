# PROTOTYPE: battlefield + Rhino (issue #5). Throwaway, do not build on this.

Question: can a browser read a local RA2 + YR install, draw a real battlefield
(tiles, buildings, trees) and drive Rhino voxels over it at a good frame rate,
and which renderer fits?

Run one of:

- `npm i && npm start`, then open http://localhost:5173/ (serves the install at `/ra2`;
  set `RA2_DIR` if it isn't `D:\GAMES\Origin\Command and Conquer Red Alert II`).
  Query params: `?map=Maps/Yuri's Revenge/<name>.map`, `?tanks=N`.
- Double-click `index.html` and pick `ra2.mix`, `ra2md.mix`, `expandmd01.mix` and one `.map`.
- OBS browser source, "Local file" = `index.html`: reads the install via `http://absolute/`
  (path is `OBS_INSTALL` in `main.ts`). Not yet tried.

Drag to pan, wheel to zoom, buttons add Rhinos. The HUD logs every load step and the frame rate.

`vendor/` is copied from [openra2](https://github.com/harshilmathur/openra2) @ 8ba59f0
(GPL-3.0, see `vendor/LICENSE-GPL-3.0`); one line patched (`decodeBase64` used Node `Buffer`).
That's why this folder is GPL; the real licence decision is issue #12.

## Issue #25: stream views (branch `prototype/stream-view`)

Question: how does the stream see a race? Same fake race (10 Rhinos driving straight lines between the
map's start waypoints, random viewer interactions), three structurally different views:

- `?variant=A` **Overview + standings tower**: fixed camera on the whole course, course line drawn,
  numbered chips on tanks, full standings down the left, feed bottom-right, results as a full-screen table.
- `?variant=B` **Chase cam + minimap**: camera follows the leader up close, minimap of the course,
  position ticker across the top, name + status tags over every tank, results as a podium.
- `?variant=C` **Director cuts + lower third**: camera cuts between leader, closest battle and whoever
  just got hit; TV lower-third for the racer on screen, top 5 only, results revealed last to first.

`npm i && npm start`, open http://localhost:5173/?variant=A. Switch with the yellow bar or ← →; `r` restarts.
Other params: `laps`, `speed` (cells/s), `finishTimer` (s, default 30), `zoom` (B), `skip=N` (fast-forward
N s, for screenshots), `bar=0` (hide switcher), `log=1` (load log). In OBS: Local file `index.html`,
1920x1080; use Interact for ← → or set `?variant=` via a localhost URL source.
