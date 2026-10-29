import { expect, it } from 'vitest';
import type { CellGrid } from '../battlefield/grid.js';
import { mapHash, type CourseFile } from './course.js';
import { closestSegment, freeMapName, inspectCourse, mapUpload } from './editorModel.js';

const bytes = new TextEncoder().encode('map');
const grid: CellGrid = {
  width: 12, height: 12, land: Array(144).fill('Clear'), speed: Array(144).fill(1),
  level: Array(144).fill(0), ramp: Array(144).fill(0), blocked: Array(144).fill(false),
  deck: Array(144).fill(-1), bridge: Array(144).fill(-1), bridges: [],
};
const file = (): CourseFile => ({
  name: 'Loop', map: 'test.map', mapHash: mapHash(bytes), source: 'install', author: 'Westwood', link: '',
  startGrid: [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2]],
  waypoints: [[9, 2], [9, 9], [2, 9]], laps: [{ from: 0, to: 2, count: 3 }], finish: [1, 8], bridges: [],
});

it('validates placements and lap sections before saving', () => {
  expect(inspectCourse(file(), bytes, grid).errors).toEqual([]);
  const invalid = file();
  invalid.startGrid[1] = [1, 1];
  invalid.startGrid[2] = [0, 0]; grid.blocked[0] = true;
  invalid.startGrid[3] = [6, 6]; grid.bridge[78] = 0; grid.bridges.push({ kind: 'low', cells: [78] });
  invalid.waypoints[0] = [7, 7]; grid.deck[91] = 4;
  invalid.laps.push({ from: 1, to: 2, count: 2 });
  expect(inspectCourse(invalid, bytes, grid).errors.join(' ')).toMatch(/distinct.*drivable.*bridge.*deck.*overlap/i);
});

it('reports an empty start grid without exposing a loader error', () => {
  const draft = file();
  draft.startGrid = [];
  expect(inspectCourse(draft, bytes, grid).errors).toEqual(['Place exactly 10 start cells.']);
});

it('asks for a finish on a new course instead of placing one', () => {
  const { finish: _, ...draft } = file();
  expect(inspectCourse(draft, bytes, grid).errors).toEqual(['Place the finish.']);
});

it('updates time and ignores a low bridge with no water to cross', () => {
  const one = file();
  grid.bridge[33] = grid.bridges.length; grid.bridges.push({ kind: 'low', cells: [33] }); // (9, 2) in open ground
  const report = inspectCourse(one, bytes, grid);
  expect(report.errors).toEqual([]);
  expect(report.seconds).toBeGreaterThan(0);
  expect(report.suggestedBridges).toEqual([]);
  one.waypoints = [[2, 3]]; one.laps = [];
  expect(inspectCourse(one, bytes, grid).seconds).toBeLessThan(report.seconds!);
});

it('suggests low bridges the ideal line crosses water on', () => {
  // Water along row 5, low bridges at (9, 5) and (2, 5).
  for (let x = 0; x < 12; x++) grid.speed[60 + x] = 0;
  const ids = [69, 62].map((i) => { grid.speed[i] = 1; grid.bridge[i] = grid.bridges.length; return grid.bridges.push({ kind: 'low', cells: [i] }) - 1; });
  try {
    const one = file();
    expect(inspectCourse(one, bytes, grid).suggestedBridges).toEqual([[9, 5]]);
    one.forks = [{ from: 0, to: 1, via: [[2, 5]] }]; // the alternate route crosses the western bridge
    expect(inspectCourse(one, bytes, grid).suggestedBridges).toEqual([[9, 5], [2, 5]]);
  } finally {
    for (let x = 0; x < 12; x++) { grid.speed[60 + x] = 1; grid.bridge[60 + x] = -1; }
    grid.bridges.length = ids[0]!;
  }
});

it('suggests a high bridge only when the ideal line is on its deck', () => {
  const id = grid.bridges.length; // (9, 5), between waypoints (9, 2) and (9, 9)
  grid.bridge[69] = id; grid.bridges.push({ kind: 'high', cells: [69] });
  try {
    grid.deck[69] = 4; // overhead: the line drives under it
    expect(inspectCourse(file(), bytes, grid).suggestedBridges).not.toContainEqual([9, 5]);
    grid.deck[69] = 0; // level with the ground: the line drives over it
    expect(inspectCourse(file(), bytes, grid).suggestedBridges).toContainEqual([9, 5]);
  } finally {
    grid.bridge[69] = -1; grid.deck[69] = -1; grid.bridges.pop();
  }
});

it('validates alternate via cells and traces their route to the merge waypoint', () => {
  const one = file();
  one.forks = [{ from: 0, to: 2, via: [[3, 7]] }];
  const report = inspectCourse(one, bytes, grid);
  expect(report.errors).toEqual([]);
  expect(report.course!.forks.get(0)!.via).toEqual([{ x: 3, y: 7 }]);
  expect(report.course!.forks.get(3)!.via).toEqual([{ x: 3, y: 7 }]); // repeated lap
  expect(report.course!.forks.get(0)!.to).toBe(2);
  one.forks.push({ from: 0, to: 1, via: [[0, 0]] });
  grid.blocked[0] = true;
  expect(inspectCourse(one, bytes, grid).errors.join(' ')).toMatch(/unique split.*not drivable/i);
  one.forks[0]!.weight = 101;
  expect(inspectCourse(one, bytes, grid).errors.join(' ')).toMatch(/weight from 0 to 100/i);
  const crossing = file();
  crossing.laps = [{ from: 0, to: 1, count: 2 }];
  crossing.forks = [{ from: 0, to: 2, via: [[3, 7]] }];
  expect(inspectCourse(crossing, bytes, grid).errors.join(' ')).toMatch(/crosses a lap boundary/i);
});

it('reuses an identical uploaded map and never replaces a different one silently', () => {
  const a = new TextEncoder().encode('map a'), b = new TextEncoder().encode('map b');
  expect(mapUpload(undefined, a)).toBe('write');
  expect(mapUpload(a, a.slice())).toBe('same');
  expect(mapUpload(a, b)).toBe('conflict');
  const taken = new Set(['oasis.map', 'oasis-2.map']);
  expect(freeMapName('oasis.map', (name) => taken.has(name))).toBe('oasis-3.map');
});

it('inserts a route waypoint between the closest two existing points', () => {
  const path = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }];
  expect(closestSegment(path, { x: 1, y: 4 })).toBe(0);
  expect(closestSegment(path, { x: 5, y: 9 })).toBe(1);
  expect(closestSegment(path, { x: 9, y: 4 })).toBe(2);
});
