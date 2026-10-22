# Tanks are never destroyed: races are non-lethal

In a game about tanks firing at tanks, no audience interaction can remove a tank from a race or leave it unable to finish; effects only delay a tank (a short stun, followed by brief stun immunity) or move it to a drivable cell. We gave up the elimination moment because on a small stream a viewer knocked out after twenty seconds has nothing left to watch, and a race could end with nobody finishing. This re-decides rhino-race-2's ADR 0005 on its own merits but drops its breakdown meter: one hit is one stun, with no hidden health.

## Considered Options

- **Lethal with DNF**: most dramatic, but eliminated racers lose interest and a race can end with no finisher.
- **Destroy and respawn at a recent waypoint**: keeps a "kill" moment; still available to the interaction roster as a move effect, since it obeys the same rule.
