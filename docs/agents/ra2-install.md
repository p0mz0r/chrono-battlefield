# RA2 install and OBS

## Finding the install

`RA2_DIR` names the combined RA2 + Yuri's Revenge install folder. Read it from the environment; when it is unset, ask the operator rather than guessing. Never copy anything from it into the repo.

A battlefield plus a Rhino needs `ra2.mix`, `ra2md.mix`, `expandmd01.mix` and one loose map (`Maps\Yuri's Revenge\*.map`). The YR theater tile MIXes nested in `ra2md.mix` are `desert`/`isodes`, `urbann`/`isoubn` and `lunar`/`isolun` (no `md` suffix, verified on the owner's install).

## Checking a render

Most maps in `Maps\Yuri's Revenge` have a CNCMaps render beside them: `<map>.png`. Compare against it for layout. It also highlights ore/gems and applies map lighting, so those differences are expected until we draw them.

## Checking the page in a browser

Use headless Chromium through `tools/shot.mjs`; the owner's own Chrome windows are personal, so leave them alone.

1. Start the dev server as a background task with its output in `.vite.log`: `npx vite --port 5173 --strictPort > .vite.log 2>&1`. Read the log when a request fails or the server stops.
2. Shoot: `node tools/shot.mjs "http://localhost:5173/?edit=1&map=DeepFrze.yro" --out <file>.png`. It prints page errors, failed requests and dialogs; a clean run prints only the shot path. The default size, 2560x1270, is the owner's maximised window.
3. To interact first, pass `--steps steps.mjs`, a module whose default export `async (page) => {}` drives the page with the Playwright API (click, keyboard, `page.evaluate`). Keep step files in a scratch folder.

If launch fails with "Executable doesn't exist", run `npx playwright-core install chromium-headless-shell` once.

## Measuring frame rate

Measure in a real browser window or in OBS. Orca's embedded browser throttles hidden tabs and reports 30 fps or NaN.

- Real window: launch Edge/Chrome with `--remote-debugging-port` and read the page over CDP.
- OBS: drive it through obs-websocket (`ws://127.0.0.1:4455`, v5 protocol; check `%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json` for auth). `CreateInput` with `browser_source`, `is_local_file: true` loads a page from `http://absolute/`, which can `fetch` the install by absolute path. `SaveSourceScreenshot` and `GetStats` read results back. Remove the input when done.

The issue #5 prototype (branch `prototype/battlefield-and-rhino`) reads the install both ways and steps its own frame-rate bench when loaded in OBS.
