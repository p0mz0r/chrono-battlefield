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
The cells at the course's last waypoint; a tank that enters it has finished and leaves the battlefield.
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

**Audience interaction**:
Any chat-triggered effect on the race, such as a missile, the chronosphere, or a boost.
_Avoid_: Superweapon, command, power

### The ground

**Battlefield**:
An imported RA2 / Yuri's Revenge map, used as the terrain a race is run on.
_Avoid_: Map, level, arena

**Course**:
The ordered waypoints from start to finish laid over a battlefield; tanks find their own way between waypoints.
_Avoid_: Path, track, route
