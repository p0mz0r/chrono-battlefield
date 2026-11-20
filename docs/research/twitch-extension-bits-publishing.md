# Research: publishing and monetizing a Bits extension on Twitch

Answers #166 ("What does Twitch require to publish and monetize a Bits
extension?") for the extension map #164. Researched 2026-11-20.

Each claim is tagged **[verified]** (read in a primary source, linked),
**[inference]** (reasoned from verified facts, not tested) or **[unverified]**
(not in any primary source we found, or only in forum or press posts). Nothing
here was tried against a real extension.

Sources:
- [B] Extensions Monetization Guide (Bits in Extensions): <https://dev.twitch.tv/docs/extensions/bits/>
- [G] Extension Guidelines and Policies: <https://dev.twitch.tv/docs/extensions/guidelines-and-policies/>
- [L] Extension Life Cycle: <https://dev.twitch.tv/docs/extensions/life-cycle/>
- [S] Submission Best Practices: <https://dev.twitch.tv/docs/extensions/submission-best-practices/>
- [R] Extensions Reference (JS helper): <https://dev.twitch.tv/docs/extensions/reference/>
- [X] Extensions overview (types): <https://dev.twitch.tv/docs/extensions/>
- [BU] Building Extensions (mobile, configuration): <https://dev.twitch.tv/docs/extensions/building/>
- [D] Designing Extensions: <https://dev.twitch.tv/docs/extensions/designing/>
- [M] Monetization Strategies: <https://dev.twitch.tv/docs/extensions/monetization-strategies/>
- [E] EventSub `extension.bits_transaction.create`: <https://dev.twitch.tv/docs/eventsub/reference/extension#extension-bits-transaction-create>
- [H1] Helix Get Extension Transactions: <https://dev.twitch.tv/docs/api/reference/bits#get-extension-transactions>
- [H2] Helix Get/Update Extension Bits Products, Send Extension PubSub Message: <https://dev.twitch.tv/docs/api/reference/extensions#update-extension-bits-product>
- [DA] Twitch Developer Services Agreement: <https://legal.twitch.com/legal/developer-agreement> (renders client-side; its text could not be read for this note)
- Secondary, for the revenue split only: Twitch blog, 2018-04-23
  <https://blog.twitch.tv/en/2018/04/23/the-next-big-update-for-extensions-is-here-a036151cc309>;
  TechCrunch <https://techcrunch.com/2018/04/23/twitchs-creators-and-developers-gain-a-new-revenue-stream-with-launch-of-bits-in-extensions>
- RFC 0012 Component Extension Redesign (forum, for component sizing):
  <https://discuss.dev.twitch.tv/t/rfc-0012-component-extension-redesign/21072>

## TL;DR

1. **Publishing:** build in Local Test, upload a zip to Hosted Test, submit one
   version for review with a review channel, walkthrough guide, listing assets,
   EULA/ToS and privacy URLs and every fetched URL. Twitch quotes **8-14 days**
   per review. Pending Action can be fixed and resubmitted; **Rejected revokes the
   Client ID for good**. The owner releases an approved version whenever they
   like. Leave the streamer allowlist blank and any channel can install it. [L] **[verified]**
2. **Eligibility:** a developer who is Affiliate or Partner needs no extra
   onboarding; anyone else onboards once (legal entity, tax, payout info,
   Extensions Developer Agreement, up to 2 business days). Any channel can install
   a Bits extension, but Bits only work on channels that can take Bits (Affiliate
   or Partner who has not switched Bits off for the extension). The extension
   **must** check `twitch.ext.features.isBitsEnabled`. [B][S][R] **[verified]**
3. **Prices:** the developer defines a catalog of products (SKU, name, 1-10000
   Bits, max 250) per extension. It is one global catalog: Twitch documents no
   per-channel or broadcaster-set price, and Bits may not be exchanged for
   "items or experiences specified by broadcasters". This matches #164's one
   global price list. [B][H2][G 6.2.8] **[verified]**
4. **Revenue split:** current docs only say Bits revenue is "shared between the
   broadcaster and the Extension developer". The widely quoted split is **80%
   broadcaster / 20% developer**, from the 2018 launch. [B][M] **[verified]** that
   it is shared; 80/20 **[unverified]** today.
5. **Transaction path:** `useBits(sku)` opens Twitch's dialog → on confirm,
   `onTransactionComplete` fires in the extension with a signed
   `transactionReceipt` JWT; the backend verifies it with the extension secret.
   The backend can also get every transaction from EventSub
   `extension.bits_transaction.create` (webhook or conduit, not WebSocket) and
   replay misses from Helix Get Extension Transactions. A cancel fires
   `onTransactionCancelled`. No refund API exists. [R][E][H1] **[verified]**
6. **Component:** placed over the video, sized by the developer as a target height
   (% of the player) plus an aspect ratio; viewers can hide it; it must fill its
   iframe and not copy the frame's own controls. [X][G 2.10-2.11] **[verified]**;
   the % sizing model is from RFC 0012 **[unverified]** as the current behaviour.
7. **Mobile:** a separate (or the same, responsive) front end loaded with
   `?platform=mobile`, shown on iOS and Android with no extra submission step since
   2024-07-09. Limits: ≤1 MB initial load, under 3 s at ~500 kb/s, everything
   visible in the chat viewport in portrait and landscape. [BU][G 3.x] **[verified]**
8. **Hiding when the game isn't running:** no API hides an extension entirely. It
   can `actions.minimize()` itself (component or overlay) and draw a quiet idle
   state; viewers can hide it; a broadcaster could deactivate it. [R][X] **[verified]**

## 1. Review process and timeline

- Versions move Local Test → Hosted Test → Review → Pending Action / Rejected /
  Approved → Released. Only one version can be in review and one released; a new
  release deprecates the old one. [L] **[verified]**
- Hosted Test needs the asset zip (no executables) and the Bits Support and
  Subscription Support switches set on the Monetization tab (both default No). [L] **[verified]**
- Submitting needs: review channel URL, a walkthrough guide (first version), name,
  summary, description, author, category, logo, discovery image, at least one
  screenshot, EULA/ToS and privacy policy URLs, capabilities, asset hosting paths,
  and every URL the front end fetches plus image/media/fetch CSP allowlists. [L][S][G 2.12] **[verified]**
- Extensions that need a game or backend running must give review availability
  within 9 AM-5 PM PT and have that game set up on a live review channel;
  otherwise Twitch asks for another time. [L][S][G 1.1-1.4] **[verified]**
  For Rhino Race: the reviewer must see a race live, so the owner books a slot and
  runs Rhino Race on the review channel. **[inference]**
- "Expected review times for Extensions are 8-14 days", longer over weekends and
  US holidays. Resubmitting a version in review resets its queue place. [L] **[verified]**
- Pending Action: fix and resubmit without a new version. Rejected: Client ID
  permanently revoked. Approved: release at any time. [L] **[verified]**
- Streamer allowlist blank = anyone can install from the directory; testing
  account allowlist lets named accounts test before release. Changing the
  allowlist after submission needs a new review. [L] **[verified]**
- Common rejection causes: payment links, offsite calls to action, Twitch
  branding, wrong Bits wording, missing CSP fields, hard setup steps. [S] **[verified]**

## 2. Bits in Extensions eligibility

- **Developer:** "Onboarding is only for developers who are not Twitch partners
  or affiliates." Others give legal entity, tax and payout details and accept the
  Extensions Developer Agreement; minors need a guardian; one developer account
  per legal entity; approval takes up to 2 business days. [B] **[verified]**
- **Broadcaster:** "All broadcasters can install and activate Bits-enabled
  Extensions", but Bits fail on channels that cannot accept Bits. Best practice:
  Bits are "only available on opted-in Partner or Affiliate channels", so detect it
  and hide Bits features, offer a free version, or block activation. [B][S] **[verified]**
- `twitch.ext.features.isBitsEnabled` is false when the developer has not turned
  Bits on, the broadcaster can't take Bits, or the broadcaster switched Bits off
  for this extension. Checking it is mandatory. [B][R] **[verified]**
  For Rhino Race: a non-affiliate operator still gets Join and the personal
  interactions; the Bits buttons just don't show. **[inference]**

## 3. Products, SKUs and prices

- Products live in the Developer Console (Monetization → Bits Products) or via
  Helix Update Extension Bits Product (app access token of the extension's own
  client ID): SKU (unique, fixed once saved, ≤255 chars), display name, cost
  1-10000 Bits, `in_development`, `is_broadcast`, optional expiration. At most 250
  products; products can't be deleted, only deprecated/expired. [B][H2] **[verified]**
- The price is "a flat rate, regardless of the viewer's geographical location".
  The `useBits` dialog shows the current catalog price, which wins over whatever
  the extension displayed. [B] **[verified]**
- Twitch documents no per-channel price and no broadcaster price control; the
  catalog belongs to the extension. Bits may not be exchanged "for items or
  experiences specified by broadcasters or end users" (G 6.2.8). [B][H2][G] **[verified]**
  Per-channel switching of a product on/off is the extension's own logic (the
  operator's race setup hides that button). **[inference]**
- Twitch "may require adjustments" to the Bits amounts you set. [G 6.3] **[verified]**
- A streamer-triggered "sale" is suggested in [M], which in practice means extra
  discounted SKUs in the same catalog. **[inference]** Out of scope for v1.

### Allowed uses and wording (affects #164's "Bits events are cheers")

- Allowed: "to activate an experience for the broadcaster and/or the community",
  voting, enhancing gameplay. Not allowed: gambling or wagering on gameplay
  events, random loot boxes with monetary value, sweepstakes, pay-to-play. [G 6.1-6.2] **[verified]**
  Buying a chaos event fits "activate an experience". **[inference]**
- **"You may not describe the use of Bits in Extensions as 'cheering'"**, nor as
  donation, support, purchase, spend, buy or insert. Preferred words: get, win,
  use, exchange, give. [G 6.4-6.5][S] **[verified]**
  So the game may keep treating these as a **Cheer** internally (GLOSSARY.md), but
  the extension's viewer-facing text must not say "cheer" or "buy". **[inference]**

## 4. Revenue split

- Docs: "Revenue from Bits used in an Extension is shared between the broadcaster
  and the Extension developer"; developers "earn a share of the Bits revenue". No
  percentage given. [B][M] **[verified]**
- 2018 launch: 80% broadcaster, 20% developer (Twitch blog, TechCrunch). The
  Developer Services Agreement [DA] did not render for this research.
  **[unverified]** whether 80/20 still holds; confirm in the Developer Console
  Monetization tab or the agreement before promising numbers.
- If the owner is themselves the broadcaster, both shares reach them. **[inference]**

## 5. How a transaction reaches the extension and backend

1. On load, `Twitch.ext.bits.getProducts()` returns the live catalog (products
   marked In Development are hidden in production). [B][R] **[verified]**
2. `Twitch.ext.bits.useBits(sku)` opens Twitch's modal with price and balance.
   Confirming shares the viewer's identity with the extension. Too few Bits: no
   Confirm button, offer to get more. The extension is blocked while the modal is
   open; clicking outside cancels. [B] **[verified]**
3. `onTransactionComplete(tx)` fires with `userId`, `displayName`,
   `transactionID`, `product`, `initiator` (`current_user` or `other`) and
   `transactionReceipt`, a JWT the backend verifies with the developer secret. If
   the product has Broadcast on, every instance on the channel gets it. [B][R] **[verified]**
4. Backend-side, EventSub `extension.bits_transaction.create` v1 (condition
   `extension_client_id`, app access token of the extension) delivers transaction
   id, broadcaster, user and product (name, sku, bits, in_development).
   Webhook or conduit only, **not WebSocket**. [E] **[verified]**
5. Helix Get Extension Transactions (app access token) lists transactions by
   extension or id, for reconciliation. Retention period is not documented. [H1] **[verified]**

Failure and refund:
- `onTransactionCancelled` fires on cancel, outside click, or dismissing a
  `useBits` error. Errors: not logged in; banned user or SKU removed (generic
  3-second message). [B][R] **[verified]**
- No refund endpoint exists in Helix or the helper. [R][H1][H2] **[verified]** (by absence)
  Twitch Support treats Bits use as final, with case-by-case exceptions
  (forum-quoted help article). **[unverified]**
- Bits are taken before the backend hears about it, so a completed transaction
  must always be honoured: queue it if the game is mid-countdown or between
  races, as the GLOSSARY's Cheer already says. EventSub catches transactions the
  front end's message to the backend lost. **[inference]**
- The game itself needs a hosted endpoint (or conduit) for EventSub, since it
  can't use WebSocket; this is the "small hosted backend" #164 allows. **[inference]**

Testing:
- On the developer's own channel in Local/Hosted Test, transactions "succeed
  without using your Bits"; `inDevelopment: true` means no Bits are deducted;
  `setUseLoopback` fakes completion locally. [B][R] **[verified]**
- On an operator's channel there is no free mode, so the trial race must hide
  Bits buttons. **[inference]**

## 6. Component size and placement

- A component "displays as part of the video, taking up part of the screen" and
  "can be hidden by viewers". The broadcaster picks a slot on activation. [X] **[verified]**
- It must use the whole iframe and must not duplicate the component frame's own
  UI (its title bar / close). [G 2.10-2.11] **[verified]**
- Sizing (set in the console): target height as a % of the player's free space
  plus a fixed aspect ratio; e.g. 25% at 4:3 in a 1000 px space renders 250×333 px.
  It stops growing on huge players and is hidden on very small ones. Optional
  "Zoom" scales the content to a virtual long edge (default 1024 px). From
  RFC 0012/0002. **[unverified]** as current production behaviour; check in the
  Developer Console.
- The UI must "scale and adapt when the browser and video player resize". [D] **[verified]**
- The docs do not give a number of components active at once. **[unverified]**

## 7. Mobile view

- Same or separate front end; Twitch passes `?platform=mobile` or `?platform=web`.
  "All mobile Extensions, existing and new, are available on iOS and Android
  without additional requirements in the submission process" (since 2024-07-09). [BU] **[verified]**
- Must support iOS 10+/Android 4.1+, initial CDN load ≤1 MB, load in <3 s at
  ~500 kb/s, show every element within the stream chat viewport in portrait and
  landscape; follow Apple guideline 4.7. Touch targets ≥44 pt suggested. [G 3.1-3.5][D] **[verified]**
- `showBitsBalance()` is ignored on mobile. [R] **[verified]** Bits in
  Extensions on mobile works per forum reply. **[unverified]** The docs don't
  say where in the app the view sits (it shares the chat viewport). **[inference]**

## 8. Hiding when Rhino Race isn't running

- No helper call hides an extension completely. [R] **[verified]** (by absence)
- `Twitch.ext.actions.minimize()` minimizes a video-component or video-overlay
  extension; `onVisibilityChanged` tells it when it is hidden (paused, ads,
  viewer). [R] **[verified]**
- Overlays disable themselves when the broadcaster goes offline. [D] **[verified]**
- "Required configuration" stops it rendering until the broadcaster configures
  it, but that is one-off per channel, not live. [BU] **[verified]**
- Plan: when the backend says the game is down, call `minimize()` and render a
  small idle state; the viewer reopens it to see "Rhino Race isn't running". A
  blank component is risky in review (G 1.2 "must load when activated", 2.11
  "must utilize the entire size"). **[inference]**

## Open questions

- The current Bits revenue split (needs the Developer Console or the agreement text).
- Whether component sizing still follows RFC 0012, and if `minimize()` on load is
  acceptable to reviewers.
