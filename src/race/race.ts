import { addTank, createField, isDriving, orderMove, random, tick, TICK_HZ, type Cell, type CellGrid, type Field, type Tank } from '../movement/index.js';
import { courseProgress, type Course } from './course.js';
import { repairBridge, toggleBridge, type BridgeGrid } from './bridge.js';

// The headless race (#6 rules, #8 chat contract): plain data stepped by `tickRace`, no rendering.

/** Field limits (#6). */
export const MAX_TANKS = 10;
const BOT_FILL = 8;
/** Waypoint reach radius in cells (rulesmd `CloseEnough=2.25`). */
export const REACH = 2.25;
const COMMANDS = {
  rhino: { hint: '', cooldown: 0, racers: false },
  boost: { hint: ' [name]', cooldown: 20, racers: false },
  shield: { hint: '', cooldown: 30, racers: true },
  missile: { hint: ' [name]', cooldown: 30, racers: false },
  bridge: { hint: ' B1', cooldown: 60, racers: false },
} as const;
type Interaction = Exclude<keyof typeof COMMANDS, 'rhino'>;
const interactions = Object.keys(COMMANDS).filter((verb): verb is Interaction => verb !== 'rhino');

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
  boostUntil: number;
  shieldUntil: number;
  stunUntil: number;
  immunityUntil: number;
  protectedUntil: number;
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
  /** Interactions enabled for this race; setup can select a subset. */
  enabled: Set<Interaction>;
  cooldowns: Map<string, number>;
  /** Visible failures, newest last. */
  feed: string[];
  feedUntil: Map<string, number>;
  missiles: { target: Racer; named: boolean; launched: number; arrives: number; x: number; y: number }[];
  lastHit: Racer | undefined;
  lastHitFrame: number;
  bridgeGrid: BridgeGrid | undefined;
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
  const bridgeGrid = 'bridge' in grid && 'bridges' in grid ? grid as BridgeGrid : undefined;
  return { course, field: createField(grid, seed), phase: 'idle', racers: [], timer: 0, frame: 0, finishFrames: 0, results: [], enabled: new Set(interactions.filter((verb) => verb !== 'bridge' || (bridgeGrid && course.file.bridges.length))), cooldowns: new Map(), feed: [], feedUntil: new Map(), missiles: [], lastHit: undefined, lastHitFrame: -1, bridgeGrid };
}

export function commandList(race: Race): string[] {
  if (race.phase === 'join') return [`!rhino${COMMANDS.rhino.hint}`];
  if (race.phase !== 'racing') return [];
  return interactions.filter((verb) => race.enabled.has(verb))
    .map((verb) => `!${verb}${COMMANDS[verb].hint}${COMMANDS[verb].racers ? ' (racers)' : ''}`);
}

/** Operator: opens the join window (default 90 s); the finish timer (default 60 s) starts at the first finish. */
export function openJoinWindow(race: Race, { joinSeconds = 90, finishSeconds = 60 } = {}): void {
  if (race.phase !== 'idle' && race.phase !== 'results') return;
  Object.assign(race, { phase: 'join', racers: [], timer: joinSeconds * TICK_HZ, frame: 0, finishFrames: finishSeconds * TICK_HZ, results: [] });
  race.field.tanks.length = 0;
  race.cooldowns.clear();
  race.feed.length = 0;
  race.feedUntil.clear();
  race.missiles.length = 0;
  race.lastHit = undefined;
  race.lastHitFrame = -1;
  for (const [id, bridge] of race.bridgeGrid?.bridges.entries() ?? []) {
    if (bridge.destroyed) repairBridge(race.bridgeGrid!, id);
    bridge.changedAt = undefined;
  }
}

const IGNORED: ChatResult = { ok: false, reason: 'ignored' };

/** The chat-command contract: every line from every source comes through here. */
export function chat(race: Race, line: ChatLine): ChatResult {
  const words = line.text.trim().toLowerCase().split(/\s+/);
  if (words.length > 2) return IGNORED;
  const word = words[0] ?? '';
  if (!word.startsWith('!')) return IGNORED;
  const verb = word.slice(1) as keyof typeof COMMANDS;
  if (!Object.hasOwn(COMMANDS, verb)) return IGNORED;
  if (verb === 'rhino') {
    if (words.length !== 1) return IGNORED;
    if (race.phase !== 'join' || race.racers.some((r) => r.viewerId === line.viewerId)) return IGNORED;
    const taken = (name: string) => /^bot[1-8]$/i.test(name) || race.racers.some((r) => r.name.toLowerCase() === name.toLowerCase());
    let name = line.name.trim() || line.viewerId;
    for (let n = 2, base = name; taken(name); n++) name = `${base}#${n}`;
    race.racers.push(racer(race, name, line.viewerId));
    if (race.racers.length === MAX_TANKS) closeJoinWindow(race);
    return { ok: true, reason: `joined as ${name}` };
  }
  if (race.phase !== 'racing' || !race.enabled.has(verb)) return IGNORED;
  if ((verb === 'shield' && words.length !== 1) || (verb === 'bridge' && words.length !== 2) || (verb !== 'shield' && words.length > 2)) return IGNORED;
  const reject = (reason: string): ChatResult => {
    if ((race.feedUntil.get(line.viewerId) ?? 0) <= race.frame) {
      race.feed.push(`${line.name}: ${reason}`);
      race.feedUntil.set(line.viewerId, race.frame + 3 * TICK_HZ);
      if (race.feed.length > 5) race.feed.shift();
    }
    return { ok: false, reason };
  };
  const left = (race.cooldowns.get(line.viewerId) ?? 0) - race.frame;
  if (left > 0) return reject(`cooldown ${Math.ceil(left / TICK_HZ)} s`);
  if (verb === 'bridge') {
    const result = toggleBridge(race, words[1]);
    if (!result.ok) return reject(result.reason);
    race.cooldowns.set(line.viewerId, race.frame + COMMANDS.bridge.cooldown * TICK_HZ);
    return result;
  }
  let target: Racer | undefined;
  let named = false;
  if (verb === 'shield') {
    target = race.racers.find((r) => r.viewerId === line.viewerId && r.finishedAt === undefined);
    if (!target) return reject('not a racing racer');
  } else if (words[1]) {
    named = true;
    const name = words[1].replace(/^@/, '');
    const candidates = race.racers.filter((r) => r.finishedAt === undefined);
    target = candidates.find((r) => r.name.toLowerCase() === name);
    if (!target && name.length >= 3) {
      const matches = candidates.filter((r) => r.name.toLowerCase().startsWith(name));
      if (matches.length > 1) return reject('ambiguous name');
      target = matches[0];
    }
    if (!target) return reject('unknown name');
    if (verb === 'missile' && target.protectedUntil > race.frame) return reject('target protected');
    if (verb === 'missile' && target.immunityUntil > race.frame && target.shieldUntil <= race.frame) return reject('target unable');
  } else {
    const candidates = race.racers.filter((r) => r.finishedAt === undefined && (verb !== 'missile' || r.immunityUntil <= race.frame || r.shieldUntil > race.frame));
    target = candidates[Math.floor(random(race.field) * candidates.length)];
    if (!target) return reject('no target available');
  }
  race.cooldowns.set(line.viewerId, race.frame + COMMANDS[verb].cooldown * TICK_HZ);
  if (verb === 'boost') {
    target.boostUntil = race.frame + 5 * TICK_HZ;
    target.tank!.speedFactor = 1.5;
  } else if (verb === 'shield') target.shieldUntil = race.frame + 6 * TICK_HZ;
  else race.missiles.push({ target, named, launched: race.frame, arrives: race.frame + Math.round(1.5 * TICK_HZ), x: target.tank!.x / 256 - 6, y: target.tank!.y / 256 - 6 });
  return { ok: true, reason: `${verb} ${target.name}` };
}

const racer = (race: Race, name: string, viewerId?: string): Racer =>
  ({ viewerId, name, bot: viewerId === undefined, tank: undefined, next: 0, progress: 0, finishedAt: undefined, tie: random(race.field), boostUntil: 0, shieldUntil: 0, stunUntil: 0, immunityUntil: 0, protectedUntil: 0 });

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
  for (const r of race.racers) if (r.tank && r.boostUntil <= race.frame) r.tank.speedFactor = 1;
  for (let i = race.missiles.length - 1; i >= 0; i--) {
    const missile = race.missiles[i]!;
    if (missile.arrives > race.frame) continue;
    race.missiles.splice(i, 1);
    const r = missile.target;
    if (r.finishedAt !== undefined || r.shieldUntil > race.frame || r.immunityUntil > race.frame) continue;
    r.stunUntil = race.frame + 3 * TICK_HZ;
    r.immunityUntil = r.stunUntil + 3 * TICK_HZ;
    r.tank!.stunnedUntil = field.frame + 3 * TICK_HZ;
    race.lastHit = r;
    race.lastHitFrame = race.frame;
    if (missile.named) r.protectedUntil = race.frame + 15 * TICK_HZ;
  }
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
