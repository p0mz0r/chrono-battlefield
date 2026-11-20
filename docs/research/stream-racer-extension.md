# Research: how Stream Racer's Twitch extension looks and behaves

Answers #167 ("How does Stream Racer's Twitch extension look and behave?"), part
of #164. Researched 2026-11-20.

Each claim is tagged **[verified]** (read in a primary source, linked),
**[inference]** (reasoned from verified facts, not tested) or **[unverified]** (not
in any primary source we found). Nobody watched the extension on a live channel or
a phone for this note; everything comes from Twitch's own extension record, the
extension's shipped front-end code, its listing screenshots and the developer's
Steam posts.

Sources:
- **Twitch extension record.** Read with Twitch's public web GraphQL endpoint
  (`gql.twitch.tv`), via the install on the developer's own channel
  `twitch.tv/streamracer` (`user.channel.selfInstalledExtensions`) and
  `extension(id: "xml2f31qnr1jevtk7nka6h712s4ool", version: "1.1.0")`. It gives
  the name, description, anchor, views, Bits products and viewer URL. The
  public listing page is
  <https://dashboard.twitch.tv/extensions/xml2f31qnr1jevtk7nka6h712s4ool>, but
  it is rendered client-side, so a plain fetch does not show its text.
- **Extension front end, version 1.1.0, as Twitch serves it.**
  <https://xml2f31qnr1jevtk7nka6h712s4ool.ext-twitch.tv/xml2f31qnr1jevtk7nka6h712s4ool/1.1.0/e796242f0a3479f47765c568aaae009a/video_overlay.html>
  and its bundle `assets/video_overlay-BzhJvkMK.js`, which is minified React.
  The UI strings, layout classes and state logic quoted below come from that
  bundle.
- **The three listing screenshots** (1024x768, made by the developer). They are
  linked, not copied, because no licence is given:
  [1 race view](https://extensions-discovery-images.twitch.tv/xml2f31qnr1jevtk7nka6h712s4ool/0.0.1/screenshot93106508-ca5b-4aa2-b8fa-d61694985e63),
  [2 chaos menu](https://extensions-discovery-images.twitch.tv/xml2f31qnr1jevtk7nka6h712s4ool/0.0.1/screenshot2bc105c8-b27a-425b-bcb2-4d679ef804f0),
  [3 garage](https://extensions-discovery-images.twitch.tv/xml2f31qnr1jevtk7nka6h712s4ool/0.0.1/screenshot2cc8e17e-206d-4ce6-aeec-6cb1fc4568f0).
- **Stream Racer's Steam announcements**, especially "Update 2.7.0: Driver
  customization and 3x race Fuel" (2026-10-29):
  <https://store.steampowered.com/news/app/1333410>. The full text is also at
  <https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1333410&maxlength=0>.
- **Twitch developer docs.** Extension types:
  <https://dev.twitch.tv/docs/extensions/>. Design guidelines:
  <https://dev.twitch.tv/docs/extensions/designing/>. Mobile RFC:
  <https://discuss.dev.twitch.tv/t/rfc-0003-mobile-app-extensions/14130>.
- **Stream Racer's own sites.** <https://streamracer.com/> and
  <https://app.streamracer.com/> (the companion web app). Neither documents the
  extension.

## TL;DR

1. **It is a video overlay extension.** Its anchor is `VIDEO_OVERLAY`, it is
   active in slot `extension-overlay-1` on the developer's channel, and it ships
   only a `video_overlay.html` view, with no panel, component or mobile view.
   **[verified]** The iframe covers the whole player, as Twitch overlays do, but
   what it draws is small: a slim vertical rail, 72 px wide (52 px on smaller
   players), vertically centred on the right edge of the video. **[verified]**
   That matches what the owner remembers.
2. **Position is shown as `P7` / `of 75`.** It sits in the rail under a small
   "YOU" label, in large mint text. On hover, a card next to the rail repeats
   it at 36 px. Only a viewer who is racing sees it. **[verified]**
3. **What viewers see changes with race phase and with whether they joined.**
   The tables below give each state. When the streamer's game is not
   connected, the extension renders nothing at all. **[verified]**
4. **There are nine Bits "chaos" products**, from 10 Bits (Single Boom) to
   10,000 Bits (Nuke, once per race). Joining, boosting and the garage are
   free. **[verified]**
5. **There is no mobile view.** Twitch's mobile apps enable an extension only
   when it declares a mobile path, so mobile app viewers should not see it.
   **[verified]** for the missing view, **[inference]** for what the app does.
   In a browser, a player narrower than 640 px or shorter than 360 px hides the
   rail and the menus. Only the boom banners and toasts remain. **[verified]**

## Identity

| Field | Value |
|---|---|
| Name / author | "Stream Racer" by "Stream Racer" **[verified]** |
| Extension ID / version | `xml2f31qnr1jevtk7nka6h712s4ool`, `1.1.0`, state `RELEASED` **[verified]** |
| Type | Video overlay (`anchor: VIDEO_OVERLAY`; `views.videoOverlay.viewerPath = video_overlay.html`; `mobile`, `component` and `panel` are `null`) **[verified]** |
| Subscriptions support | `NONE` **[verified]** |
| Backend | WebSocket `wss://live.streamracer.com`, plus the companion app's REST API for the garage (`twitch/Me`, `twitch/Vehicles`, `twitch/Loadout`, …) **[verified]** |
| Works when | "The extension works while the streamer is playing Stream Racer." (listing description) **[verified]** |

Twitch's summary on the listing: "Join the Stream Racer race from the video
player: hop on the grid, boost your car, pick your ride and use Bits to blow up
the field." The listing description has five bullets. Join: one click, under
your own Twitch name. Boost: two per race, shared with `!boost` in chat. Live
position. Garage: browse, preview in 3D and equip, paid for with Fuel. Chaos:
Bits explosions, "Everyone watching sees who caused the mayhem." **[verified]**

Stream Racer's 2.7.0 Steam post describes the extension the same way: "lets your
viewers join, boost and follow their position right from the video player, use
Bits on chaos effects and pick their ride in the garage". The game shows a tour
that ends in an INSTALL FOR FREE ON TWITCH button. **[verified]**

## Layout

All of the following is from the bundle's root component and layout classes.
**[verified]**

- **Rail.** A `<nav>` with a rounded "glass" panel (`bg-deep/80`, 90% opacity,
  full on hover). It is `position: fixed`, vertically centred
  (`top-1/2 -translate-y-1/2`) and 20 px from the right edge. When Twitch's
  player controls are visible it moves to 64 px from the right, so it does not
  sit under them. From top to bottom it holds the logo, a status block, a
  join or boost button, a Chaos button (only when Bits effects are on) and a
  Garage button. Screenshot 1 shows it.
- **Hover card.** When the pointer is over the rail and the player is at least
  960 px wide, a 360 px card opens to the rail's left. It shows "Next race"
  in the lobby and "This race" while racing. Screenshot 1 shows the racing card.
- **Chaos and Garage.** Clicking either button opens a larger panel, about
  380 px or more wide (screenshots 2 and 3). The rail hides while a panel is
  open.
- **Boom banners.** These are pill-shaped and centred at the top of the video
  (`fixed top-6 left-1/2`). The text is "`<name>` boomed `<n>` racers",
  "`<name>` dropped a `<effect>`" or "`<name>`'s `<effect>` fizzled". They do
  not take pointer events. Screenshot 1 shows one: "TURBOTESS BOOMED 10
  RACERS".
- **Toasts.** These report the result of a viewer's own actions.
- **Breakpoints**, from player width and height (`Gr` in the bundle):

  | Breakpoint | Size | What shows |
  |---|---|---|
  | `tiny` | width < 640 or height < 360 | No rail, no cards, no Chaos or Garage panels. Only banners and toasts. |
  | `compact` | 640–959 | 52 px rail, no hover card. Panels in compact layout. |
  | `default` | 960–1279 | 72 px rail and hover card |
  | `full` | ≥ 1280 | 72 px rail and hover card |

The leaderboard at the top left, the car name tags and the minimap in the
screenshots are part of the game's own video. They are not in the extension.
**[verified]** from the bundle, which draws no leaderboard.

## Viewer states

The phases come from the game over the WebSocket: `offline`, `lobby`,
`countdown`, `racing`, `finishing` and `results`. The code groups
`lobby`/`countdown` as "lobby" and `racing`/`finishing` as "racing".
**[verified]**

| State | Rail status block | Rail button | Hover card (≥ 960 px) |
|---|---|---|---|
| **Game not running / not connected** (`gameOnline` false) | Nothing. The component returns `null`, so the extension is invisible. | – | – |
| **Lobby, not joined** | Countdown `m:ss` to the start and `racers/max` | **Join** ("Full" and disabled when the grid is full) | "Next race". Shows the map name, "Starts in" with the countdown, a fill bar, "12 of 75 racers on the grid" and "Join in your `<vehicle · skin>`. Swap it in the garage before the flag." |
| **Lobby, joined** | Same | "On grid", with a check mark, not a button | Same card, ending "You're on the grid in your `<ride>`. Watch for your car at the green flag." and "Two boosts unlock at the green flag." |
| **Racing, joined, still driving** | "YOU", **P`n`**, "of `total`". The label changes to "VSC" during a Virtual Safety Car. | **Boost** with two pips for charges left. Disabled when charges run out, and paused during VSC ("Boost paused for VSC, charges kept"). | "This race". Shows a "RACE ON" or "FINAL LAP" badge, a thumbnail of their skin, "You're racing", the skin and vehicle names, **P`n`** in 36 px and "of `total`". |
| **Racing, joined, finished** | Same P/of block (final place) | "Done", with a check mark | "You finished" plus the place |
| **Racing, not joined** (spectator) | A dot and "Race on", or "VSC" | No join or boost button | "Watching", the map name and "Join the next race from the lobby." No position. |
| **Results** | "Results" | – | – |
| **Viewer has not shared identity** | Unchanged | Join or Garage opens "One quick thing": "Share your Twitch ID to join and race under your name." Its button is **Share my Twitch ID**. | Lobby card: "Share your Twitch ID to join and race under your name." |

Some details on these states. **[verified]**
- Join and boost go to the game over the WebSocket. The two boosts are shared
  with the chat command `!boost`.
- Chaos does **not** need a shared Twitch ID: "Booms work without it. We only
  get your Twitch user ID, never your email." If identity is shared, the
  viewer's name goes on the boom ("Sign your chaos").
- Chaos effects work only while racing. Outside a race each tile says "Waits
  for the green flag". When the room is offline it says "Race not connected".
  When Bits are off for the channel or device it says "Bits are off here".

## Bits costs

These are the products on the extension record (version 1.1.0). **[verified]**

| SKU | Name | Bits |
|---|---|---|
| `boom_1` | Single Boom | 10 |
| `boom_10` | Big Boom | 100 |
| `boom_100` | HUGE Boom | 1,000 |
| `shrink` | Shrink Ray | 100 |
| `bananas` | Banana Peels | 100 |
| `cones` | Traffic Cone Apocalypse | 100 |
| `oil` | Oil Spills | 200 |
| `vsc` | Virtual Safety Car | 250 |
| `nuke` | Nuke (one per race, until the first car finishes, reserved while one viewer confirms) | 10,000 |

Screenshot 2 is older (the image path says `0.0.1`) and shows different prices
for two of these: Shrink Ray at **50** and "Traffic Cone Buddy" at **500**. The
table above is the live product list. The game decides which effects are on
(`room.effects`, `boomsEnabled`), so a streamer can disable chaos. **[verified]**
Which side controls each toggle in the game's settings: **[unverified]**.

Joining, boosting and equipping cost nothing. Garage unlocks cost Fuel, which
viewers earn by racing, or Nitro, which they buy with real money in the
companion app. Neither is paid in Bits. **[verified]**

## Mobile

- Version 1.1.0 declares no mobile view (`views.mobile: null`). **[verified]**
- Twitch's mobile RFC says a valid mobile path is "all that is required to
  enable mobile for your extension". So an extension with no mobile path should
  not appear in the iOS or Android app. **[inference]** Not checked on a phone.
- In a desktop or mobile browser, the `tiny` breakpoint (< 640 px wide)
  removes every interactive part. A small player shows only the "X boomed N
  racers" banners. **[verified]** from the code, but not tested on a device.

## Unverified / not checked

- How the extension looks live on a channel, in theatre mode or in fullscreen.
  No public footage of it was found. It was released recently (the 2.7.0 post
  is dated 2026-10-29).
- How often the position updates. It comes from the WebSocket room state, and
  the game sets the cadence.
- Whether Bits products can be configured per channel.
- How the streamer configures it. Its configuration and live-config views were
  not inspected.

## What this means for Rhino Race

**[inference]**
- To mirror it, build one video overlay extension that draws a small rail on
  the right edge, vertically centred and clear of the player controls. Do not
  build a component. Its content: a status block (countdown in the lobby,
  **P`n` of `total`** for a racer, "Race on" for a spectator), one primary
  action (Join or Boost), and optional Chaos and Garage drawers.
- Render nothing when the game is not connected. Hide everything but
  announcements when the player is small.
- Skip mobile in the first version, as Stream Racer did. Chat (`!race` /
  `!boost`) stays the path for phone viewers.
