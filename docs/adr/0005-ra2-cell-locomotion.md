# Tanks move by RA2 cell locomotion, with travel-time pathfinding

Tanks move the way RA2/YR moves a Rhino ([#3](https://github.com/p0mz0r/chrono-battlefield/issues/3)), in RA2 units (leptons, frames, `ROT`) on a fixed-step simulation whose tick rate is one setting (default 30 Hz, tuned by playing), interpolated to 60 fps for drawing. One tank per cell, plus the cell it is heading into (and a two-cell track's midpoint) reserved. Passability comes from data: each cell's land type and `Track=` value, cliff-foot Rock (`CliffBackImpassability=2`), ±1 level only via ramps, high-bridge decks as a second layer at +4; trees, walls and buildings are hard blockers that tanks never shoot through. Tanks turn in place at `ROT` before the first step and then drive RA1's curved tracks (`DriveClass` `RawTracks` / `TrackControl` from EA's GPL-3 C&C release, compatible with [ADR 0003](0003-gpl-with-readers-ported-from-openra2.md)), with no acceleration and a per-tank speed multiplier that scales speed, never `ROT`. All tanks are friendly to each other: a blocked tank asks a stationary one to make way, waits behind a moving one and then detours (`BlockagePathDelay`), and, unlike RA2, never gives up or stops "close enough", because the non-lethal floor ([ADR 0001](0001-non-lethal-racing.md)) needs every tank able to finish.

We deviate from RA2 in pathfinding: plain 8-neighbour A* where a step costs its travel time (terrain speed, √2 on diagonals), with RA2's occupancy pricing on top. RA2 prices no terrain and its hierarchical search often misses the shortest route; that is fine for an RTS but reads as tanks racing badly, and battlefields with at most 10 tanks don't need the hierarchy.

Other rules that hang off this:

- Tanks resolve in a per-race seeded order, so a race replays from its seed.
- An intermediate waypoint counts as reached within 2.25 cells (data); finishing still needs the finish area.
- A stunned tank stops mid-step holding its cells and cannot be asked to make way.
- A moved tank lands on the nearest drivable, tank-free, non-bridge cell that can reach its next waypoint, drops its old cells and re-paths by course progress; a stun carries on.
- A tank that enters no new cell for 10 s ghosts through other tanks until it stands on a free cell.
- Bridges can be destroyed and repaired during a race by audience interactions, but a destroy is refused unless every unfinished tank keeps a route to the finish, ignoring tanks; tanks on or under it are moved off. RA2's "can't stop under a bridge" is dropped.
- Diagonal corner-cutting copies RA2 once an in-game test settles it; until then a diagonal step is refused when either orthogonal neighbour is blocked by terrain.

## Considered Options

- **RA2's hierarchical, terrain-blind route search**: faithful, but tanks would plough through ore and take visibly poor lines in a race.
- **Straight cell-to-cell driving**: less code than porting tracks, but looks robotic next to real RA2 movement.
- **Own curves, or YR's tables reverse-engineered from `gamemd.exe`**: own curves only approximate the look; the exe route is slow and legally murkier. Chrono Divide is closed and documents nothing, so it can't be copied. Fallback to own curves if RA1's tables look wrong in play.
- **Racers as enemies, or giving up when stuck**: enemies would fire (disabled anyway) and jams wouldn't resolve; giving up breaks the non-lethal floor.
- **Indestructible bridges**: simplest and safe, but loses a good audience interaction; the route check keeps destruction within the floor.
