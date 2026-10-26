# Research: triggering operator actions from an Elgato Stream Deck

Question: how can a Stream Deck button trigger an operator action (pause, end race,
switch camera mode, mute, open race setup) in the game page? The page runs in an OBS
browser source in Local-file mode (ADR 0004, `stream-delivery.md`). The Interact
window must not need focus, and we run no localhost server of our own. Which way is
simplest for a non-technical streamer? Researched 2026-10-26.

Each claim is tagged **[verified]** (read in a primary source, linked) or
**[inference]** (reasoned from verified facts, not tested). Nothing here was run on a
real OBS or Stream Deck.

Source code links are pinned to:
- obs-browser `85c7f26` (master, 2026-10-20)
- obs-studio `72e8665`
- obs-websocket `e28f849`
- Chromium `main`

## TL;DR

- OBS can push a named JS event into browser sources in two ways. The page gets
  `window` `CustomEvent`s with JSON in `event.detail`, and needs no permission level.
  The two ways:
  - the obs-websocket vendor request `obs-browser` / `emit_event` (OBS 27.2+)
  - the per-source proc handler `javascript_event` (OBS 29.1+), callable from an
    OBS Lua or Python script
- Neither way checks the page URL, so Local-file sources receive them.
- `BroadcastCustomEvent` does **not** reach browser sources. It only goes to
  connected WebSocket clients.
- Elgato's official OBS plugin has no raw, vendor or hotkey action, so it cannot send
  `emit_event`. Third-party tools that can send raw requests (Streamer.bot, Touch
  Portal) are extra apps and need the obs-websocket password.
- A page cannot register its own OBS hotkeys. obs-browser registers only "Refresh
  cache of current page" per source.
- A small OBS script can register named hotkeys ("Chrono Battlefield: Pause", …) that
  call `javascript_event` on the game source. OBS hotkeys are global by default and
  are read by polling the OS key state. So the stock Stream Deck **System > Hotkey**
  action, or a plain keyboard, triggers them without the Interact window.
- Keys typed into the page itself only arrive while the Interact window has focus.
  OBS hotkeys still fire then.
- **Custom Stream Deck plugin** (Node.js, WebSocket server on 127.0.0.1, page
  connects out):
  - It works in OBS 30–33. obs-browser explicitly disables Chromium's WebSocket
    Local Network Access check.
  - It installs by double-click with no Marketplace review.
  - It costs the most to build and maintain.

**Recommendation:** ship a bundled OBS Lua script that adds OBS hotkeys, and drive
them from Stream Deck's built-in Hotkey action (details at the end).

## 1. obs-browser vendor request `emit_event`

- obs-browser registers vendor `obs-browser` with request `emit_event` in
  `obs_module_post_load`. It reads `event_name` (string) and the optional
  `event_data` (object, default `{}`), then calls
  `DispatchJSEvent(event_name, json, nullptr)`. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-plugin.cpp#L904-L926>
- `browser == nullptr` means `ExecuteOnAllBrowsers`, so every browser source gets the
  event, whatever its URL or local-file setting. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-source.cpp#L684-L700>
- How the event reaches the page:
  - In the renderer, obs-browser evaluates `new CustomEvent('<name>', {"detail": <json>})`
    and calls `window.dispatchEvent` in every frame. **[verified]**
    <https://github.com/obsproject/obs-browser/blob/85c7f26/browser-app.cpp#L301-L345>
  - The page listens with `window.addEventListener('<name>', e => e.detail)`. The
    README lists "Any custom event emitted via obs-websocket vendor requests" among the
    events. **[verified]** <https://github.com/obsproject/obs-browser/blob/85c7f26/README.md>
- Permissions: event dispatch has no control-level check. Only the
  `window.obsstudio.*` *functions* are gated (`browser-client.cpp`). The default
  "Page permissions" therefore works. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/browser-client.cpp#L150-L290>
- Event names are spliced unescaped into the eval'd script. Keep them to
  `[A-Za-z0-9:_-]`. **[verified source / inference on the risk]**
- History: added in obs-browser commit `26dc85e` ("Add obs-websocket 5.0.0
  integration", 2022-01-10). **[verified]**
  <https://github.com/obsproject/obs-browser/commit/26dc85ec2609c67f5c81f7d42750e8dbb37aae1d>
  - OBS 27.2.0's obs-browser submodule contains it and 27.1.3's does not (checked by
    commit comparison). **[verified]**
  - It does nothing without obs-websocket 5, which ships bundled from OBS 28.
    **[inference]**
- Wire format sent by a WebSocket client (op 6 Request):
  `{"requestType":"CallVendorRequest","requestData":{"vendorName":"obs-browser","requestType":"emit_event","requestData":{"event_name":"chronoPause","event_data":{}}}}`.
  **[verified fields]**
  <https://github.com/obsproject/obs-websocket/blob/e28f849/docs/generated/protocol.md#callvendorrequest>
- If the source has "Shut down source when not visible" set and is hidden, it has no
  browser, and the event is dropped. **[inference from `SetShowing`]**

## 2. obs-websocket `BroadcastCustomEvent`

- Protocol: "Broadcasts a `CustomEvent` to all WebSocket clients. Receivers are
  clients which are identified and subscribed." **[verified]**
  <https://github.com/obsproject/obs-websocket/blob/e28f849/docs/generated/protocol.md#broadcastcustomevent>
- obs-browser only *registers a vendor*. It never subscribes to obs-websocket events,
  and its only obs-websocket API use is in `obs_module_post_load`. **[verified]**
  So browser sources do **not** receive it.
- A page could open its own obs-websocket client connection (`ws://127.0.0.1:4455`).
  That needs the streamer to copy the server password into the game. **[inference]**

## 3. `window.obsstudio` events a Stream Deck could cause indirectly

- Events dispatched to pages:
  - `obsSceneChanged`, with `detail = {name,width,height}`, sent to all sources
  - `obsSourceVisibleChanged`, with `{visible}`, per source
  - `obsSourceActiveChanged`, with `{active}`, per source
  - streaming, recording, replay and virtual-camera start/stop events
  - `obsExit`

  **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-plugin.cpp#L526-L640>,
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-source.cpp#L380-L434>
- Like all events, they need no page permission (see §1). Calling
  `obsstudio.getCurrentScene()` needs READ_USER. **[verified]** (README)
- Elgato's "Scene" or "Source" actions could fire these events. But:
  - switching scenes changes what goes on air
  - visibility events reach only the source being toggled, and hiding the game source
    hides the game

  Mapping five operator actions this way is a hack. **[inference]**
- One workaround: a hidden "button" browser source per action, toggled by Elgato's
  Source Visibility action, that relays to the game with `BroadcastChannel` (same
  `http://absolute` origin). This is plausible but untested and clumsy. **[inference]**

## 4. What a Stream Deck can actually send

- **Elgato's official OBS Studio plugin**:
  - Actions: Stream, Record, Virtual Camera, Replay Buffer, Save Replay, Studio Mode,
    Preview Scene, Chapter Marker, Screenshot, Scene, Scene Collection, Profile,
    Source, Filter, Transition, Mute, Media, Audio Mixer Volume.
  - It has no raw, vendor or hotkey action, so it **cannot** send `emit_event`.
    **[verified, marketplace article]**
    <https://www.elgato.com/us/en/explorer/products/marketplace/streamline-your-production-with-the-obs-studio-plugin-for-stream-deck/>
- **Streamer.bot**: its "OBS Raw" sub-action "Send[s] custom requests directly to the
  OBS WebSocket server" with a free-form request type, so `CallVendorRequest` should
  work. **[verified doc / inference for vendor]**
  <https://docs.streamer.bot/api/sub-actions/obs-studio/raw>
  - It is a separate desktop app, driven from Stream Deck through its own plugin.
    That is too much setup for our target user. **[inference]**
- **Touch Portal** has a Custom Request action, but it is not a Stream Deck product.
  <https://www.touch-portal.com/blog/post/tutorials/obs-touch-portal-how-to-use-custom-request.php>
- BarRaider's "OBS Tools" plugin listed a hotkey-trigger action. Its GitHub repo now
  returns 404, so we could not verify it. **[unverified]**
- **Stream Deck "Hotkey" (System) action**: it sends a keystroke to the OS.
  - Keys reach a browser source only through the Interact dialog. That dialog
    forwards Qt `KeyPress`/`KeyRelease` on its preview widget to
    `obs_source_send_key_click`. So the dialog must have keyboard focus. **[verified]**
    <https://github.com/obsproject/obs-studio/blob/72e8665/frontend/dialogs/OBSBasicInteraction.cpp#L95-L105>,
    <https://github.com/obsproject/obs-studio/blob/72e8665/frontend/dialogs/OBSBasicInteraction.cpp#L381-L395>
  - OBS hotkeys use `GetAsyncKeyState` polling on Windows, so they see synthetic
    keystrokes system-wide. **[verified source / inference that SendInput is seen]**
    <https://github.com/obsproject/obs-studio/blob/72e8665/libobs/obs-windows.c#L974-L980>
  - The default "Hotkey Focus Behavior" is `NeverDisableHotkeys`. Focus is judged
    for the whole Qt application (`applicationState()`), so OBS hotkeys keep firing
    while the Interact window is focused. **[verified]**
    <https://github.com/obsproject/obs-studio/blob/72e8665/frontend/OBSApp.cpp#L380>,
    <https://github.com/obsproject/obs-studio/blob/72e8665/frontend/OBSApp.cpp#L1230-L1251>

## 5. OBS hotkeys for page actions

- obs-browser registers one hotkey per source, `ObsBrowser.Refresh` ("Refresh cache
  of current page"). The page has no JS API to register more. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-source.cpp#L77-L86>
- obs-browser also adds a proc handler on every browser source:
  `void javascript_event(string eventName, string jsonString)`. It dispatches the same
  `CustomEvent` to *that* source only. **[verified]**
  <https://github.com/obsproject/obs-browser/blob/85c7f26/obs-browser-source.cpp#L88-L102>
  - Added in commit `501f624` (2023-03-19), first shipped in **OBS 29.1.0**
    (submodule comparison). **[verified]**
    <https://github.com/obsproject/obs-browser/commit/501f624e0eabe851358bcc34dca785bbf52ac1c9>
- OBS scripting exposes `obs_hotkey_register_frontend(name, description, callback)`.
  **[verified]**
  <https://github.com/obsproject/obs-studio/blob/72e8665/docs/sphinx/scripting.rst>
  The libobs `proc_handler_call` and `calldata_set_string` are part of the API the
  scripting bindings wrap. **[verified API / inference that obslua exposes them]**
  <https://github.com/obsproject/obs-studio/blob/72e8665/docs/sphinx/reference-libobs-callback.rst>
- So a ~60-line `chrono-battlefield.lua` can:
  1. Register hotkeys such as "Chrono Battlefield: Pause / End race / Camera mode /
     Mute / Race setup" (shown in Settings > Hotkeys).
  2. On press, find browser sources (`obs_get_source_by_name` from a script setting,
     or enumerate `browser_source`s).
  3. Call `javascript_event` with a name like `chronoOperator` and
     `{"action":"pause"}`.
  4. Save and load the bindings with `obs_hotkey_save`/`obs_hotkey_load` in
     `script_save`/`script_load`.

  **[inference, standard script pattern]**
- The page then needs a single listener. The same listener also catches `emit_event`
  from Streamer.bot users. **[inference]**

## 6. Custom Stream Deck plugin with a loopback WebSocket (OBS not in the path)

Design: we ship a Stream Deck plugin with one action per operator command. Its Node
process runs a WebSocket server on `127.0.0.1:<port>`. The game page connects out as
a client, and retries quietly while the Stream Deck app is down.

### 6.1 Can a Local-file page open `ws://127.0.0.1:<port>`?

- In OBS 30–32 (an older CEF on OBS 30, then CEF/Chromium 127 from OBS 31, see
  `stream-delivery.md`), it is allowed. **[inference]**
  - These versions predate Chrome's Local Network Access (LNA), which went opt-in in
    Chrome 138 and launched its prompt in Chrome 142. **[verified]**
    <https://developer.chrome.com/blog/local-network-access>
  - Older Private Network Access did not gate WebSockets. **[inference]**
- In Chromium today, a document with no IP endpoint (a custom scheme handler like
  `http://absolute`) has address space `kUnknown`, treated as public. **[verified]**
  <https://chromium.googlesource.com/chromium/src/+/main/services/network/public/cpp/ip_address_space_util.cc>
  - With LNA on, requests from a **non-secure** context to local or loopback get
    `Policy::kBlock`, with no prompt. **[verified]**
    <https://chromium.googlesource.com/chromium/src/+/main/content/browser/renderer_host/local_network_access_util.cc>
  - So obs-browser's loopback auto-accept ("Implicitly allow Localhost access to
    retain previous behavior for now", `browser-client.cpp` L322) would not help an
    `http://absolute` page. That auto-accept only answers prompts.
    **[verified quote / inference on applicability]**
    <https://github.com/obsproject/obs-browser/blob/85c7f26/browser-client.cpp#L317-L328>
- The WebSocket case is covered separately:
  - Chromium has a separate feature `LocalNetworkAccessChecksWebSockets` (enabled by
    default on `main`). **[verified]**
    <https://chromium.googlesource.com/chromium/src/+/main/services/network/public/cpp/features.cc>
  - obs-browser adds it to `--disable-features` on every platform (commit `a162443`,
    "Allow WebSocket requests over the network", PR #538, merged 2026-09-12, aimed at
    the CEF 150 / OBS 33 update). **[verified]**
    <https://github.com/obsproject/obs-browser/blob/85c7f26/browser-app.cpp#L134-L167>,
    <https://github.com/obsproject/obs-browser/commit/a1624431ae60cd89560d3d12c8143b1b926b410a>
- **Result:** loopback WebSocket from a Local-file page works in OBS 30–32 and is
  explicitly kept working in OBS 33. It is more robust than loopback `fetch`, which
  rests on the "for now" prompt auto-accept and does not apply to non-secure origins.
  **[inference from verified source]**
- Security: any local page, or a public site in a browser without LNA, could connect
  to the port. The plugin should reject handshakes whose `Origin` is not
  `http://absolute` (plus the dev origin). **[inference]**

### 6.2 Stream Deck SDK facts

- SDK version 3.0.0. Plugins need Node.js 24+ to build and Stream Deck 7.1+ to run.
  The CLI is `npm i -g @elgato/cli`, then `streamdeck create`. **[verified]**
  <https://docs.elgato.com/streamdeck/sdk/introduction/getting-started>
- In the manifest, `Nodejs.Version` is one of `"20"`, `"24"`, `"26"`. The Stream Deck
  app runs the plugin's JS as its own Node process, with `--enable-source-maps
  --no-global-search-paths`. **[verified]**
  <https://docs.elgato.com/streamdeck/sdk/references/manifest>
  - No sandbox or network restriction is documented, so `node:http` plus a bundled
    `ws` package (Node has no built-in WS *server*) can listen on 127.0.0.1.
    **[inference]**
- Packaging: `streamdeck pack <id>.sdPlugin` validates the plugin and produces a
  `.streamDeckPlugin` file, which can be distributed "directly to users".
  Marketplace publishing (Maker Console, "Submit for review") is optional.
  **[verified]**
  <https://docs.elgato.com/streamdeck/sdk/introduction/distribution>
- Install: "If you double-click this file on your machine, Stream Deck will install
  the plugin." **[verified]** <https://github.com/elgatosf/streamdeck-counter>
- Neither page mentions code signing or warnings for side-loaded plugins. **[not
  found]**

### 6.3 Effort and maintenance compared with the OBS routes (rough)

| Route | Build | Streamer setup | Ongoing cost |
|---|---|---|---|
| A. OBS Lua script + OBS hotkeys + Stream Deck "Hotkey" | ~60 lines Lua, 1 page listener; < 1 day | Tools > Scripts > add file; bind 5 keys in Settings > Hotkeys; 5 Stream Deck Hotkey buttons | Near zero; stable libobs APIs; needs OBS 29.1+ |
| B. obs-websocket `emit_event` via Streamer.bot / Touch Portal | Page listener only | Enable WebSocket server, copy password, install and configure a third-party app | None for us; high for the streamer |
| C. Custom Stream Deck plugin + loopback WS | Node/TS plugin, `ws` dep, manifest, icons, 5 actions, page reconnect client, origin check; ~2–4 days | Double-click `.streamDeckPlugin`, drag buttons | Track SDK, Node and Stream Deck app versions; rebuild and re-pack; depends on obs-browser keeping the WS LNA opt-out; Stream Deck users only |

Route C gives the nicest buttons: real names and icons, and two-way state (for
example a lit "Paused" key). That is its main advantage. **[inference]**

## Recommendation

Go with **route A**.
- Bundle `chrono-battlefield.lua` with the game.
- The streamer adds it once under Tools > Scripts. It registers named OBS hotkeys
  that call the game source's `javascript_event` proc.
- The page listens for one `CustomEvent`, which also accepts `emit_event`.
- Stream Deck's built-in Hotkey action, or any keyboard, then drives the game
  globally.

Why: no server, no WebSocket password, no third-party app, and no Interact focus. It
also helps streamers without a Stream Deck.

Pick the keys:
- Suggest unused combos such as Ctrl+Alt+F13–F17, so the keystroke doesn't leak into
  other apps.
- Avoid keys the page also handles itself. Otherwise a focused Interact window would
  trigger the action twice.

Treat **route C** (custom Stream Deck plugin) as a later polish step if streamers want
labelled, stateful buttons. It works technically in OBS 30–33. Skip relying on
`BroadcastCustomEvent` (it never reaches browser sources) and on Elgato's OBS plugin
(it cannot send vendor requests).

Open checks for a spike:
1. obslua exposes `proc_handler_call`.
2. Stream Deck's Hotkey action triggers OBS hotkeys while OBS is unfocused.
3. A hidden source with "shutdown when not visible" drops events.
