# A launcher runs the game in an Edge app window that OBS captures

Supersedes [ADR 0004](0004-obs-local-file-source-reading-the-install.md)'s OBS Local-file source. Every setup step used to happen inside the browser source through OBS Interact, which can't open a `<select>` list or a login popup, and the browser source keeps its own storage, so nothing set up in a normal browser reached the copy on stream ([#135](https://github.com/p0mz0r/chrono-battlefield/issues/135)). Now the game runs in one real browser window, and OBS only captures it (Window Capture for video, Application Audio Capture for sound). The streamer sets up, logs in and runs races in that window, with the page keys.

The release ships `rhino-race.exe`, a Go program (about 8 MB) with the built game embedded:

- **Fixed port.** It serves the game on `http://127.0.0.1:27135` and never another port: browser storage belongs to the origin, port included. If the port is taken by a running launcher (it answers with `X-Rhino-Race`), a second start opens the window again and exits, so there is never a second server.
- **The install in place, by path.** `/abs/<absolute path>` serves an install file with Range support, the way OBS's `http://absolute/` did, so `readInstall` keeps one backend with the same discovery (saved path, then the Origin, EA app and Steam folders). It serves only MIXes and maps, by absolute path, to requests whose `Host` is `127.0.0.1:27135` or `localhost:27135` (a page elsewhere can't rebind its own host name onto it). Responses are `no-store`: Edge's cache fails concurrent Range requests on one cacheable file with `ERR_CACHE_OPERATION_NOT_SUPPORTED`. The folder picker and the copy into browser storage are gone; the dev server keeps `/ra2/` for `RA2_DIR`.
- **Edge app window, own profile.** `msedge --app=… --user-data-dir=%LOCALAPPDATA%\Rhino Race\profile`, with the throttling flags (`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`) and `--autoplay-policy=no-user-gesture-required` so sound plays without a click, as it did in the browser source. Edge is on every Windows 10/11 PC, whatever the default browser. The profile sits in `LOCALAPPDATA`, not beside the exe as first planned, so setup, logins and imported courses survive unzipping a newer release into another folder, and its deep paths stay under Windows' 260 characters (IndexedDB failed to open from a profile in a deep folder).
- **Stopping.** The launcher waits for that Edge process and stops when it exits. `--edge-skip-compat-layer-relaunch` and `--disable-background-mode` keep the started process the browser itself: without them Edge relaunched itself at start, and kept running after its last window closed. As a fallback, the page holds an `EventSource` on `/__alive`, and the server quits once no page has held it for 30 s (a crash, or the page opened in another browser; a reload reconnects well within it).
- **Seed log.** Each race's seed line goes to `rhino-race.log` beside the exe (`POST /__log`), off stream, since no OBS log sees the page's console any more.

What went with the browser source: the OBS Lua script and its hotkeys (the page keys work while the window has focus), the `chronoOperator` and `chronoChat` page events, which only obs-websocket could fire into a browser source, and uploading the install into IndexedDB. Chat comes only through Streamer.bot or Twitch direct ([ADR 0008](0008-streamer-bot-or-twitch-direct.md)).

Twitch login keeps the device code flow, with the code filled into Twitch's activate page in a popup, which now opens. The authorization-code flow with a `http://localhost` redirect is no simpler: it needs the app's client secret, which can't be kept secret in a shipped exe, and the implicit flow gives no refresh token.

The exe is unsigned for now, so SmartScreen shows "Windows protected your PC" on first run (the operator README says to click More info > Run anyway), and antivirus may flag it. Signing waits until streamers other than the owner run it.

## Checked on the owner's PC (2026-11-11)

- **Frame rate**, page `requestAnimationFrame` rate over 8 s against OBS `GetStats`, with a Window Capture of the game: in front, half covered by OBS, fully covered, and fully covered during a race, the page ran at 60.1 fps (worst frame 17 ms) and OBS at 60 fps with no skipped frames, and the preview kept moving. Minimised, the page drops to one frame a second and the capture goes black, so the operator README says to leave the window open, never minimised. The window capture holds the browser source's 60 fps.
- **Streamer.bot** connects from the new origin and chat reaches the race.
- **Twitch direct** logs in through the popup on the activate page, with the code filled in.

## Considered Options

- **Keep the OBS browser source:** no extra program, but setup through Interact stays clumsy and Twitch login can't open a popup.
- **A WebView2 or Electron host window:** one window under our control, but Electron is a 100 MB+ runtime, and WebView2 needs a native host and the same profile and frame-rate work Edge's own flags already do.
- **A Node or Python server:** the operator would install a runtime first; Go builds one exe with nothing to install.
- **The streamer's default browser:** another profile and flag set per browser, and Chrome or Firefox may be missing; Edge is always there.
