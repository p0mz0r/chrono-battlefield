import { expect, it } from 'vitest';
import type { CellGrid } from '../battlefield/grid.js';
import { mapHash, type CourseFile } from './course.js';
import { freeMapName, inspectCourse, mapUpload } from './editorModel.js';

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

it('suggests crossed bridges in line order and updates time', () => {
  const one = file();
  grid.bridge[33] = 0; grid.bridges.push({ kind: 'low', cells: [33] });
  const report = inspectCourse(one, bytes, grid);
  expect(report.errors).toEqual([]);
  expect(report.seconds).toBeGreaterThan(0);
  expect(report.suggestedBridges).toEqual([[9, 2]]);
  one.waypoints = [[2, 3]]; one.laps = [];
  expect(inspectCourse(one, bytes, grid).seconds).toBeLessThan(report.seconds!);
});

it('reuses an identical uploaded map and never replaces a different one silently', () => {
  const a = new TextEncoder().encode('map a'), b = new TextEncoder().encode('map b');
  expect(mapUpload(undefined, a)).toBe('write');
  expect(mapUpload(a, a.slice())).toBe('same');
  expect(mapUpload(a, b)).toBe('conflict');
  const taken = new Set(['oasis.map', 'oasis-2.map']);
  expect(freeMapName('oasis.map', (name) => taken.has(name))).toBe('oasis-3.map');
});
