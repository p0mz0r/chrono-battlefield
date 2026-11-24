# Chat reaches the game through Streamer.bot or Twitch direct, never anonymous IRC

The operator picks one chat source in setup (`F2`), never both, so a line can't arrive twice ([#90](https://github.com/p0mz0r/chrono-battlefield/issues/90)):

- **Streamer.bot:** the game connects to its local WebSocket (`ws://127.0.0.1:8080`). It gets chat from every platform the operator connected there, plus Twitch redemptions and cheers. Streamer.bot can't create rewards over its WebSocket. So the operator creates the game's rewards there under fixed titles and imports one action, and the game sends `DoAction` to that action to fulfil or refund each redemption.
- **Twitch direct:** for streamers without Streamer.bot. The operator logs in once with the device code flow, and EventSub carries chat, redemptions and cheers. The game creates its own rewards, because only the app that created a reward may refund its redemptions. Cost and on/off stay in Twitch's dashboard. The game refreshes tokens, validates them hourly and stores them in `localStorage`.

We dropped anonymous `justinfan` IRC, although it needs no setup at all ([research for #86](https://github.com/p0mz0r/chrono-battlefield/blob/research/twitch-chat-intake/docs/research/twitch-chat-intake.md)). Twitch doesn't document it, it can't carry redemptions, and it would be a third parser and reconnect path. Its only saving is the one device code a direct streamer types.

`viewerId` is the platform plus that platform's user ID (`twitch:123`). The same person on two platforms is two viewers, since nothing links their accounts. Other platforms get chat commands only for now. Their paid events (Super Chats, Kick's paid items) are ignored until a later ticket maps them.

The `chronoChat` page event, which Streamer.bot could fire through obs-websocket, went with the browser source ([ADR 0009](0009-launcher-runs-the-game-in-an-edge-app-window.md)); it was chat only, and the fallback if OBS started blocking the loopback socket, which today works only through obs-browser changes OBS calls temporary ([OBS socket test](../research/obs-local-file-sockets.md)).

Update ([#184](https://github.com/p0mz0r/chrono-battlefield/issues/184)): paid events are cheers only, so the game has no rewards for now. The redemption and settlement path, the `channel:manage:redemptions` scope and the settle action stay for channel-point rewards to come. Twitch direct refunds the waiting redemptions of the old Kirov, Desolator and Chronosphere rewards and then deletes them; Streamer.bot refunds their redemptions until the streamer deletes them.

## Considered Options

- **Anonymous IRC for chat plus Streamer.bot for paid tiers:** works with no login, but rests on an undocumented endpoint and leaves streamers without Streamer.bot no channel points.
- **Twitch direct only:** one code path, but it ties the game to Twitch and to our app's token handling, while many streamers already run Streamer.bot with YouTube and Kick connected.
- **Both sources at once:** every Twitch line would arrive twice and need de-duplicating, for no gain.
