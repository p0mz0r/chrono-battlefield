# Streamer.bot settle action

On the Streamer.bot chat source ([ADR 0008](adr/0008-streamer-bot-or-twitch-direct.md)), the game settles each redemption by sending `DoAction` over Streamer.bot's WebSocket to one action the operator imports. This is the contract that action must meet (`src/chat/streamerBot.ts`).

## The request

```json
{
  "request": "DoAction",
  "id": "rhino-settle-<redemptionId>",
  "action": { "name": "Rhino Race settle" },
  "args": { "redemptionId": "…", "rewardId": "…", "reward": "Kirov", "outcome": "fulfilled" }
}
```

The action is found by its **name**, `Rhino Race settle`, so the import must keep that name.

| Argument | Value |
|---|---|
| `redemptionId` | The Twitch redemption ID, from the `RewardRedemption` event's `id` (`redemptionId` in older Streamer.bot versions). |
| `rewardId` | The Twitch reward ID, from the event's `reward.id`. |
| `reward` | The reward title as Twitch sent it, for logs only. |
| `outcome` | `fulfilled` when the paid event landed; `refunded` when it fizzled, was still waiting at race end, arrived outside a race or is switched off in race setup. |

The action should mark the redemption fulfilled (C# `TwitchRedemptionFulfill`, or the Update Redemption Status sub-action) or cancel it, which refunds the points (`TwitchRedemptionCancel`). Both work only on rewards created in Streamer.bot.

Cheers are never settled, and YouTube and Kick paid events are ignored.

## The shipped action

The action is one Execute C# Code sub-action, with no trigger, in `src/chat/settleAction.cs`. Its import string, `src/chat/settleAction.sb`, is built from that file by `node tools/streamer-bot-action.mjs`; rerun it after any change to the C#, and a test fails until you do. Install setup (`F2`) shows the string for copying, and the operator pastes it into Streamer.bot's Import. A refusal from Twitch, or an unknown `outcome`, is logged as a warning in Streamer.bot's log. Verified on Streamer.bot 1.0.7 against real redemptions: one refunded outside a race, one fulfilled when its Chrono swap landed.

## Reward titles

Decided in [#102](https://github.com/p0mz0r/chrono-battlefield/issues/102) ([research](research/channel-point-reward-titles.md)); the strings live in `REWARDS` in `src/race/race.ts`, and install setup (`F2`) lists them for copying when Streamer.bot is picked. The operator must create the rewards with Streamer.bot's Create Reward button, since only rewards Streamer.bot created can be fulfilled or refunded.

A redemption reaches the game only if its reward title matches one of these after trimming and ignoring case; inner spacing must match exactly. Any other title is ignored: no settlement, no feed line, no hype.

| Title | Paid event | Prompt |
|---|---|---|
| Kirov | Kirov airship | A Kirov airship hovers ahead of the leading tank and bombs every tank that comes near: stunned and knocked back. Shields block it. Refunded if no tank comes near. |
| Desolator | Desolator | Radiation lands on the track just ahead of the leading tank for about 15 s and slows every tank in it, most at its centre. Shields ignore it. |
| Chronosphere | Chrono swap | Swaps two random tanks still racing: one from the front half of the standings, one from the back half. Shielded tanks are safe. |

A cheer sets off a Chrono swap only at exactly the price set in race setup.

## Connection

The game connects to `ws://127.0.0.1:8080/` (Streamer.bot's defaults) and subscribes to `Twitch.ChatMessage`, `Twitch.RewardRedemption`, `Twitch.Cheer`, `YouTube.Message` and `Kick.ChatMessage`. A WebSocket password with "Enforce" is not supported yet. If the connection drops, the "chat offline" marker shows and the game retries after 1, 2, 4 … up to 30 seconds; settlements made meanwhile go out once it is back.

Unsettled redemptions are kept in the browser's storage. If the page reloads before one is settled, the race it was for is gone, so the game refunds it once it reaches Streamer.bot again. One whose event landed just before the reload is refunded too.
