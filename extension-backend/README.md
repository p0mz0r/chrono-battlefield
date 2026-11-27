# Extension backend

The Cloudflare Worker between Rhino Race and its Twitch extension (#187). The game links to `/game` over a WebSocket,
offering the subprotocol `rhino-game` and the operator's Twitch token. The Worker checks the token once against
`/oauth2/validate` (it must come from the game's own Twitch app), hands the socket to that channel's Durable Object
and forgets the token. The object passes each snapshot to the channel's viewers as one Extension PubSub broadcast.

- Tests run with the game's: `npm test` at the repo root.
- The extension secret lives only in the Worker's environment: `npx wrangler secret put EXTENSION_SECRET`. For
  `wrangler dev`, put it in `.dev.vars` here, which Git ignores.
