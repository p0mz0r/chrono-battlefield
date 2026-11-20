# Research: hosting the Rhino Race Twitch extension needs

Answers #165 ("What hosting does a Twitch extension need to pass game state to viewers
and actions back?") for the extension map #164. Researched 2026-11-20.

Each claim is tagged **[verified]** (read in a primary source, linked) or
**[inference]** (reasoned from verified facts, not tested). Nothing here was run against
a real extension.

## TL;DR

1. **A small hosted Extension Backend Service (EBS) is unavoidable.** No Twitch-only
   route carries a viewer's action back to the game. A viewer's front end cannot publish
   to Extension PubSub (only broadcaster-role tokens can send from the front end), the
   Configuration Service is writable only by the broadcaster or an `external` JWT, and
   extension chat messages need an `external` JWT. Every `external` JWT has to be signed
   with the extension secret, which must not ship in the operator's zip. So something
   that holds the secret has to run on a public HTTPS host. **[inference from the
   verified API rules below]**
2. **Extension PubSub survives.** Twitch shut down legacy PubSub on 2025-04-14, but said
   the Extensions broadcast "will not be affected by the broader PubSub deprecation and
   shutdown". `POST /helix/extensions/pubsub` is still documented, with no deprecation
   note. **[verified]** [13][1]
3. **Minimum shape:** the game on the operator's PC opens an *outbound* WebSocket to
   the EBS (no port forwarding). The EBS:
   - relays the game's state to viewers with Send Extension PubSub Message (one
     `broadcast` per channel, ≤5 KB, ≤1/s);
   - verifies each viewer action's Twitch JWT and passes it down the socket to the
     game;
   - verifies Bits `transactionReceipt` JWTs.

   A Cloudflare Worker plus one Durable Object per channel fits the free plan.
   **[inference]**
4. **Latency:** `onContext` gives `hlsLatencyBroadcaster` (seconds behind the
   broadcaster). Twitch's own sample uses it to line game data up with the video, but
   forum reports show it missing in some contexts (iOS, panel-only). Treat it as
   best-effort, with a fallback delay. **[verified docs, forum reports]**

## 1. Game state out: game → viewers

| Route | Who can send | Limits | Fit |
|---|---|---|---|
| **Send Extension PubSub Message** (`POST https://api.twitch.tv/helix/extensions/pubsub`) | EBS with an `external` JWT signed with the secret (`channel_id`, `pubsub_perms.send: ["broadcast"]`) | 5 KB per message; 100 messages/min per client ID + broadcaster; Building guide: "1 message per second per channel" | **Yes.** Push the whole state as one `broadcast` each tick or on change. [1][2] |
| `twitch.ext.send` from the front end | Broadcaster role only ("Broadcasters cannot send to global"); viewers cannot send | Same PubSub limits | Only if the broadcaster keeps an extension view open, and the game still can't reach that iframe without a host. Not a real route. [3] |
| Configuration Service (broadcaster segment) | Broadcaster front end or EBS `external` JWT | 5 KB; set 20/min, get 20/min per channel | Good for operator settings (Bits events on or off), too slow and stale for live state. [1][2] |
| Extension chat (`POST /helix/extensions/chat`) | EBS `external` JWT | 280 chars; 12/min | Not for state. Also against the frame (extension actions never go to the chat panel). [1] |

**Fitting the racer readout in 5 KB [inference]:**
- One broadcast carries `{phase, actions[], hypeArmed, racers: {<userId>: [place, pct]}}`.
- Each viewer's front end picks out its own `user_id`.
- About 40 racers × ~25 bytes is about 1 KB, well inside 5 KB.
- Per-viewer `whisper-<userId>` targets would spend one message of the 100/min budget
  per racer, so a single broadcast is the right choice.
- The place list is public anyway, because the stream shows the race.

Viewers listen with `twitch.ext.listen('broadcast', cb)`. Anonymous viewers receive it
too, so "watching is anonymous" holds. [3]

## 2. Viewer actions in: viewer → game

- The front end can only reach the outside world by HTTPS `fetch` to domains on the
  extension's "Allowlist for URL Fetching Domains", set in the developer console. The
  Content Security Policy is built from that list. [4]
- Each request sends the viewer's `token` from `onAuthorized`, the "JWT that should be
  passed to any EBS call for authentication". [3]
- The EBS verifies that token with the secret and reads `channel_id`, `opaque_user_id`,
  `user_id` (only if the viewer shared their identity) and `role`. It then forwards the
  action to that channel's game socket. **[verified fields, inference flow]**
- Rate limit: the per-viewer limit is the EBS's own choice. Twitch's Helix-from-front-end
  limit (30 req/min per viewer) does not apply to EBS calls. [5] The game's viewer
  cooldowns stay the authority. **[inference]**
- Reaching the operator's PC directly, for example by fetching `http://127.0.0.1` from
  the Twitch-hosted iframe, is not viable. It would need a public allowlisted HTTPS
  host. [4] **[inference]**

## 3. Bits

- `twitch.ext.bits.useBits(sku)` starts a purchase. `onTransactionComplete` fires with
  `{userId, displayName, product, transactionID, transactionReceipt}`.
- `transactionReceipt` is a "JWT containing the following transaction information ... It
  can be verified using your developer secret". So the front end posts it to the EBS,
  the EBS verifies it, and the EBS tells the game. [3]
- The catalog's "Broadcast" toggle decides whether every instance or only the buyer's
  gets the callback. [6]
- The server-side alternative, EventSub `extension.bits_transaction.create`, needs an
  app access token whose client ID matches the extension. It is "only supported by
  Webhooks and Conduits, and cannot be used with WebSockets", so it also needs a hosted
  HTTPS endpoint or a secret-holding conduit owner. [7]
- `twitch.ext.features.isBitsEnabled` must be checked; it is mandatory for monetized
  extensions. Confirming a purchase shares the viewer's identity. [6]
- Trial-race guard: the game ignores Bits during a trial race, and the front end should
  hide Bits buttons while the game says "trial". **[inference]**

## 4. Where the secret lives

- The extension secret is a long-lived (100-year) shared secret. Twitch recommends
  rotating it often. Requesting a new one makes the old one expire after one hour. [2]
- It signs every `external` JWT and verifies viewer tokens and Bits receipts, so it must
  only exist on the EBS, for example as a Cloudflare Worker secret. It must never be in
  the release zip or the front-end bundle. **[inference]**
- The game itself never needs the secret. It authenticates to the EBS with its own
  per-channel link credential (operator linking, still open in #164).
  - One option: the operator opens the extension's config view, which runs with the
    broadcaster's Twitch JWT (`role: broadcaster`, `opaque_user_id` = "U" + the
    broadcaster's ID [3]).
  - That view asks the EBS for a one-off link code, which the setup wizard pastes into
    the game. **[inference]**

## 5. Identity sharing

- Before sharing, `onAuthorized.userId` is an opaque ID. "U…" IDs are stable per
  account; "A…" IDs are transient anonymous sessions that "should never be associated
  with persistent data". [3]
- `twitch.ext.actions.requestIdShare()` opens Twitch's share prompt, if identity linking
  is enabled for the extension. Afterwards `onAuthorized` fires again and the JWT carries
  the real `user_id`. `viewer.isLinked` tells whether the viewer has shared. Viewers can
  revoke it, and then get a new opaque ID. [3]
- **The display name is not in the JWT.**
  - The EBS (or the front end, via `helixToken` and Get Users) looks it up from
    `user_id`. [3][5]
  - The game already maps `twitch:<id>` from the chat source, so the EBS can send just
    the ID. **[inference]**
- Bits transactions carry `userId` and `displayName` directly. [3]

## 6. Stream latency

- `onContext` includes `hlsLatencyBroadcaster`, the "Number of seconds of latency
  between the broadcaster and viewer". [3]
- Hidden extensions get no `onContext` updates. The docs don't state how often it
  fires. [3]
- Twitch's 2019 blog post uses it to rewind game state by the viewer's latency. [8]

Reliability [forum reports, not official]:
- It ignores a manually set stream delay or OBS delay. [9]
- It has been reported missing on iOS [10], and missing when only a panel extension is
  active (a component is in the video slot, so it should be present). [11]

**Recommendation [inference]:** buffer incoming state and show it after
`hlsLatencyBroadcaster` seconds. Fall back to a fixed few seconds when it's absent, plus
an operator-set extra delay to match any OBS delay.

## 7. Cheap hosts

- **Cloudflare Workers Free:** 100,000 requests/day, 10 ms CPU per invocation. [12]
- **Durable Objects on Free:** SQLite-backed only, 100,000 requests/day, 13,000 GB-s/day.
  Incoming WebSocket messages bill at 20:1. [12]

Load estimate [inference]:
- One DO per channel holds the game's WebSocket.
- At 1 state push/s plus actions, a 30-minute stream uses about 1,800 PubSub `fetch`es
  (subrequests) and a few hundred action requests. That is well inside the free tier for
  a handful of operators.
- Any HTTPS host that can keep a secret and hold a WebSocket also works (a small VPS, or
  a Fly.io or Render free/cheap instance). Their current free-tier terms were not
  checked.

## Recommendation: minimum hosting

One EBS on Cloudflare Workers + Durable Objects (free tier). It:
- holds the extension secret;
- accepts an outbound WebSocket from each operator's game;
- fans state out with one Extension PubSub `broadcast` at most 1/s;
- verifies viewer JWTs and Bits receipts, then forwards actions down the socket.

Twitch hosts the front-end files itself; they ship in the zip uploaded to Twitch. [4]
Skip the Configuration Service for live state and keep it for operator settings.

## Sources

1. Twitch API reference, Extensions: Send Extension PubSub Message, Get/Set Extension Configuration Segment, Send Extension Chat Message. https://dev.twitch.tv/docs/api/reference/extensions/
2. Building Extensions (EBS, JWT roles, secret rotation, PubSub limits "1 message per second per channel", "5 KB message size", 5 KB config). https://dev.twitch.tv/docs/extensions/building/
3. Extensions Reference (Extension Helper: `listen`/`send`, `onAuthorized`, `onContext`, `requestIdShare`, Bits API, JWT schema). https://dev.twitch.tv/docs/extensions/reference/
4. Extensions overview (zip upload, CSP built from the developer-console allowlist, HTTPS). https://dev.twitch.tv/docs/extensions/
5. Using the Twitch API in an Extension front end (helix JWT, 30 req/min per viewer). https://dev.twitch.tv/docs/extensions/frontend-api-usage/
6. Monetization / Bits in Extensions (catalog Broadcast toggle, `isBitsEnabled`, identity disclosure). https://dev.twitch.tv/docs/extensions/bits/ , https://dev.twitch.tv/docs/extensions/monetization/
7. EventSub reference, Extension Bits Transaction Create (app token, webhook/conduit only). https://dev.twitch.tv/docs/eventsub/reference/extension/
8. Twitch blog, "Just add time travel" (2019-08-21). https://blog.twitch.tv/en/2019/08/21/just-add-time-travel-building-your-games-for-both-streamers-and-viewers-cd0c54f78b64/
9. Twitch dev forum, "How to measure delay to broadcaster?" https://discuss.dev.twitch.com/t/how-to-measure-delay-to-broadcaster/18133
10. Twitch dev forum, "hlsLatencyBroadcaster on IOS". https://discuss.dev.twitch.tv/t/hlslatencybroadcaster-on-ios/24393
11. Twitch dev forum, "onContext hlsLatencyBroadcaster not working in local/hosted test?" https://discuss.dev.twitch.tv/t/oncontext-hlslatencybroadcaster-not-working-in-local-hosted-test/29795
12. Cloudflare Workers pricing (Free plan, Durable Objects). https://developers.cloudflare.com/workers/platform/pricing/
13. Twitch dev forum, "Legacy PubSub deprecation and shutdown timeline" (jbulava, 2024-04-12; shutdown 2025-04-14; Extension PubSub not affected). https://discuss.dev.twitch.com/t/legacy-pubsub-deprecation-and-shutdown-timeline/58043
