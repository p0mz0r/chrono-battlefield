# What footage of the earlier Rhino Race shows

Answers #92 for the chaos update map #85. Recorded 2026-11-03. This checks the owner's
account in [earlier-rhino-race-on-stream.md](earlier-rhino-race-on-stream.md) (#89)
against real footage. It uses the same *old V3*, *old green shell* and *old
chronosphere* names as that note.

**Source:** [Rhino race time! (Week 12/2026)](https://youtu.be/-U5uS21slB0), a highlight
cut uploaded to YouTube by Doof88 on 2026-04-21. The description says "Broadcasted live
on Twitch". It runs 11:47 and has no chapters. The stream overlay shows the date
20-03-2026. The stream's chat is burned into the left panel of the video. The YouTube
video has no comments or live chat.

**Method:** downloaded with `yt-dlp`. Used `ffmpeg` to pull a frame every 10 s, 1 fps
strips at key moments, 2× crops of the chat panel every 10–20 s and a 1 fps strip of the
top-right toast area. YouTube's English auto-captions were used for the streamer's
commentary. Timestamps are video time and link to the moment.

Each claim is tagged:

- **[seen]**: on screen in the game or overlay.
- **[chat]**: legible in the burned-in chat panel.
- **[said]**: the streamer, from the auto-captions. These are approximate, and names
  are garbled: "Lunark" is lunak89, "Spanglers Cat" is spenglerscat, "Baff" is
  paflight.
- **[inference]**: my reading of the above.
- **[owner]**: p0mz0r, author of the earlier game, answering questions this note left
  open (2026-11-03).

## What the earlier game looks like

The video shows six races, called A–F below. The game runs inside the streamer's RA2
scene. Chat is on the left, with Twitch 65, YouTube 21–26 and Kick 0 viewer counts under
it. A follower, sub, donation and cheer bar runs along the bottom.
[00:10](https://youtu.be/-U5uS21slB0?t=10) **[seen]**

| Element | On screen |
|---|---|
| Track | Snow ground, **6 straight lanes** left to right, chequered finish line on the right. Every tank is a Rhino with the racer's avatar as a flag. **[seen]** |
| Seats | "!rhino - join the race (up to 6 players)". The bot posts "A tank race is about to start! Type !rhino in chat to join (max. 6 players)!" **[seen] [chat]** |
| Join window | A 90 s countdown (01:30 → 00:00), top right. The race starts early when 6 have joined: race F started at 01:04 left. With 5 or fewer, the timer sat at 00:00 for 25 s or more while the streamer asked for "one more". [01:40](https://youtu.be/-U5uS21slB0?t=100), [03:42](https://youtu.be/-U5uS21slB0?t=222), [10:27](https://youtu.be/-U5uS21slB0?t=627) **[seen] [said]** The game would start with fewer than 6; the wait was the streamer's choice. **[owner]** |
| Command list | A large dark panel in the middle of the track during the join window. It stays up for about 5–10 s after the start and covers the lanes. [00:20](https://youtu.be/-U5uS21slB0?t=20), [06:40](https://youtu.be/-U5uS21slB0?t=400) **[seen]** |
| Ticker | "Don't forget to bring a !boost and !shield" under the track for the whole race. **[seen]** |
| Standings | Top-left live list: rank, avatar, first 4 letters of the name. It covers the start of lanes 1–3 and fades when tanks are under it. Names overlap when two tanks are level. [06:49](https://youtu.be/-U5uS21slB0?t=409), [07:00](https://youtu.be/-U5uS21slB0?t=420) **[seen]** |
| Toasts | Top right, one per redemption or cheer: avatar, "NAME USED RED SHELL / GREEN SHELL / CHRONO". They stack and last about 3–4 s. [02:39](https://youtu.be/-U5uS21slB0?t=159) **[seen]** |
| Win banner | "lunak89 wins!" grows in the middle of the track. The winner keeps driving off the right edge. [07:25](https://youtu.be/-U5uS21slB0?t=445) **[seen]** ("Flew off the screen" **[said]**) |
| Stats | After every race, about 10 s: **Most wins, Most last places, Hit most players, Got hit the most**, top 3 each, kept across races. For example, codsetr had 97–99 hits dealt. [01:20](https://youtu.be/-U5uS21slB0?t=80), [11:30](https://youtu.be/-U5uS21slB0?t=690) **[seen]** |
| Race start | A dark RA2 object moves down the left edge, and the tanks appear in their lanes as it passes. [06:42](https://youtu.be/-U5uS21slB0?t=402) **[seen]** It looks like a spawn animation. **[inference]** |

### Interactions as listed and as they look

The on-screen list has five entries: `!rhino`, `!boost` and `!shield` for racers only,
two channel-point rewards ("can be redeemed by everyone") and one cheer.

- **Red Shell** (channel points): "Targets the lead tank and hits it back unless
  shielded". A Mario Kart red shell sprite flies at the leading tank, and a hit tank drops
  back. [02:39](https://youtu.be/-U5uS21slB0?t=159),
  [09:20](https://youtu.be/-U5uS21slB0?t=560) **[seen] [said]** This is the owner's
  *old V3*. **[inference]**
- **Green Shell** (channel points): "Targets the lead tank, but flies vertically and hits
  everything in its path unless shielded". The shell drops in from the top at the
  leading tank's x position and falls down through all lanes, so it reaches every tank
  level with the leader. Fired at the start, when the field is still bunched, that is
  nearly everyone: [02:19–02:23](https://youtu.be/-U5uS21slB0?t=139). Later it reaches
  only the tanks near the leader: [09:13](https://youtu.be/-U5uS21slB0?t=553). **[seen]**
  So "hits every tank" in #89 holds only for an early shell. **[inference]**
- **Black tanks are shielded, not hit.** **[owner]** Several black tanks show up around
  shells, for example two at [02:39](https://youtu.be/-U5uS21slB0?t=159) and the
  streamer's tank at [07:24](https://youtu.be/-U5uS21slB0?t=444), so racers did use
  `!shield` against incoming shells. **[seen] [inference]**
- **Cheer 7 bits: Chrono Legionnaire.** An RA2 Chrono Legionnaire appears next to a
  random tank. The toast reads "USED CHRONO". [06:52](https://youtu.be/-U5uS21slB0?t=412)
  **[seen]** The streamer lowered the bit price on stream: "I'm going to lower the
  bitties… seven bitties for a Chrono Legionnaire should be possible now."
  [00:42–01:01](https://youtu.be/-U5uS21slB0?t=42) **[said]**
- **`!boost` / `!shield`:** the chat panel never shows the commands, so they are hidden
  from it. **[chat]** After a boost, an icon (a tank with ">>" in a badge) appears next to
  the racer in the standings and the tank surges forward.
  [09:09–09:11](https://youtu.be/-U5uS21slB0?t=549) **[seen]** The streamer says "Baff,
  you still have the boost" [11:25](https://youtu.be/-U5uS21slB0?t=685) **[said]**.
  Boost had a 1-minute cooldown, and races run about 45–60 s of driving, so in practice
  it was once per race. **[owner]**
- **Shield:** an Iron Curtain effect. The tank gets a black tint while it is protected.
  **[owner]**
- **Veteran and elite promotion: not on the list.** lunak89's tank wore the orange RA2
  veteran chevron after he hit his own tank with his cheer.
  [07:00–07:24](https://youtu.be/-U5uS21slB0?t=420) **[seen]** "That's how you get
  veteran… the promotion got you the win" [07:52–08:00](https://youtu.be/-U5uS21slB0?t=472)
  and "No veterans yet" [11:21](https://youtu.be/-U5uS21slB0?t=681). **[said]**
  Promotions come from taking hits, veteran first and then elite. The old V3 (red
  shell) and the green shell need 2 hits per promotion. The Chrono Legionnaire and the
  old chronosphere need 1. **[owner]** That fits lunak89's single chrono hit giving the
  veteran chevron. **[inference]** Each promotion makes the tank slightly faster.
  **[owner]** So being hit pays back a little speed, which is how a self-chrono could
  win a race. **[inference]**

**Not in the footage at all:** a hype meter, `!nuke`, the old chronosphere (14 bits)
and the old V3 under that name. **[seen]**

## Key moments

| Time | Race | What happens |
|---|---|---|
| [00:00](https://youtu.be/-U5uS21slB0?t=0) | – | Show-match screen with a prediction (68%/32%). The races fill the wait for show-match players. "We're still waiting for Gino and Zaslan to join the lobby" [03:02](https://youtu.be/-U5uS21slB0?t=182). **[seen] [said]** |
| [01:15](https://youtu.be/-U5uS21slB0?t=75) | A | spenglerscat wins and draws level with paflight at 5 wins. **[said] [seen]** |
| [02:35](https://youtu.be/-U5uS21slB0?t=155) | B | "You don't have to be in the race to play along. You can use your channel points…" **[said]** |
| [02:39](https://youtu.be/-U5uS21slB0?t=159) | B | lunak89 red shell and p0mz0r chrono at the same moment. "Chrono Legionnaire but Lunark still pushing it on through." **[seen] [said]** |
| [04:45](https://youtu.be/-U5uS21slB0?t=285) | C | spenglerscat's 4th straight win. The streamer: "What? What?… Somebody needs to break his winning streak." **[said]** |
| [05:20–06:30](https://youtu.be/-U5uS21slB0?t=320) | D | A full 90 s join window with only 4–5 racers. The prediction overlay sits on top of the track. The streamer joins himself as the 6th: "Need one more. One more. I'll join." [06:24](https://youtu.be/-U5uS21slB0?t=384) **[seen] [said]** |
| [06:52](https://youtu.be/-U5uS21slB0?t=412) | D | lunak89's 7-bit chrono lands on **his own tank**. His tank later shows the veteran chevron. **[seen]** |
| [07:24–07:26](https://youtu.be/-U5uS21slB0?t=444) | D | The streamer's tank leads at the line and goes black (shielded **[owner]**), yet lunak89 passes it and wins. "OP monster Lunark… He even beat the Doof… After self-Chrono." **[seen] [said]** |
| [09:20–09:35](https://youtu.be/-U5uS21slB0?t=560) | E | CodSetR's red shell knocks lunak89 back and he boosts. p0mz0r red-shells CodSetR. lunak89 wins again: "got knocked back way back. Came back." **[seen] [said]** |
| [09:49](https://youtu.be/-U5uS21slB0?t=589) | E | "Oh, he made a clip, boys. Lunark made a clip." A clip link appears in chat. **[said] [chat]** |
| [10:53](https://youtu.be/-U5uS21slB0?t=653) | F | "this Spanglish guy loves to spawn that green shell right off the bat. As soon as you hear the whistle…" **[said]** |
| [11:29](https://youtu.be/-U5uS21slB0?t=689) | F | paflight wins with a late boost: "WOW, Baff bringing it back." **[said]** The stats then show paflight at 6 wins. **[seen]** |
| [11:25–11:30](https://youtu.be/-U5uS21slB0?t=685) | F | A p0mz0r "USED CHRONO" toast arrives as the race ends and shows over the stats screen. **[seen]** |

**Race pace:** about 45–60 s from start to win. For example, race D ran from about
[06:44](https://youtu.be/-U5uS21slB0?t=404) to [07:26](https://youtu.be/-U5uS21slB0?t=446).
Add the 90 s join window and about 10 s of stats, and one race takes 2.5–3 min. **[seen]**
That matches #89's "2–3 minutes" if it counts the whole cycle. **[inference]**

**Redemptions:** from the toast strip, I counted 1, 3, 2–3, 2, 4 and 5 per race (A–F).
**[seen]** Nearly all came from five people: spenglerscat (a green shell in almost every
race), codsetr, p0mz0r, lunak89 and rico1982. Most were racers buying shells against the
leader. **[seen]** In total there were 3 cheers in about 12 minutes: two by p0mz0r, the
game's author, and one by lunak89. **[chat]**

## Chat reactions

### What landed: the self-chrono, the veteran win and the comeback

Chat around race D:

- "RIPCheer7"
- "FINALLY!!!!!!"
- "lmao GG"
- "after self Chrono xD"
- "mvp last places xD"
- "hahaha, instant promotion tho"
- "tactics ^^"

[07:00–09:00](https://youtu.be/-U5uS21slB0?t=440) **[chat]**

After race E:

- "NOO"
- "POMZOT WHYY" (p0mz0r had red-shelled CodSetR)
- "MUHAHA"
- "Lunak OP vet lmao"
- "calculated"

The race E reactions sit at about [09:40–10:20](https://youtu.be/-U5uS21slB0?t=580).
**[chat]** lunak89 posted **two Twitch clip links** (`…/clip/BadNastyFriseeNotATK-…`,
`…/clip/ArtsyShinyEyeballCmonBruh-…`), and the streamer reacted to the clip on stream.
**[chat] [said]**

### Win streaks drew the most talk

Chat on spenglerscat's run:

- "NSA APENGLERS WINNING"
- "WHAT DUDEE"
- "lol GG Spengler"
- "AAHAHAHAH"

[03:00–05:00](https://youtu.be/-U5uS21slB0?t=180) **[chat]**

spenglerscat himself wrote "C'mon 4/4" and "I want my 4th". **[chat]** The streamer kept
framing races around the streak and the number one spot: "Path, you just lost your first
place, Path. You need to join", and "Lunark, you need to come to defend… your title".
[03:35](https://youtu.be/-U5uS21slB0?t=215), [08:32](https://youtu.be/-U5uS21slB0?t=512)
**[said]**

### The playful "rigged"

- paflight: "rigged" … "cuz hes mod", after the second win by lunak89, a mod.
- deus_net: "i deserved this", "forever looser (".

[09:40–10:20](https://youtu.be/-U5uS21slB0?t=580) **[chat]** Nobody complained in
earnest. The win came from a mechanic the command list does not mention (promotion
from taking hits), and that is where "rigged" came up. **[inference]**

### Noise and fell-flat signals

- The bot answered "You are already part of the race, cannot join multiple times" twice
  per join window. [08:00–11:40](https://youtu.be/-U5uS21slB0?t=480) **[chat]**
- Most of the chat in this window is RA2 balance talk (APM, Mirage vs Rhino), not about
  the race. **[chat]**
- Join windows often did not fill 6 seats with 65 Twitch viewers. **[seen]**
- The cheer was raised on stream, then hardly used. **[said] [chat]**

### The streamer as commentator

The streamer:

- called out every redemption by name ("There's the red shell from Lunark")
- greeted racers as they joined
- reminded lurkers that channel points work without joining

This narration carried the hype more than anything the overlay showed. **[said]
[inference]**

## Against the #89 lessons

| #89 lesson | Footage |
|---|---|
| 8 racers, 8–10 is the sweet spot | **Contradicts the count:** this version had **6** seats, and with 65 viewers they often did not fill (the streamer joined himself). Supports "more seats are not needed". |
| 1 Every setback needs a visible cause | **Confirms:** every redemption has a named toast, and chat named the culprit ("POMZOT WHYY"). Adds that the **veteran promotion is not listed**, and the one "rigged" came after a win it decided. |
| 2 Draining hype meter, then `!nuke` by 5 viewers, 1–2 per race | **Not seen:** no meter and no nuke in this March 2026 footage. They may come from a later version. The lesson rests on the owner's account alone. |
| 3 Hitting everyone at once is accepted | **Partly seen:** the green shell fired at the start hits most of the field, and nobody objected. Spengler's habit of doing exactly that was treated as his signature. |
| 4 Leader-or-everyone targeting was enough | **Confirms:** both paid shells target the leading tank. Nobody asked for a named target. |
| 5 Bits least used; keep for strong random effects | **Confirms:** 3 cheers in 12 minutes, two by the author, even after the price cut. The random target also hit the cheerer's own tank, which became the best moment of the video. |
| 7 Stats gain weight from a prize and a reset | **Partly:** four stat tables after every race are kept across races. In chat, live streaks and "first place" drew more talk than the tables. No prize is mentioned in this cut. |
| 8 Operator steps are fine | **Confirms:** the races fill the wait for show-match players, and the operator also has to fill empty seats and talk. The prediction overlay covered the track. |
| 9 Slapstick is optional polish | The winner's tank driving off screen drew a laugh ("Flew off the screen"). |
| ~10 redemptions per race | **Lower here:** 1–5 per race. This cut may drop some, and #89 may describe busier streams. |

## Which decisions on #85 this changes

Most decisions on #85 stand. Three changes and one confirmation:

1. **[#90](https://github.com/p0mz0r/chrono-battlefield/issues/90) cheers.** "Cheers
   can't fail during a race" leaves out a cheer that arrives **as a race ends or between
   races**. In the footage, a chrono toast showed over the stats screen.
   [11:30](https://youtu.be/-U5uS21slB0?t=690) Bits are never refunded, so the game needs
   a rule for that case. Two options: hold the cheer for the next race, or land it in the
   finish area. *(Changes #90; new open question.)*
2. **[#89](https://github.com/p0mz0r/chrono-battlefield/issues/89) chat-wide event.**
   The footage cannot confirm the meter-plus-`!nuke` design, because it isn't in this
   version. Keep the decision on the owner's word, or ask for footage of a later stream
   before #85 specifies "How a chat-wide event is triggered". *(Weakens the evidence; does
   not overturn it.)*
3. **Seats.** Lesson 6's "8–10 tanks" comes from memory. The footage shows 6 seats that
   often did not fill; the old game started with whoever had joined. **[owner]** Keep the race setup's seat count operator-set and let
   [bots](../../GLOSSARY.md) fill empty seats (an existing glossary term), rather than
   counting on 8–10 viewers joining. *(Adjusts #89's lesson 6.)*
4. **Interaction feed and command list.** The footage backs the glossary's choices that
   the game posts nothing to chat (the bot's repeated replies were noise) and that the
   command list stays subtle (the big panel covered the lanes at the start). The standings
   also covered lanes 1–3 at the start. *(Confirms; no change.)*

Also for #85's open points:

- **How hype moments are shown:** the strongest moment came from a random effect hitting
  its own buyer, plus a hidden reward (the veteran win), plus the streamer reacting.
  Every effect that can change a placing should be shown and named, including promotions.
  Otherwise wins look "rigged".
- **Spectator discovery:** the streamer had to say out loud that channel points work
  without joining. The on-screen list split "participants only" and "everyone", but lurkers
  still needed the spoken reminder.
- **Viewers on other platforms:** 21–26 YouTube viewers were watching, and channel points
  and bits exist only on Twitch. This supports #90's Streamer.bot route for other
  platforms.
- **Boost cooldown:** keep a cooldown rather than a hard once-per-race limit. On longer
  maps several boosts per race are fine, but each racer must be able to see clearly when
  their boost is ready again. **[owner]** (The old game's only cue was the streamer saying
  it aloud.)

## Limits

- **Highlight cut, not the full stream.** The cut is 11:47 and lists no source
  timestamps. Breaks between races are trimmed, so how often things happen is a lower
  bound.
- **Chat panel:** Twitch only and about 12 lines high, read at 10–20 s intervals. Fast
  bursts may be missed. `!` commands are filtered out of the panel, so boost, shield and
  join use cannot be counted from chat. Some usernames are dark blue on navy and
  unreadable. The panel may lag the gameplay by a few seconds.
- **Captions:** auto-generated and garble names. Quotes are approximate.
- **Owner answers:** the shield look, the promotion trigger and effect, the start rule
  and the boost cooldown come from the owner, not the footage.
- **One stream:** dated 20-03-2026 (overlay) and labelled Week 12/2026. It may predate the
  hype meter and nuke the owner describes.
