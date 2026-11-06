# Rhino Race

A browser stream mini game: viewers join a race, each gets a tank, and the tanks race along a course laid over a real Red Alert 2 / Yuri's Revenge map while chat interferes.

## Language

### People

**Viewer**:
Anyone in the stream's chat. The same person on two platforms counts as two viewers.
_Avoid_: User, chatter

**Racer**:
A viewer who has joined the current race; owns exactly one tank for that race.
_Avoid_: Player, participant

**Operator**:
The streamer running the game; starts each race and sets its options.
_Avoid_: Admin, host, user

**Course maker**:
Whoever lays a course in the editor, sometimes also the author of its map file; decides the course's waypoints, laps and finish.
_Avoid_: Map maker, designer

### The race

**Race**:
One round of the game, from the join window opening until every tank has finished, the finish timer runs out or the operator ends it. A race the operator ends before it has got far enough is cancelled and has no results.
_Avoid_: Game, match, round

**Race setup**:
The on-stream screen between races where the operator picks the course and the race's options, then opens the join window; it remembers the last choices.
_Avoid_: Lobby, menu, settings

**Join window**:
The opening phase of a race, started by the operator, during which viewers can join as racers; it closes when its time runs out or the field is full, and nobody joins after it closes.
_Avoid_: Lobby, registration, starting countdown

**Start countdown**:
The short 3-2-1 after the join window closes, ending with every tank driving off at once.
_Avoid_: Join window, starting countdown

**Tank**:
The unit on the battlefield, owned by a racer or driven as a bot.
_Avoid_: Unit, vehicle, car

**Bot**:
A tank in the race that no racer owns, added to fill a thin field and labelled as a bot; it competes and places like any other tank.
_Avoid_: AI racer, NPC, racer

**Finish area**:
The marked circle of cells, three tanks wide, around a course's finish cell; a tank that enters it with no waypoints left has finished and leaves the battlefield.
_Avoid_: Finish line, goal

**Finish timer**:
The time limit that starts when the first tank finishes; when it runs out the race ends and unfinished tanks are placed by course progress.
_Avoid_: Time limit, DNF timer

**Course progress**:
How far along the course a tank is, judged from where it is now rather than which waypoints it has visited; a tank moved backwards loses progress and one moved forwards gains it. Orders live standings and places unfinished tanks.
_Avoid_: Distance, position

**Placing**:
A tank's final rank in a race: finished tanks by finish order, then unfinished tanks by course progress. Bots place like any tank.
_Avoid_: Position, score

**Non-lethal**:
The rule that nothing removes a tank from a race or leaves it unable to finish; audience interactions can only delay a tank or move it.
_Avoid_: Destroyed, eliminated, DNF

**Stun**:
A delay in which a tank stops and burns for a few seconds, then drives on unharmed; the baseline effect of a hit. One hit is one stun; there is no health.
_Avoid_: Damage, breakdown, health

**Stun immunity**:
A short, visible spell after a stun ends during which no stun can hit the tank again, so chat cannot freeze one tank forever; moves and radiation still apply.
_Avoid_: Shield, invulnerability

**Target protection**:
A short, visible spell after a harmful audience interaction aimed at a tank by name lands, during which nobody can name that tank as a target; it can still be hit at random or by accident.
_Avoid_: Cooldown, immunity

**Boost**:
An audience interaction giving a tank a short burst of extra speed; any viewer may boost any tank, and boosting again restarts the burst rather than adding to it.
_Avoid_: Nitro, speed-up

**Shield**:
An audience interaction a racer uses on their own tank, blocking every harmful audience interaction for a few seconds; bots shield too, at random moments.
_Avoid_: Iron Curtain, protection, invulnerability

**Homing missile**:
An audience interaction aimed at one tank by name or at random that flies to it and stuns it; only a shield stops it.
_Avoid_: Red shell, rocket

**V3 rocket**:
An audience interaction a racer fires forward or backward from their own tank in a straight line, stunning the first tank in its path; it can be dodged.
_Avoid_: Green shell, missile

**Tesla strike**:
An audience interaction in which a Tesla tank chronoshifts in beside a tank, stuns every tank near it after a short visible charge, and chronoshifts out.
_Avoid_: Area strike, nuke, artillery

**Chronosphere**:
An audience interaction that moves one tank a random distance back along the course, or sometimes, as a misfire, a shorter random distance forward.
_Avoid_: Teleport

**Knockback**:
A move a few cells back along the course that comes with a stun from a big event, for every tank caught in it, intended target or not; personal interactions never knock back.
_Avoid_: Pushback, recoil

**Radiation**:
A glowing patch on the ground that slows every tank driving through it, the more the closer to its centre, but never stops one, until it fades; a shield keeps a tank unharmed, stun immunity does not.
_Avoid_: Slow field, poison

**Viewer cooldown**:
The wait after a viewer uses any audience interaction before they may use another; its length depends on the interaction used.
_Avoid_: Global cooldown, charges

**Move**:
An effect that puts a tank instantly onto another drivable cell, such as being sent back or chronoshifted; the tank drives on from there.
_Avoid_: Teleport, warp, respawn

**Ghosting**:
A short, visible spell in which a tank stuck behind other tanks for too long drives through them until it stands on a free cell.
_Avoid_: Noclip, unstuck

**Audience interaction**:
Any chat-triggered effect on the race, such as a homing missile, the chronosphere, or a boost. Harmful ones delay or move a tank; boost and shield help one.
_Avoid_: Superweapon, command, power

**Personal interaction**:
An audience interaction any viewer sets off alone with a chat command, held to the viewer cooldown; small, and may name its target.
_Avoid_: Basic attack, command

**Big event**:
A paid event or chat-wide event: a spectacle that hits the leading tank, a random tank or the whole field, never a tank by name. Only one plays at a time; others wait their turn in a visible queue.
_Avoid_: Superweapon, ultimate

**Paid event**:
A big event one viewer sets off with a redemption or, for the strongest few, a cheer; never with a chat command.
_Avoid_: Channel-point event, bits event

**Chat-wide event**:
A big event that chat builds up together and then unleashes: chat fills the hype meter, then enough different viewers call for it, and it takes the next turn in the queue, ahead of waiting paid events and cheers. At most two a race; nothing carries over to the next race.
_Avoid_: Global event, raid

**Hype meter**:
The on-stream meter chat fills during a race for the next chat-wide event: every accepted audience interaction from a viewer adds to it, a cheer or anything else paid with money most, a redemption less, a chat command least; failed commands, plain chat lines and bots add nothing. EVA warns when it first passes half full. It drains once nobody has added for a moment, empties when a chat-wide event is set off, and is gone for the rest of the race after the second.
_Avoid_: Hype train, chaos meter, bar

**Armed**:
The hype meter's state once full: it holds without draining for a short spell, its chat-wide event's command (`!nuke`) appears on the command list, and the event is set off once enough different viewers type it; `!nuke` is free of the viewer cooldown, each viewer counts once per spell, and a repeat is ignored silently. Nothing adds to an armed meter; if the spell runs out first, the meter drains again from full.
_Avoid_: Ready, charged, primed

**Nuke**:
The chat-wide event: a few seconds after EVA announces the launch, with the nuke siren sounding as the missile falls on the leading tank and no on-screen countdown, it stuns every tank on the field for longer than a normal stun, longer still the further along the course a tank is, each ending at its own random moment so the field restarts in a new order; only a shield still up at the moment of impact saves a tank.
_Avoid_: Nuclear strike, bomb

**Kirov airship**:
A paid event: an airship flies slowly in from behind the leading tank and bombs whichever tank leads as it arrives; every tank in the blast is stunned and knocked back, unless shielded; stun immunity spares the stun but not the knockback.
_Avoid_: Zeppelin, blimp, airstrike

**Desolator**:
A paid event that leaves radiation on the course just ahead of the leading tank.
_Avoid_: Rad cannon, slow trap

**Chrono swap**:
A paid event, also set off by a cheer, that swaps the places of two random tanks still racing, one from the front half of them in the standings and one from the back half.
_Avoid_: Chronosphere, teleport, switch

### Chat

**Chat command**:
A chat line that is exactly one listed verb, such as `!rhino` or `!missile`, plus at most its one argument; case and extra spaces don't matter, and every other line is ignored silently.
_Avoid_: Message, redemption

**Chat source**:
Where the game hears chat, redemptions and cheers from: **Streamer.bot**, which can bring in several platforms, or **Twitch direct** after the operator logs in. The operator picks exactly one.
_Avoid_: Integration, connector, bot

**Redemption**:
A viewer spending channel points on one of the game's rewards to set off an audience interaction; it is fulfilled when the interaction lands and refunded when it fails. Never a chat command, and not held to the viewer cooldown.
_Avoid_: Reward, purchase, chat command

**Settlement**:
The race's word back to the chat source on a redemption: fulfilled when its event lands, refunded when it fizzles, is still waiting at race end or arrives outside a race. Cheers are never settled.
_Avoid_: Ack, receipt

**Cheer**:
A viewer spending bits to set off an audience interaction; bits are never refunded, so a cheer's interaction cannot fail during a race.
_Avoid_: Bits, donation, redemption

**Command list**:
The subtle on-screen list of the chat commands available right now, such as `!rhino` during the join window; a chat command not on it is ignored silently.
_Avoid_: Help, menu

**Interaction feed**:
The short on-stream lines naming who did what: each audience interaction that lands, with the viewer who used it and the tank it hit or helped, and each available chat command that failed, with the reason, such as a cooldown or an unknown name; the game posts nothing to chat itself.
_Avoid_: Log, chat reply, toast

### On stream

**Camera mode**:
How the stream's camera shows a race, switched by the operator: **Overview** or **Director**.
_Avoid_: View, cam

**Overview**:
The camera mode that holds the whole course in one still frame; tanks are small, so their labels are number chips.
_Avoid_: Map view, wide shot

**Director**:
The camera mode that zooms in and cuts between the leading tank, the closest fight for a place and the tank last hit, captioning the tank on screen with its name, its place and, after a hit, who hit it; labels show names. When a big event's turn comes it cuts to the event's target and holds there until a few seconds after it lands; after a nuke it holds until the first stun ends, then cuts to that tank, captioned "First away".
_Avoid_: Chase cam, spectator, auto-cam

**Standings**:
The live table of every tank in the race, in order of finish then course progress, each with its course progress as a % of the whole race; shown in both camera modes, never cut to the top few.
_Avoid_: Leaderboard, rankings, top 5

**Event banner**:
The headline shown from the moment a big event's turn comes until it lands, naming the event and who set it off: the viewer for a paid event, chat and the viewers who called for it for a chat-wide event. Personal interactions never get one.
_Avoid_: Toast, alert, popup

**Target ring**:
The pulsing red ring under a big event's target from its turn until it lands, in both camera modes: on the leading tank, on a cell, or on both Chrono swap tanks joined by a line. It moves to whoever the event will hit instead when its target finishes.

**Event queue**:
The row of chips beside the hype meter showing the big event playing now and the ones waiting, in order, each with who set it off (a chat-wide event's chip reads "next" instead); a cheer carried over to the next race keeps its chip, marked "next race", through race setup and the join window.
_Avoid_: Queue bar, timeline

**Results**:
The screen after a race listing every tank's placing with its finish time, or DNF if unfinished.
_Avoid_: Podium, scoreboard

### The ground

**Battlefield**:
An imported RA2 / Yuri's Revenge map, used as the terrain a race is run on.
_Avoid_: Map, level, arena

**Map file**:
The `.map`, `.yrm` or `.mpr` file a battlefield is imported from, either shipped with the game or a custom map made in Final Alert 2.
_Avoid_: Battlefield, scenario

**Course**:
A start grid, ordered waypoints and a finish area laid over a battlefield; tanks find their own way between waypoints. One battlefield can carry many courses.
_Avoid_: Path, track, route

**Course file**:
One file, `<name>.rhino-course.json`, that carries a course to an operator, with its custom map inside when it has one; the operator imports it in race setup.
_Avoid_: Course pack, map pack, export

**Waypoint**:
One cell on a course that tanks must pass close to, in order, on their way to the finish.
_Avoid_: Checkpoint, node, gate

**Lap section**:
A run of consecutive waypoints on a course that tanks drive a set number of times before going on; a circuit is a course that is one lap section.
_Avoid_: Loop, circuit, lap

**Fork**:
A second way from one waypoint to a later one, through its own fork cells; each tank takes it at the fork's set chance, otherwise drives the waypoints between.
_Avoid_: Alternate route, branch, via, route waypoint

**Start grid**:
The ten cells where a course's tanks are placed at random before the start countdown.
_Avoid_: Grid, spawn, starting line

**Ideal line**:
The fastest route from the start grid through a course's waypoints in order, each lap section repeated, to the finish area, ignoring tanks; course progress is measured along it.
_Avoid_: Racing line, centre line, path

**Leading tank**:
The unfinished tank with the most course progress.
_Avoid_: Leader, first place, pole

**Bridge**:
A bridge on the battlefield: a high bridge, with a deck tanks drive over and ground tanks drive under, or a low bridge, a strip of road over water. During a race it can be destroyed, whole, as long as every unfinished tank can still reach the finish, and repaired. Only the bridges the course maker puts in play, labelled `B1`, `B2` and on, can be targeted; the map's own `DestroyableBridges` setting is ignored. In RA2 the bomb goes on the bridge's repair hut and the whole bridge explodes.
_Avoid_: Overpass

**Install**:
The RA2 + Yuri's Revenge files the game reads, from a folder on the operator's PC or uploaded by hand; never committed or redistributed.
_Avoid_: Game files, assets
