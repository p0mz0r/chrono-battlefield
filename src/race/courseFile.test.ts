import { expect, it } from 'vitest';
import { mapHash, type CourseFile } from './course.js';
import { exportCourse, readCourseFile } from './courseFile.js';

const custom = new Uint8Array(300_000).map((_, i) => i * 7);
const install = new TextEncoder().encode('install map');
const course = (source: CourseFile['source'], bytes: Uint8Array): CourseFile => ({
  name: 'Oasis Run', map: source === 'shipped' ? 'oasis.map' : 'Hills.mmx', mapHash: mapHash(bytes), source,
  author: 'Someone', link: 'https://example.org/oasis', finish: [3, 3], waypoints: [[2, 2]], laps: [], bridges: [],
  startGrid: Array.from({ length: 10 }, (_, i) => [i, 0] as [number, number]),
});
const installMaps = (path: string) => Promise.resolve(path === 'Hills.mmx' ? install : undefined);

it('round-trips a course with its custom map, and one on an install map without it', async () => {
  const shipped = exportCourse(course('shipped', custom), custom);
  const back = await readCourseFile('oasis.rhino-course.json', shipped, installMaps);
  expect(back.course).toEqual(course('shipped', custom));
  expect(back.map).toEqual(custom);

  const onInstall = exportCourse(course('install', install));
  expect(JSON.parse(onInstall).mapFile).toBeUndefined();
  expect((await readCourseFile('hills.rhino-course.json', onInstall, installMaps)).map).toBeUndefined();
});

it('refuses other files, a map that does not match, and a missing or different install map', async () => {
  await expect(readCourseFile('x.json', '{"name":"x"}', installMaps)).rejects.toThrow('x.json is not a Rhino Race course file');
  await expect(readCourseFile('x.json', 'not json', installMaps)).rejects.toThrow('not a Rhino Race course file');
  const tampered = JSON.parse(exportCourse(course('shipped', custom), custom));
  tampered.mapFile = btoa('other bytes');
  await expect(readCourseFile('oasis.rhino-course.json', JSON.stringify(tampered), installMaps)).rejects.toThrow("The map inside oasis.rhino-course.json doesn't match its course");
  const uncredited = { ...course('shipped', custom), author: ' ' };
  await expect(readCourseFile('anon.rhino-course.json', exportCourse(uncredited, custom), installMaps)).rejects.toThrow('The custom map in anon.rhino-course.json has no author or source link');
  const missing = { ...course('install', install), map: 'Gone.mmx' };
  await expect(readCourseFile('gone.rhino-course.json', exportCourse(missing), installMaps)).rejects.toThrow("gone.rhino-course.json needs the install map Gone.mmx, which your install doesn't have or has in a different version");
  const other = course('install', new TextEncoder().encode('older version'));
  await expect(readCourseFile('old.rhino-course.json', exportCourse(other), installMaps)).rejects.toThrow('needs the install map Hills.mmx');
});

it('keeps forks in exported courses and rejects malformed fork references', async () => {
  const withFork = course('install', install);
  withFork.waypoints.push([4, 2]);
  withFork.forks = [{ from: 0, to: 1, via: [[3, 5]], weight: 70 }];
  expect((await readCourseFile('fork.rhino-course.json', exportCourse(withFork), installMaps)).course.forks).toEqual(withFork.forks);
  withFork.forks[0]!.to = 2;
  await expect(readCourseFile('bad.rhino-course.json', exportCourse(withFork), installMaps)).rejects.toThrow('not a Rhino Race course file');
  withFork.forks[0]!.to = 1;
  withFork.forks[0]!.weight = 101;
  await expect(readCourseFile('bad-weight.rhino-course.json', exportCourse(withFork), installMaps)).rejects.toThrow('not a Rhino Race course file');
  delete withFork.forks[0]!.to;
  delete withFork.forks[0]!.weight;
  expect((await readCourseFile('old-fork.rhino-course.json', exportCourse(withFork), installMaps)).course.forks).toEqual(withFork.forks);
});
