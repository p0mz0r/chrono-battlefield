import { describe, expect, it } from 'vitest';
import { TICK_HZ, type CellGrid } from '../movement/index.js';
import { currentLap, directorShot, type Shot } from './camera.js';
import { loadCourse, mapHash, type CourseFile } from './course.js';
import { chat, createRace, openJoinWindow, standings, tickRace, type Race } from './race.js';

const MAP = new TextEncoder().encode('[Map]\nTheater=TEMPERATE\n');

/** 30×20 open ground with a wall block in the middle to drive round. */
const ARENA: CellGrid = (() => {
  const width = 30, height = 20, n = width * height;
  const blocked = Array.from({ length: n }, (_, i) => { const x = i % width, y = (i - x) / width; return x >= 10 && x < 20 && y >= 7 && y < 13; });
  return { width, height, speed: blocked.map((b) => (b ? 0 : 1)), level: new Array(n).fill(0), ramp: new Array(n).fill(0), blocked, deck: new Array(n).fill(-1) };
})();

/** Two laps clockwise round the block (unrolled A B C D A B C D), finishing beside the start grid. */
const LOOP: CourseFile = {
  name: 'Test loop', map: 'test.map', mapHash: mapHash(MAP), source: 'shipped', author: 'tests', link: '',
  startGrid: [[2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4]],
  waypoints: [[24, 3], [24, 16], [6, 16], [6, 8]], laps: [{ from: 0, to: 3, count: 2 }], finish: [3, 7], bridges: [],
};

function race(seed = 1, viewers = ['Kane', 'Kara', 'Yuri']): Race {
  const r = createRace(loadCourse(LOOP, MAP, ARENA), ARENA, seed);
  openJoinWindow(r, { joinSeconds: 1 });
  for (const name of viewers) chat(r, { viewerId: name, name, text: '!rhino' });
  return r;
}

/** Ticks until the race shows results, calling `each` after every tick. */
function runToResults(r: Race, each: () => void) {
  for (let i = 0; i < 400 * TICK_HZ && r.phase !== 'results'; i++) { tickRace(r); each(); }
  expect(r.phase).toBe('results');
}

describe('director camera', () => {
  it('opens on the leader, holds each shot 7 s, then alternates with the closest fight for a place', () => {
    const r = race(3, ['Kane', 'Kara', 'Yuri', 'Tanya', 'Boris']);
    let shot: Shot | undefined;
    const cuts: { frame: number; reason: string; name: string; expected: string; leftFinished: boolean }[] = [];
    runToResults(r, () => {
      if (r.phase !== 'racing') return;
      const before = shot;
      shot = directorShot(r, shot);
      expect(shot.racer.finishedAt).toBeUndefined();
      if (shot === before) return;
      const live = standings(r).filter((s) => s.finishTime === undefined);
      let expected = live[0]!.name;
      if (shot.reason.startsWith('Battle')) {
        // The chaser of the unfinished pair with the smallest progress gap.
        const gaps = live.slice(1).map((s, i) => live[i]!.progress - s.progress);
        expected = live[gaps.indexOf(Math.min(...gaps)) + 1]!.name;
        const place = standings(r).findIndex((s) => s.name === expected) + 1;
        expect(shot.reason).toBe(`Battle for P${place - 1}`);
      }
      cuts.push({ frame: r.frame, reason: shot.reason, name: shot.racer.name, expected, leftFinished: before?.racer.finishedAt !== undefined });
    });
    expect(cuts[0]).toMatchObject({ frame: 0, reason: 'Leader' });
    for (const c of cuts) expect(c.name).toBe(c.expected);
    expect(cuts.slice(0, 4).map((c) => c.reason.split(' ')[0])).toEqual(['Leader', 'Battle', 'Leader', 'Battle']);
    // A shot is held 7 s unless its tank finishes.
    for (let i = 1; i < cuts.length; i++) if (!cuts[i]!.leftFinished) expect(cuts[i]!.frame - cuts[i - 1]!.frame).toBe(7 * TICK_HZ);
  });

  it('cuts to the tank last hit, once per hit, but not within 2.5 s of the previous cut', () => {
    const r = race(1);
    let shot: Shot | undefined;
    const step = () => { tickRace(r); shot = directorShot(r, shot); };
    while (r.phase !== 'racing') tickRace(r);
    step();
    const opened = shot!.cutAt;
    for (let i = 1; i < TICK_HZ / 2; i++) step(); // 0.5 s into the leader shot
    const target = standings(r).at(-1)!.name;
    expect(chat(r, { viewerId: 'v', name: 'v', text: `!missile ${target}` }).ok).toBe(true);
    for (let i = 0; i < 1.5 * TICK_HZ; i++) step(); // the hit lands 1.5 s after launch, 2 s into the shot
    expect(r.lastHit?.name).toBe(target);
    expect(shot!.reason).toBe('Leader'); // too soon after the last cut
    for (let i = 0; i < TICK_HZ; i++) step();
    expect(shot).toMatchObject({ reason: 'Just hit', cutAt: opened + 2.5 * TICK_HZ });
    expect(shot!.racer.name).toBe(target);
    for (let i = 0; i < 7 * TICK_HZ; i++) step();
    expect(shot!.reason).not.toBe('Just hit'); // the same hit doesn't hold or re-cut the camera
  });
});

describe('standings header lap', () => {
  it("counts the leader's laps: lap 2 starts when the leader passes the lap's first waypoint again", () => {
    const r = race();
    const seen: string[] = [];
    runToResults(r, () => {
      if (r.phase !== 'racing') return;
      const leader = r.racers.find((x) => x.name === standings(r)[0]!.name)!;
      const lap = currentLap(r)!;
      expect(lap.count).toBe(2);
      // Unrolled waypoints: A=0 … D=3, A=4 …; the leader passed A a second time once it heads for 5.
      expect(lap.lap).toBe(leader.next >= 5 ? 2 : 1);
      if (seen.at(-1) !== String(lap.lap)) seen.push(String(lap.lap));
    });
    expect(seen).toEqual(['1', '2']);
  });

  it('has no lap for a course without a lap section', () => {
    const r = createRace(loadCourse({ ...LOOP, laps: [] }, MAP, ARENA), ARENA, 1);
    expect(currentLap(r)).toBeUndefined();
  });
});

describe('standings', () => {
  it('always list the whole field, finished tanks first, then by course progress, reordering as the race runs', () => {
    const r = race(2);
    let orders = 0, last = '';
    runToResults(r, () => {
      if (r.phase !== 'racing') return;
      const s = standings(r);
      expect(s).toHaveLength(r.racers.length);
      expect(new Set(s.map((x) => x.name)).size).toBe(r.racers.length);
      for (let i = 1; i < s.length; i++) {
        const [a, b] = [s[i - 1]!, s[i]!];
        if (b.finishTime !== undefined) expect(a.finishTime).toBeLessThanOrEqual(b.finishTime);
        else if (a.finishTime === undefined) expect(a.progress).toBeGreaterThanOrEqual(b.progress);
      }
      const order = s.map((x) => x.name).join();
      if (order !== last) { orders++; last = order; }
    });
    expect(r.racers.length).toBeGreaterThanOrEqual(8); // bots fill the field
    expect(orders).toBeGreaterThan(3);
  });
});
