import { addTank, createField, findLanding, findRoute, isDriving, moveTank, orderMove, random, tick, TICK_HZ, type Cell, type CellGrid, type Field, type Spot, type Tank } from '../movement/index.js';
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
  v3: { hint: ' [back|fwd]', cooldown: 20, racers: true },
  tesla: { hint: ' [name]', cooldown: 45, racers: false },
  chrono: { hint: ' [name]', cooldown: 45, racers: false },
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
  botNext: number;
  botV3Next: boolean;
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
  v3s: { firer: Racer; x: number; y: number; dx: number; dy: number; travelled: number }[];
  /** Tesla strikes charging: the Tesla tank stays beside `target` (x, y in cells) until it goes off. */
  teslas: { target: Racer; named: boolean; x: number; y: number; arrives: number }[];
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
  return { course, field: createField(grid, seed), phase: 'idle', racers: [], timer: 0, frame: 0, finishFrames: 0, results: [], enabled: new Set(interactions.filter((verb) => verb !== 'bridge' || (bridgeGrid && course.file.bridges.length))), cooldowns: new Map(), feed: [], feedUntil: new Map(), missiles: [], v3s: [], teslas: [], bridgeGrid };
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
  race.v3s.length = 0;
  race.teslas.length = 0;
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
  if ((verb === 'shield' && words.length !== 1) || (verb === 'bridge' && words.length !== 2) || (verb === 'v3' && words[1] && !['back', 'fwd'].includes(words[1])) || (verb !== 'shield' && words.length > 2)) return IGNORED;
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
  let shift: Shift | undefined;
  if (verb === 'shield' || verb === 'v3') {
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
    if ((verb === 'missile' || verb === 'tesla' || verb === 'chrono') && target.protectedUntil > race.frame) return reject('target protected');
    if ((verb === 'missile' || verb === 'tesla') && target.immunityUntil > race.frame && target.shieldUntil <= race.frame) return reject('target unable');
    if (verb === 'chrono' && (target.shieldUntil > race.frame || !(shift = chronoshift(race, target)))) return reject('target unable');
  } else {
    const candidates = race.racers.filter((r) => r.finishedAt === undefined && ((verb !== 'missile' && verb !== 'tesla') || r.immunityUntil <= race.frame || r.shieldUntil > race.frame) && (verb !== 'chrono' || r.shieldUntil <= race.frame));
    target = candidates[Math.floor(random(race.field) * candidates.length)];
    // A random chronosphere rerolls among tanks a move can land.
    while (verb === 'chrono' && target && !(shift = chronoshift(race, target))) {
      candidates.splice(candidates.indexOf(target), 1);
      target = candidates[Math.floor(random(race.field) * candidates.length)];
    }
    if (!target) return reject('no target available');
  }
  race.cooldowns.set(line.viewerId, race.frame + COMMANDS[verb].cooldown * TICK_HZ);
  if (verb === 'boost') {
    target.boostUntil = race.frame + 5 * TICK_HZ;
    target.tank!.speedFactor = 1.5;
  } else if (verb === 'shield') target.shieldUntil = race.frame + 6 * TICK_HZ;
  else if (verb === 'v3') {
    const back = words[1] === 'back' || (!words[1] && standings(race).find((s) => s.finishTime === undefined)?.name === target.name);
    launchV3(race, target, back);
  } else if (verb === 'tesla') race.teslas.push({ target, named, x: target.tank!.x / 256, y: target.tank!.y / 256, arrives: race.frame + 2 * TICK_HZ });
  else if (verb === 'missile') race.missiles.push({ target, named, launched: race.frame, arrives: race.frame + Math.round(1.5 * TICK_HZ), x: target.tank!.x / 256 - 6, y: target.tank!.y / 256 - 6 });
  else if (verb === 'chrono') {
    // A move: the tank drives on from its new cell towards the waypoint after it (re-pathed next frame).
    moveTank(race.field, target.tank!, shift!.landing);
    target.next = shift!.next;
    target.progress = courseProgress(race.course, shift!.landing.x + 0.5, shift!.landing.y + 0.5, target.next);
    if (named) target.protectedUntil = race.frame + 15 * TICK_HZ;
  }
  return { ok: true, reason: `${verb} ${target.name}` };
}

type Shift = { landing: Spot; next: number };

/**
 * Rolls a chronosphere on `racer` from the race seed: back 15–30% of the course as drawn, or 20% of the time
 * forward 5–10%, never behind the start or into the finish area. Measured on the unrolled ideal line, so a tank
 * sent back across a lap drops it. Undefined if no cell near the spot can take the tank.
 */
function chronoshift(race: Race, racer: Racer): Shift | undefined {
  const { course, field } = race;
  const forward = random(field) < 0.2;
  const share = forward ? 0.05 + random(field) * 0.05 : -(0.15 + random(field) * 0.15);
  const along = Math.max(0, Math.min(course.length, racer.progress + share * course.drawnLength));
  const i = Math.max(1, course.along.findIndex((d) => d >= along));
  const a = course.line[i - 1]!, b = course.line[i]!;
  const t = (along - course.along[i - 1]!) / (course.along[i]! - course.along[i - 1]! || 1);
  const next = course.waypointAlong.findIndex((d) => d >= along), to = course.waypoints[next] ?? course.finish;
  const landing = findLanding(field, racer.tank!, { x: a.x + (b.x - a.x) * t - 0.5, y: a.y + (b.y - a.y) * t - 0.5 },
    (s) => !course.finishArea.has(s.y * field.grid.width + s.x) && findRoute(field.grid, s, to) !== undefined);
  return landing && { landing, next: next < 0 ? course.waypoints.length : next };
}

const racer = (race: Race, name: string, viewerId?: string): Racer =>
  ({ viewerId, name, bot: viewerId === undefined, tank: undefined, next: 0, progress: 0, finishedAt: undefined, tie: random(race.field), boostUntil: 0, shieldUntil: 0, stunUntil: 0, immunityUntil: 0, protectedUntil: 0, botNext: 0, botV3Next: false });

function launchV3(race: Race, firer: Racer, back: boolean): void {
  const facing = firer.tank!.facing * 2 * Math.PI / 65536;
  const sign = back ? -1 : 1;
  race.v3s.push({ firer, x: firer.tank!.x / 256, y: firer.tank!.y / 256,
    dx: Math.sin(facing) * sign, dy: -Math.cos(facing) * sign, travelled: 0 });
}

function hit(race: Race, r: Racer, named: boolean): void {
  if (r.finishedAt !== undefined || r.shieldUntil > race.frame || r.immunityUntil > race.frame) return;
  r.stunUntil = race.frame + 3 * TICK_HZ;
  r.immunityUntil = r.stunUntil + 3 * TICK_HZ;
  r.tank!.stunnedUntil = race.field.frame + 3 * TICK_HZ;
  if (named) r.protectedUntil = race.frame + 15 * TICK_HZ;
}

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
    if (r.bot) { r.botNext = 5 * TICK_HZ + Math.floor(random(race.field) * 5 * TICK_HZ); r.botV3Next = random(race.field) < 0.5; }
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
  for (const r of race.racers) if (r.bot && r.finishedAt === undefined && race.frame >= r.botNext) {
    if (r.botV3Next && race.enabled.has('v3')) launchV3(race, r, random(field) < 0.5);
    else if (!r.botV3Next && race.enabled.has('shield')) r.shieldUntil = race.frame + 6 * TICK_HZ;
    r.botV3Next = !r.botV3Next;
    r.botNext = race.frame + (5 + Math.floor(random(field) * 5)) * TICK_HZ;
  }
  for (const r of race.racers) if (r.tank && r.boostUntil <= race.frame) r.tank.speedFactor = 1;
  for (let i = race.missiles.length - 1; i >= 0; i--) {
    const missile = race.missiles[i]!;
    if (missile.arrives > race.frame) continue;
    race.missiles.splice(i, 1);
    const r = missile.target;
    hit(race, r, missile.named);
  }
  for (let i = race.v3s.length - 1; i >= 0; i--) {
    const v3 = race.v3s[i]!, px = v3.x, py = v3.y;
    v3.x += v3.dx * (12 / (1.5 * TICK_HZ)); v3.y += v3.dy * (12 / (1.5 * TICK_HZ));
    v3.travelled += 12 / (1.5 * TICK_HZ);
    const hits = race.racers.filter((r) => r !== v3.firer && r.finishedAt === undefined && r.tank)
      .map((r) => {
        const x = r.tank!.x / 256 - px, y = r.tank!.y / 256 - py;
        return { r, along: x * v3.dx + y * v3.dy, aside: Math.abs(x * v3.dy - y * v3.dx) };
      }).filter(({ along, aside }) => along >= 0 && along <= 12 / (1.5 * TICK_HZ) && aside <= 0.55)
      .sort((a, b) => a.along - b.along)[0];
    if (hits) { hit(race, hits.r, false); race.v3s.splice(i, 1); }
    else if (v3.travelled >= 12) race.v3s.splice(i, 1);
  }
  for (let i = race.teslas.length - 1; i >= 0; i--) {
    const strike = race.teslas[i]!, t = strike.target;
    if (t.finishedAt === undefined) Object.assign(strike, { x: t.tank!.x / 256, y: t.tank!.y / 256 });
    if (strike.arrives > race.frame) continue;
    race.teslas.splice(i, 1);
    for (const r of race.racers) if (r.finishedAt === undefined && r.tank && Math.hypot(r.tank.x / 256 - strike.x, r.tank.y / 256 - strike.y) <= 3) hit(race, r, strike.named && r === t);
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
