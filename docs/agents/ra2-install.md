# RA2 install and OBS

## Finding the install

`RA2_DIR` names the combined RA2 + Yuri's Revenge install folder. Read it from the environment; when it is unset, ask the operator rather than guessing. Never copy anything from it into the repo.

A battlefield plus a Rhino needs `ra2.mix`, `ra2md.mix`, `expandmd01.mix` and one loose map (`Maps\Yuri's Revenge\*.map`). The YR theater tile MIXes nested in `ra2md.mix` are `desert`/`isodes`, `urbann`/`isoubn` and `lunar`/`isolun` (no `md` suffix, verified on the owner's install).

## Checking a render

Most maps in `Maps\Yuri's Revenge` have a CNCMaps render beside them: `<map>.png`. Compare against it for layout. It also highlights ore/gems and applies map lighting, so those differences are expected until we draw them.

## Measuring frame rate

Measure in a real browser window or in OBS. Orca's embedded browser throttles hidden tabs and reports 30 fps or NaN.

- Real window: launch Edge/Chrome with `--remote-debugging-port` and read the page over CDP.
- OBS: drive it through obs-websocket (`ws://127.0.0.1:4455`, v5 protocol; check `%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json` for auth). `CreateInput` with `browser_source`, `is_local_file: true` loads a page from `http://absolute/`, which can `fetch` the install by absolute path. `SaveSourceScreenshot` and `GetStats` read results back. Remove the input when done.

The issue #5 prototype (branch `prototype/battlefield-and-rhino`) reads the install both ways and steps its own frame-rate bench when loaded in OBS.
