import { addTank, createField, isDriving, orderMove, random, tick, TICK_HZ, type Cell, type CellGrid, type Field, type Tank } from '../movement/index.js';
import { courseProgress, type Course } from './course.js';

// The headless race (#6 rules, #8 chat contract): plain data stepped by `tickRace`, no rendering.

/** Field limits (#6). */
export const MAX_TANKS = 10;
const BOT_FILL = 8;
/** Waypoint reach radius in cells (rulesmd `CloseEnough=2.25`). */
export const REACH = 2.25;

export type Phase = 'idle' | 'join' | 'countdown' | 'racing' | 'results';

/** One raw chat line from any source (test-chat panel now, platform adapters later). */
export interface ChatLine {
  /** Opaque, set by the adapter, e.g. `twitch:123`. */
  viewerId: string;
  /** Display name as the stream shows it. */
  name: string;
  text: string;
}

/** What a chat line did. `reason: 'ignored'` = silent: nothing shows on stream. */
export interface ChatResult {
  ok: boolean;
  reason: string;
}

export interface Racer {
  /** Undefined for bots. */
  viewerId: string | undefined;
  /** Label on the tank: display name (`#2` on a collision) or `Bot1`… */
  name: string;
  bot: boolean;
  tank: Tank | undefined;
  /** Index into `course.waypoints` of the next waypoint; `waypoints.length` = heading for the finish. */
  next: number;
  /** Course progress in cells along the ideal line. */
  progress: number;
  /** Race frame (since GO) the tank finished on. */
  finishedAt: number | undefined;
  /** Seeded random tie-break: placings are never shared. */
  tie: number;
}

export interface Race {
  readonly course: Course;
  readonly field: Field;
  phase: Phase;
  racers: Racer[];
  /** Frames left in the current timed phase (join window, countdown, finish timer once running). */
  timer: number;
  /** Frames since GO. */
  frame: number;
  finishFrames: number;
  /** Placings, set when the race ends. */
  results: Standing[];
}

export interface Standing {
  name: string;
  bot: boolean;
  /** Course progress as a fraction of the whole race (1 when finished). */
  progress: number;
  /** Seconds from GO to finishing, or undefined (DNF). */
  finishTime: number | undefined;
}

export function createRace(course: Course, grid: CellGrid, seed: number): Race {
  return { course, field: createField(grid, seed), phase: 'idle', racers: [], timer: 0, frame: 0, finishFrames: 0, results: [] };
}

/** Operator: opens the join window (default 90 s); the finish timer (default 60 s) starts at the first finish. */
export function openJoinWindow(race: Race, { joinSeconds = 90, finishSeconds = 60 } = {}): void {
  if (race.phase !== 'idle' && race.phase !== 'results') return;
  Object.assign(race, { phase: 'join', racers: [], timer: joinSeconds * TICK_HZ, frame: 0, finishFrames: finishSeconds * TICK_HZ, results: [] });
  race.field.tanks.length = 0;
}

const IGNORED: ChatResult = { ok: false, reason: 'ignored' };

/** The chat-command contract: every line from every source comes through here. */
export function chat(race: Race, line: ChatLine): ChatResult {
  const words = line.text.trim().toLowerCase().split(/\s+/);
  if (words.length !== 1 || words[0] !== '!rhino') return IGNORED;
  if (race.phase !== 'join' || race.racers.some((r) => r.viewerId === line.viewerId)) return IGNORED;
  const taken = (name: string) => /^bot[1-8]$/i.test(name) || race.racers.some((r) => r.name.toLowerCase() === name.toLowerCase());
  let name = line.name.trim() || line.viewerId;
  for (let n = 2, base = name; taken(name); n++) name = `${base}#${n}`;
  race.racers.push(racer(race, name, line.viewerId));
  if (race.racers.length === MAX_TANKS) closeJoinWindow(race);
  return { ok: true, reason: `joined as ${name}` };
}

const racer = (race: Race, name: string, viewerId?: string): Racer =>
  ({ viewerId, name, bot: viewerId === undefined, tank: undefined, next: 0, progress: 0, finishedAt: undefined, tie: random(race.field) });

/** Closes the join window: bots fill to 8, tanks go on random start cells facing the first waypoint, 3-2-1. */
function closeJoinWindow(race: Race) {
  if (!race.racers.length) {
    race.phase = 'idle';
    return;
  }
  for (let n = 1; race.racers.length < BOT_FILL; n++) race.racers.push(racer(race, `Bot${n}`));
  const cells = [...race.course.startGrid];
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(random(race.field) * (i + 1));
    [cells[i], cells[j]] = [cells[j]!, cells[i]!];
  }
  const first = race.course.waypoints[0] ?? race.course.finish;
  race.racers.forEach((r, i) => {
    const c = cells[i]!;
    r.tank = addTank(race.field, c, { facing: Math.round((Math.atan2(first.x - c.x, c.y - first.y) / (2 * Math.PI)) * 65536) & 0xffff });
    r.progress = courseProgress(race.course, c.x + 0.5, c.y + 0.5, 0);
  });
  race.phase = 'countdown';
  race.timer = 3 * TICK_HZ;
}

/** Seconds left on the start countdown (3, 2, 1), the join window or the finish timer. */
export const secondsLeft = (race: Race) => Math.ceil(race.timer / TICK_HZ);

/** Operator: ends the race now with results. */
// ponytail: always results; #46 adds the cancel below 50 % course progress.
export function endRace(race: Race): void {
  if (race.phase !== 'countdown' && race.phase !== 'racing') return;
  race.phase = 'results';
  race.results = standings(race);
}

/** One frame (1 / TICK_HZ s). */
export function tickRace(race: Race): void {
  if (race.phase === 'join' && --race.timer <= 0) closeJoinWindow(race);
  else if (race.phase === 'countdown' && --race.timer <= 0) race.phase = 'racing';
  else if (race.phase === 'racing') drive(race);
}

const near = (tank: Tank, c: Cell) => !tank.cell.deck && Math.hypot(tank.x / 256 - c.x - 0.5, tank.y / 256 - c.y - 0.5) <= REACH;

function drive(race: Race) {
  const { course, field } = race;
  race.frame++;
  tick(field);
  const anyFinished = race.racers.some((r) => r.finishedAt !== undefined);
  for (const r of race.racers) {
    const tank = r.tank!;
    if (r.finishedAt !== undefined) continue;
    // Waypoints count only when reached; a move (#43) sets `next` to the first waypoint ahead of where it lands.
    while (r.next < course.waypoints.length && near(tank, course.waypoints[r.next]!)) r.next++;
    r.progress = courseProgress(course, tank.x / 256, tank.y / 256, r.next);
    if (r.next === course.waypoints.length && !tank.cell.deck && course.finishArea.has(tank.cell.y * field.grid.width + tank.cell.x)) {
      r.finishedAt = race.frame;
      r.progress = course.length;
      field.tanks.splice(field.tanks.indexOf(tank), 1); // the tank leaves the battlefield
      continue;
    }
    const to = course.waypoints[r.next] ?? course.finish;
    // ponytail: re-searches every frame while a goal stays unreachable (only after the grid changes, #44).
    if (tank.goal?.x !== to.x || tank.goal.y !== to.y) if (tank.goal || !isDriving(tank)) orderMove(field, tank, to);
  }
  if (!anyFinished && race.racers.some((r) => r.finishedAt !== undefined)) race.timer = race.finishFrames;
  else if (anyFinished) race.timer--;
  if (race.racers.every((r) => r.finishedAt !== undefined) || (anyFinished && race.timer <= 0)) {
    race.phase = 'results';
    race.results = standings(race);
  }
}

/** Every tank: finished ones in finish order, then by course progress; ties broken by seed. */
export function standings(race: Race): Standing[] {
  const len = race.course.length || 1;
  return [...race.racers]
    .sort((a, b) => (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) || b.progress - a.progress || a.tie - b.tie)
    .map((r) => ({ name: r.name, bot: r.bot, progress: r.finishedAt === undefined ? Math.min(r.progress / len, 1) : 1, finishTime: r.finishedAt === undefined ? undefined : r.finishedAt / TICK_HZ }));
}
