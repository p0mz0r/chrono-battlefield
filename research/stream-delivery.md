# Research: getting a browser game that reads local RA2 files onto an OBS stream

Answers #4 ("Can a browser game with local RA2 files get onto stream?") for the
"How the game reaches the stream" decision in #1. Researched 2026-10-22.

Each claim is tagged **[verified]** (read in a primary source: docs, spec, or the
shipping source code, linked) or **[inference]** (reasoned from verified facts, not
tested). Nothing here was run on a real OBS install. Section 7 lists what a short
spike has to confirm.

Source code links are pinned to:
- obs-browser `85c7f26` (master, 2026-10-20)
- CEF `master`
- Chromium `main`

## TL;DR

1. **An OBS browser source can read the RA2 install directly, with no picker, if the
   game is loaded as a "Local file".** OBS serves local-file pages from the
   pseudo-origin `http://absolute/`. A page on that origin can
   `fetch('http://absolute/C:/…/ra2.mix')` to read any file the OBS process can read,
   including files under `Program Files`. **[verified, source]** There are three
   catches:
   - OBS maintainers call this handler "legacy" and say they "should consider removing"
     it. **[verified]**
   - The origin is not a secure context, so WebGPU, OPFS, the File System Access API
     and service workers are unavailable there. WebGL, IndexedDB and localStorage still
     work. **[inference from spec plus origin]**
2. **The File System Access API (`showDirectoryPicker`) is the wrong tool on Windows.**
   - Chrome refuses directory picks under `C:\Program Files`, `C:\Program Files (x86)`,
     `%APPDATA%`, `%LOCALAPPDATA%` and `C:\ProgramData` ("kBlockAllChildren").
     **[verified, Chromium source]** That covers the default Origin, EA app and Steam
     install locations for RA2. **[inference]**
   - Inside OBS, permission prompts from browser sources are silently ignored. This
     covers the prompt that re-granting a persisted handle needs. **[verified,
     CEF + obs-browser source]**
3. **A small local static server on `http://localhost` is the most robust path.**
   Loopback counts as a secure context **[verified, spec]**. The same URL works in an
   OBS browser source and in normal Chrome, with no pickers and no permission prompts.
   It costs one process the streamer must start.
4. **GitHub Pages hosting works only for the code.** It cannot read local files by
   itself. The streamer still has to either:
   - import the files once (`<input type=file>`) into IndexedDB, which persists across
     OBS restarts **[verified that the profile is on disk]**, or
   - run a localhost companion for the hosted page to call.

   Pages from a **private** repo needs a paid plan, and the site is then public anyway
   unless the account is on Enterprise Cloud. **[verified]** This repo is private.
5. **A normal Chrome/Edge window plus OBS Window Capture works, but it is fragile.**
   - Chrome stops rendering when its window is minimised or fully covered (native
     window occlusion). **[verified]**
   - Capture loses transparency. **[inference]**
   - Audio needs Application Audio Capture. **[verified]**

## 1. OBS browser source: what engine, what it can do

### Engine version
- OBS 31.0 updated browser sources and docks to CEF/Chromium 127 (6533).
  **[verified]** <https://obsproject.com/blog/obs-studio-31-0-release-notes>
- The OBS 32.x releases (current stable is 32.2.2, 2026-08-14) do not mention a CEF
  change, so they are still on 127. **[inference from release notes]**
  <https://github.com/obsproject/obs-studio/releases>
- OBS 33.0 (rc3, 2026-10-20) updates CEF "from 127/6533 to 150/7871" and moves to
  CEF's **Chrome runtime**. **[verified]**
  - Release notes: <https://github.com/obsproject/obs-studio/releases/tag/33.0.0-rc3>
  - Upgrade PRs: <https://github.com/obsproject/obs-studio/pull/13900> and
    <https://github.com/obsproject/obs-browser/pull/523>
- A browser source is a **windowless (off-screen) browser**
  (`windowInfo.windowless_rendering_enabled = true`). **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-source.cpp#L212>
- CEF says "Windowless rendering will always use Alloy style". So even under OBS 33's
  Chrome runtime, browser sources get the reduced Alloy feature set. **[verified]**
  <https://github.com/chromiumembedded/cef/blob/master/include/internal/cef_types_runtime.h>

### "Local file" mode and the `http://absolute/` handler (the key finding)
- With "Local file" ticked, OBS rewrites the path to
  `"http://absolute/" + <URI-encoded absolute path>`. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-source.cpp#L497-L517>
- `CefRegisterSchemeHandlerFactory("http", "absolute", …)` serves any request to that
  host straight from disk. It uses `CefStreamReader::CreateForFile(path)` and guesses
  the MIME type, falling back to `application/octet-stream`. **[verified]**
  - <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-plugin.cpp#L413>
  - <https://github.com/obsproject/obs-browser/blob/85c7f26/browser-scheme.cpp>
- The handler checks only two things. **[verified]**
  - The requesting browser's main-frame origin must be `http://absolute/`. This check
    was added 2026-10-13 in commit `6b6d456`.
  - The first path segment must not be an IP literal.

  There is no directory jail. So a game page loaded as a Local file can fetch
  `http://absolute/C:/Program Files (x86)/…/ra2.mix`.
  - The OBS process reads the file with normal user rights. Program Files is
    world-readable. **[inference]**
  - Large files are streamed. See the earlier commit "Enable large local media file
    access" (`78489db`). **[verified commit exists]**
- **Deprecation risk [verified]:** the `6b6d456` commit message reads:

  > This is additional protections for what is ultimately legacy functionality dating
  > back to the original OBS Classic and we should consider removing the
  > http://absolute handler entirely in a future update.

  OBS 32.1.0 also shipped "Improved security of browser sources using local files", and
  33.0-rc3 fixed "the browser local file handler could be invoked from a remote page".
  The trend is tightening, not opening.
  <https://github.com/obsproject/obs-browser/commit/6b6d456>
- **Secure-context consequences [inference]:** `http://absolute` is a plain-http,
  non-loopback origin. Under the Secure Contexts spec it is not potentially trustworthy.
  So the following are off:
  - `[SecureContext]` APIs: WebGPU, OPFS (`navigator.storage.getDirectory`), File
    System Access pickers, service workers, `crypto.subtle`.
  - Not affected: WebGL/WebGL2, IndexedDB, localStorage, fetch and Web Audio, which
    have no such requirement.
  - Sources: <https://www.w3.org/TR/secure-contexts/> and
    <https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API>
- Query strings are percent-encoded into the path, so a Local-file URL cannot carry
  `?ra2=C:/…`. Config such as the RA2 path has to come from somewhere else: a
  `config.js` next to `index.html`, or localStorage set via the Interact window.
  **[inference from the encoding code above]**

### Persistence (IndexedDB / localStorage) across OBS restarts
- obs-browser sets `settings.cache_path` and `root_cache_path` to the plugin config
  directory, which is on disk. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-plugin.cpp#L355-L365>
- In CEF, an on-disk cache path means persistent storage. An empty or invalid path is
  "silently treated as Incognito Mode". **[verified, quoted in obs-browser PR #523]**
- So IndexedDB, localStorage and cookies survive OBS restarts. This is per origin and
  shared by every browser source with that origin. **[inference, high confidence]**
- OBS 33 migrates the old Alloy-layout profile into a Chrome-runtime `Default` profile
  "to ensure user's data [is] maintained". **[verified]**
  <https://github.com/obsproject/obs-browser/pull/523>
- Browser **docks** create their own `CefRequestContext` with a separate storage path.
  So a dock likely does **not** share IndexedDB with browser sources, and "import in a
  dock, play in a source" probably does not work. **[inference from
  `panel/browser-panel.cpp`]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/panel/browser-panel.cpp#L99-L150>

### File pickers, the File System Access API and permission prompts inside OBS
- obs-browser implements no `CefDialogHandler`, so CEF's default file dialog is used.
  **[verified by absence in source]**
- For windowless browsers, CEF parents the dialog to the client-supplied window handle.
  OBS supplies none. **[verified]**
  <https://github.com/chromiumembedded/cef/blob/master/libcef/browser/file_dialog_manager.cc>
- Whether `<input type=file>` or `webkitdirectory` opens a usable dialog from the
  Interact window is **untested**. My guess is that it opens an unowned native dialog.
  **[inference]**
- Permission prompts in Alloy style:
  - CEF's default for Alloy-style browsers is "IGNORE handling of permission prompts".
    **[verified]**
    <https://github.com/chromiumembedded/cef/blob/master/libcef/browser/permission_prompt.cc>
  - obs-browser's `OnShowPermissionPrompt` auto-accepts only
    `CEF_PERMISSION_TYPE_LOOPBACK_NETWORK` and returns `false` for everything else.
    **[verified]**
    <https://github.com/obsproject/obs-browser/blob/85c7f26/browser-client.cpp#L317-L328>
  - Result: a `CEF_PERMISSION_TYPE_FILE_SYSTEM_ACCESS` prompt, such as re-granting a
    stored directory handle, is never shown and never granted in a browser source.
    **[inference from the two verified facts]**
- `showDirectoryPicker` also needs a secure context and transient user activation.
  **[verified]**
  <https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker>
- The only way to give a browser source a user gesture is the **Interact** window,
  which forwards mouse and keyboard input. **[verified feature]**
  <https://github.com/obsproject/obs-studio/blob/master/frontend/dialogs/OBSBasicInteraction.cpp>
- Overall verdict: do not design around the File System Access API inside OBS.

### Graphics
- Hardware acceleration is the OBS setting "Browser Source Hardware Acceleration"
  (`BrowserHWAccel`). It uses shared textures when the GPU supports them.
  **[verified]**
  - If shared textures are unavailable, OBS adds `disable-gpu-compositing`.
  - Some Intel/AMD multi-adapter setups are blacklisted.
  - <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-plugin.cpp>
  - <https://github.com/obsproject/obs-browser/blob/85c7f26/browser-app.cpp#L123-L131>
- WebGL/WebGL2 works in browser sources. Widely used overlays depend on it.
  **[inference, not separately verified]**
- WebGPU is unverified in an off-screen CEF source. It is definitely unavailable in
  Local-file mode (not a secure context). Target WebGL2; PixiJS v8 supports both.
  **[inference]**
- Frame rate follows the OBS canvas FPS. A "custom frame rate" setting is also
  available. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-source.cpp#L216-L236>
- obs-browser disables Chromium's `CalculateNativeWinOcclusion`, so off-screen sources
  are not occlusion-throttled. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/browser-app.cpp#L134-L137>

### Audio
- OBS launches CEF with `autoplay-policy=no-user-gesture-required`, so audio plays
  without a click. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/browser-app.cpp#L165>
- "Control audio via OBS" (`reroute_audio`, off by default) mutes CEF's own output and
  routes the page audio into the OBS mixer as that source's audio. Without it, audio
  plays on the desktop device. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-plugin.cpp#L152>

### Localhost from a hosted page inside OBS
- Chrome's Local Network Access (LNA) gates requests from public origins to
  loopback/LAN behind a permission prompt, starting in Chrome 142. **[verified]**
  <https://developer.chrome.com/blog/local-network-access>
- OBS 33-beta broke pages calling `localhost` (issue #545). OBS fixed it by
  auto-accepting loopback permission "to retain previous behavior for now".
  **[verified]**
  - <https://github.com/obsproject/obs-browser/issues/545>
  - <https://github.com/obsproject/obs-studio/pull/14009>
- "For now" means a hosted-page-plus-localhost-companion design depends on a stopgap.
  **[inference]**

## 2. File System Access API in normal Chrome/Edge (relevant to the window-capture route)

- **Blocked directories on Windows [verified]:**
  - `GenerateBlockPaths` marks these `BlockType::kBlockAllChildren`:
    - `DIR_PROGRAM_FILES`, `DIR_PROGRAM_FILESX86`, `DIR_PROGRAM_FILES6432`
    - `DIR_WINDOWS`
    - `DIR_ROAMING_APP_DATA`, `DIR_LOCAL_APP_DATA`, `DIR_COMMON_APP_DATA`
  - That means the folder and everything under it is refused.
  - <https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc>
- RA2/YR from Origin, the EA app or Steam installs under `Program Files (x86)` or
  `Program Files` by default. So `showDirectoryPicker` / `showOpenFilePicker` fail
  unless the streamer installed elsewhere or copies the files out. **[inference]**
- The blocklist lives in the File System Access permission context. The classic
  `<input type=file>` / `webkitdirectory` path does not go through it. **[inference]**
  - That route returns read-only `File` snapshots with no persistent handle. The page
    would copy the needed `.mix` files into IndexedDB/OPFS once.
  - <https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory>
- **Persisted handles [verified]:**
  - Since Chrome 122, handles stored in IndexedDB can be re-granted with
    `requestPermission()` through a three-way prompt that includes "Allow on every
    visit".
  - Installed PWAs persist permissions automatically.
  - Without that, "access lasts until you close the last tab of the origin".
  - <https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api>

## 3. Normal Chrome/Edge window plus OBS capture

- **Occlusion throttling [verified]:**
  - Chrome on Windows tracks native window occlusion (on by default since M86). "If a
    window is occluded, Chromium treats foreground tabs as if they were background tabs;
    rendering stops".
  - Minimised windows are marked hidden.
  - Locking the screen marks all windows occluded.
  - <https://chromium.googlesource.com/chromium/src/+/main/docs/windows_native_window_occlusion_tracking.md>
  - <https://blog.chromium.org/2021/12/chrome-windows-performance-improvements-native-window-occlusion.html>
  - Tabs playing audio or video are exempt from some priority lowering, per the same
    blog's footnote.
- **Hidden-page throttling [verified]:**
  - `requestAnimationFrame` "will wait for the page to be visible".
  - Timers drop to 1/s, and to 1/min after 5 minutes hidden and silent.
  - <https://developer.chrome.com/blog/timer-throttling-in-chrome-88>
- A game tab that is behind another window, minimised, or on another virtual desktop
  freezes on stream. **[inference]**
  - Workaround: launch Chrome with
    `--disable-features=CalculateNativeWinOcclusion` (the same feature OBS disables for
    its own CEF), or keep the window uncovered.
  - Minimised windows cannot be window-captured at all anyway.
- **Window Capture:** OBS offers BitBlt and "Windows 10" (WGC) methods. The KB gives no
  browser-specific advice. **[verified]**
  <https://obsproject.com/kb/window-capture-sources>
- Window capture does not keep the page's transparency, so overlays need a chroma-key
  background. **[inference]**
- **Audio:** Application Audio Capture (OBS 28+, Windows 10 2004+). Window Capture can
  include audio since OBS 30.1. For Chrome, match by executable name, because window
  titles change. **[verified]**
  <https://obsproject.com/kb/application-audio-capture-guide>
- Cost: a second full browser process tree plus a GPU copy through capture, compared
  with an in-process CEF texture. That is more overhead than a browser source.
  **[inference]**

## 4. Delivery options compared

| Option | How it reaches RA2 files | Secure context | Extra process | Main risk |
|---|---|---|---|---|
| **A. OBS browser source, Local file** (game folder downloaded to disk) | `fetch('http://absolute/<abs path>')`, no prompts [verified] | No | None | Legacy handler may be removed [verified intent]; no WebGPU/OPFS |
| **B. Local static server** (`http://localhost:PORT`, serves the game and the RA2 dir read-only), used as an OBS browser-source URL | Plain same-origin fetch | Yes (loopback) [verified] | Yes, the server | Streamer must start it; tiny binary or script |
| **C. Hosted static site** (GitHub Pages / Netlify / Cloudflare Pages) as an OBS browser-source URL | One-time `<input type=file>` import via Interact into IndexedDB; or fetch to a localhost companion | Yes (https) | None (import) / Yes (companion) | File dialog in an off-screen source untested; companion relies on OBS's "for now" loopback auto-allow |
| **D. Chrome/Edge window plus Window Capture** (hosted or local page) | Picker blocked for Program Files [verified]; `<input>` import works [inference] | Yes | Chrome | Occlusion/minimise freezes [verified]; no alpha; separate audio capture |
| **E. Electron/Tauri wrapper** plus Window Capture | Native fs (Node in main process; Tauri fs plugin with explicit path scopes [verified]) | n/a | Yes, the app | Same capture caveats as D (Electron can set `backgroundThrottling: false` [verified]); heavy build and packaging for a stream overlay |

Sources for E:
- <https://www.electronjs.org/docs/latest/api/structures/web-preferences>
- <https://v2.tauri.app/plugin/file-system/>

**GitHub Pages specifics [verified]:**
- GitHub Free allows Pages only from public repos. Pro and Team allow it from private
  repos.
- Publishing a site *privately* needs Enterprise Cloud. Otherwise the site is public
  even from a private repo. **[inference: the docs present private publishing as the
  Enterprise-only alternative]**
- Limits: 1 GB site, a soft cap of 100 GB/month bandwidth, and no commercial use.
- Sources:
  - <https://docs.github.com/en/get-started/learning-about-github/githubs-plans>
  - <https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site>
  - <https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>
- `p0mz0r/chrono-battlefield` is currently **private**.
- Because the game ships no EA assets, a public site is legally unproblematic from the
  assets side. **[inference]**

## 5. Can a hosted page read a local folder once and reuse it?

- **In normal Chrome:** yes, for folders outside the blocklist. Store the
  `FileSystemDirectoryHandle` in IndexedDB. On the next visit, call
  `requestPermission()`; one click on "Allow on every visit" (Chrome 122+) makes it
  permanent. **[verified]**
  - Not for a default RA2 install under Program Files, which is blocked. **[verified
    path list; inference about install location]**
- **In an OBS browser source:** handle re-grant prompts are ignored. **[inference from
  verified code]**
  - The workable variant is to copy the bytes, not keep a handle. Import once, store in
    IndexedDB (or OPFS on https), and reuse forever. The OBS profile is persistent.
  - Re-import only if the streamer changes their install.
- **With a localhost server or `http://absolute`:** no "once" step is needed. The page
  reads the install by path on every load.

## 6. Recommendation for the decision (inference)

- Build the game as static files.
- Put all RA2 reads behind **one seam**: "give me the bytes of `<name>.mix`". Then the
  delivery backend can change without touching the game.
- Primary path: **A (Local file in OBS)**. Zero setup beyond pointing a browser source
  at `index.html`.
- Keep **B (localhost server)** as the fallback for when OBS removes `http://absolute`,
  or when a secure-context API turns out to be needed.
- Skip File System Access entirely.
- Skip Pages until there is a reason to host. It does not remove the local-files
  problem.

## 7. Open points a spike must confirm (not verified here)

1. In OBS 32.2 and 33.0-rc: a Local-file page can `fetch('http://absolute/C:/Program
   Files (x86)/…/ra2.mix')` (hundreds of MB), and gets the bytes as an `ArrayBuffer`.
   The origin check needs the *main frame* origin to be `http://absolute/`, so Workers
   and iframes need checking too.
2. WebGL2 frame pacing in a browser source at 60 FPS with and without "Browser Source
   Hardware Acceleration".
3. Whether `<input type=file>` from the Interact window opens a dialog at all in an
   off-screen source (OBS 32 Alloy runtime vs OBS 33 Chrome runtime).
4. Whether WebGPU is exposed in a browser source loaded from https or localhost.

## Sources

- OBS 31.0 release notes: <https://obsproject.com/blog/obs-studio-31-0-release-notes>
- OBS releases (32.1.0, 32.2.x, 33.0.0-rc3): <https://github.com/obsproject/obs-studio/releases>
- CEF 150 / Chrome runtime PRs: <https://github.com/obsproject/obs-studio/pull/13900>,
  <https://github.com/obsproject/obs-browser/pull/523>
- Localhost regression and fix: <https://github.com/obsproject/obs-browser/issues/545>,
  <https://github.com/obsproject/obs-studio/pull/14009>
- obs-browser source (pinned): <https://github.com/obsproject/obs-browser/tree/85c7f26>
- `http://absolute` hardening commit: <https://github.com/obsproject/obs-browser/commit/6b6d456>
- OBS KB, Browser Source: <https://obsproject.com/kb/browser-source>
- OBS KB, Window Capture: <https://obsproject.com/kb/window-capture-sources>
- OBS KB, Application Audio Capture: <https://obsproject.com/kb/application-audio-capture-guide>
- CEF runtime styles: <https://github.com/chromiumembedded/cef/blob/master/include/internal/cef_types_runtime.h>
- CEF permission prompt defaults: <https://github.com/chromiumembedded/cef/blob/master/libcef/browser/permission_prompt.cc>
- CEF file dialogs: <https://github.com/chromiumembedded/cef/blob/master/libcef/browser/file_dialog_manager.cc>
- Chromium File System Access blocklist: <https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc>
- Chrome persistent FS permissions: <https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api>
- MDN showDirectoryPicker: <https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker>
- MDN webkitdirectory: <https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory>
- MDN WebGPU: <https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API>
- W3C Secure Contexts: <https://www.w3.org/TR/secure-contexts/>
- Chrome Local Network Access: <https://developer.chrome.com/blog/local-network-access>
- Chrome timer throttling: <https://developer.chrome.com/blog/timer-throttling-in-chrome-88>
- Chromium native window occlusion: <https://chromium.googlesource.com/chromium/src/+/main/docs/windows_native_window_occlusion_tracking.md>,
  <https://blog.chromium.org/2021/12/chrome-windows-performance-improvements-native-window-occlusion.html>
- GitHub plans / Pages visibility / limits: <https://docs.github.com/en/get-started/learning-about-github/githubs-plans>,
  <https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site>,
  <https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>
- Electron webPreferences: <https://www.electronjs.org/docs/latest/api/structures/web-preferences>
- Tauri fs plugin: <https://v2.tauri.app/plugin/file-system/>
