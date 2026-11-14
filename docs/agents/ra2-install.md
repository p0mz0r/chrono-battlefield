# RA2 install and OBS

## Finding the install

`RA2_DIR` names the combined RA2 + Yuri's Revenge install folder. Read it from the environment; when it is unset, ask the operator rather than guessing. Never copy anything from it into the repo.

A battlefield plus a Rhino needs `ra2.mix`, `ra2md.mix`, `expandmd01.mix` and one loose map (`Maps\Yuri's Revenge\*.map`). The YR theater tile MIXes nested in `ra2md.mix` are `desert`/`isodes`, `urbann`/`isoubn` and `lunar`/`isolun` (no `md` suffix, verified on the owner's install).

## Tests that need the install

Tests inside `describeInstall` (`test/install.ts`) read `RA2_DIR` and skip when it is unset, as in CI. The pre-commit hook runs them on a machine with the install. Two of them answer common questions:

- **Shipped courses:** `bundled and release courses` in `src/race/race.test.ts` loads every `courses/*.json` and `release-courses/*.json` over its battlefield.
- **Bridges on a real map:** `src/battlefield/import.test.ts` checks Hills' bridge decks. `src/battlefield/grid.test.ts` covers the same grid rules on a synthetic map, without the install.

## One-off install probes

To dump something from the install (a map's grid, a prerender's timing), write a throwaway `src/zz_<name>.test.ts`: vitest only collects `src/**/*.test.ts`, so a probe anywhere else finds no tests. Read the install with `readFromDir` from `test/install.ts`, then `mountTheater` or `importBattlefield`. Run it with `npx vitest run src/zz_<name>.test.ts --reporter=verbose`, because the default reporter here drops `console.log` from passing tests. For bulk output, write to `.scratch/`. Delete the probe afterwards.

## Checking a render

Most maps in `Maps\Yuri's Revenge` have a CNCMaps render beside them: `<map>.png`. Compare against it for layout. It also highlights ore/gems and applies map lighting, so those differences are expected until we draw them.

To look at prerendered voxel frames, call `writeSheet(sprite, '.scratch/<name>.png')` from `test/sheet.ts` in a probe. It writes the atlas as a grid of frames, 32 per row, so a Rhino's rows are its tilts. A wrong lean or offset that one in-game screenshot leaves ambiguous shows up across a whole row.

## Checking the page in a browser

Use headless Chromium through `tools/shot.mjs`; the owner's own Chrome windows are personal, so leave them alone.

1. Start the dev server as a background task with its output in `.vite.log`: `npx vite --port 5173 --strictPort > .vite.log 2>&1`. Other worktrees run their own servers, so pick a free port per worktree and use it in every URL below. If `--strictPort` fails, read `.vite.log`, then check the port's owner (`netstat -ano`): it may be a server left running from this worktree, or one from another worktree serving other code. Stop your server when done.
2. Shoot: `node tools/shot.mjs "http://localhost:5173/?edit=1&map=DeepFrze.yro" --out <file>.png`. It prints page errors, console errors (a shader that fails to compile shows here), failed requests and dialogs; a clean run prints only the shot path. The default size, 2560x1270, is the owner's maximised window.
3. To interact first, pass `--steps steps.mjs`, a module whose default export `async (page) => {}` drives the page with the Playwright API (click, keyboard, `page.evaluate`). Keep step files in `.scratch/` (gitignored). Other sessions keep files there too, so remove only the files you created. To shoot a tank at a given cell, wait on `body.dataset.tanks` instead of guessing a `--wait`. Its entries are `Name@x,y:wpN:tT:fF`: `T` is the tilt (0 flat, 1–8 on a ramp), and `F` is the facing in 32nds (0 north, -y, then clockwise). `@x,y` takes a `d` on a bridge deck and a `g` while ghosted. Waiting on `:t[1-8]:` catches a tank on a ramp:

   ```js
   // .scratch/at-cell.mjs: shoot once any tank is on (66, 52)
   export default (page) => page.waitForFunction(() => /@66,52:/.test(document.body.dataset.tanks ?? ''), null, { timeout: 120000, polling: 50 });
   ```

Headless SwiftShader gives Pixi a WebGL1 context. Custom GLSL must compile there (`texture`, not `textureLod`), and a shader that works with world coordinates in the thousands needs `preferredFragmentPrecision: 'highp'`, because the default `mediump` is off by pixels at that size.

If launch fails with "Executable doesn't exist", run `npx playwright-core install chromium-headless-shell` once.

## Running the launcher

`npm run build` builds `release/rhino-race.exe` (Go must be on `PATH`; `go test` in `launcher/` tests its server, and the pre-commit hook runs `gofmt`, `go vet` and `go test` when `launcher/` is staged). Unzip `release/rhino-race.zip` into a short folder and run the exe to check the real thing: it opens an Edge app window on `%LOCALAPPDATA%\Rhino Race\profile`, the operator's own profile on the owner's PC, so leave its storage alone.

Check the real window, not only headless `shot.mjs`: Edge's cache, profile and flags differ, and a page that loads headless can fail there.

1. Close any running game window (`tasklist` shows no `rhino-race.exe`): Edge reads the debug port only when its browser starts.
2. Start the exe with `RHINO_RACE_DEBUG_PORT=9333` set (in Git Bash: `RHINO_RACE_DEBUG_PORT=9333 ./rhino-race.exe &`).
3. `node tools/attach.mjs --reload --wait 15 --out .scratch/window.png` prints page errors, console errors and failed requests (the install probe's `/abs/` 404s are filtered), then screenshots the page. `--press S` or `--press E,E,F2` sends page keys first. It only disconnects, so the window stays open; closing the window stops the launcher.

## Recording a race

For a ticket that asks for a recording, the dev page plays a race unattended and `tools/shot.mjs` records it:

```
node tools/shot.mjs "http://localhost:5173/?seed=7&autoopen=1&join=3&fake=6&redeem=kirov@6&zoom=1.8" --size 1280x720 --wait 30 --video .scratch/rec
```

- `autoopen=1&join=3&fake=6` opens a 3 s join window with 6 fake viewers; `redeem=<event>@<s>` redeems a big event (`kirov`, `chronoSwap`, `desolator`) that many seconds after GO; `zoom` follows the leading tank. More URL shortcuts sit at the end of `src/race/devPanel.ts`.
- `--wait` counts from page ready, so set it to the event's time plus however long it plays. The video starts at page load, about 10 s before GO.
- To check frames, tile them with ffmpeg: `ffmpeg -sseof -24 -i <video> -vf "fps=2,scale=426:-1,tile=6x8" -frames:v 1 sheet.png`.
- SwiftShader renders a few frames per second, so the video is good for checking frames, not for showing. Footage for an issue or stream comes from OBS.

## Measuring frame rate

Measure in a real browser window or in OBS. Orca's embedded browser throttles hidden tabs and reports 30 fps or NaN.

- Real window: launch Edge/Chrome with `--remote-debugging-port` and read the page over CDP.
- OBS: drive it through obs-websocket (`ws://127.0.0.1:4455`, v5 protocol; check `%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json` for auth). `CreateInput` with `browser_source`, `is_local_file: true` loads a page from `http://absolute/`, which can `fetch` the install by absolute path. `SaveSourceScreenshot` and `GetStats` read results back. Remove the input when done.

The issue #5 prototype (branch `prototype/battlefield-and-rhino`) reads the install both ways and steps its own frame-rate bench when loaded in OBS.
