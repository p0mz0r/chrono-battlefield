# Research: receiving Twitch chat and channel-point redemptions

Answers [#86](https://github.com/p0mz0r/chrono-battlefield/issues/86) for the map in
[#85](https://github.com/p0mz0r/chrono-battlefield/issues/85). Researched 2026-11-02.

Each claim is tagged **[verified]** (read in a primary source, linked), **[tested]**
(run from this machine on 2026-11-02, outside OBS) or **[inference]** (reasoned, not
tested). Nothing here was run inside an OBS browser source yet.

## Answer

- **Chat only, no login:** the page can open `wss://irc-ws.chat.twitch.tv:443` and
  join as an anonymous `justinfan<digits>` user. It works today **[tested]**, but
  Twitch does not document it: its docs require a user token and recommend EventSub
  over IRC **[verified]**. It needs nothing from the operator except the channel name.
- **Redemptions directly:** EventSub WebSocket plus a user token with
  `channel:read:redemptions` (or `channel:manage:redemptions` to fulfil or refund). The
  **device code flow** gets that token with no backend and no redirect URI: the game
  shows a code, the operator types it at `twitch.tv/activate`. Twitch's OAuth and Helix
  endpoints send `Access-Control-Allow-Origin: *` **[tested]**. Access tokens last
  4 hours; refresh tokens are one-time-use and lapse after 30 days unused **[verified]**.
- **Fulfil or refund:** only rewards **created by our own client ID** can have their
  redemptions updated. `CANCELED` refunds the points. Channel points need an Affiliate
  or Partner channel **[verified]**.
- **Through Streamer.bot:** its WebSocket server defaults to `ws://127.0.0.1:8080/` with
  Auto Start on **[verified]**. It forwards `Twitch.ChatMessage`, `Twitch.RewardRedemption`,
  `Twitch.Cheer` and many others. It can fulfil or refund only rewards it created
  ("Create Reward" button), and the game can ask it to do so with a `DoAction` request
  **[verified]**. The operator needs Streamer.bot running and logged in, which many
  streamers already have.
- **Recommendation [inference]:** support anonymous IRC for chat, with no setup.
  For redemptions, pick one of two: direct EventSub with device-code login and
  rewards the game creates itself, or Streamer.bot as an optional adapter. Direct needs
  only the Twitch login, but the game must own token refresh and the hourly validation.
  Streamer.bot hands all of that to a tool the operator may already run.

## (a) Connecting to Twitch directly

### Chat over IRC WebSocket

- The endpoint is `wss://irc-ws.chat.twitch.tv:443`. Non-SSL WebSocket is "Unavailable"
  (decommissioned). **[verified]** <https://dev.twitch.tv/docs/chat/irc/>
- The docs require a user access token with `chat:read`. They also say "Twitch IRC has
  some limitations versus EventSub" and recommend EventSub and API calls instead.
  **[verified]** <https://dev.twitch.tv/docs/chat/irc/>,
  <https://dev.twitch.tv/docs/chat/>
- Anonymous login (`PASS` anything, `NICK justinfan12345`) is not documented anywhere
  on dev.twitch.tv. **[verified, absence]** It still works: Node's built-in
  `WebSocket` got `001 … Welcome, GLHF!` and a `JOIN #twitchdev` echo. **[tested]**
  So it is read-only and could stop working without notice. **[inference]**
- A redemption's text shows up in chat only for rewards that require input, and the
  `custom-reward-id` tag is not in the documented PRIVMSG tag list ("If a tag is not
  documented here, it is not supported"). **[verified]**
  <https://dev.twitch.tv/docs/chat/irc/> So IRC is no route for redemptions.
- Rate limits: 20 join attempts and 20 authentication attempts per 10 s per user, and
  100 concurrent channels. The send limits (20 per 30 s, 100 per 30 s as mod/VIP/
  broadcaster) do not matter for read-only use. **[verified]**
  <https://dev.twitch.tv/docs/chat/> (Rate Limits)

### Chat and redemptions over EventSub WebSocket

- The endpoint is `wss://eventsub.wss.twitch.tv/ws`. After the Welcome message you have
  10 s to subscribe (adjustable). `keepalive_timeout_seconds` takes 10–600; on silence,
  reconnect and resubscribe. **[verified]**
  <https://dev.twitch.tv/docs/eventsub/handling-websocket-events/>
- Limits: at most 3 connections per user token, 300 enabled subscriptions per connection
  and `max_total_cost` of 10. A WebSocket transport **requires a user access token**;
  app tokens fail. **[verified]** Same page, plus
  <https://dev.twitch.tv/docs/chat/authenticating/>
- Subscription types and scopes **[verified]**
  <https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/>:
  - `channel.chat.message` v1: `user:read:chat` from the reading user (the
    broadcaster's own token works).
  - `channel.channel_points_custom_reward_redemption.add` v1 (and `.update`):
    `channel:read:redemptions` or `channel:manage:redemptions`; condition
    `broadcaster_user_id`, optional `reward_id`.
  - `channel.cheer` v1: `bits:read`.
- Subscriptions are created with a Helix `POST /eventsub/subscriptions` using the
  session id. Helix answers with `Access-Control-Allow-Origin: *`, so a page can call it.
  **[tested]**

### Creating, fulfilling and refunding rewards (Helix)

<https://dev.twitch.tv/docs/api/reference/> **[verified]**:

- Create Custom Rewards needs `channel:manage:redemptions`. The limit is 50 rewards per
  channel, enabled and disabled together. It returns 403 "The broadcaster is not a partner
  or affiliate."
- Update Redemption Status: "The app used to create the reward is the only app that may
  update the redemption." Statuses are `FULFILLED` and `CANCELED`, and only from
  `UNFULFILLED`. "Setting the status to CANCELED refunds the user's channel points."
- Get Custom Reward Redemption also requires the same Client-Id that created the reward.
- So the game must create its own rewards with its own client ID before it can refund
  them. Rewards the streamer made by hand in the dashboard can only be read.
  **[inference from the above]**

### OAuth without a backend

<https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/> **[verified]**:

- **Device code grant:**
  1. `POST https://id.twitch.tv/oauth2/device` with `client_id` and `scopes`.
  2. Show the operator the code and `verification_uri`
     (`https://www.twitch.tv/activate?...`).
  3. Poll `POST /oauth2/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`.

  The example code lives 1800 s with an interval of 5 s. The flow "allows for public and
  confidential client types". A public client needs no secret and can refresh without
  one, but public clients are limited to this flow. Access tokens last 4 hours. Refresh
  tokens are "for one time use only" and expire after 30 days of inactivity.
- **Implicit grant:** the token comes back in the redirect URI's fragment, with no refresh
  token. The docs give no lifetime. The redirect must land on a registered URL.
  **[verified]** Our page lives at `http://absolute/C:/…/index.html` and differs per
  operator, and the login page would have to run inside the browser source through
  Interact. So the implicit grant does not fit Local-file mode. **[inference]**
- Twitch's own pages do not say whether redirect URLs must be HTTPS or may be
  `localhost`. **[verified, absence]** <https://dev.twitch.tv/docs/authentication/register-app/>
- `id.twitch.tv/oauth2/device` and `/oauth2/token` answer CORS preflights from
  `Origin: http://absolute` with `Access-Control-Allow-Origin: *`. **[tested]**
- The app "must validate the OAuth token when it starts and on an hourly basis
  thereafter" (`GET /oauth2/validate`), and must end its sessions on a 401. Twitch
  audits for this. **[verified]** <https://dev.twitch.tv/docs/authentication/validate-tokens/>
- **Token storage:** `localStorage` in the OBS profile, as ADR 0004 already does for
  settings. The refresh token rotates on every use, so the new one must be written back
  each time. If OBS stays closed for 30 days, the operator logs in again. **[inference]**
- **Client ID:** we register one Twitch app (public client) and ship its ID in the
  build. Client IDs "are considered public and can be embedded in a web page's source".
  **[verified]** <https://dev.twitch.tv/docs/authentication/register-app/>

### What the operator does (direct)

- Chat only: types the channel name in setup. **[inference]**
- Redemptions:
  1. Presses "Connect Twitch" in setup (Interact).
  2. Opens `twitch.tv/activate` on a phone or PC, enters the code, approves the scopes.
  3. Lets the game create its rewards.

  The channel must be Affiliate or Partner. **[inference + verified 403]**

## (b) Going through Streamer.bot

- **Server:** Servers/Clients → WebSocket Server. The defaults are Address `127.0.0.1`,
  Port `8080`, Endpoint `/` and Auto Start on. There is an optional password, and
  "Enforce" applies it to every request. **[verified]**
  <https://docs.streamer.bot/api/websocket/guide/configuration>,
  <https://docs.streamer.bot/api/websocket/guide/authentication>
- **Auth:** a Hello carries a salt and challenge; the client answers with
  `base64(sha256(base64(sha256(password+salt))+challenge))`. Without Enforce, auth is
  required only for `SendMessage`. **[verified]** Same authentication page.
- **Requests:** `Subscribe` (`{"request":"Subscribe","id":…,"events":{"Twitch":["ChatMessage","RewardRedemption","Cheer"]}}`),
  `UnSubscribe`, `GetEvents`, `GetActions`, `DoAction` (with an `args` object),
  `SendMessage`, `GetBroadcaster` and others. **[verified]**
  <https://docs.streamer.bot/api/websocket/requests>
- **Events forwarded:** 139 Twitch events, among them `ChatMessage`, `RewardRedemption`,
  `RewardRedemptionUpdated`, `Cheer`, `CoinCheer`, `AutomaticRewardRedemption`, `Sub`
  and `Raid`. **[verified]** <https://docs.streamer.bot/api/websocket/events>.
  The redemption trigger exposes `rewardId`, `redemptionId`, `rewardCost`, `rawInput`
  and user variables. **[verified]**
  <https://docs.streamer.bot/api/triggers/twitch/channel-reward/reward-redemption>
- **Create, fulfil, refund:** the Reward Redemption trigger page has a "Create Reward"
  button. The guide says to "recreate your existing rewards through Streamer.bot" for
  ownership. The Update Redemption Status sub-action, and the C# methods
  `TwitchRedemptionFulfill` and `TwitchRedemptionCancel` (which refunds), work only on
  redeems "originally created by Streamer.bot". **[verified]**
  <https://docs.streamer.bot/guide/platforms/twitch>,
  <https://docs.streamer.bot/api/sub-actions/twitch/rewards/update-redemption-status>,
  <https://docs.streamer.bot/api/csharp/methods/twitch/channel-reward/twitch-redemption-cancel>
  The documented WebSocket API has no "create reward" request. **[verified, absence]**
  So the game refunds by sending `DoAction` with `rewardId` and `redemptionId` to an
  action the operator imported. **[inference]**
- **Client library:** `@streamerbot/client` (global `StreamerbotClient` from a script
  tag) handles auth when given a `password`. **[verified]**
  <https://streamerbot.github.io/client/get-started/installation>
  The game should bundle it, or speak the small protocol itself, rather than load it
  from a CDN. **[inference]**
- **Operator steps:**
  1. Install Streamer.bot and log in the Broadcaster account (Platforms → Twitch,
     Login, approve). **[verified]** <https://docs.streamer.bot/guide/platforms/twitch>
  2. Check that the WebSocket Server is on (it auto-starts by default).
  3. Create the game's rewards with "Create Reward" and import our action (an export
     string) for refunds.
  4. Keep Streamer.bot running while streaming.

  Many streamers already run it, but for those who don't it is a desktop app with a
  busy UI. **[inference]**
- **Limits:** the same Affiliate/Partner rule and the 50-reward cap, enforced by Twitch.
  Streamer.bot owns the token handling. **[inference]**

## Comparison

| | Anonymous IRC | Direct EventSub + device code | Streamer.bot |
|---|---|---|---|
| Chat | yes | yes (`user:read:chat`) | yes |
| Redemptions | no | yes | yes |
| Bits | no | yes (`bits:read`) | yes |
| Fulfil / refund | — | own rewards only | Streamer.bot-created only, via `DoAction` |
| Extra process | none | none | Streamer.bot running |
| Operator setup | channel name | login code once; again if idle 30 days | install, log in, import action |
| Our code | small IRC parser | OAuth device flow, refresh, hourly validate, EventSub reconnect | WS client + action export |
| Risk | undocumented, may break | Twitch app registration and audit | third-party API changes |

## To confirm in a spike

1. From a Local-file source (`http://absolute/`), open `wss://irc-ws.chat.twitch.tv`,
   `wss://eventsub.wss.twitch.tv/ws` and `ws://127.0.0.1:8080/`. Check that Chromium's
   Private Network Access does not block the loopback WebSocket from the
   `http://absolute` origin. **[inference: it should not; untested]**
2. Run the device code flow end to end from the OBS page, and check that the token
   survives an OBS restart in `localStorage`.
