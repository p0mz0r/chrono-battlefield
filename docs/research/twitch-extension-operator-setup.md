# Research: how the operator switches on the Twitch extension

Answers #172 ("How does the operator switch on the Twitch extension and link the game
to it?") for the extension map #164. It builds on #169, where the operator's Twitch
login proves the channel to the extension backend, and on the hosting and Bits notes
([#165](https://github.com/p0mz0r/chrono-battlefield/blob/research/twitch-extension-hosting/docs/research/twitch-extension-hosting.md),
[#166](https://github.com/p0mz0r/chrono-battlefield/blob/research/twitch-extension-bits-publishing/docs/research/twitch-extension-bits-publishing.md)).
Researched 2026-11-21.

Each claim is tagged **[verified]** (read in a primary source, linked), **[code]** (read
in this repo), **[inference]** (reasoned from verified facts, not tested) or
**[unverified]** (no primary source found). Nothing here was tried against a real
channel or extension.

Sources:
- Extensions guide: <https://dev.twitch.tv/docs/extensions/>
- Life cycle management: <https://dev.twitch.tv/docs/extensions/life-cycle/>
- Building extensions: <https://dev.twitch.tv/docs/extensions/building/>
- Extensions reference: <https://dev.twitch.tv/docs/extensions/reference/>
- Guidelines and policies: <https://dev.twitch.tv/docs/extensions/guidelines-and-policies/>
- Helix Users reference (extension endpoints): <https://dev.twitch.tv/docs/api/reference/users/>
- Helix Extensions reference: <https://dev.twitch.tv/docs/api/reference/extensions/>
- Scopes: <https://dev.twitch.tv/docs/authentication/scopes/>
- OAuth flows (device code): <https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow>
- Validate, refresh and revoke tokens: <https://dev.twitch.tv/docs/authentication/validate-tokens/>,
  <https://dev.twitch.tv/docs/authentication/refresh-tokens/>,
  <https://dev.twitch.tv/docs/authentication/revoke-tokens/>
- Creator Camp, Extensions (Twitch-owned, for streamers): <https://www.twitch.tv/creatorcamp/level1/monetization/extensions/>

## Short answer

1. **Switching it on takes two halves, and the game can do only one of them.**
   - On Twitch, the operator installs the extension and activates it in the single
     overlay slot, in the Extension Manager of their dashboard. No Helix endpoint
     installs an extension. Update User Extensions can activate one that is already
     installed, but it needs an extra scope, and it fails with 409 if the extension
     isn't installed. **[verified]**
   - In the game, the operator switches the extension on and logs in to Twitch once.
     The game then opens its socket to the extension backend (#169). **[code + #169]**
2. **Where:** a new **Twitch extension** step in the setup wizard, after the chat
   source's own step, shown for both chat sources. Race setup keeps only what it
   already has: each Bits event switched on or off, as an audience interaction. Logging
   in shows a code that OBS captures, so it belongs in setup, which already warns "Do
   this off stream", and not in race setup between races. **[inference from code]**
3. **Streamer.bot operators** get the same device-code button the Twitch-direct step
   already has. Today the game refreshes and validates the token only inside the
   Twitch-direct chat source, so the login has to move out of it for this to work.
   **[code]**
4. **Checking it works:**
   - The game asks Twitch, with the operator's own token and no extra scope, whether the
     extension sits in the channel's overlay slot (Get User Active Extensions). **[verified]**
   - The backend confirms the game's socket is bound to the channel. **[inference]**
   - The step shows both results as chips, and links to the extension's Twitch page.
5. **Switching it off:**
   - In the game, switching it off closes the socket, so the rail draws nothing.
   - On Twitch, the operator deactivates or uninstalls it in the Extension Manager.
   - Logging out revokes the token (`/oauth2/revoke`), or the operator disconnects
     the app on Twitch's Connections page. The game has no log-out button today.
     **[verified + code]**

## Decisions (grilling, 2026-11-21)

These settle §3 and the open questions; where they differ from the proposal below,
they win.

1. **Activation stays on Twitch.** The operator installs and activates the extension
   in the overlay slot by hand. The game never writes the slot (no Update User
   Extensions), and there is no required-configuration gate.
2. **Setup step.** A new **Twitch extension** step after the chat source's step, for
   either chat source. On the first start after the update, setup opens by itself
   once, on that step; if the operator leaves it off, it doesn't open itself again.
   Switching the extension off lives only there (`F2`), not in race setup.
3. **One Twitch login.** Twitch direct and the extension share it. It asks for the
   same scopes whichever chat source is picked (today's Twitch-direct set): an operator
   who switches the extension on streams on Twitch. Refresh and hourly validation move
   out of `connectTwitch` into their own module. The backend accepts only tokens whose
   `client_id` is `TWITCH_CLIENT_ID`. A **Log out of Twitch** button revokes the token,
   and says it also stops Twitch-direct chat.
4. **Walkthrough.** After the login, the step walks the operator through Twitch as a
   checklist, refreshed while the step is open, in text and links only (no
   screenshots):
   1. *Install*: link to `https://www.twitch.tv/ext/<id>`.
   2. *Activate as Overlay*: link to the Extension Manager. If the overlay slot holds
      another extension, name it and warn that Rhino Race replaces it (from Get User
      Active Extensions, no extra scope).
   3. *Check*: ticks itself when the extension is active in the overlay slot.

   No separate "installed" tick: it would need `user:read:broadcast`, and every
   logged-in Twitch-direct operator would log in again.
5. **Status chips.** **Twitch** ("Not active in your overlay slot" / "Active") and
   **Game link** ("Connecting…" / "Linked to <channel>" / "Refused"). The trial race is
   not offered as the way to test the extension.
6. **When the rail shows.** Only while the game window is open with the extension
   switched on, in races and race setup alike. Otherwise it draws nothing at all: game
   closed, crashed (aim: gone within about 10 s), switched off, or a trial race. This
   drops the idle state planned in #166. Before an RA2 showmatch the operator closes
   Rhino Race or switches the extension off; hiding even Twitch's own player chrome
   means deactivating it on Twitch. The game doesn't follow the OBS scene.
7. **Link down mid-race.** An "EXTENSION OFFLINE" tag shows on stream beside the
   chat offline marker; the race carries on and the game reconnects with growing waits.

Still to check while building:
- Whether Twitch's player shows the extension's icon on hover while the rail draws
  nothing.
- That Bits spent in the extension never reach Streamer.bot as a chat cheer (expected:
  EventSub's `channel.cheer` is chat only), so nothing counts twice. **[unverified]**
- Whether activating the overlay also turns on the mobile view.
- The dashboard's exact labels for installing, activating, deactivating and
  uninstalling, on a real channel, before the walkthrough names them.
- The scope question is moot: every login asks for the Twitch-direct set.

## 1. What Twitch lets the operator and the game do

### Installing and activating (operator, on Twitch)

- Twitch's own walkthrough: "Click **View on Twitch and Install** to add your extension
  to your channel", then "click the **Activate** button on your extension. Choose a slot
  for the extension." ([Extensions guide](https://dev.twitch.tv/docs/extensions/))
  **[verified]**
- Streamers manage extensions in the Extension Manager at `dashboard.twitch.tv/extensions`.
  A channel can have up to six active at once: "three Panel Extensions, two Component
  Extensions, and one overlay Extension"
  ([Creator Camp](https://www.twitch.tv/creatorcamp/level1/monetization/extensions/)).
  **[verified]**
- Get User Active Extensions confirms the single overlay slot: "The dictionary always
  contains the key 1, for the single overlay slot"
  ([Users reference](https://dev.twitch.tv/docs/api/reference/users/#get-user-active-extensions)).
  **[verified]** So an operator who already runs another overlay extension, such as a
  Streamlabs one, has to give that slot up for Rhino Race. **[inference]**
- A released extension with a blank Streamer Allowlist can be installed by "any Twitch
  user ... using the Extension Discovery Directory"
  ([Life cycle](https://dev.twitch.tv/docs/extensions/life-cycle/)). **[verified]**
- Twitch's own docs link an extension's page as `https://www.twitch.tv/ext/<extension id>`
  (the Hearthstone Deck Tracker link in the
  [Extensions guide](https://dev.twitch.tv/docs/extensions/)). The setup step can link
  there. **[verified as used; no page documents the URL pattern]**
- I could not read the step-by-step streamer article on help.twitch.tv: it renders only
  with JavaScript. The exact menu labels for deactivating and uninstalling come from
  the API's model (`active: false`) and the dashboard, not from a page I could read.
  **[unverified]**

### Activating from the game (possible, not recommended)

- Update User Extensions (`PUT /helix/users/extensions`) sets a slot's `active`, `id`
  and `version`. It needs `user:edit:broadcast` or `channel:manage:extensions`. It
  returns 409 if "The extension that you're activating isn't installed on the
  broadcaster's channel"
  ([Users reference](https://dev.twitch.tv/docs/api/reference/users/#update-user-extensions)).
  **[verified]**
- So the game could flip the overlay slot on and off itself. But the operator still has
  to install the extension by hand. The scope is broad ("View and edit a user's
  broadcasting configuration", [Scopes](https://dev.twitch.tv/docs/authentication/scopes/)),
  and a write would replace whatever overlay the channel has. **[inference]**
  Recommendation: don't. Let the operator activate it on Twitch.

### Reading the state (game, no extra scope)

- Get User Active Extensions accepts any user access token, with no scope. Without
  `user_id`, "the API uses the user ID from the access token." For an unreleased version
  (Hosted Test), it is listed only if the token's user is on the Testing Account
  Allowlist; otherwise "its slot contains only the `active` field, set to **false**"
  ([Users reference](https://dev.twitch.tv/docs/api/reference/users/#get-user-active-extensions)).
  **[verified]**
- So the game can check `data.overlay["1"].id === <our extension id>` with the token it
  already holds. **[inference]**
- Get User Extensions also lists installed but inactive extensions, with `can_activate`.
  It needs `user:read:broadcast`, `user:edit:broadcast` or `channel:manage:extensions`
  ([same page](https://dev.twitch.tv/docs/api/reference/users/#get-user-extensions)).
  **[verified]** Only worth adding if "installed, not activated" deserves its own
  message. **[inference]**
- The backend can call Get Extension Live Channels, but "It may take a few minutes" to
  update ([Extensions reference](https://dev.twitch.tv/docs/api/reference/extensions/#get-extension-live-channels)).
  **[verified]** That's too slow for a setup check.

### Required configuration (option: gate activation on the game link)

- An extension can "require that a broadcaster successfully configures your extension
  before activation is allowed". The EBS then calls Set Extension Required Configuration
  ([Building](https://dev.twitch.tv/docs/extensions/building/#required-configurations)).
  This needs **Custom/My Own Service** in Capabilities, and an `external` JWT signed
  with the secret
  ([Extensions reference](https://dev.twitch.tv/docs/api/reference/extensions/#set-extension-required-configuration)).
  **[verified]**
- The Config Path page "is shown to streamers while they are configuring the Extension
  but before activating it" ([Life cycle](https://dev.twitch.tv/docs/extensions/life-cycle/)).
  It runs with the broadcaster's JWT (`role: broadcaster`, `opaque_user_id` "U" + their
  user ID, [reference JWT schema](https://dev.twitch.tv/docs/extensions/reference/#jwt-schema)).
  **[verified]**
- Possible use **[inference]**:
  - The backend sets the required string for a channel the first time a game connects
    for it.
  - Until then, the config page says "Start Rhino Race and switch on the extension in
    setup (F2)", and Twitch won't let the operator activate the extension.
  - This makes the order explicit (install, link the game, activate), and the config
    page can show "Rhino Race connected" live.
- Costs:
  - Review requires "Extensions must be able to be configured within the review channel
    dashboard without error" (guideline 1.5,
    [Guidelines](https://dev.twitch.tv/docs/extensions/guidelines-and-policies/)), so
    the review channel must run the game. #166 already needs that. **[verified]**
  - A new version with a new string makes every channel configure it again
    ([Building](https://dev.twitch.tv/docs/extensions/building/#required-configurations)).
    **[verified]**
- Guideline 4.7 allows requiring the broadcaster to run other software: "Extensions may
  require broadcasters to download third-party software in order to function"
  ([Guidelines](https://dev.twitch.tv/docs/extensions/guidelines-and-policies/)).
  **[verified]**

### Testing before release

- In Local Test or Hosted Test, only accounts on the Testing Account Allowlist (and the
  owner by default) can install, activate and see the extension; other viewers see
  nothing ([Life cycle](https://dev.twitch.tv/docs/extensions/life-cycle/)).
  **[verified]** So a test operator's channel ID has to be on that list.
- **Ambiguity:** the same field's text says both "If this is list empty or missing, all
  streamers can use the Extension" and "Adding IDs here prevents streamers outside the
  allowlist from installing the Extension once it is approved". I read it as describing
  after-release behaviour, but the page doesn't say so plainly. **[unverified]**

## 2. The login, for either chat source

What the code does today **[code]**:
- `loginTwitch()` in `src/chat/twitch.ts` runs the device code flow with the scopes
  `user:read:chat channel:manage:redemptions bits:read`. It stores the tokens under
  `rhino-twitch-login`.
- Refreshing (`refresh`) and the hourly `/validate` exist only inside `connectTwitch()`.
  `src/main.ts` calls that only when `chatSource() === 'twitch'`.
- The wizard shows the `twitch` step only for that source (`wizardSteps` in
  `src/install/wizard.ts`). The step warns "Do this off stream: the login code shows in
  this window, which OBS captures."

What Twitch requires:
- Access tokens from the device flow last "4 hours". Public-client refresh tokens are
  "one time use only" and expire after 30 days
  ([OAuth, device code](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow)).
  **[verified]**
  - **Ambiguity:** that page says 30 days of being *inactive*, while
    [Refresh tokens](https://dev.twitch.tv/docs/authentication/refresh-tokens/) says
    "30 days after they are generated".
  - Either way, an operator who doesn't start the game for a month logs in again.
- Apps "must validate the OAuth token when it starts and on an hourly basis thereafter".
  If the user disconnects, "your app must end all sessions that use the token"
  ([Validate](https://dev.twitch.tv/docs/authentication/validate-tokens/)). **[verified]**
- `/validate` returns `client_id`, `login`, `scopes`, `user_id` and `expires_in`
  ([Validate](https://dev.twitch.tv/docs/authentication/validate-tokens/)). **[verified]**
- The device flow's `scopes` parameter is marked Required
  ([OAuth](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#device-code-grant-flow)).
  **[verified]** I found nothing on whether an empty list is accepted. **[unverified]**

Consequences **[inference]**:
- **One login, shared.** Move the stored login, refresh and hourly validation out of
  `connectTwitch` into a small module. Both the Twitch-direct chat source and the
  extension link use it. Otherwise a Streamer.bot operator's token expires after 4
  hours and nothing refreshes it.
- **Scopes for Streamer.bot operators.** They don't need redemption or chat scopes for
  the extension. The checks in §1 need no scope at all. Ask for the narrowest scope
  that works: one harmless read scope, or `user:read:broadcast` if "installed, not
  activated" gets its own message. A Twitch-direct operator keeps their current scopes.
  Their existing token already works for the extension, so they don't log in again.
- **The backend must check `client_id`.** It should accept only tokens whose `client_id`
  is the game's app (`TWITCH_CLIENT_ID`). Otherwise any app's token for a user would
  bind that user's channel. #169 said the backend checks the token "once"; this adds
  one comparison.
- **Expiry while connected.** The backend checks the token only when the socket
  connects. The game keeps validating hourly, closes the socket when the token is
  invalid, and reconnects with the refreshed token. That meets "end all sessions".

## 3. Proposed operator flow

These are suggestions for the grilling, built on the facts above. **[inference]**

**Setup wizard, new step "Twitch extension"** (after the chat source's own step,
before OBS):
1. A switch: *Use the Twitch extension*. If it's off, the step is information only and
   Next is allowed.
2. If it's on and there is no login: the same *Log in to Twitch* button and off-stream
   warning as the Twitch step. Twitch-direct operators already logged in skip this.
3. Two status chips, refreshed while the step is open:
   - **Twitch:** "Not installed or not active" / "Active in your overlay slot", from Get
     User Active Extensions.
   - **Backend:** "Connecting…" / "Linked to <login>" / "Refused", from the socket.
4. A link to `https://www.twitch.tv/ext/<id>` with three lines: install, activate as
   **Overlay**, and that this replaces any other overlay extension.
5. Hint: open your channel while live to see the rail. Bits buttons show only on
   Affiliate and Partner channels (#166).

**Race setup (`S`)**: unchanged in kind. The Bits events are the paid events it already
switches on or off (`src/race/operator.ts`, `src/race/race.ts`). There's no extension
switch here: switching on needs a login, and that belongs off stream in setup.

**Switching off:**
- *Game:* turn the switch off in setup (`F2`). The socket closes, and the backend tells
  viewers the game isn't running, so the rail shows its idle state. An extension can't
  hide itself, only `minimize()` (#166).
- *Twitch:* deactivate or uninstall in the Extension Manager.
- *Account:* a *Log out of Twitch* action calls `POST /oauth2/revoke` with `client_id`
  and the token ([Revoke](https://dev.twitch.tv/docs/authentication/revoke-tokens/))
  and clears `rhino-twitch-login`. The game has nothing like it today **[code]**. The
  operator can also click Disconnect under Other Connections at
  `twitch.tv/settings/connections`, which "invalidates the access tokens"
  ([Validate](https://dev.twitch.tv/docs/authentication/validate-tokens/)). **[verified]**
  For a Twitch-direct operator, logging out also stops the chat source, so the button
  should say so.

## Open questions

Answered in [Decisions](#decisions-grilling-2026-11-21); kept as they were asked.

- **Gate activation with required configuration?** Activation would only be possible
  once the game has connected for that channel. That gives a clear order and a live
  "connected" config page, at the cost of a review channel running the game (already
  needed) and reconfiguring on versions that change the string. Or let the operator
  activate freely and rely on the idle rail.
- **Scope for Streamer.bot operators:** which single scope to request, given that the
  device flow requires `scopes` and empty is unverified. Is "installed but not
  activated" worth `user:read:broadcast`?
- **Mobile view:** Get User Extensions lists `mobile` as a type, but Get User Active
  Extensions has no mobile slot. I couldn't verify whether the overlay activation also
  turns on the mobile view or needs a step of its own. **[unverified]**
- **Overlay when offline:** #166 says overlays disable themselves when the broadcaster
  goes offline, citing the Designing page. I couldn't find that sentence on the current
  page. That matters for "open your channel to check": the operator may have to be live
  to see the rail. **[unverified]**
- **Exact dashboard labels** for deactivating and uninstalling: help.twitch.tv didn't
  render for fetching. They need a manual check on a real dashboard before the setup
  text names them.
- **Trial race:** the extension can't reach a trial race from chat, and Bits must stay
  hidden. That's left to the map's "Trial race" ticket, but the setup step should not
  offer the trial race as the way to test the extension.
