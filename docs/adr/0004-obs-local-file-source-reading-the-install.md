# The game runs as an OBS Local-file source, reading the install through one seam

Superseded by [ADR 0009](0009-launcher-runs-the-game-in-an-edge-app-window.md): a launcher runs the game in an Edge app window and serves the install by path. The one read seam stays.

The game reaches the stream only as an OBS browser source in Local-file mode, and nothing is hosted. [#4](https://github.com/p0mz0r/chrono-battlefield/issues/4) found this is the one route that can read the install with no extra process: OBS serves the page from `http://absolute/`, which can `fetch` any file by absolute path, even under Program Files. Every read of the install goes through one function with three backends: that absolute-path fetch in OBS, a Vite middleware serving `RA2_DIR` under `npm run dev`, and files the operator uploaded by hand into IndexedDB, stored as-is. OBS maintainers call the `http://absolute` handler legacy and may remove it; if they do, a localhost server takes its place behind the same function, and until then we don't build one.

On load the game tries the last saved path, then the Origin, EA app and Steam default folders. If none reads, it shows a setup screen, used through OBS Interact, with a folder picker that stores the files the game needs (the required MIXes and the maps, about 600 MB, since a picker gives files but never a path) and an install path field that reads the folder in place for installs elsewhere or of other releases. Settings live in `localStorage` in the OBS profile; a key in Interact (`F2`) reopens setup to change the path, re-upload or clear the stored files, so nothing setup-related appears during a race. Imports are checked against the owner's Origin install (with CnCNet's YR client); other releases are untested, and a missing file fails with a message naming it.

The game will ship to other streamers. At its first release the repo goes public, which also provides the GPL source ([ADR 0003](0003-gpl-with-readers-ported-from-openra2.md)), and each version is a zip of the build on GitHub Releases: unzip, add a Local-file source pointing at `index.html`, set up through Interact. Development runs in a browser on the dev server; stream checks point OBS at the repo's `dist/index.html`, the same way an operator does. How much of a MIX is read at a time, and what the import caches, is [#15](https://github.com/p0mz0r/chrono-battlefield/issues/15)'s question.

## Considered Options

- **Hosted page (GitHub Pages or another host)**: automatic updates for other streamers, and a secure context, but it can only read uploaded files, never a path on disk; Pages from a private repo needs a paid plan. Off the table for now.
- **`config.js` next to the game**: no setup screen to build, but the operator edits a file by hand, and it can't take an upload.
- **File System Access (`showDirectoryPicker`)**: Chrome refuses Program Files, AppData and ProgramData, the default install folders, and OBS browser sources ignore permission prompts.
- **Localhost static server now**: future-proof and a secure context, but one more process every operator has to start, for a problem OBS hasn't caused yet.
- **Window-capturing Chrome or Edge**: the game freezes when the window is covered or minimised, and loses transparency; documented as unsupported.
