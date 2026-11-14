# Operators get one file per course and import it in race setup

A course reaches another streamer as one file, `<name>.rhino-course.json`, exported from the dev editor and imported in race setup (**Import courses…**, [#63](https://github.com/p0mz0r/chrono-battlefield/issues/63)). The file is `{ "format": "rhino-course", "version": 1, "course": <the course as in courses/<name>.json> }`; a course on a custom map (`source: "shipped"`) also carries the map file itself, base64 in `mapFile`, with its author and source link in the course as [ADR 0006](0006-custom-map-files-ship-with-courses.md) asks. A course on an install map carries no map: the operator's install supplies it, matched by name and hash, so no EA file is ever exported. The cost is size: a custom-map course grows by about its map (about 200 KB).

Import refuses a file that isn't a course file, whose embedded map doesn't match the course's hash, or whose install map is missing or a different version, naming which. Imported courses, with their maps, are stored in IndexedDB (`rhino-race-courses`) in the OBS profile, beside the import cache, so they outlive reloads, OBS restarts and release updates, and race setup lists them with the bundled courses. Setup (`F2`) borrows the same Courses form for its Courses step.

Since [#161](https://github.com/p0mz0r/chrono-battlefield/issues/161) a release can also carry course files: the owner puts them in `release-courses/` (not committed), and the zip ships them in `rhino-race/courses/`. On every start the launcher hands the page each `*.rhino-course.json` in `courses\` beside the exe, and the page imports any that isn't already imported as it is. The operator's Remove is remembered (`localStorage`), so a removed course stays removed while its file is still in the folder. Copying a file into that folder and restarting is also how an operator adds several courses at once. Setup's Courses step explains this and shows race setup's import.

This changes how a custom map reaches an operator, not the repo: bundled courses keep `courses/<name>.json` plus `courses/maps/<map>` (ADR 0006), and export files are never committed.

## Considered Options

- **Course and map as separate files**: smaller files and no duplicated map, but an operator who imports one without the other gets a course that won't load.
- **Importing through install setup**: one screen fewer, but it mixes "game files" with "courses" for the streamer.
- **Course packs (several courses in one file)**: later, if single files get tedious.
