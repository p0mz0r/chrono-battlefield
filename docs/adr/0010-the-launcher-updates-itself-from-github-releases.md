# The launcher updates itself from GitHub releases

Operators used to download each release and unzip it by hand ([#211](https://github.com/p0mz0r/chrono-battlefield/issues/211)). Now `rhino-race.exe` ([ADR 0009](0009-launcher-runs-the-game-in-an-edge-app-window.md)) checks this repo's latest release on start and offers it.

- **Only the exe.** `courses\` and `README.txt` beside it stay as they were unzipped. When a release changes the shipped courses, its notes tell operators to download the zip again. Setup, logins and imported courses live in the Edge profile in `%LOCALAPPDATA%\Rhino Race`, on the fixed origin, so an update doesn't touch them.
- **The release pages, not the API.** `HEAD …/releases/latest` redirects to `…/releases/tag/vX.Y.Z`, and the exe takes the tag from there. The assets come from `…/releases/download/<tag>/rhino-race.exe` and `…/SHA256SUMS.txt`. This needs no JSON, and there's no API rate limit of 60 calls an hour per IP. It works because the repo is public.
- **Those names are a contract.** Installed exes look for the asset `rhino-race.exe`, the file `SHA256SUMS.txt` with its `sha256sum` lines and the tag `v<version>`. Renaming any of them strands every copy out there, which then has to be updated by hand once.
- **Asked, never silent.** A Yes/No box asks before the game window opens, so it never shows up during a race. "Later" asks again on the next start. Only the instance that got the port checks; a second start just reopens the window. `dev` builds never check. The check gives up after 3 s, and offline it starts without a word.
- **Checked, then swapped, or left alone.** The download must match its line in `SHA256SUMS.txt`. The new exe is written beside the old one first, then the running exe is renamed to `rhino-race.exe.old` (Windows lets a running exe be renamed, not overwritten) and the new one takes its name. Any failure puts the old exe back and starts it after one message box. The next start deletes `.old`.

Operators on v0.1.0, which has no updater, download the next release by hand once.

## Considered Options

- **`creativeprojects/go-selfupdate`:** covers GitHub releases, checksums and the Windows rename, but brings a dependency tree to a launcher that has none, and guesses asset names that we control exactly. The stdlib version is about 100 lines.
- **The GitHub API (`/releases/latest` JSON):** gives the asset list, but costs JSON parsing and an anonymous rate limit, for a tag the redirect already gives.
- **Update the whole zip folder:** would refresh shipped courses and the README too, but means unpacking over a folder the operator may have changed, for releases that rarely change them. Embedding shipped courses in the exe is the follow-up if they start changing often.
- **A progress window during the download:** the exe is about 8 MB, a few seconds on most connections; a native progress window is far more Win32 code than a 60 s timeout that falls back to the old exe.
