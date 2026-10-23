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
