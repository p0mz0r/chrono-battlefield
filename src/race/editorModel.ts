import type { CellGrid } from '../battlefield/grid.js';
import { drivable, findRoute } from '../movement/index.js';
import { loadCourse, mapHash, type Course, type CourseFile } from './course.js';

/** A live inspection of the file the editor will save. The game loader remains the authority for the ideal line. */
export function inspectCourse(file: CourseFile, bytes: Uint8Array, grid: CellGrid): {
  errors: string[]; course?: Course; seconds?: number; suggestedBridges: [number, number][];
} {
  const errors: string[] = [];
  const valid = (p: [number, number] | undefined) => p && Number.isInteger(p[0]) && Number.isInteger(p[1]) &&
    p[0] >= 0 && p[1] >= 0 && p[0] < grid.width && p[1] < grid.height;
  const index = (p: [number, number]) => p[1] * grid.width + p[0];
  const high = (p: [number, number]) => grid.deck[index(p)]! >= 0;
  if (!file.name.trim()) errors.push('Enter a course name.');
  if (file.mapHash !== mapHash(bytes)) errors.push('Map hash differs from the loaded map.');
  if (file.startGrid.length !== 10) errors.push('Place exactly 10 start cells.');
  const seen = new Set<string>();
  for (const [n, p] of file.startGrid.entries()) {
    if (!valid(p)) { errors.push(`Start ${n + 1} is outside the map.`); continue; }
    const key = p.join(',');
    if (seen.has(key)) errors.push(`Start ${n + 1} must be distinct.`);
    seen.add(key);
    if (!drivable(grid, ...p)) errors.push(`Start ${n + 1} is not drivable.`);
    if (grid.bridge[index(p)]! >= 0) errors.push(`Start ${n + 1} is on a bridge.`);
    if (high(p)) errors.push(`Start ${n + 1} is on or under a high bridge deck.`);
  }
  for (const [label, p] of [...file.waypoints.map((p, i) => [`Waypoint ${i + 1}`, p] as const), ['Finish', file.finish] as const]) {
    if (!valid(p)) { errors.push(`${label} is outside the map.`); continue; }
    if (!drivable(grid, ...p)) errors.push(`${label} is not drivable.`);
    if (high(p)) errors.push(`${label} is on or under a high bridge deck.`);
  }
  let last = -1;
  for (const [n, lap] of [...file.laps].sort((a, b) => a.from - b.from).entries()) {
    if (!Number.isInteger(lap.from) || !Number.isInteger(lap.to) || !Number.isInteger(lap.count) ||
      lap.from < 0 || lap.to >= file.waypoints.length || lap.from >= lap.to || lap.count < 2) errors.push(`Lap ${n + 1} needs two or more waypoints and a count of at least 2.`);
    if (lap.from <= last) errors.push(`Lap ${n + 1} sections overlap.`);
    last = Math.max(last, lap.to);
    if (valid(file.waypoints[lap.from]) && valid(file.waypoints[lap.to]) &&
      !findRoute(grid, { ...point(file.waypoints[lap.to]!), deck: false }, point(file.waypoints[lap.from]!))) errors.push(`Lap ${n + 1} cannot close.`);
  }
  const chosen = new Set<number>();
  for (const [n, p] of file.bridges.entries()) {
    if (!valid(p) || grid.bridge[index(p)]! < 0) { errors.push(`B${n + 1} is not a bridge.`); continue; }
    const id = grid.bridge[index(p)]!;
    if (chosen.has(id)) errors.push(`B${n + 1} repeats a bridge.`);
    chosen.add(id);
  }
  try {
    const course = loadCourse(file, bytes, grid);
    const first = file.waypoints[0] ?? file.finish;
    for (const [n, p] of file.startGrid.entries()) if (!findRoute(grid, { ...point(p), deck: false }, point(first))) errors.push(`Start ${n + 1} cannot reach the course.`);
    const suggestedBridges: [number, number][] = [], visited = new Set<number>();
    let seconds = 0;
    for (let n = 1; n < course.line.length; n++) {
      const a = course.line[n - 1]!, b = course.line[n]!;
      const x = Math.floor(b.x), y = Math.floor(b.y), i = y * grid.width + x;
      const id = grid.bridge[i]!;
      if (id >= 0 && !visited.has(id)) { visited.add(id); suggestedBridges.push([x, y]); }
      // Rhino Speed=6, GameSpeedBias=1.6, 30 Hz; add a modest turn allowance.
      seconds += Math.hypot(b.x - a.x, b.y - a.y) * 256 / (Math.floor(6 * 256 / 100) * 1.6 * 30 * (grid.deck[i]! >= 0 ? 1 : grid.speed[i]!)) * 1.15;
    }
    return { errors, course, seconds, suggestedBridges };
  } catch (error) {
    errors.push((error as Error).message);
    return { errors, suggestedBridges: [] };
  }
}

const point = ([x, y]: [number, number]) => ({ x, y });

/** Uploading a custom map over `existing` (undefined: no file of that name): write it, reuse the identical file, or ask first. */
export function mapUpload(existing: Uint8Array | undefined, incoming: Uint8Array): 'write' | 'same' | 'conflict' {
  if (!existing) return 'write';
  return existing.length === incoming.length && existing.every((byte, i) => byte === incoming[i]) ? 'same' : 'conflict';
}

/** `name-2.map`, `name-3.map`… : the first that isn't taken. */
export function freeMapName(name: string, taken: (name: string) => boolean): string {
  const dot = name.lastIndexOf('.');
  for (let n = 2; ; n++) {
    const next = `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
    if (!taken(next)) return next;
  }
}
