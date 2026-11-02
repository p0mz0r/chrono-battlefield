# What worked and fell flat on stream with the earlier Rhino Race

Answers #89 for the chaos update map #85. Recorded 2026-11-02.

**Source:** the owner's account of streaming the earlier Rhino Race many times on a
friend's channel, given in a grilling session. No footage was reviewed yet; a clip
review is tracked separately (see the end). Names of the earlier game's effects are
written *old V3*, *old green shell* and *old chronosphere* because they do not match
today's glossary terms of the same name.

## The earlier game

A self-built Streamer.bot implementation, not the stalled `p0mz0r/rhino-race`
browser build. Eight Rhinos drove in straight lanes from left to right.

| Trigger | Effect |
|---|---|
| `!rhino` (chat) | Join the race. Max 8 racers, min 2. |
| `!boost` (chat, racers) | Short burst of speed for the racer's own tank. |
| `!shield` (chat, racers) | Short Iron-Curtain-style shield on the racer's own tank. |
| `!nuke` (chat, anyone) | Only once the hype meter is full; typed 5 times, it stops the whole field; tanks restart at random with a slight handicap. |
| Old V3 (channel points) | Rocket at the leading tank, knocks it back. |
| Old green shell (channel points) | Shell sweeps down the screen and hits every tank. |
| Chrono legionnaire (7 bits) | Holds one random tank still for 3 s; it cannot be hit meanwhile. |
| Old chronosphere (14 bits) | Swaps two random tanks' positions. |

Every command, channel-point reward and bit reward was listed on screen.

## How it played

- **Chat size:** 40–110 viewers. Races were usually full (8); some had 5–7. Some
  90 s join windows did not fill 8 seats.
- **Pace:** a race took 2–3 minutes with about 10 redemptions. A stream ran 3–20
  races, sometimes to bridge a break between matches, most often after the
  streamer's show matches.
- **Nuke:** after tuning it went off 1–2 times per race. Anyone could type it, and
  by oversight one viewer could type it all 5 times. Nobody complained about the
  random handicapped restart.
- **Hype meter:** visible on stream, filled by every attack, boost and shield, and
  drained over time, so chat had to keep engaging. The hype moment was the whole
  sequence: meter filling, chat typing `!nuke`, the nuke landing.
- **Stats:** wins, last places, hits dealt and hits taken, kept across races until
  the streamer reset them by hand. The streamer gave one gifted sub a week to
  whoever led the stats on Sunday, then reset. Some chatter about them, not much.
- **Operator work:** switch scene with a Stream Deck button, start the countdown,
  then everything ran by itself until the stats screen; the next race was started
  by hand.

## What worked

- Channel-point rewards and the racers' boost and shield were used often.
- Hitting only the leader (old V3) was enough targeting; nobody asked to name a
  racer.
- The chat-wide nuke: a meter that drains, then several viewers acting together,
  then a field-wide payoff, 1–2 times a race.
- Listing every command and reward on screen: viewers were not confused.
- Clipped moments: close finishes, a win from far back, a perfectly timed shield.
- A weekly prize tied to the stats gave them some weight.

## What fell flat

- **Bit rewards were the least used.** Not every viewer wants to spend bits, and
  bits may not be available in every country.
- **Bugs decided races.** Tanks knocked off their lane, or two in one lane, made
  funny clips but made racers feel cheated when the apparent winner lost.
- **Full races** left some viewers unable to join.
- **Not winning** was the main racer complaint.

## Lessons for the chaos update

1. **Every setback needs a visible cause in chat.** A loss to a visible chat action
   feels fair; a loss nobody can explain feels like cheating. Bugs that look funny
   are not worth recreating.
2. **Chat-wide events: a draining meter fed by all interactions, then distinct
   viewers acting together.** `!nuke` should need 5 *different* viewers. 1–2 big
   events per 2–3 minute race was the tuned rate.
3. **Hitting everyone at once is accepted,** even with a random handicapped restart.
4. **Leader-or-everyone targeting was enough** for the paid tier on the earlier game.
5. **Bits: keep for very strong effects, with random targets,** never aimed at a
   chosen viewer; expect few uses.
6. **8–10 tanks per race is the sweet spot;** more seats are not needed, because
   smaller fields also happened.
7. **Stats gain weight from a prize and an operator reset,** not from being
   all-time. Input for #85's "Persistence and rivalries".
8. **Operator steps per race are fine:** scene switch, start, next race by hand.
9. **Slapstick is optional polish:** a stunned tank spinning its hull, or flipped
   or spinning upside down, kept for later; nothing that changes cells or progress.

## Not yet reviewed

Footage of the earlier game (a clip or past broadcast from the friend's channel)
can confirm or adjust these lessons; that review is #92.
