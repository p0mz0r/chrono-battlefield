# Streamer.bot settle action

On the Streamer.bot chat source ([ADR 0008](adr/0008-streamer-bot-or-twitch-direct.md)), the game settles each redemption by sending `DoAction` over Streamer.bot's WebSocket to one action the operator imports. This is the contract that action must meet (`src/chat/streamerBot.ts`).

## The request

```json
{
  "request": "DoAction",
  "id": "rhino-settle-<redemptionId>",
  "action": { "name": "Rhino Race settle" },
  "args": { "redemptionId": "…", "rewardId": "…", "reward": "Kirov airship", "outcome": "fulfilled" }
}
```

The action is found by its **name**, `Rhino Race settle`, so the import must keep that name.

| Argument | Value |
|---|---|
| `redemptionId` | The Twitch redemption ID, from the `RewardRedemption` event's `redemptionId`. |
| `rewardId` | The Twitch reward ID, from the event's `reward.id`. |
| `reward` | The reward title as Twitch sent it, for logs only. |
| `outcome` | `fulfilled` when the paid event landed; `refunded` when it fizzled, was still waiting at race end, arrived outside a race or is switched off in race setup. |

The action should mark the redemption fulfilled (C# `TwitchRedemptionFulfill`, or the Update Redemption Status sub-action) or cancel it, which refunds the points (`TwitchRedemptionCancel`). Both work only on rewards created in Streamer.bot.

Cheers are never settled, and YouTube and Kick paid events are ignored.

## Reward titles

A redemption reaches the game only if its reward title is one of these, ignoring case and extra spaces; any other title is ignored and never settled. The titles are placeholders until [#102](https://github.com/p0mz0r/chrono-battlefield/issues/102) fixes them.

| Title | Paid event |
|---|---|
| Kirov airship | Kirov airship |
| Desolator | Desolator |
| Chrono swap | Chrono swap |

A cheer sets off a Chrono swap only at exactly the price set in race setup.

## Connection

The game connects to `ws://127.0.0.1:8080/` (Streamer.bot's defaults) and subscribes to `Twitch.ChatMessage`, `Twitch.RewardRedemption`, `Twitch.Cheer`, `YouTube.Message` and `Kick.ChatMessage`. A WebSocket password with "Enforce" is not supported yet. If the connection drops, the "chat offline" marker shows and the game retries after 1, 2, 4 … up to 30 seconds; settlements made meanwhile go out once it is back.
