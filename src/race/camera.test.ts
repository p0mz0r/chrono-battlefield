import { describe, expect, it } from 'vitest';
import { TICK_HZ, type CellGrid } from '../movement/index.js';
import { currentLap, directorShot, lapOf, type Shot } from './camera.js';
import { loadCourse, mapHash, type CourseFile } from './course.js';
import { chat, createRace, openJoinWindow, paid, standings, tickRace, type Race } from './race.js';

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
  it('opens on the leader, holds each shot 7 s, alternating with the closest fight for a place', () => {
    const r = race(3, ['Kane', 'Kara', 'Yuri', 'Tanya', 'Boris']);
    r.enabled.delete('v3'); // no bot V3s, so no hits interrupt the alternation
    let shot: Shot | undefined;
    const reasons = new Set<string>();
    runToResults(r, () => {
      if (r.phase !== 'racing') return;
      const before = shot;
      shot = directorShot(r, shot);
      expect(shot.racer.finishedAt).toBeUndefined();
      if (shot === before) return;
      reasons.add(shot.reason.split(' ')[0]!);
      if (!before) return expect(shot).toMatchObject({ cutAt: 0, reason: 'Leader' });
      const held = r.frame - before.cutAt;
      if (shot.reason.startsWith('Hit by ')) {
        expect(shot.racer).toBe(r.lastHit);
        expect(held).toBeGreaterThanOrEqual(2.5 * TICK_HZ);
        return;
      }
      if (before.racer.finishedAt === undefined) expect(held).toBe(7 * TICK_HZ); // held unless its tank finished
      const live = standings(r).filter((x) => x.finishTime === undefined);
      if (before.reason === 'Leader' && live.length > 1) {
        // The chaser of the unfinished pair with the smallest progress gap.
        const gaps = live.slice(1).map((x, i) => live[i]!.progress - x.progress);
        const chaser = live[gaps.indexOf(Math.min(...gaps)) + 1]!.name;
        expect(shot.racer.name).toBe(chaser);
        expect(shot.reason).toBe(`Battle for P${standings(r).findIndex((x) => x.name === chaser)}`);
      } else expect(shot).toMatchObject({ reason: 'Leader', racer: { name: live[0]!.name } });
    });
    expect([...reasons].sort()).toEqual(['Battle', 'Leader']);
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
    expect(chat(r, { viewerId: 'v', name: 'Vera', text: `!missile ${target}` }).ok).toBe(true);
    for (let i = 0; i < 1.5 * TICK_HZ; i++) step(); // the hit lands 1.5 s after launch, 2 s into the shot
    expect(r.lastHit?.name).toBe(target);
    expect(shot!.reason).toBe('Leader'); // too soon after the last cut
    for (let i = 0; i < TICK_HZ; i++) step();
    expect(shot).toMatchObject({ reason: 'Hit by Vera', cutAt: opened + 2.5 * TICK_HZ });
    expect(shot!.racer.name).toBe(target);
    const hitShot = shot;
    for (let i = 0; i < 7 * TICK_HZ; i++) {
      step();
      if (shot !== hitShot) expect(shot!.hitSeen === hitShot!.hitSeen && shot!.reason.startsWith('Hit by ')).toBe(false); // never the same hit twice
    }
    expect(shot).not.toBe(hitShot); // a hit shot is held 7 s like any other
  });

  it('names the viewer behind a random hit too', () => {
    const r = race(1);
    let shot: Shot | undefined;
    while (r.phase !== 'racing') tickRace(r);
    for (const x of r.racers) x.botNext = Infinity; // no bot shield to block the missile
    shot = directorShot(r, shot);
    expect(chat(r, { viewerId: 'w', name: 'Wes', text: '!missile' }).ok).toBe(true);
    for (let i = 0; i < 3 * TICK_HZ; i++) { tickRace(r); shot = directorShot(r, shot); }
    expect(shot).toMatchObject({ reason: 'Hit by Wes', racer: r.lastHit });
  });

  /** A race 5 s in with no bot actions, shot by the director every tick. */
  function calm() {
    const r = race(1);
    while (r.phase !== 'racing') tickRace(r);
    for (const x of r.racers) x.botNext = Infinity;
    let shot: Shot | undefined;
    const step = (n = 1) => { for (let i = 0; i < n; i++) { tickRace(r); shot = directorShot(r, shot); } return shot!; };
    step(5 * TICK_HZ);
    return { r, step };
  }

  it('shows a Chrono swap as the back tank first, then cuts to it landing up front and holds 3 s', () => {
    const { r, step } = calm();
    expect(paid(r, { viewerId: 'v', name: 'Vera', event: 'chronoSwap', via: 'redemption', reference: 'r1' }).ok).toBe(true);
    const turn = step();
    const back = r.queue[0]!.picks[1]!;
    expect(turn).toMatchObject({ racer: back, reason: 'Chrono swap by Vera', cutAt: r.frame });
    expect(step(3 * TICK_HZ - 1)).toBe(turn); // held through the build-up
    const landing = step();
    expect(landing).toMatchObject({ racer: back, reason: 'Swapped up front by Vera', cutAt: r.frame });
    expect(standings(r).findIndex((s) => s.name === back.name)).toBeLessThan(r.racers.length / 2);
    expect(step(3 * TICK_HZ - 1)).toBe(landing);
    expect(step()).toMatchObject({ reason: 'Leader', cutAt: r.frame }); // 3 s after landing
  });

  it('holds on the nuke\'s target until the first stun ends, then cuts to that tank captioned "First away" for 3 s', () => {
    const { r, step } = calm();
    for (let i = 0; i < 30; i++) chat(r, { viewerId: `fan${i}`, name: `fan${i}`, text: '!boost' });
    for (let i = 0; i < 5; i++) chat(r, { viewerId: `n${i}`, name: `n${i}`, text: '!nuke' });
    const turn = step();
    const leading = r.racers.find((x) => x.name === standings(r)[0]!.name)!;
    expect(turn).toMatchObject({ racer: leading, reason: 'Nuke by CHAT', cutAt: r.frame });
    step(3 * TICK_HZ); // impact
    const away = r.racers.reduce((a, b) => (b.stunUntil < a.stunUntil ? b : a));
    expect(step(away.stunUntil - r.frame - 1)).toBe(turn); // through impact while every tank burns
    const first = step();
    expect(first).toMatchObject({ racer: away, reason: 'First away', cutAt: r.frame });
    expect(step(3 * TICK_HZ - 1)).toBe(first);
    expect(step().reason).not.toBe('First away');
  });

  it('holds on the Kirov\'s target while it waits and bombs, and 3 s after its last bomb', () => {
    const { r, step } = calm();
    paid(r, { viewerId: 'v', name: 'Vera', event: 'kirov', via: 'redemption', reference: 'r1' });
    let bombs = 0, shot: Shot;
    do {
      r.sounds.length = 0;
      shot = step();
      if (r.sounds.includes('kirovAttack')) bombs++;
      // The leading tank while it waits, then the tank that came in range.
      expect(shot).toMatchObject({ racer: (r.queue[0] ?? r.landed)!.picks[0], reason: 'Kirov by Vera' });
    } while (r.queue.length);
    expect(bombs).toBe(7);
    expect(step(3 * TICK_HZ - 1)).toBe(shot);
    expect(step().reason).not.toBe('Kirov by Vera'); // 3 s after its last bomb
  });

  it('holds back hit cuts while an event plays, and drops the hits it held back', () => {
    const { r, step } = calm();
    paid(r, { viewerId: 'v', name: 'Vera', event: 'chronoSwap', via: 'redemption', reference: 'r1' });
    const held = step();
    const target = standings(r).find((s) => s.name !== held.racer.name)!.name;
    expect(chat(r, { viewerId: 'w', name: 'Wes', text: `!missile ${target}` }).ok).toBe(true);
    step(2 * TICK_HZ); // the missile lands in the build-up
    expect(r.lastHit?.name).toBe(target);
    expect(step(TICK_HZ + 3 * TICK_HZ - 1).reason).toBe('Swapped up front by Vera');
    for (let i = 0; i < 8 * TICK_HZ; i++) expect(step().reason).not.toMatch(/^Hit by/);
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

  it('follows the leader into a later lap section', () => {
    // Waypoints 0..9: ring 1..3 ×2, ring 6..7 ×3. Unrolled: 0 1 2 3 [1 2 3] 4 5 6 7 [6 7 6 7] 8 9.
    const laps = [{ from: 6, to: 7, count: 3 }, { from: 1, to: 3, count: 2 }];
    expect(lapOf(laps, 0)).toEqual({ lap: 1, count: 2 });
    expect(lapOf(laps, 5)).toEqual({ lap: 2, count: 2 }); // passed waypoint 1 a second time
    expect(lapOf(laps, 10)).toEqual({ lap: 1, count: 3 }); // passed waypoint 6 (unrolled 9) once
    expect(lapOf(laps, 12)).toEqual({ lap: 2, count: 3 });
    expect(lapOf(laps, 14)).toEqual({ lap: 3, count: 3 });
    expect(lapOf(laps, 16)).toEqual({ lap: 3, count: 3 });
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
