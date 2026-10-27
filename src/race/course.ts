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
  /** Waypoint index ranges (inclusive), driven `count` times; non-overlapping. */
  laps: { from: number; to: number; count: number }[];
  finish: XY;
  /** One cell of each bridge in play, `B1`… in the order the ideal line meets them. */
  bridges: XY[];
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
  /** Length of the ideal line in cells. */
  length: number;
}

/** Finish area radius in cells (3 tanks wide). */
export const FINISH_RADIUS = 1.5;

/** CRC-32 of the map file (the OBS page isn't a secure context, so no `crypto.subtle`). */
export const mapHash = (bytes: Uint8Array) => `crc32:${crc32(bytes).toString(16).padStart(8, '0')}`;

const cell = ([x, y]: XY): Cell => ({ x, y });

/** Lap sections repeated into one flat waypoint list. */
function unroll(file: CourseFile): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < file.waypoints.length; i++) {
    out.push(cell(file.waypoints[i]!));
    const lap = file.laps.find((l) => l.to === i);
    if (lap) for (let n = 1; n < lap.count; n++) for (let j = lap.from; j <= lap.to; j++) out.push(cell(file.waypoints[j]!));
  }
  return out;
}

/** Loads a course over the grid imported from `mapBytes`. Throws on a hash mismatch or an unreachable leg. */
export function loadCourse(file: CourseFile, mapBytes: Uint8Array, grid: CellGrid): Course {
  const hash = mapHash(mapBytes);
  if (hash !== file.mapHash) throw new Error(`Course "${file.name}" is for another version of ${file.map}: map hash ${hash}, course expects ${file.mapHash}`);
  const waypoints = unroll(file), finish = cell(file.finish), startGrid = file.startGrid.map(cell);

  const line = [{ x: startGrid[0]!.x + 0.5, y: startGrid[0]!.y + 0.5 }], along = [0], waypointAlong: number[] = [];
  let at: Spot = { ...startGrid[0]!, deck: false };
  for (const to of [...waypoints, finish]) {
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
  waypointAlong.pop(); // the finish cell

  const finishArea = new Set<number>();
  const r = Math.ceil(FINISH_RADIUS);
  for (let y = finish.y - r; y <= finish.y + r; y++) for (let x = finish.x - r; x <= finish.x + r; x++) {
    if (Math.hypot(x - finish.x, y - finish.y) <= FINISH_RADIUS && drivable(grid, x, y) && grid.deck[y * grid.width + x]! < 0) finishArea.add(y * grid.width + x);
  }
  return { file, startGrid, waypoints, finish, finishArea, line, along, waypointAlong, length: along[along.length - 1]! };
}

/**
 * Course progress (cells along the ideal line) of a point (cell units) heading for waypoint `next`: the nearest
 * point on the ideal line's leg into that waypoint, so a tank on a self-crossing course stays on its own pass and
 * one that drove off the line picks up where it rejoins.
 */
export function courseProgress(course: Course, x: number, y: number, next: number): number {
  const { line, along } = course;
  const from = course.waypointAlong[next - 1] ?? 0, to = course.waypointAlong[next] ?? course.length;
  let best = from, bestD = Infinity;
  for (let i = 1; i < line.length; i++) {
    if (along[i]! <= from || along[i - 1]! >= to) continue;
    const a = line[i - 1]!, b = line[i]!, dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
    if (d < bestD) [best, bestD] = [along[i - 1]! + (along[i]! - along[i - 1]!) * t, d];
  }
  return best;
}
