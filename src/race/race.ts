import { addTank, createField, findLanding, findRoute, isDriving, moveTank, orderMove, random, tick, TICK_HZ, type Cell, type CellGrid, type Field, type Spot, type Tank } from '../movement/index.js';
import { courseProgress, forkProgress, type Course } from './course.js';
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

export type Phase = 'idle' | 'join' | 'countdown' | 'racing' | 'results' | 'cancelled';

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

/**
 * Big events (#101): one plays at a time from the event queue; `buildUp` is seconds from its turn to landing (the
 * Kirov's is open-ended: it lands with its last bomb).
 */
// ponytail: the Kirov's Infinity build-up keeps it playing until `kirovRun` sets its real landing; a per-event phase if more events wait like this.
export const BIG_EVENTS = { chronoSwap: { label: 'CHRONO SWAP', buildUp: 3 }, nuke: { label: 'NUKE', buildUp: 3 }, kirov: { label: 'KIROV', buildUp: Infinity } } as const;
export type BigEvent = keyof typeof BIG_EVENTS;
/** Frames from one big event landing to the next one's turn. */
const EVENT_GAP = 10 * TICK_HZ;
/** Frames a cheer-paid Chrono swap with no valid pair waits before trying again. */
const CHEER_RETRY = 10 * TICK_HZ;
/** Seconds the nuke falls before impact, under the siren. */
export const NUKE_FALL = 2.1;
/**
 * Kirov tuning (#109): cells ahead of the leading tank it hovers (nearest, furthest) but never within `clear` of the
 * finish, seconds it waits for a tank to come within `range` cells before it leaves refunded, bombs, seconds between
 * them and each falls, blast radius and knockback in cells.
 */
export const KIROV = { ahead: [5, 10], clear: 3, wait: 20, range: 2.5, bombs: 7, every: 1, fall: 0.5, blast: 1.5, knockback: 4 } as const;

/** Hype meter tuning (#107): points per accepted interaction, grace and drain in seconds, full, the armed spell, chat-wide events a race. */
export const HYPE = { command: 1, redemption: 2, cheer: 3, grace: 5, drain: 2, full: 30, armed: 30, calls: 5, perRace: 2 } as const;

/** The hype meter: `drainAt` is the race frame it next loses a point; `armedUntil` the frame its armed spell ends. */
export interface Hype {
  points: number;
  drainAt: number;
  /** EVA has warned at half during this filling. */
  warned: boolean;
  armedUntil: number | undefined;
  /** Viewers who typed `!nuke` during this armed spell: viewer ID to display name. */
  calls: Map<string, string>;
}

const emptyHype = (): Hype => ({ points: 0, drainAt: 0, warned: false, armedUntil: undefined, calls: new Map() });

/** A redemption or cheer from a chat source: the paid entry beside `chat`. */
export interface PaidLine {
  viewerId: string;
  name: string;
  event: BigEvent;
  via: 'redemption' | 'cheer';
  /** The cheer's bit amount. */
  bits?: number;
  /** The source's opaque redemption reference, handed back in a settlement. */
  reference: string;
}

/** What the chat source tells the platform about a redemption. */
export interface Settlement {
  reference: string;
  outcome: 'fulfilled' | 'refunded';
}

/** A big event in the event queue; `lands` is set once its turn comes. */
export interface Turn {
  event: BigEvent;
  viewerId: string;
  by: string;
  /** Undefined for a chat-wide event or a cheer, or once settled: nothing (more) to settle. */
  reference: string | undefined;
  /** Set off by a cheer: never fails, tries again `CHEER_RETRY` later or carries over to the next race instead. */
  cheer: boolean;
  /** Race frame a cheer whose swap had no valid pair may take its turn again; it keeps its place meanwhile. */
  retryAt: number;
  lands: number | undefined;
  /** Chrono swap: the front-half and back-half tanks; nuke: the leading tank. */
  picks: Racer[];
  /** Nuke: the viewers who called it. */
  callers: string[];
  /** Nuke: the stunned tank whose stun ends first. */
  firstAway: Racer | undefined;
  /**
   * Kirov: the spot it hovers over and bombs (cells), the race frame it leaves on if no tank has come in range, the
   * frame its first bomb drops, and every tank its bombs caught.
   */
  ship: { x: number; y: number; waitUntil: number; firstDrop: number | undefined; caught: Racer[] } | undefined;
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
  /** Alternate leg being driven; cleared on reaching its merge waypoint or a move. */
  fork: { from: number; nextVia: number } | undefined;
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
  /** The last chronosphere: the cells left and landed on, and the race frame. */
  warp: { from: Cell; to: Cell; at: number } | undefined;
}

export interface Race {
  course: Course;
  readonly field: Field;
  /** This race's seed: `createRace`'s for the page's first race, a fresh one for each later join window. */
  seed: number;
  phase: Phase;
  paused: boolean;
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
  /** Visible lines, newest last: who did what to which tank, and failures with their reason. */
  feed: string[];
  feedUntil: Map<string, number>;
  sounds: string[];
  missiles: { by: string; target: Racer; named: boolean; launched: number; arrives: number; x: number; y: number }[];
  lastHit: Racer | undefined;
  /** Who set off the interaction behind `lastHit`. */
  lastHitBy: string | undefined;
  lastHitFrame: number;
  v3s: { firer: Racer; x: number; y: number; dx: number; dy: number; travelled: number }[];
  /** Tesla strikes charging: the Tesla tank stays beside `target` (x, y in cells) until it goes off. */
  teslas: { by: string; target: Racer; named: boolean; x: number; y: number; arrives: number }[];
  bridgeGrid: BridgeGrid | undefined;
  /** The event queue, playing turn first. */
  queue: Turn[];
  /** Race frame the next big event's turn may come on. */
  nextEventAt: number;
  /** The big event that landed last this race. */
  landed: Turn | undefined;
  /** Drained by the chat source, as the view drains `sounds`; kept across races until drained. */
  settlements: Settlement[];
  hype: Hype;
  /** Chat-wide events set off this race. */
  chatWide: number;
  /** The operator's Chrono swap price in bits: only a cheer of exactly this sets one off. */
  // ponytail: fixed at the default 50 until install setup gains the chat-source settings (#101).
  cheerBits: number;
  /** Cheers waiting for the next race, in order: they survive `openJoinWindow` and take the first turns after its countdown. */
  carried: Turn[];
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
  return { course, field: createField(grid, seed), seed, phase: 'idle', paused: false, racers: [], timer: 0, frame: 0, finishFrames: 0, results: [], enabled: new Set(interactions.filter((verb) => verb !== 'bridge' || (bridgeGrid && course.file.bridges.length))), cooldowns: new Map(), feed: [], feedUntil: new Map(), sounds: [], missiles: [], v3s: [], teslas: [], lastHit: undefined, lastHitBy: undefined, lastHitFrame: -1, bridgeGrid, queue: [], nextEventAt: 0, landed: undefined, settlements: [], hype: emptyHype(), chatWide: 0, cheerBits: 50, carried: [] };
}

export function commandList(race: Race): string[] {
  if (race.paused) return [];
  if (race.phase === 'join') return [`!rhino${COMMANDS.rhino.hint}`];
  if (race.phase !== 'racing') return [];
  return [...interactions.filter((verb) => race.enabled.has(verb))
    .map((verb) => `!${verb}${COMMANDS[verb].hint}${COMMANDS[verb].racers ? ' (racers)' : ''}`), ...armed(race) ? ['!nuke'] : []];
}

/** Operator: opens the join window (default 90 s); the finish timer (default 60 s) starts at the first finish. */
export function openJoinWindow(race: Race, { joinSeconds = 90, finishSeconds = 60 } = {}): void {
  if (race.phase !== 'idle' && race.phase !== 'results' && race.phase !== 'cancelled') return;
  // A race replays from its seed alone; an empty join window (back to idle) ran nothing, so it keeps its seed.
  if (race.phase !== 'idle') race.seed = Math.floor(random(race.field) * 2 ** 32);
  Object.assign(race.field, { rng: race.seed >>> 0, frame: 0 });
  Object.assign(race, { phase: 'join', paused: false, racers: [], timer: joinSeconds * TICK_HZ, frame: 0, finishFrames: finishSeconds * TICK_HZ, results: [] });
  race.field.tanks.length = 0;
  race.cooldowns.clear();
  race.feed.length = 0;
  race.sounds.length = 0;
  race.feedUntil.clear();
  race.missiles.length = 0;
  race.lastHit = undefined;
  race.lastHitBy = undefined;
  race.lastHitFrame = -1;
  race.v3s.length = 0;
  race.teslas.length = 0;
  race.queue.length = 0;
  race.nextEventAt = 0;
  race.landed = undefined;
  race.hype = emptyHype();
  race.chatWide = 0;
  for (const [id, bridge] of race.bridgeGrid?.bridges.entries() ?? []) {
    if (bridge.destroyed) repairBridge(race.bridgeGrid!, id);
    bridge.changedAt = undefined;
  }
}

const IGNORED: ChatResult = { ok: false, reason: 'ignored' };

/** The chat-command contract: every line from every source comes through here. */
export function chat(race: Race, line: ChatLine): ChatResult {
  if (race.paused) return IGNORED;
  const words = line.text.trim().toLowerCase().split(/\s+/);
  if (words.length > 2) return IGNORED;
  const word = words[0] ?? '';
  if (!word.startsWith('!')) return IGNORED;
  if (word === '!nuke') return words.length === 1 ? callNuke(race, line) : IGNORED;
  const verb = word.slice(1) as keyof typeof COMMANDS;
  if (!Object.hasOwn(COMMANDS, verb)) return IGNORED;
  if (verb === 'rhino') {
    if (words.length !== 1) return IGNORED;
    if (race.phase !== 'join' || race.racers.some((r) => r.viewerId === line.viewerId)) return IGNORED;
    const taken = (name: string) => /^bot[1-8]$/i.test(name) || race.racers.some((r) => r.name.toLowerCase() === name.toLowerCase());
    let name = line.name.trim() || line.viewerId;
    for (let n = 2, base = name; taken(name); n++) name = `${base}#${n}`;
    race.racers.push(racer(race, name, line.viewerId));
    race.sounds.push('ready');
    if (race.racers.length === MAX_TANKS) closeJoinWindow(race);
    return { ok: true, reason: `joined as ${name}` };
  }
  if (race.phase !== 'racing' || !race.enabled.has(verb)) return IGNORED;
  if ((verb === 'shield' && words.length !== 1) || (verb === 'bridge' && words.length !== 2) || (verb === 'v3' && words[1] && !['back', 'fwd'].includes(words[1])) || (verb !== 'shield' && words.length > 2)) return IGNORED;
  const reject = (reason: string): ChatResult => {
    postThrottled(race, line.viewerId, `${line.name}: ${reason}`);
    return { ok: false, reason };
  };
  const left = (race.cooldowns.get(line.viewerId) ?? 0) - race.frame;
  if (left > 0) return reject(`cooldown ${Math.ceil(left / TICK_HZ)} s`);
  if (verb === 'bridge') {
    const result = toggleBridge(race, words[1]);
    if (!result.ok) return reject(result.reason);
    race.cooldowns.set(line.viewerId, race.frame + COMMANDS.bridge.cooldown * TICK_HZ);
    const destroyed = result.reason.endsWith('destroyed');
    race.sounds.push(destroyed ? 'bridgeCollapse' : 'bridgeRepair');
    post(race, `${line.name} ${destroyed ? 'destroyed' : 'repaired'} bridge ${words[1]!.toUpperCase()}`);
    addHype(race, HYPE.command);
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
    race.sounds.push('boost');
    post(race, `${line.name} ▸ boost ▸ ${target.name}`);
  } else if (verb === 'shield') shield(race, target, line.name);
  else if (verb === 'v3') {
    const back = words[1] === 'back' || (!words[1] && standings(race).find((s) => s.finishTime === undefined)?.name === target.name);
    launchV3(race, target, back);
  } else if (verb === 'tesla') { race.teslas.push({ by: line.name, target, named, x: target.tank!.x / 256, y: target.tank!.y / 256, arrives: race.frame + 2 * TICK_HZ }); race.sounds.push('teslaCharge'); }
  else if (verb === 'missile') { race.missiles.push({ by: line.name, target, named, launched: race.frame, arrives: race.frame + Math.round(1.5 * TICK_HZ), x: target.tank!.x / 256 - 6, y: target.tank!.y / 256 - 6 }); race.sounds.push('missileLaunch'); }
  else if (verb === 'chrono') {
    target.warp = { from: { x: target.tank!.cell.x, y: target.tank!.cell.y }, to: { x: shift!.landing.x, y: shift!.landing.y }, at: race.frame };
    move(race, target, shift!);
    if (named) target.protectedUntil = race.frame + 15 * TICK_HZ;
    race.sounds.push('chrono');
    post(race, `${line.name} ▸ chrono ▸ ${target.name}`);
  }
  addHype(race, HYPE.command);
  return { ok: true, reason: `${verb} ${target.name}` };
}

/** `!nuke` while armed: free, and each viewer counts once per armed spell. */
function callNuke(race: Race, line: ChatLine): ChatResult {
  const { hype } = race;
  if (!armed(race) || hype.calls.has(line.viewerId)) return IGNORED;
  hype.calls.set(line.viewerId, line.name);
  post(race, `${line.name} ▸ NUKE ${hype.calls.size}/${HYPE.calls}`);
  if (hype.calls.size === HYPE.calls) {
    // The next turn: behind only a big event already playing and nukes already waiting.
    let at = 0;
    while (race.queue[at] && (race.queue[at]!.lands !== undefined || race.queue[at]!.event === 'nuke')) at++;
    race.queue.splice(at, 0, { event: 'nuke', viewerId: '', by: 'CHAT', reference: undefined, cheer: false, retryAt: 0, lands: undefined, picks: [], callers: [...hype.calls.values()], firstAway: undefined, ship: undefined });
    race.hype = emptyHype();
    race.chatWide++;
  }
  return { ok: true, reason: `nuke ${hype.calls.size}/${HYPE.calls}` };
}

/** The paid entry: queues a redemption during a race, refunds it outside one; a cheer of exactly the price queues ahead of redemptions. */
export function paid(race: Race, line: PaidLine): ChatResult {
  const cheer = line.via === 'cheer';
  if (cheer && (line.event !== 'chronoSwap' || line.bits !== race.cheerBits)) return IGNORED;
  const turn: Turn = { event: line.event, viewerId: line.viewerId, by: line.name, reference: cheer ? undefined : line.reference, cheer, retryAt: 0, lands: undefined, picks: [], callers: [], firstAway: undefined, ship: undefined };
  if (cheer && !viewersRacing(race)) {
    race.carried.push(turn);
    return { ok: true, reason: 'next race' };
  }
  if (race.phase !== 'racing') {
    settle(race, line.reference, 'refunded');
    return { ok: false, reason: 'not racing' };
  }
  // Behind the one playing, a waiting nuke and earlier cheers; redemptions just go last.
  const at = cheer ? race.queue.findIndex((t) => t.lands === undefined && t.event !== 'nuke' && !t.cheer) : -1;
  race.queue.splice(at < 0 ? race.queue.length : at, 0, turn);
  addHype(race, HYPE[line.via]);
  return { ok: true, reason: 'queued' };
}

/** An accepted interaction from a viewer fills the hype meter and restarts the grace before it drains. */
function addHype(race: Race, points: number): void {
  const { hype } = race;
  if (hype.armedUntil !== undefined || !hypeLive(race)) return;
  hype.points = Math.min(HYPE.full, hype.points + points);
  hype.drainAt = race.frame + (HYPE.grace + HYPE.drain) * TICK_HZ;
  if (!hype.warned && hype.points >= HYPE.full / 2) {
    hype.warned = true;
    race.sounds.push('nukeDetected');
  }
  if (hype.points === HYPE.full) {
    hype.armedUntil = race.frame + HYPE.armed * TICK_HZ;
    hype.calls.clear();
    race.sounds.push('nukeReady');
  }
}

/** The armed spell runs out into a drain from full; an empty meter starts a new filling. */
function drainHype(race: Race): void {
  const { hype } = race;
  if (hype.armedUntil !== undefined) {
    if (race.frame < hype.armedUntil) return;
    hype.armedUntil = undefined;
    hype.drainAt = race.frame + HYPE.drain * TICK_HZ;
  }
  if (!hype.points || race.frame < hype.drainAt) return;
  if (!--hype.points) hype.warned = false;
  hype.drainAt = race.frame + HYPE.drain * TICK_HZ;
}

/** The hype meter is on screen: gone for the rest of the race once its last chat-wide event is set off. */
export const hypeLive = (race: Race) => race.chatWide < HYPE.perRace;

/** The hype meter is armed: `!nuke` counts. */
export const armed = (race: Race) => race.phase === 'racing' && race.hype.armedUntil !== undefined;

/** The next big event's turn comes, the playing one lands, or it fizzles; the next waits `EVENT_GAP` after a landing. */
function playEvents(race: Race): void {
  if (race.frame < race.nextEventAt) return;
  // The first turn that's due takes the front: a cheer trying again lets the ones behind it go first meanwhile.
  const due = race.queue.findIndex((t) => t.retryAt <= race.frame);
  if (due < 0) return;
  const turn = race.queue.splice(due, 1)[0]!;
  race.queue.unshift(turn);
  const nuke = turn.event === 'nuke', kirov = turn.event === 'kirov', aim = turn.event === 'chronoSwap' ? swapPicks : leaderTarget;
  if (turn.lands === undefined) {
    if (!aim(race, turn)) return fizzle(race);
    turn.lands = race.frame + BIG_EVENTS[turn.event].buildUp * TICK_HZ;
    race.sounds.push({ nuke: 'nukeLaunch', chronoSwap: 'chronoSelect', kirov: 'kirovCreated' }[turn.event]);
    if (kirov) {
      // Never so near the finish that tanks finish before coming in range: right over the leading tank if it is that near.
      const [near, far] = KIROV.ahead, lead = turn.picks[0]!.progress;
      const { x, y } = lineAt(race.course, Math.max(lead, Math.min(lead + near + random(race.field) * (far - near), race.course.length - KIROV.clear)));
      turn.ship = { x, y, waitUntil: race.frame + KIROV.wait * TICK_HZ, firstDrop: undefined, caught: [] };
    }
  } else if (kirov) kirovRun(race, turn);
  else if (race.frame < turn.lands) {
    // A target that finishes is replaced at once, so the target ring and the director follow the new one.
    if (turn.picks.some((r) => r.finishedAt !== undefined) && !aim(race, turn)) fizzle(race);
    else if (nuke && race.frame === turn.lands - Math.round(NUKE_FALL * TICK_HZ)) race.sounds.push('nukeSiren');
  } else {
    if (!aim(race, turn)) return fizzle(race);
    if (nuke) nukeImpact(race, turn);
    else {
      if (!chronoSwap(race, turn.picks[0]!, turn.picks[1]!)) return fizzle(race);
      race.sounds.push('chrono');
      post(race, `${turn.by} ▸ ${BIG_EVENTS[turn.event].label} ▸ ${turn.picks[0]!.name} ⇄ ${turn.picks[1]!.name}`);
    }
    land(race, turn);
  }
}

/** The playing big event lands: the next one's turn waits `EVENT_GAP`. */
function land(race: Race, turn: Turn): void {
  race.queue.shift();
  race.landed = turn;
  race.nextEventAt = race.frame + EVENT_GAP;
  settle(race, turn.reference, 'fulfilled');
}

/** Takes the leading tank as the target: the waiting Kirov's is whoever leads now, the nuke keeps its own while it races; false with none left. */
function leaderTarget(race: Race, turn: Turn): boolean {
  if (turn.event === 'nuke' && turn.picks[0] && turn.picks[0].finishedAt === undefined) return true;
  const leading = ranked(race).find((r) => r.finishedAt === undefined);
  turn.picks = leading ? [leading] : [];
  return !!leading;
}

/**
 * Stuns every tank on the field for 2 s + course progress % × 60 ms + 0–2 s (seeded), so each restarts at its own
 * moment; only a shield up at impact saves a tank, stun immunity doesn't, and a longer stun already running stands.
 */
function nukeImpact(race: Race, turn: Turn): void {
  for (const r of race.racers) {
    if (r.finishedAt !== undefined || r.shieldUntil > race.frame) continue;
    const frames = Math.round((2 + r.progress / race.course.length * 100 * 0.06 + random(race.field) * 2) * TICK_HZ);
    stun(race, r, Math.max(frames, r.stunUntil - race.frame));
    if (!turn.firstAway || r.stunUntil < turn.firstAway.stunUntil) turn.firstAway = r;
  }
  race.sounds.push('nukeExplosion');
  post(race, `${turn.by} ▸ ${BIG_EVENTS.nuke.label} ▸ all`);
}

/** Race frames the Kirov's bombs drop on, once a tank has come in range. */
export const kirovDrops = (turn: Turn): number[] => turn.ship?.firstDrop === undefined ? []
  : Array.from({ length: KIROV.bombs }, (_, i) => turn.ship!.firstDrop! + Math.round(i * KIROV.every * TICK_HZ));

/** Race frames the Kirov's bombs land on, `KIROV.fall` s after each drops. */
export const kirovImpacts = (turn: Turn): number[] => kirovDrops(turn).map((drop) => drop + Math.round(KIROV.fall * TICK_HZ));

/**
 * The Kirov hovers over its spot, the leading tank as its target, until a tank comes in range, or leaves refunded once
 * `KIROV.wait` runs out; then it drops its bombs there (the redemption is fulfilled with the first), following the tank
 * nearest its spot, and lands with the last.
 */
function kirovRun(race: Race, turn: Turn): void {
  const ship = turn.ship!, off = (r: Racer) => Math.hypot(r.tank!.x / 256 - ship.x, r.tank!.y / 256 - ship.y);
  const racing = race.racers.filter((r) => r.finishedAt === undefined), near = (r: Racer, cells: number) => racing.includes(r) && off(r) <= cells;
  if (ship.firstDrop === undefined) {
    if (!leaderTarget(race, turn) || race.frame >= ship.waitUntil) return fizzle(race);
    if (!racing.some((r) => near(r, KIROV.range))) return;
    ship.firstDrop = race.frame;
    turn.lands = kirovImpacts(turn).at(-1)!;
    settle(race, turn.reference, 'fulfilled');
    turn.reference = undefined;
  }
  // The target ring stays on the spot; the director follows whichever tank is nearest it.
  if (racing.length) turn.picks = [racing.reduce((a, b) => (off(b) < off(a) ? b : a))];
  if (kirovDrops(turn).includes(race.frame)) race.sounds.push('kirovAttack');
  if (!kirovImpacts(turn).includes(race.frame)) return;
  // A bomb lands: every tank in the blast is stunned as by a hit and knocked back; a shield blocks both, stun immunity only the stun.
  for (const r of race.racers.filter((r) => near(r, KIROV.blast) && r.shieldUntil <= race.frame).sort((a, b) => a.progress - b.progress)) { // the rearmost first, so the ones ahead land clear of them
    if (r.immunityUntil <= race.frame) stun(race, r, 3 * TICK_HZ);
    knockBack(race, r);
    if (!ship.caught.includes(r)) ship.caught.push(r);
  }
  race.sounds.push('hit');
  if (race.frame < turn.lands!) return;
  kirovLine(race, turn);
  land(race, turn);
}

/** The Kirov's one feed line: the first tank its bombs caught and how many others, or that they missed. */
function kirovLine(race: Race, turn: Turn): void {
  const [first, ...others] = turn.ship!.caught;
  post(race, `${turn.by} ▸ ${BIG_EVENTS.kirov.label} ▸ ${first ? `${first.name}${others.length ? ` +${others.length}` : ''}` : 'missed'}`);
}

/** Knocks `r` back `KIROV.knockback` cells along the ideal line, to the nearest cell there that is at least a cell behind it. */
function knockBack(race: Race, r: Racer): void {
  const shift = shiftTo(race, r, r.progress - KIROV.knockback, (s, next) => courseProgress(race.course, s.x + 0.5, s.y + 0.5, next) <= r.progress - 1);
  if (shift) move(race, r, shift);
}

/** The big event playing now: its turn has come and it hasn't landed yet. */
export const playingEvent = (race: Race): Turn | undefined => race.queue[0]?.lands === undefined ? undefined : race.queue[0];

/** The big event playing now, else the one that landed last this race. */
export const latestEvent = (race: Race): Turn | undefined => playingEvent(race) ?? race.landed;

/** The event-queue chips in order: the playing one lit, a chat-wide event's reading "next", a carried cheer's "next race". */
export const eventChips = (race: Race): { label: string; playing: boolean }[] => [...race.phase === 'racing' ? race.queue : [], ...race.carried]
  .map((t) => ({ label: `${BIG_EVENTS[t.event].label} · ${t.event === 'nuke' ? 'next' : t.by}${race.carried.includes(t) ? ' · next race' : ''}`, playing: t.lands !== undefined }));

/** A race viewers are in: not between races, nor an editor simulation run by bots alone, which never spends a cheer. */
const viewersRacing = (race: Race) => race.phase === 'racing' && race.racers.some((r) => !r.bot);

/** A cheer still waiting at race end takes its turn in the next race, picked afresh there. */
const carry = (race: Race, turn: Turn) => race.carried.push(Object.assign(turn, { lands: undefined, picks: [], retryAt: 0 }));

/** A chat-wide event (no reference) has nothing to settle. */
const settle = (race: Race, reference: string | undefined, outcome: Settlement['outcome']) => { if (reference !== undefined) race.settlements.push({ reference, outcome }); };

function fizzle(race: Race): void {
  const turn = race.queue.shift()!;
  // One that played its build-up still takes the gap before the next turn.
  if (turn.lands !== undefined) race.nextEventAt = race.frame + EVENT_GAP;
  if (turn.cheer) {
    race.queue.unshift(Object.assign(turn, { lands: undefined, picks: [], retryAt: race.frame + CHEER_RETRY }));
    return postThrottled(race, turn.viewerId, `${turn.by} ▸ ${BIG_EVENTS[turn.event].label} · retrying`);
  }
  if (turn.reference === undefined) return; // a chat-wide event is dropped
  settle(race, turn.reference, 'refunded');
  postThrottled(race, turn.viewerId, `${turn.by} ▸ ${BIG_EVENTS[turn.event].label} · refunded`);
}

/**
 * Keeps each Chrono swap pick that is still racing unshielded, else picks again from its half of the tanks still
 * racing; false with no valid pair.
 */
function swapPicks(race: Race, turn: Turn): boolean {
  const order = ranked(race).filter((r) => r.finishedAt === undefined), half = Math.floor(order.length / 2);
  const ok = (r: Racer | undefined) => r !== undefined && r.finishedAt === undefined && r.shieldUntil <= race.frame;
  for (const [i, side] of [order.slice(0, half), order.slice(half)].entries()) {
    if (ok(turn.picks[i])) continue;
    const candidates = side.filter((r) => ok(r) && r !== turn.picks[1 - i]);
    turn.picks[i] = candidates[Math.floor(random(race.field) * candidates.length)]!;
  }
  return ok(turn.picks[0]) && ok(turn.picks[1]);
}

/** Two moves: each tank lands on (or beside) the other's cell and drives on with its waypoints. False if one can't land. */
function chronoSwap(race: Race, a: Racer, b: Racer): boolean {
  const { field, course } = race;
  const goal = (r: Racer) => r.fork && course.forks.get(r.fork.from)!.via[r.fork.nextVia] || course.waypoints[r.next] || course.finish;
  const reaches = (r: Racer) => (s: Spot) => findRoute(field.grid, s, goal(r)) !== undefined;
  const cellA = { ...a.tank!.cell }, from = { x: cellA.x, y: cellA.y }, to = { x: b.tank!.cell.x, y: b.tank!.cell.y };
  const landA = findLanding(field, a.tank!, to, reaches(b));
  if (!landA) return false;
  moveTank(field, a.tank!, landA);
  // A's cell is free now, so B lands on it exactly.
  const landB = findLanding(field, b.tank!, from, reaches(a));
  if (!landB) {
    moveTank(field, a.tank!, cellA);
    return false;
  }
  moveTank(field, b.tank!, landB);
  a.warp = { from, to: { x: landA.x, y: landA.y }, at: race.frame };
  b.warp = { from: to, to: { x: landB.x, y: landB.y }, at: race.frame };
  const place = { next: a.next, fork: a.fork, progress: a.progress };
  Object.assign(a, { next: b.next, fork: b.fork, progress: b.progress });
  Object.assign(b, place);
  return true;
}

type Shift = { landing: Spot; next: number };

/**
 * Rolls a chronosphere on `racer` from the race seed: back 15–30% of the course as drawn, or 20% of the time
 * forward 5–10%, never behind the start or into the finish area. Measured on the unrolled ideal line, so a tank
 * sent back across a lap drops it. Undefined if no cell near the spot can take the tank.
 */
function chronoshift(race: Race, racer: Racer): Shift | undefined {
  const forward = random(race.field) < 0.2;
  const share = forward ? 0.05 + random(race.field) * 0.05 : -(0.15 + random(race.field) * 0.15);
  return shiftTo(race, racer, racer.progress + share * race.course.drawnLength);
}

/** The point `along` cells into the ideal line (clamped to it), in cells, and the waypoint next from there (-1: the finish). */
function lineAt(course: Course, along: number): { x: number; y: number; next: number } {
  along = Math.max(0, Math.min(course.length, along));
  const i = Math.max(1, course.along.findIndex((d) => d >= along));
  const a = course.line[i - 1]!, b = course.line[i]!;
  const t = (along - course.along[i - 1]!) / (course.along[i]! - course.along[i - 1]! || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, next: course.waypointAlong.findIndex((d) => d >= along) };
}

/**
 * The cell nearest the ideal line `along` cells in that takes `racer`, outside the finish area, with a way on and
 * passing `ok`; undefined if none.
 */
function shiftTo(race: Race, racer: Racer, along: number, ok = (_s: Spot, _next: number) => true): Shift | undefined {
  const { course, field } = race, { x, y, next } = lineAt(course, along), to = course.waypoints[next] ?? course.finish;
  const landing = findLanding(field, racer.tank!, { x: x - 0.5, y: y - 0.5 },
    (s) => !course.finishArea.has(s.y * field.grid.width + s.x) && ok(s, next) && findRoute(field.grid, s, to) !== undefined);
  return landing && { landing, next: next < 0 ? course.waypoints.length : next };
}

/** A move: the tank drives on from its new cell towards the waypoint after it (re-pathed next frame). */
function move(race: Race, r: Racer, { landing, next }: Shift): void {
  moveTank(race.field, r.tank!, landing);
  r.next = next;
  r.fork = undefined;
  r.progress = courseProgress(race.course, landing.x + 0.5, landing.y + 0.5, next);
}

const racer = (race: Race, name: string, viewerId?: string): Racer =>
  ({ viewerId, name, bot: viewerId === undefined, tank: undefined, next: 0, fork: undefined, progress: 0, finishedAt: undefined, tie: random(race.field), boostUntil: 0, shieldUntil: 0, stunUntil: 0, immunityUntil: 0, protectedUntil: 0, botNext: 0, botV3Next: false, warp: undefined });

function launchV3(race: Race, firer: Racer, back: boolean): void {
  race.sounds.push('cannon', 'v3Launch');
  const facing = firer.tank!.facing * 2 * Math.PI / 65536;
  const sign = back ? -1 : 1;
  race.v3s.push({ firer, x: firer.tank!.x / 256, y: firer.tank!.y / 256,
    dx: Math.sin(facing) * sign, dy: -Math.cos(facing) * sign, travelled: 0 });
}

/** A feed line for a viewer at most every 3 s: failures and refunds. */
function postThrottled(race: Race, viewerId: string, text: string): void {
  if ((race.feedUntil.get(viewerId) ?? 0) > race.frame) return;
  post(race, text);
  race.feedUntil.set(viewerId, race.frame + 3 * TICK_HZ);
}

/** A feed line; the feed keeps the newest 5. */
function post(race: Race, text: string): void {
  race.feed.push(text);
  if (race.feed.length > 5) race.feed.shift();
}

function shield(race: Race, r: Racer, by: string): void {
  r.shieldUntil = race.frame + 6 * TICK_HZ;
  race.sounds.push('shield');
  post(race, `${by} ▸ shield ▸ ${r.name}`);
}

/** Stops `r` burning for `frames`, then 3 s of stun immunity. */
function stun(race: Race, r: Racer, frames: number): void {
  r.stunUntil = race.frame + frames;
  r.immunityUntil = r.stunUntil + 3 * TICK_HZ;
  r.tank!.stunnedUntil = race.field.frame + frames;
}

/** Stuns `r` unless it is shielded, immune or finished; the feed names who stunned it and with what. */
function hit(race: Race, r: Racer, verb: Interaction, named: boolean, by: string): void {
  if (r.finishedAt !== undefined || r.shieldUntil > race.frame || r.immunityUntil > race.frame) return;
  stun(race, r, 3 * TICK_HZ);
  race.lastHit = r;
  race.lastHitBy = by;
  race.lastHitFrame = race.frame;
  if (named) r.protectedUntil = race.frame + 15 * TICK_HZ;
  race.sounds.push('hit');
  post(race, `${by} ▸ ${verb} ▸ ${r.name}`);
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

/** Dev (course editor): ends any race, then races `course` with bots alone, one per start cell up to `bots`, straight to 3-2-1. */
export function simulateRace(race: Race, course: Course, bots = 10): void {
  endRace(race);
  race.course = course;
  openJoinWindow(race);
  for (let n = 1; n <= Math.min(bots, course.startGrid.length); n++) race.racers.push(racer(race, `Bot${n}`));
  closeJoinWindow(race);
}

/** Seconds left on the start countdown (3, 2, 1), the join window or the finish timer. */
export const secondsLeft = (race: Race) => Math.ceil(race.timer / TICK_HZ);

/** Operator: cancels a young race, or builds the same results as an expired finish timer. */
export function endRace(race: Race): void {
  if (!['join', 'countdown', 'racing'].includes(race.phase)) return;
  const progress = race.racers.length ? race.racers.reduce((sum, r) => sum + (r.finishedAt === undefined ? r.progress / race.course.length : 1), 0) / race.racers.length : 0;
  race.phase = race.phase === 'racing' && progress >= 0.5 ? 'results' : 'cancelled';
  race.paused = false;
  race.results = race.phase === 'results' ? standings(race) : [];
  refundQueue(race);
}

/**
 * At race end every big event still queued or playing is refunded, dropped if chat set it off, or carried to the next
 * race if a cheer did; a Kirov already bombing posts its line.
 */
function refundQueue(race: Race): void {
  for (const turn of race.queue.splice(0)) {
    if (turn.cheer) carry(race, turn);
    if (turn.ship?.firstDrop !== undefined) kirovLine(race, turn);
    settle(race, turn.reference, 'refunded');
  }
}

/** One frame (1 / TICK_HZ s). */
export function tickRace(race: Race): void {
  if (race.paused) return;
  if (race.phase === 'join' && --race.timer <= 0) closeJoinWindow(race);
  else if (race.phase === 'countdown' && --race.timer <= 0) {
    race.phase = 'racing';
    if (viewersRacing(race)) race.queue.push(...race.carried.splice(0));
  }
  else if (race.phase === 'racing') drive(race);
}

const near = (tank: Tank, c: Cell) => !tank.cell.deck && Math.hypot(tank.x / 256 - c.x - 0.5, tank.y / 256 - c.y - 0.5) <= REACH;

function drive(race: Race) {
  const { course, field } = race;
  race.frame++;
  for (const r of race.racers) if (r.bot && r.finishedAt === undefined && race.frame >= r.botNext) {
    if (r.botV3Next && race.enabled.has('v3')) launchV3(race, r, random(field) < 0.5);
    else if (!r.botV3Next && race.enabled.has('shield')) shield(race, r, r.name);
    r.botV3Next = !r.botV3Next;
    r.botNext = race.frame + (5 + Math.floor(random(field) * 5)) * TICK_HZ;
  }
  for (const r of race.racers) if (r.tank && r.boostUntil <= race.frame) r.tank.speedFactor = 1;
  for (let i = race.missiles.length - 1; i >= 0; i--) {
    const missile = race.missiles[i]!;
    if (missile.arrives > race.frame) continue;
    race.missiles.splice(i, 1);
    race.sounds.push('missileImpact');
    hit(race, missile.target, 'missile', missile.named, missile.by);
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
    if (hits) { hit(race, hits.r, 'v3', false, v3.firer.name); race.v3s.splice(i, 1); race.sounds.push('v3Impact'); }
    else if (v3.travelled >= 12) { race.v3s.splice(i, 1); race.sounds.push('v3Impact'); }
  }
  for (let i = race.teslas.length - 1; i >= 0; i--) {
    const strike = race.teslas[i]!, t = strike.target;
    if (t.finishedAt === undefined) Object.assign(strike, { x: t.tank!.x / 256, y: t.tank!.y / 256 });
    if (strike.arrives > race.frame) continue;
    race.teslas.splice(i, 1);
    race.sounds.push('teslaStrike');
    for (const r of race.racers) if (r.finishedAt === undefined && r.tank && Math.hypot(r.tank.x / 256 - strike.x, r.tank.y / 256 - strike.y) <= 3) hit(race, r, 'tesla', strike.named && r === t, strike.by);
  }
  playEvents(race);
  drainHype(race);
  tick(field);
  const anyFinished = race.racers.some((r) => r.finishedAt !== undefined);
  for (const r of race.racers) {
    const tank = r.tank!;
    if (r.finishedAt !== undefined) continue;
    // Waypoints count only when reached; a move (#43) sets `next` to the first waypoint ahead of where it lands.
    if (r.fork) {
      const via = course.forks.get(r.fork.from)!.via;
      while (r.fork.nextVia < via.length && near(tank, via[r.fork.nextVia]!)) r.fork.nextVia++;
    }
    while ((!r.fork || r.fork.nextVia === course.forks.get(r.fork.from)!.via.length) &&
      r.next < course.waypoints.length && near(tank, course.waypoints[r.next]!)) {
      r.fork = undefined;
      const from = r.next++;
      if (course.forks.has(from) && random(field) < course.forks.get(from)!.weight / 100) {
        r.fork = { from, nextVia: 0 };
        r.next = course.forks.get(from)!.to;
      }
    }
    r.progress = r.fork ? forkProgress(course, r.fork.from, tank.x / 256, tank.y / 256) : courseProgress(course, tank.x / 256, tank.y / 256, r.next);
    if (r.next === course.waypoints.length && !tank.cell.deck && course.finishArea.has(tank.cell.y * field.grid.width + tank.cell.x)) {
      r.finishedAt = race.frame;
      r.progress = course.length;
      field.tanks.splice(field.tanks.indexOf(tank), 1); // the tank leaves the battlefield
      continue;
    }
    const to = r.fork && course.forks.get(r.fork.from)!.via[r.fork.nextVia] || course.waypoints[r.next] || course.finish;
    // ponytail: re-searches every frame while a goal stays unreachable (only after the grid changes, #44).
    if (tank.goal?.x !== to.x || tank.goal.y !== to.y) if (tank.goal || !isDriving(tank)) orderMove(field, tank, to);
  }
  if (!anyFinished && race.racers.some((r) => r.finishedAt !== undefined)) race.timer = race.finishFrames;
  else if (anyFinished) race.timer--;
  // One tank still racing can only place last, so the race ends as the one before it finishes.
  const racing = race.racers.filter((r) => r.finishedAt === undefined).length;
  if (!racing || (anyFinished && (racing === 1 || race.timer <= 0))) {
    race.phase = 'results';
    race.results = standings(race);
    refundQueue(race);
  }
}

/** Racers in standings order. */
const ranked = (race: Race) => [...race.racers]
  .sort((a, b) => (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) || b.progress - a.progress || a.tie - b.tie);

/** Every tank: finished ones in finish order, then by course progress; ties broken by seed. */
export function standings(race: Race): Standing[] {
  const len = race.course.length || 1;
  return ranked(race).map((r) => ({ name: r.name, bot: r.bot, progress: r.finishedAt === undefined ? Math.min(r.progress / len, 1) : 1, finishTime: r.finishedAt === undefined ? undefined : r.finishedAt / TICK_HZ }));
}
