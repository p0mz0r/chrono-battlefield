import { drivable, findRoute, stepTo, type Cell, type CellGrid, type Spot } from '../movement/index.js';
import { crc32 } from '../ra2/mix/crc.js';

// A course laid over a battlefield (#10, ADR 0006): plain data, no rendering.

type XY = [number, number];

/** `courses/<name>.json`. Cells are `[x, y]` in RA2 cell coordinates. */
export interface CourseFile {
  name: string;
  /** Map file path: inside the install (`source: 'install'`) or under `courses/maps/` (`'shipped'`). */
  map: string;
  /** `mapHash(bytes)` of the map file; a mismatch is refused. */
  mapHash: string;
  source: 'install' | 'shipped';
  /** The map file's author and where it came from (credit, ADR 0006). */
  author: string;
  link: string;
  /** Ten cells, drivable and off bridges. */
  startGrid: XY[];
  waypoints: XY[];
  /** Alternate route to a later waypoint. Missing `to`/`weight` in older files mean the next waypoint/50%. */
  forks?: { from: number; to?: number; via: XY[]; weight?: number }[];
  /** Waypoint index ranges (inclusive), driven `count` times; non-overlapping. */
  laps: { from: number; to: number; count: number }[];
  finish: XY;
  /** One cell of each bridge in play, `B1`… in the order the ideal line meets them. */
  bridges: XY[];
}

/** A course's file name: `courses/<slug>.json`. */
export const courseSlug = (name: string) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Whether untrusted JSON has a course file's shape; install maps are paths inside the install, custom maps plain file names. */
export function isCourseFile(file: unknown): file is CourseFile {
  if (!file || typeof file !== 'object') return false;
  const f = file as Record<string, unknown>;
  const cell = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n) && n >= 0);
  return typeof f.name === 'string' && !!f.name.trim() && typeof f.mapHash === 'string' && /^crc32:[0-9a-f]{8}$/.test(f.mapHash) &&
    typeof f.map === 'string' && !f.map.includes('..') &&
    (f.source === 'install' ? /^[\w .\-\\/]+\.(mmx|yro|map|yrm|mpr)$/i : f.source === 'shipped' ? /^[\w.-]+\.(map|yrm|mpr)$/i : /$^/).test(f.map) &&
    typeof f.author === 'string' && typeof f.link === 'string' &&
    Array.isArray(f.startGrid) && f.startGrid.length === 10 && Array.isArray(f.waypoints) && Array.isArray(f.laps) && Array.isArray(f.bridges) &&
    [...f.startGrid, ...f.waypoints, f.finish, ...f.bridges].every(cell) &&
    (f.forks === undefined || (Array.isArray(f.forks) && f.forks.every((fork) => fork && typeof fork === 'object' &&
      Number.isInteger(fork.from) && fork.from >= 0 &&
      (fork.to === undefined || Number.isInteger(fork.to)) &&
      (fork.to ?? fork.from + 1) > fork.from && (fork.to ?? fork.from + 1) < (f.waypoints as unknown[]).length &&
      (fork.weight === undefined || (Number.isInteger(fork.weight) && fork.weight >= 0 && fork.weight <= 100)) &&
      Array.isArray(fork.via) && fork.via.length > 0 && fork.via.every(cell)) &&
      new Set(f.forks.map((fork) => fork.from)).size === f.forks.length)) &&
    f.laps.every((lap) => lap && typeof lap === 'object' && ['from', 'to', 'count'].every((key) => Number.isInteger((lap as Record<string, unknown>)[key])));
}

/** A course loaded over its battlefield's grid. */
export interface Course {
  file: CourseFile;
  startGrid: Cell[];
  /** Waypoints with lap sections unrolled. */
  waypoints: Cell[];
  finish: Cell;
  /** Ground cell indices (`y * width + x`) of the finish area. */
  finishArea: Set<number>;
  /** Ideal line: cell centres (cell units, centre = x + 0.5) from the start grid through every waypoint to the finish cell. */
  line: { x: number; y: number }[];
  /** Distance along the line (cells) at each line point. */
  along: number[];
  /** Distance along the line of each unrolled waypoint. */
  waypointAlong: number[];
  /** Alternate traced legs, indexed by the unrolled split waypoint. */
  forks: Map<number, { to: number; weight: number; via: Cell[]; line: { x: number; y: number }[]; along: number[]; length: number }>;
  /** Length of the ideal line in cells. */
  length: number;
  /** Length of the course as drawn (each lap section driven once): chronosphere bands are a share of it. */
  drawnLength: number;
}

/** Finish area radius in cells (3 tanks wide). */
export const FINISH_RADIUS = 1.5;

/** CRC-32 of the map file (the OBS page isn't a secure context, so no `crypto.subtle`). */
export const mapHash = (bytes: Uint8Array) => `crc32:${crc32(bytes).toString(16).padStart(8, '0')}`;

const cell = ([x, y]: XY): Cell => ({ x, y });

/** Lap sections repeated into one flat waypoint list. */
function unroll(file: CourseFile): { points: Cell[]; sources: number[] } {
  const out: Cell[] = [], sources: number[] = [];
  for (let i = 0; i < file.waypoints.length; i++) {
    out.push(cell(file.waypoints[i]!)); sources.push(i);
    const lap = file.laps.find((l) => l.to === i);
    if (lap) for (let n = 1; n < lap.count; n++) for (let j = lap.from; j <= lap.to; j++) { out.push(cell(file.waypoints[j]!)); sources.push(j); }
  }
  return { points: out, sources };
}

/** Loads a course over the grid imported from `mapBytes`. Throws on a hash mismatch or an unreachable leg. */
export function loadCourse(file: CourseFile, mapBytes: Uint8Array, grid: CellGrid): Course {
  const hash = mapHash(mapBytes);
  if (hash !== file.mapHash) throw new Error(`Course "${file.name}" is for another version of ${file.map}: map hash ${hash}, course expects ${file.mapHash}`);
  const { points: waypoints, sources } = unroll(file), finish = cell(file.finish), startGrid = file.startGrid.map(cell);
  // The ideal line through `points`, start grid cell 0 to the finish cell.
  const trace = (points: Cell[], start = startGrid[0]!) => {
    const line = [{ x: start.x + 0.5, y: start.y + 0.5 }], along = [0], waypointAlong: number[] = [];
    let at: Spot = { ...start, deck: false };
    for (const to of points) {
      const route = findRoute(grid, at, to);
      if (!route) throw new Error(`Course "${file.name}": ${to.x},${to.y} can't be reached from ${at.x},${at.y}`);
      for (const face of route) {
        at = stepTo(grid, at, face)!;
        const p = { x: at.x + 0.5, y: at.y + 0.5 }, q = line[line.length - 1]!;
        line.push(p);
        along.push(along[along.length - 1]! + Math.hypot(p.x - q.x, p.y - q.y));
      }
      waypointAlong.push(along[along.length - 1]!);
    }
    return { line, along, waypointAlong, length: along[along.length - 1]! };
  };
  const traced = trace([...waypoints, finish]);
  traced.waypointAlong.pop(); // the finish cell
  const drawnLength = file.laps.length ? trace([...file.waypoints.map(cell), finish]).length : traced.length;
  const forks = new Map<number, { to: number; weight: number; via: Cell[]; line: { x: number; y: number }[]; along: number[]; length: number }>();
  for (let i = 0; i < sources.length - 1; i++) {
    const fork = file.forks?.find((f) => f.from === sources[i]);
    if (fork) {
      const merge = fork.to ?? fork.from + 1;
      const to = i + merge - fork.from;
      if (sources[to] !== merge || sources.slice(i, to + 1).some((source, offset) => source !== fork.from + offset)) {
        throw new Error(`Course "${file.name}": fork from waypoint ${fork.from + 1} crosses a lap boundary`);
      }
      const via = fork.via.map(cell);
      forks.set(i, { to, weight: fork.weight ?? 50, via, ...trace([...via, waypoints[to]!], waypoints[i]!) });
    }
  }

  return { file, startGrid, waypoints, forks, finish, finishArea: finishAreaOf(grid, finish), ...traced, drawnLength };
}

/** Ground cell indices of the finish area around `finish`. */
export function finishAreaOf(grid: CellGrid, finish: Cell): Set<number> {
  const area = new Set<number>(), r = Math.ceil(FINISH_RADIUS);
  for (let y = finish.y - r; y <= finish.y + r; y++) for (let x = finish.x - r; x <= finish.x + r; x++) {
    if (Math.hypot(x - finish.x, y - finish.y) <= FINISH_RADIUS && drivable(grid, x, y) && grid.deck[y * grid.width + x]! < 0) area.add(y * grid.width + x);
  }
  return area;
}

/**
 * Course progress (cells along the ideal line) of a point (cell units) heading for waypoint `next`: the nearest
 * point on the ideal line's leg into that waypoint, so a tank on a self-crossing course stays on its own pass and
 * one that drove off the line picks up where it rejoins.
 */
export function courseProgress(course: Course, x: number, y: number, next: number): number {
  const { line, along } = course;
  const from = course.waypointAlong[next - 1] ?? 0, to = course.waypointAlong[next] ?? course.length;
  return from + projectLine(line, along, x, y, from, to);
}

/** Progress on the chosen alternate leg, scaled onto the main course for fair standings. */
export function forkProgress(course: Course, from: number, x: number, y: number): number {
  const fork = course.forks.get(from)!;
  const start = course.waypointAlong[from]!, end = course.waypointAlong[fork.to]!;
  return start + (fork.length ? projectLine(fork.line, fork.along, x, y, 0, fork.length) / fork.length : 0) * (end - start);
}

function projectLine(line: { x: number; y: number }[], along: number[], x: number, y: number, from: number, to: number): number {
  let best = from, bestD = Infinity;
  for (let i = 1; i < line.length; i++) {
    if (along[i]! <= from || along[i - 1]! >= to) continue;
    const a = line[i - 1]!, b = line[i]!, dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
    if (d < bestD) [best, bestD] = [along[i - 1]! + (along[i]! - along[i - 1]!) * t, d];
  }
  return best - from;
}
