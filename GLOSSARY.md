# Rhino Race

A browser stream mini game: viewers join a race, each gets a tank, and the tanks race along a course laid over a real Red Alert 2 / Yuri's Revenge map while chat interferes.

## Language

### People

**Viewer**:
Anyone in the stream's chat.
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
One round of the game, from the join window opening until every tank has finished or the finish timer runs out.
_Avoid_: Game, match, round

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
A short, visible spell after a stun ends during which no delay can hit the tank again, so chat cannot freeze one tank forever; moves still apply.
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
_Avoid_: Chrono swap, teleport

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

### Chat

**Chat command**:
A chat line that is exactly one listed verb, such as `!rhino` or `!missile`, plus at most its one argument; case and extra spaces don't matter, and every other line is ignored silently.
_Avoid_: Message, redemption

**Command list**:
The subtle on-screen list of the chat commands available right now, such as `!rhino` during the join window; a chat command not on it is ignored silently.
_Avoid_: Help, menu

**Interaction feed**:
The short on-stream lines telling a viewer why an available chat command failed, such as a cooldown or an unknown name; the game posts nothing to chat itself.
_Avoid_: Log, chat reply, toast

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

**Waypoint**:
One cell on a course that tanks must pass close to, in order, on their way to the finish.
_Avoid_: Checkpoint, node, gate

**Lap section**:
A run of consecutive waypoints on a course that tanks drive a set number of times before going on; a circuit is a course that is one lap section.
_Avoid_: Loop, circuit, lap

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
A high bridge on the battlefield, with a deck tanks drive over and ground tanks drive under; during a race it can be destroyed, as long as every unfinished tank can still reach the finish, and repaired. Only the bridges a course puts in play, labelled `B1`, `B2` and on, can be targeted.
_Avoid_: Overpass

**Install**:
The RA2 + Yuri's Revenge files the game reads, from a folder on the operator's PC or uploaded by hand; never committed or redistributed.
_Avoid_: Game files, assets
