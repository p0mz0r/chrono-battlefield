import { findRoute, stepTo, spotSpeed, type Cell, type CellGrid, type Spot } from './route.js';
import { F_D, F_T, F_X, F_Y, RAW_TRACKS, TRACKS, TRACK_CONTROL } from './tracks.js';

export { drivable, findRoute, spotLevel, type Cell, type CellGrid, type Spot } from './route.js';

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

export interface Tank {
  readonly id: number;
  /** Position in leptons (cell × 256 + 128 = cell centre). */
  x: number;
  y: number;
  /** Body facing in 1/65536 turn, 0 = north (-y), clockwise. */
  facing: number;
  /** Speed multiplier (boost, handicap): scales speed, never `ROT`. */
  speedFactor: number;
  /** The spot the tank stands in. */
  cell: Spot;
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
  /** Leptons per tick on the current track. */
  speed: number;
  /** Leptons moved but not yet spent on a track step. */
  accum: number;
}

/** All tanks on one battlefield, stepped together. */
export interface Field {
  readonly grid: CellGrid;
  readonly tanks: Tank[];
  /** Frames since the field was created. */
  frame: number;
}

const centre = (c: number) => c * LEPTONS_PER_CELL + LEPTONS_PER_CELL / 2;
const wrap = (f: number) => ((f % 65536) + 65536) % 65536;

export function createField(grid: CellGrid, _seed: number): Field {
  return { grid, tanks: [], frame: 0 };
}

/** Puts a tank on the ground of `cell`. */
export function addTank(field: Field, cell: Cell, opts: { facing?: number; speedFactor?: number } = {}): Tank {
  const spot = { x: cell.x, y: cell.y, deck: false };
  const tank: Tank = {
    id: field.tanks.length, x: centre(cell.x), y: centre(cell.y), facing: opts.facing ?? 0,
    speedFactor: opts.speedFactor ?? 1, cell: spot, goal: undefined,
    path: [], track: -1, trackIndex: 0, headTo: { ...spot }, ahead: [], speed: 0, accum: 0,
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
  const route = findRoute(field.grid, tank.track === -1 ? tank.cell : tank.headTo, to);
  if (!route) return false;
  tank.goal = { x: to.x, y: to.y };
  tank.path = route;
  return true;
}

/** Advances every tank one frame. */
export function tick(field: Field): void {
  for (const tank of field.tanks) tickTank(field, tank);
  field.frame++;
}

function tickTank(field: Field, tank: Tank): void {
  if (tank.track === -1 && !startTrack(field, tank)) return;
  tank.accum += tank.speed;
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
  let next = tank.path[1] ?? face;
  // RA1 has no track for turns over 90°: drive straight in, then turn in place there.
  if (!TRACK_CONTROL[face * 8 + next]![0]) next = face;
  let two = (TRACK_CONTROL[face * 8 + next]![2] & F_D) !== 0;
  const far = two ? stepTo(grid, dest, next) : undefined;
  if (!far) {
    next = face;
    two = false;
  }
  tank.track = face * 8 + next;
  tank.trackIndex = 0;
  tank.headTo = far ?? dest;
  tank.ahead = far ? [dest, far] : [dest];
  tank.path.splice(0, far ? 2 : 1);
  tank.speed = TOP_SPEED * tank.speedFactor * spotSpeed(grid, dest);
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
  while (tank.ahead[0] && near(tank.ahead[0]) < near(tank.cell)) tank.cell = tank.ahead.shift()!;

  // Track jumping: at the jump point of a curve, chain straight into the next curve.
  const nextFace = tank.path[0];
  if (tank.trackIndex === raw.jump && nextFace !== undefined && nextFace !== endFacing) {
    const jumpTo = endFacing * 8 + nextFace;
    const target = TRACK_CONTROL[jumpTo]![0];
    const c = stepTo(grid, tank.headTo, nextFace);
    if (target && RAW_TRACKS[target - 1]!.entry && c) {
      tank.track = jumpTo;
      tank.trackIndex = RAW_TRACKS[target - 1]!.entry;
      tank.headTo = c;
      tank.ahead.push(c);
      tank.path.shift();
      tank.speed = TOP_SPEED * tank.speedFactor * spotSpeed(grid, c);
      return true;
    }
  }
  tank.trackIndex++;
  return true;
}
