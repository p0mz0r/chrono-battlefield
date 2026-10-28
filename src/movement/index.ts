import { drivable, findRoute, spotIndex, stepTo, spotSpeed, type Cell, type CellGrid, type Spot } from './route.js';
import { F_D, F_T, F_X, F_Y, RAW_TRACKS, TRACKS, TRACK_CONTROL } from './tracks.js';

export { drivable, findRoute, spotLevel, stepTo, type Cell, type CellGrid, type Spot } from './route.js';

// Pure RA2 cell locomotion (ADR 0005): one tick = one game frame, positions in leptons, facings in
// 1/65536 turn. Turn in place at ROT before a step, then follow RA1's curved tracks.

/** Simulation ticks per second (RA2 frames). Changing it changes game speed. */
export const TICK_HZ = 30;
export const LEPTONS_PER_CELL = 256;

/** `[HTNK]` in rulesmd: `Speed=6`, `ROT=5`. */
const RHINO = { speed: 6, rot: 5 };
/** Speed → leptons/frame (×256/100, truncated) × `GameSpeedBias=1.6`: 24 for the Rhino. */
const TOP_SPEED = Math.floor((RHINO.speed * 256) / 100) * 1.6;
const ROT_PER_TICK = RHINO.rot * 256;
/** Leptons a track step costs: RA1 has 24 steps per cell. */
const STEP_LEPTONS = LEPTONS_PER_CELL / 24;
/** rulesmd `BlockagePathDelay=60`: frames a blocked tank prices moving tanks at 4× before 1000×. */
const BLOCKAGE_PATH_DELAY = 60;
/** rulesmd `PathDelay=.01` minutes ≈ 9 frames between route searches while blocked. */
const PATH_DELAY = 9;
/** A tank that wants to move but enters no new cell for this many frames (10 s) ghosts. */
export const GHOST_AFTER = 10 * TICK_HZ;

export interface Tank {
  readonly id: number;
  /** Position in leptons (cell × 256 + 128 = cell centre). */
  x: number;
  y: number;
  /** Body facing in 1/65536 turn, 0 = north (-y), clockwise. */
  facing: number;
  /** Speed multiplier (boost, handicap): scales speed, never `ROT`. Takes effect the next frame. */
  speedFactor: number;
  /** Field frame through which a hit stops movement without releasing occupied or reserved spots. */
  stunnedUntil: number;
  /** The spot the tank stands in. */
  cell: Spot;
  /** Ghosting: drives through other tanks until it stands on a free cell. */
  ghost: boolean;
  /** Where the tank was ordered to, until it gets there. */
  goal: Cell | undefined;
  /** Facings (0-7) of the steps still to drive. */
  path: number[];
  /** Index into TRACK_CONTROL, or -1 when not on a track. */
  track: number;
  trackIndex: number;
  /** The spot the current track ends in. */
  headTo: Spot;
  /** Track spots not yet entered (a two-cell track's middle, then headTo): reserved, as RA1 `Mark_Track`. */
  ahead: Spot[];
  /** Leptons per tick on the current track, before `speedFactor`. */
  speed: number;
  /** Leptons moved but not yet spent on a track step. */
  accum: number;
  /** Frame the tank was first blocked since its last step, or -1. */
  blockedSince: number;
  /** Frame of the next route search while blocked. */
  nextSearch: number;
  /** Last frame the tank entered a new cell, or didn't want to move. */
  lastNewCell: number;
}

/** All tanks on one battlefield, stepped together. */
export interface Field {
  readonly grid: CellGrid;
  readonly tanks: Tank[];
  /** Frames since the field was created. */
  frame: number;
  /** mulberry32 state: the per-race seed's random stream. */
  rng: number;
}

const centre = (c: number) => c * LEPTONS_PER_CELL + LEPTONS_PER_CELL / 2;
const wrap = (f: number) => ((f % 65536) + 65536) % 65536;

export function createField(grid: CellGrid, seed: number): Field {
  return { grid, tanks: [], frame: 0, rng: seed >>> 0 };
}

/** mulberry32: a uniform float in [0, 1) from the field's seeded stream. */
export function random(field: Field): number {
  let t = (field.rng = (field.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Puts a tank on the ground of `cell`. */
export function addTank(field: Field, cell: Cell, opts: { facing?: number; speedFactor?: number } = {}): Tank {
  const spot = { x: cell.x, y: cell.y, deck: false };
  const tank: Tank = {
    id: field.tanks.length, x: centre(cell.x), y: centre(cell.y), facing: opts.facing ?? 0,
    speedFactor: opts.speedFactor ?? 1, stunnedUntil: 0, cell: spot, ghost: false, goal: undefined,
    path: [], track: -1, trackIndex: 0, headTo: { ...spot }, ahead: [], speed: 0, accum: 0, blockedSince: -1, nextSearch: 0, lastNewCell: field.frame,
  };
  field.tanks.push(tank);
  return tank;
}

export function tankCell(tank: Tank): Spot {
  return { ...tank.cell };
}

export function isDriving(tank: Tank): boolean {
  return tank.track !== -1 || tank.path.length > 0;
}

/** Routes the tank to `to` from where its current track ends. False if `to` can't be reached. */
export function orderMove(field: Field, tank: Tank, to: Cell): boolean {
  const route = findRoute(field.grid, tank.track === -1 ? tank.cell : tank.headTo, to, pricing(field, tank));
  if (!route) return false;
  tank.goal = { x: to.x, y: to.y };
  tank.path = route;
  tank.lastNewCell = field.frame;
  return true;
}

/**
 * Where a move lands: the drivable ground cell nearest `near` that is off every bridge, held by no other
 * tank and passes `ok` (e.g. can still reach the next waypoint), or undefined.
 */
// ponytail: sorts every cell of the battlefield per move; a ring search outwards if moves get frequent.
export function findLanding(field: Field, tank: Tank, near: { x: number; y: number }, ok: (spot: Spot) => boolean): Spot | undefined {
  const { grid } = field;
  return Array.from({ length: grid.width * grid.height }, (_, i) => ({ x: i % grid.width, y: Math.floor(i / grid.width), deck: false }))
    .filter((s, i) => drivable(grid, s.x, s.y) && grid.deck[i]! < 0 && (grid.bridge?.[i] ?? -1) < 0 && !holder(field, s, tank))
    .sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y))
    .find(ok);
}

/** A move: puts the tank on `spot` at once, dropping its old cells and route. A stun carries on. */
export function moveTank(field: Field, tank: Tank, spot: Spot): void {
  tank.cell = { ...spot };
  tank.x = centre(spot.x);
  tank.y = centre(spot.y);
  tank.track = -1;
  tank.trackIndex = 0;
  tank.headTo = { ...spot };
  tank.ahead = [];
  tank.path = [];
  tank.goal = undefined;
  tank.accum = 0;
  tank.blockedSince = -1;
  tank.ghost = false;
  tank.lastNewCell = field.frame;
}

const same = (a: Spot, b: Spot) => a.x === b.x && a.y === b.y && a.deck === b.deck;

/** The other tank standing in or reserving `spot`. */
// ponytail: linear scan over ≤ 10 tanks × 3 spots; an occupancy array if fields grow.
function holder(field: Field, spot: Spot, self: Tank): Tank | undefined {
  return field.tanks.find((t) => t !== self && (same(t.cell, spot) || t.ahead.some((a) => same(a, spot))));
}

/**
 * RA2 occupancy pricing for `tank`'s route search, as a factor on the step cost into a spot other tanks
 * hold: a standing tank 8×, a moving one 1×, or once `tank` is blocked 4× and after
 * `BlockagePathDelay` 1000×. Never infinite: a tank never gives up.
 */
function pricing(field: Field, tank: Tank): (spot: number) => number {
  const blocked = tank.blockedSince < 0 ? -1 : field.frame - tank.blockedSince;
  const moving = blocked < 0 ? 1 : blocked < BLOCKAGE_PATH_DELAY ? 4 : 1000;
  const factor = new Map<number, number>();
  for (const t of field.tanks) {
    if (t === tank) continue;
    for (const s of [t.cell, ...t.ahead]) factor.set(spotIndex(field.grid, s), isDriving(t) ? moving : 8);
  }
  return (spot) => factor.get(spot) ?? 1;
}

/** The next `n` spots on a tank's path. */
function upcoming(grid: CellGrid, tank: Tank, n: number): Spot[] {
  const out: Spot[] = [];
  let at: Spot | undefined = tank.cell;
  for (const face of tank.path.slice(0, n)) {
    at = at && stepTo(grid, at, face);
    if (at) out.push(at);
  }
  return out;
}

/**
 * RA1 `Incoming`: a stationary tank asked by `asker` steps to a free neighbouring spot, preferring
 * one off the asker's next steps, then picks its own route up again. A tank on a track can't be asked.
 */
function makeWay(field: Field, tank: Tank, asker: Tank): void {
  if (tank.track !== -1 || field.frame < tank.stunnedUntil) return;
  const { grid } = field;
  const avoid = upcoming(grid, asker, 3);
  let fallback: number | undefined;
  for (let face = 0; face < 8; face++) {
    const to = stepTo(grid, tank.cell, face);
    if (!to || holder(field, to, tank)) continue;
    if (!avoid.some((a) => same(a, to))) {
      tank.path = [face];
      return;
    }
    fallback ??= face;
  }
  if (fallback !== undefined) tank.path = [fallback];
}

/** The tank keeping `tank` out of `spot`: none while ghosting. */
const blocking = (field: Field, spot: Spot, tank: Tank) => (tank.ghost ? undefined : holder(field, spot, tank));

/** Advances every tank one frame, in an order shuffled from the race seed so no tank always goes first. */
export function tick(field: Field): void {
  const order = [...field.tanks];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random(field) * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  for (const tank of order) tickTank(field, tank);
  field.frame++;
}

function tickTank(field: Field, tank: Tank): void {
  if (field.frame < tank.stunnedUntil) {
    tank.lastNewCell = field.frame;
    return;
  }
  const wants = isDriving(tank) || (tank.goal !== undefined && !(tank.cell.x === tank.goal.x && tank.cell.y === tank.goal.y));
  if (!wants) tank.lastNewCell = field.frame;
  else if (!tank.ghost && field.frame - tank.lastNewCell >= GHOST_AFTER) tank.ghost = true;
  if (tank.ghost && !wants) {
    // Stopped on its goal while ghosting: whoever else is here makes way.
    const other = holder(field, tank.cell, tank);
    if (!other) tank.ghost = false;
    else makeWay(field, other, tank);
  }
  if (tank.track === -1 && !startTrack(field, tank)) return;
  tank.accum += tank.speed * tank.speedFactor;
  while (tank.accum >= STEP_LEPTONS) {
    tank.accum -= STEP_LEPTONS;
    if (followTrack(field, tank)) continue;
    // Track done: carry on into the next one this frame, unless it needs a turn first.
    if (!startTrack(field, tank)) {
      tank.accum = 0;
      return;
    }
  }
}

/** RA1 `Start_Of_Move`: turn in place toward the next step, then pick its track. True once on a track. */
function startTrack(field: Field, tank: Tank): boolean {
  const { grid } = field;
  if (!tank.path.length && tank.goal && !(tank.cell.x === tank.goal.x && tank.cell.y === tank.goal.y)) {
    const route = findRoute(grid, tank.cell, tank.goal, pricing(field, tank)); // after making way, or a stale route
    if (route) tank.path = route;
    else tank.goal = undefined; // the grid changed under it (a bridge went): nothing to drive to
  }
  const face = tank.path[0];
  if (face === undefined) return false;
  const diff = wrap(face * 8192 - tank.facing + 32768) - 32768;
  if (diff) {
    tank.facing = wrap(tank.facing + Math.sign(diff) * Math.min(Math.abs(diff), ROT_PER_TICK));
    return false;
  }
  const dest = stepTo(grid, tank.cell, face);
  if (!dest) {
    tank.path = [];
    return false;
  }
  const blocker = blocking(field, dest, tank);
  if (blocker) {
    makeWay(field, blocker, tank);
    if (tank.blockedSince < 0) {
      tank.blockedSince = field.frame;
      tank.nextSearch = field.frame + PATH_DELAY;
    } else if (field.frame >= tank.nextSearch && tank.goal) {
      tank.nextSearch = field.frame + PATH_DELAY;
      tank.path = findRoute(grid, tank.cell, tank.goal, pricing(field, tank)) ?? tank.path;
    }
    return false;
  }
  tank.blockedSince = -1;
  let next = tank.path[1] ?? face;
  // RA1 has no track for turns over 90°: drive straight in, then turn in place there.
  if (!TRACK_CONTROL[face * 8 + next]![0]) next = face;
  let two = (TRACK_CONTROL[face * 8 + next]![2] & F_D) !== 0;
  let far = two ? stepTo(grid, dest, next) : undefined;
  if (far && blocking(field, far, tank)) far = undefined;
  if (!far) {
    next = face;
    two = false;
  }
  tank.track = face * 8 + next;
  tank.trackIndex = 0;
  tank.headTo = far ?? dest;
  tank.ahead = far ? [dest, far] : [dest];
  tank.path.splice(0, far ? 2 : 1);
  tank.speed = TOP_SPEED * spotSpeed(grid, dest);
  return true;
}

/** RA1 `While_Moving` for one track step. False when the track has ended. */
function followTrack(field: Field, tank: Tank): boolean {
  const { grid } = field;
  const [trackNo, endFacing, flags] = TRACK_CONTROL[tank.track]!;
  const raw = RAW_TRACKS[trackNo - 1]!;
  const step = TRACKS[trackNo - 1]![tank.trackIndex]!;
  if (tank.trackIndex && !step[0] && !step[1]) {
    tank.x = centre(tank.headTo.x);
    tank.y = centre(tank.headTo.y);
    tank.cell = { ...tank.headTo };
    tank.ahead = [];
    tank.track = -1;
    if (tank.ghost && !holder(field, tank.cell, tank)) tank.ghost = false;
    if (!tank.path.length && tank.goal && tank.cell.x === tank.goal.x && tank.cell.y === tank.goal.y) tank.goal = undefined;
    return false;
  }
  let [dx, dy, dir] = step;
  if (flags & F_T) [dx, dy, dir] = [dy, dx, 192 - dir];
  if (flags & F_X) [dx, dir] = [-dx, -dir];
  if (flags & F_Y) [dy, dir] = [-dy, 128 - dir];
  tank.x = centre(tank.headTo.x) + dx;
  tank.y = centre(tank.headTo.y) + dy;
  tank.facing = wrap(dir * 256);
  const near = (c: Cell) => Math.hypot(centre(c.x) - tank.x, centre(c.y) - tank.y);
  while (tank.ahead[0] && near(tank.ahead[0]) < near(tank.cell)) {
    tank.cell = tank.ahead.shift()!;
    tank.lastNewCell = field.frame;
  }

  // Track jumping: at the jump point of a curve, chain straight into the next curve.
  const nextFace = tank.path[0];
  if (tank.trackIndex === raw.jump && nextFace !== undefined && nextFace !== endFacing) {
    const jumpTo = endFacing * 8 + nextFace;
    const target = TRACK_CONTROL[jumpTo]![0];
    const c = stepTo(grid, tank.headTo, nextFace);
    if (target && RAW_TRACKS[target - 1]!.entry && c && !blocking(field, c, tank)) {
      tank.track = jumpTo;
      tank.trackIndex = RAW_TRACKS[target - 1]!.entry;
      tank.headTo = c;
      tank.ahead.push(c);
      tank.path.shift();
      tank.speed = TOP_SPEED * spotSpeed(grid, c);
      return true;
    }
  }
  tank.trackIndex++;
  return true;
}
