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

### The race

**Race**:
One round of the game, from the join window opening to the finish.
_Avoid_: Game, match, round

**Tank**:
The unit on the battlefield that a racer owns.
_Avoid_: Unit, vehicle, car

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
