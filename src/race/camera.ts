import { TICK_HZ } from '../movement/index.js';
import type { CourseFile } from './course.js';
import { playingEvent, standings, type Race, type Racer, type Turn } from './race.js';

/** The leader's lap of the course's lap section, for the standings header; undefined without a lap section. */
export function currentLap(race: Race): { lap: number; count: number } | undefined {
  const lead = race.racers.find((r) => r.name === standings(race)[0]?.name);
  return lapOf(race.course.file.laps, lead?.next ?? 0);
}

/**
 * The lap of the latest lap section reached at unrolled waypoint index `next` (the first section before any).
 * Lap k of a section starts once its first waypoint is passed for the k-th time; earlier sections' repeats shift
 * where a later section starts in the unrolled line.
 */
export function lapOf(laps: CourseFile['laps'], next: number): { lap: number; count: number } | undefined {
  let shift = 0, result: { lap: number; count: number } | undefined;
  for (const section of [...laps].sort((a, b) => a.from - b.from)) {
    const start = section.from + shift, len = section.to - section.from + 1;
    if (result && next <= start) break;
    result = { lap: Math.min(section.count, Math.max(1, Math.ceil((next - start) / len))), count: section.count };
    shift += (section.count - 1) * len;
  }
  return result;
}

/** What the director camera is on: the tank, why (the lower third's caption) and when it cut there. */
export interface Shot {
  racer: Racer;
  reason: string;
  cutAt: number;
  /** `race.lastHitFrame` already cut to (or skipped). */
  hitSeen: number;
  /** The big event the shot holds on. */
  event?: Turn;
}

const HOLD = 7 * TICK_HZ, HIT_GAP = 2.5 * TICK_HZ, EVENT_HOLD = 3 * TICK_HZ;

/** The big event the director holds on: the one playing, or the last one until 3 s after it lands (after a nuke, after the first stun ends). */
function heldEvent(race: Race): Turn | undefined {
  const landed = race.landed;
  return playingEvent(race) ?? (landed && race.frame < (landed.firstAway?.stunUntil ?? landed.lands!) + EVENT_HOLD ? landed : undefined);
}

/** The tank and caption a big event's shot holds on, if that tank is still racing. */
function eventFocus(race: Race, event: Turn): { racer: Racer; reason: string } | undefined {
  const landed = event === race.landed;
  const away = landed && event.firstAway && race.frame >= event.firstAway.stunUntil ? event.firstAway : undefined;
  const [racer, reason]: [Racer | undefined, string] = event.event === 'nuke'
    ? away ? [away, 'First away'] : [event.picks[0], `Nuke by ${event.by}`]
    : [event.picks[1], landed ? `Swapped up front by ${event.by}` : `Chrono swap by ${event.by}`];
  return racer && racer.finishedAt === undefined ? { racer, reason } : undefined;
}

/**
 * The director's next shot (the same object while it holds). A big event's turn cuts to its target and holds until
 * 3 s after it lands; a Chrono swap shows the back tank, then cuts to it landing up front; a nuke holds on its target
 * until the first stun ends, then cuts to that tank ("First away") for 3 s. Hits meanwhile are never
 * cut to. Otherwise a new hit cuts to the tank hit, once at least 2.5 s
 * have passed since the last cut; otherwise each shot holds 7 s (less if its tank finishes), alternating the leader
 * with the chaser in the closest fight for a place. Only unfinished tanks are shown.
 */
export function directorShot(race: Race, prev: Shot | undefined): Shot {
  const event = heldEvent(race);
  const focus = event && eventFocus(race, event);
  if (focus) {
    if (prev?.event === event && prev.racer === focus.racer && prev.reason === focus.reason) return prev;
    return { ...focus, cutAt: race.frame, hitSeen: race.lastHitFrame, event };
  }
  const hit = race.lastHit;
  const since = prev ? race.frame - prev.cutAt : Infinity;
  // Hits held back during an event are dropped.
  const hitSeen = prev?.event ? race.lastHitFrame : prev?.hitSeen ?? -1;
  if (hit && race.lastHitFrame > hitSeen && hit.finishedAt === undefined && since >= HIT_GAP) {
    return { racer: hit, reason: `Hit by ${race.lastHitBy}`, cutAt: race.frame, hitSeen: race.lastHitFrame };
  }
  if (prev && !prev.event && prev.racer.finishedAt === undefined && since < HOLD) return prev;
  const order = standings(race);
  const live = order.filter((s) => s.finishTime === undefined).map((s) => race.racers.find((r) => r.name === s.name)!);
  if (!live.length) return prev ?? { racer: race.racers[0]!, reason: 'Leader', cutAt: race.frame, hitSeen };
  if (prev?.reason === 'Leader' && live.length > 1) {
    let closest = 1;
    for (let i = 2; i < live.length; i++) if (live[i - 1]!.progress - live[i]!.progress < live[closest - 1]!.progress - live[closest]!.progress) closest = i;
    const chaser = live[closest]!;
    const place = order.findIndex((s) => s.name === chaser.name) + 1;
    return { racer: chaser, reason: `Battle for P${place - 1}`, cutAt: race.frame, hitSeen };
  }
  return { racer: live[0]!, reason: 'Leader', cutAt: race.frame, hitSeen };
}
