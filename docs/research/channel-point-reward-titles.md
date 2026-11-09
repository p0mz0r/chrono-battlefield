# Research: titles and prompts for the game's channel-point rewards

Answers #102 ("Which titles do the game's channel-point rewards use?") for the
chat sources in #101 and [ADR 0008](../adr/0008-streamer-bot-or-twitch-direct.md).
Researched 2026-11-09.

Each claim is tagged **[verified]** (read in a primary source, linked),
**[inference]** (reasoned from verified facts, not tested) or **[unverified]** (not
in any primary source we found). Nothing here was tried against a real channel.

Sources:
- Twitch Helix API reference: <https://dev.twitch.tv/docs/api/reference/>
  (sections Create Custom Rewards, Update Custom Reward, Get Custom Reward, Update
  Redemption Status)
- Twitch EventSub reference: <https://dev.twitch.tv/docs/eventsub/eventsub-reference/>
  and subscription types: <https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/>
- Streamer.bot docs: <https://docs.streamer.bot/>, pages linked below

## TL;DR

1. A title is 1–45 characters and must be unique among the broadcaster's custom
   rewards. A prompt is at most 200 characters. A channel holds at most 50 rewards,
   enabled or not. **[verified]**
2. Twitch documents neither trimming nor case folding of titles, nor whether
   uniqueness ignores case. **[unverified]** So the game should not rely on either.
3. Both chat sources deliver the reward's **id, title and prompt** with each
   redemption. **[verified]** Twitch direct can match by reward id, since the game
   created the rewards and stored their ids. Streamer.bot has to match by title,
   because the operator creates the rewards there by hand.
4. Only the app that created a reward may update it or settle its redemptions. In
   Streamer.bot, the Update Redemption Status sub-action works only on rewards
   Streamer.bot created. **[verified]**
5. Recommendation (owner's choice): titles `Kirov`, `Desolator`, `Chronosphere`.
   Match by trimmed, case-insensitive title on
   Streamer.bot and by stored reward id on Twitch direct. A redemption that matches
   no event is ignored: no settlement, no feed line, no hype.

## 1. Twitch: creating and updating rewards (Helix)

- "The maximum number of custom rewards per channel is 50, which includes both
  enabled and disabled rewards." Creating needs a user token with
  `channel:manage:redemptions`. **[verified]** Create Custom Rewards.
- `title`: "The custom reward's title. The title may contain a maximum of 45
  characters and it must be unique amongst all of the broadcaster's custom rewards."
  The 400 list adds: "The title must contain a minimum of 1 character and a
  maximum of 45 characters." **[verified]** Create Custom Rewards.
- A duplicate title, or a 51st reward, returns **400 Bad Request**. The docs give no
  separate error code for either case. **[verified]** The 400 list reads "The request
  exceeds the maximum number of rewards allowed per channel … The title must be
  unique amongst all of the broadcaster's custom rewards." The string
  `CREATE_CUSTOM_REWARD_DUPLICATE_REWARD` is not in the reference. **[unverified]**
  Do not branch on it.
- `prompt`: "The prompt shown to the viewer when they redeem the reward. Specify a
  prompt if is_user_input_required is true. The prompt is limited to a maximum of 200
  characters." **[verified]** EventSub calls the same field "The reward description."
  **[verified]** EventSub reference, Reward object. So a prompt also works as a plain
  description when no input is required. **[inference]**
- Other fields: `cost` (Int64, required, minimum 1); `is_enabled` (default true);
  `is_user_input_required` (default false); `is_global_cooldown_enabled` with
  `global_cooldown_seconds` ("minimum value is 1; however, the minimum value is 60 for
  it to be shown in the Twitch UX"); `is_max_per_stream_enabled`/`max_per_stream`;
  `is_max_per_user_per_stream_enabled`/`max_per_user_per_stream`;
  `should_redemptions_skip_request_queue` (default false: "status is set to
  UNFULFILLED and follows the normal request queue process"); `background_color`.
  **[verified]** Create Custom Rewards.
- Update Custom Reward: "The app used to create the reward is the only app that may
  update the reward." Its title and prompt rules are the same as on create. Its 403
  reads "The ID in the Client-Id header must match the client ID used to create the
  custom reward." **[verified]**
- Get Custom Reward's `only_manageable_rewards=true` returns "only the custom rewards
  that the app may manage (the app is identified by the ID in the Client-Id
  header)". **[verified]** So the game can find its own rewards again after it loses
  the stored ids.
- **Trimming and case:** the reference doesn't say whether Twitch trims a title,
  folds its case or counts the 45 characters as UTF-16 units or code points.
  **[unverified]** It also doesn't say whether two titles that differ only in case
  count as duplicates. **[unverified]** Keeping titles ASCII and short avoids the
  counting question. **[inference]**

## 2. Twitch: redemptions and settling them

- `channel.channel_points_custom_reward_redemption.add` v1: "A viewer has redeemed a
  custom channel points reward on the specified channel." Its condition is
  `broadcaster_user_id` plus an optional `reward_id` ("Specify a reward id to only
  receive notifications for a specific reward"). **[verified]** Subscription types.
- The event carries the redemption `id`, `user_id`/`user_login`/`user_name`,
  `user_input`, `status` (default `unfulfilled`), `redeemed_at` and `reward`: "Basic
  information about the reward that was redeemed, at the time it was redeemed." The
  Reward object has `id`, `title` ("The reward name"), `cost` and `prompt` ("The
  reward description"). **[verified]** EventSub reference.
- So the title in the event is whatever the reward was called at redemption time. If
  the streamer renames a reward, a title match stops working, but an id match keeps
  working. **[inference]**
- Update Redemption Status: "You may update a redemption only if its status is
  UNFULFILLED. The app used to create the reward is the only app that may update the
  redemption." Status is `CANCELED` or `FULFILLED`. "Setting the status to CANCELED
  refunds the user's channel points." The 403 needs the client ID that created the
  reward. The 404 means the redemptions "were not found or their statuses weren't
  marked as UNFULFILLED". **[verified]**
- The game therefore can't refund a redemption of a reward someone else created,
  such as the streamer's own "Hydrate". **[verified, from the rule above]**
- Delete Custom Reward: "The app used to create the reward is the only app that may
  delete it. If the reward's redemption status is UNFULFILLED at the time the reward
  is deleted, its redemption status is marked as FULFILLED." **[verified]**

## 3. Streamer.bot

- The Reward Redemption trigger's variables include `rewardId` ("The unique
  identifier for the reward"), `rewardName` ("The name of the reward"),
  `rewardPrompt` ("The description of the reward"), `rewardCost`, `redemptionId`,
  `rawInput`, `requiresUserInput`, `skipsQueue` and `globalCooldown`. The trigger
  page has a "Create Reward" button. **[verified]**
  <https://docs.streamer.bot/api/triggers/twitch/channel-reward/reward-redemption>
- The WebSocket `Twitch.RewardRedemption` event schema has a top-level
  `redemptionId`, plus `user` (`id`, `login`, `name`), `userInput`, `status` and
  `reward` with `id`, `title`, `prompt`, `cost`, `requiresUserInput`, `skipsQueue`,
  `globalCooldown` and `isOurs`. **[verified, schema only]** The example payload has
  `reward: null`, and no field has a prose description.
  <https://docs.streamer.bot/api/websocket/events/twitch/reward-redemption>
  `isOurs` most likely means "created by Streamer.bot". **[inference]** It is not
  described anywhere.
- Update Redemption Status sub-action: "A redeem must be originally created by
  Streamer.bot for this sub-action to work." "Cancel" is "Cancel the reward
  redemption, refunding any channel points spent". **[verified]**
  <https://docs.streamer.bot/api/sub-actions/twitch/rewards/update-redemption-status>
- C# `TwitchRedemptionCancel(string rewardId, string redemptionId)` "Will refund the
  Twitch reward". It needs both ids. **[verified]**
  <https://docs.streamer.bot/api/csharp/methods/twitch/channel-reward/twitch-redemption-cancel>
  So the game's opaque redemption reference on this source has to carry `rewardId`
  as well as `redemptionId`. **[inference]**
- Twitch guide: Streamer.bot "will automatically pull a list of currently configured
  rewards from the account". "You can also Add or Delete rewards directly from
  Streamer.bot". "It is highly recommended to recreate your existing rewards through
  Streamer.bot. This grants reward ownership to your bot, which is required to enable
  all functionality." **[verified]** <https://docs.streamer.bot/guide/platforms/twitch/>
- Streamer.bot documents nothing about trimming or case handling of reward names.
  **[unverified]** We found no WebSocket request that creates a reward (consistent
  with ADR 0008). **[verified, absence]**

## 4. What the repo already does

- The big events and their on-stream labels are in `src/race/race.ts:47`
  (`BIG_EVENTS`): `chronoSwap` "CHRONO SWAP", `kirov` "KIROV", `desolator`
  "DESOLATOR", `nuke` "NUKE". Race setup's toggles reuse these labels in lower case
  (`src/race/operator.ts:130`).
- The paid entry `PaidLine` (`src/race/race.ts:89-99`) already takes a `BigEvent`
  plus an opaque `reference`, and `Settlement` (`src/race/race.ts:101-104`) returns
  `fulfilled | refunded`. So title-to-event mapping belongs in the chat source, not
  in the race. `paid()` (`src/race/race.ts:388`) refunds a redemption when its
  event is switched off or it arrives outside `racing`.
- Fizzles refund (`src/race/race.ts:594-603`). The Kirov leaves refunded if no tank
  comes near in time (`src/race/race.ts:540`). Chrono swap picks only unfinished,
  unshielded tanks (`src/race/race.ts:613`). Radiation spares shielded tanks
  (`src/race/race.ts:893-895`).
- No chat source module exists yet. The dev panel calls `paid()` straight with
  `reference: dev:N` (`src/race/devPanel.ts:51-59`), and `chronoChat`
  (`src/main.ts:511`) is chat only. No reward titles appear anywhere in the source.

## 5. Options / recommendation

### Exact titles: name the effect or the target?

Short bare names, chosen by the owner: the description carries the effect, and
the title stays the word viewers know from RA2. All three are ASCII and well under
45 characters:

| Event | Title | Chars |
|---|---|---|
| `kirov` | `Kirov` | 5 |
| `desolator` | `Desolator` | 9 |
| `chronoSwap` | `Chronosphere` | 12 |

- Short titles are more likely to clash with a reward the streamer already has (a
  duplicate is a 400 on Twitch direct, and an ambiguous match on Streamer.bot).
  The setup list should say so when creating a reward fails.
- `Chronosphere` is also the glossary's name for the personal interaction `!chrono`
  (GLOSSARY.md, Chronosphere; Chrono swap lists it under _Avoid_). The reward
  title is viewer-facing only; code, banner and feed keep "Chrono swap".
- Considered and dropped: titles naming the target (`Kirov airship on the
  leader`), too long for the picker; a `Rhino Race:` prefix, 12 characters of
  repetition.

### Match rule, and unmatched redemptions

- **Twitch direct:** match by the reward **id** the game stored when it created the
  rewards, never by title. Renaming in the dashboard then can't break the match. If
  the stored ids are missing (for example after `localStorage` was cleared), call Get
  Custom Reward with `only_manageable_rewards=true` and adopt the game's own rewards
  by title before creating any. Otherwise creating would fail with 400 on the
  duplicate titles. **[inference]**
- **Streamer.bot:** match `reward.title` against the three titles after trimming
  and comparing case-insensitively (`trim().toLowerCase()`; the titles are ASCII).
  Loose matching forgives a stray capital or space that the operator typed. Since
  we don't know whether Twitch's own uniqueness ignores case, no stricter rule buys
  safety. **[inference]** Inner spacing stays exact: no collapsing of double spaces,
  so the rule stays one line.
- **No match:** ignore the redemption. Don't settle it, don't post a feed line and
  don't add hype. It is one of the streamer's other rewards, so refunding it would be
  wrong. On Twitch direct it is also impossible (403 for rewards the game didn't
  create). It stays UNFULFILLED in the streamer's queue for them to handle, as with
  redemptions made while chat is offline (#101 story 9).
- A matched reward that Streamer.bot didn't create (`isOurs` false, made in the
  Twitch dashboard) still plays, but its refund `DoAction` will fail. The setup list
  should tell the operator to create the rewards with Streamer.bot's
  Add / "Create Reward". Rejecting `isOurs: false` would rest on an undocumented
  field. **[inference]**

### Reward descriptions (prompts)

Set `is_user_input_required: false`. On Twitch direct the game sends these as
`prompt`. On Streamer.bot the setup list shows them for copying. All are under the
200-character limit and ASCII:

- Kirov (162): `A Kirov airship hovers ahead of the leading tank and bombs every
  tank that comes near: stunned and knocked back. Shields block it. Refunded if no
  tank comes near.`
- Desolator (141): `Radiation lands on the track just ahead of the leading tank for
  about 15 s and slows every tank in it, most at its centre. Shields ignore it.`
- Chrono swap (127): `Swaps two random tanks still racing: one from the front half of
  the standings, one from the back half. Shielded tanks are safe.`

Other fields: leave cost, cooldown and per-stream limits to the dashboard, as ADR
0008 says. The game sends only the required `cost`, with a starting value.
`should_redemptions_skip_request_queue` must stay `false`, or redemptions arrive
already FULFILLED and can't be refunded. **[inference from the 404 rule]**

### Does the setup list show the titles for copying?

Yes, for Streamer.bot: one row per paid event with its title and prompt, each with a
copy button, plus the importable action. These strings live in one constant beside
`BIG_EVENTS`, so the Twitch direct creator, the Streamer.bot matcher and the setup
list share them. On Twitch direct the list shows the same titles as created or
missing. Nothing to copy there.

### Still open

- Whether Twitch treats `kirov airship on the leader` as a duplicate of `Kirov
  airship on the leader`, and whether it trims titles. A one-off test on an
  Affiliate channel would settle this. It doesn't change the recommendation above.
- What `isOurs` means exactly in Streamer.bot's event.
