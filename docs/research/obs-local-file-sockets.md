# Research: can an OBS Local-file page open chat sockets?

Closes the open point from [#86](https://github.com/p0mz0r/chrono-battlefield/issues/86), for
[#90](https://github.com/p0mz0r/chrono-battlefield/issues/90). Tested 2026-11-02.

Each claim is tagged **[tested]** (run on the owner's PC), **[verified]** (read in a primary
source, linked) or **[inference]**.

## Answer

Yes, on OBS 33.0.0. A browser source in Local-file mode (`location.origin` is
`http://absolute`) opened every connection the chat sources need **[tested]**. But the loopback
socket to Streamer.bot only works because of obs-browser workarounds that OBS calls temporary
**[verified]**.

## Test

The setup was the isolated portable OBS 33.0.0 rig, with obs-browser 2.27.4 and CEF
150.0.7871.252. The user agent ended `Chrome/150.0.7871.252 OBS/33.0.0`. Results were read over
CDP and matched the `console.error` lines in the OBS log. **[tested]**

| Check | Result |
|---|---|
| `wss://irc-ws.chat.twitch.tv:443`, anonymous `justinfan` | `:tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!` |
| `wss://eventsub.wss.twitch.tv/ws` | `session_welcome` message |
| `ws://127.0.0.1:8080/` (a plain Node echo server standing in for Streamer.bot) | Upgrade arrived with `origin: http://absolute`, and the echo came back. No Private or Local Network Access block. |
| `fetch('https://id.twitch.tv/oauth2/validate')` | `401 missing authorization token`, no CORS error |

## Why loopback works, and may stop

- OBS 33.0 updated CEF from 127 to 150. 33.0.1 changed nothing related to this.
  **[verified]** <https://github.com/obsproject/obs-studio/releases/tag/33.0.0>,
  <https://github.com/obsproject/obs-studio/releases/tag/33.0.1>
- obs-browser #538 turns off Chromium's `LocalNetworkAccessChecksWebSockets` so WebSockets
  aren't refused with `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. **[verified]**
  <https://github.com/obsproject/obs-browser/pull/538>
- obs-browser #547 auto-accepts Chromium's loopback permission prompt. A denial saved
  before that change stays permanent until `plugin_config/obs-browser` is deleted. A user
  confirmed this fix in #545. **[verified]** <https://github.com/obsproject/obs-browser/pull/547>,
  <https://github.com/obsproject/obs-browser/issues/545>
- obs-browser #551 limits `http://absolute/` file serving to pages whose own origin is
  `http://absolute/`. Its description says the team should consider removing that handler
  entirely. **[verified]** <https://github.com/obsproject/obs-browser/pull/551>
- An open issue reports a local overlay that can't reach its 127.0.0.1 port on 33.0.1 but works
  on 32.2.2. A maintainer points at 33.0's changes to local files. **[verified]**
  <https://github.com/obsproject/obs-studio/issues/14118>

## Limits

- OBS 32.x was not tested, so there is no before/after result.
- Only anonymous Twitch was tried. No real OAuth token was sent and no EventSub subscription
  was created.
- A machine that ran an OBS 33 beta may hold a saved loopback denial. Deleting
  `plugin_config/obs-browser` clears it. **[inference from #545/#547]**
- If a later OBS blocks loopback, the `chronoChat` event delivered through obs-websocket still
  carries chat, because it never leaves OBS. It can't refund. **[inference]**
