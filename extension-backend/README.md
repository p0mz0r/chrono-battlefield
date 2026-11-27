# Extension backend

The Cloudflare Worker between Rhino Race and its Twitch extension (#187). The game links to `/game` over a WebSocket,
offering the subprotocol `rhino-game` and the operator's Twitch token. The Worker checks the token once against
`/oauth2/validate` (it must come from the game's own Twitch app), hands the socket to that channel's Durable Object
and forgets the token. The object passes each snapshot to the channel's viewers as one Extension PubSub broadcast.

Viewers' button presses come in at `POST /press` with their `onAuthorized` JWT and `{command}`. The Worker checks the JWT
against the extension secret and needs a `user_id` (the viewer shared identity). The channel's object names the viewer
with Get Users, sends the press to the game with a request ID and answers with the game's reply, "Game offline" when no
game is linked, "Twitch didn't answer" when Get Users fails, or "No answer" after 3 s.

Bits purchases come in at `POST /bits` with the viewer's JWT (it names the channel) and `{receipt}`, the signed receipt
from `onTransactionComplete`. The Worker checks the receipt against the extension secret and the catalog (SKU and price
from `CHEER_PRICES`); the object sends it to the game once per transaction ID, which plays it as an extension cheer. With
no game linked it answers "Game offline" and the purchase is lost: nothing is stored or redelivered (#173).

- Tests run with the game's: `npm test` at the repo root.
- Two secrets live only in the Worker's environment: the extension secret (`npx wrangler secret put EXTENSION_SECRET`)
  and the extension's Twitch API client secret, for Get Users (`npx wrangler secret put EXTENSION_CLIENT_SECRET`). For
  `wrangler dev`, put them in `.dev.vars` here, which Git ignores.
