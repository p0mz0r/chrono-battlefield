import { describe, expect, it } from 'vitest';
import type { CellGrid } from '../movement/index.js';
import { loadCourse, mapHash, type CourseFile } from './course.js';
import { chat, commandList, createRace, openJoinWindow, standings, tickRace, type Race } from './race.js';
import { TICK_HZ } from '../movement/index.js';
import { readdirSync, readFileSync } from 'node:fs';
import { describeInstall, readFromDir } from '../../test/install.js';
import { importBattlefield } from '../battlefield/import.js';

const COURSES: Record<string, CourseFile> = Object.fromEntries(readdirSync('courses').filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(`courses/${f}`, 'utf8'))]));

/** A grid from rows of chars: `.` clear ground, `#` blocked. */
function grid(rows: string[]): CellGrid {
  const width = rows[0]!.length, height = rows.length, n = width * height;
  const cells = rows.join('');
  return {
    width, height, speed: Array.from(cells, (c) => (c === '#' ? 0 : 1)), level: new Array(n).fill(0),
    ramp: new Array(n).fill(0), blocked: Array.from(cells, (c) => c === '#'), deck: new Array(n).fill(-1),
  };
}

const MAP = new TextEncoder().encode('[Map]\nTheater=TEMPERATE\n');

/** 30×20 open ground with a wall block in the middle to drive round. */
const ARENA = grid(Array.from({ length: 20 }, (_, y) => Array.from({ length: 30 }, (_, x) => (x >= 10 && x < 20 && y >= 7 && y < 13 ? '#' : '.')).join('')));

const START = [[2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4]] as [number, number][];

/** A circuit round the block clockwise, `count` laps, finishing back beside the start grid. */
function loopCourse(count = 2): CourseFile {
  return {
    name: 'Test loop', map: 'test.map', mapHash: mapHash(MAP), source: 'shipped', author: 'tests', link: '',
    startGrid: START, waypoints: [[24, 3], [24, 16], [6, 16], [6, 8]], laps: [{ from: 0, to: 3, count }], finish: [3, 7], bridges: [],
  };
}

describe('course', () => {
  it('refuses a course whose map hash does not match the map file', () => {
    expect(() => loadCourse(loopCourse(), new TextEncoder().encode('another map'), ARENA)).toThrow(/hash/i);
    expect(loadCourse(loopCourse(), MAP, ARENA).waypoints.length).toBeGreaterThan(0);
  });
});

const course = (file = loopCourse()) => loadCourse(file, MAP, ARENA);
const say = (race: Race, viewerId: string, text: string, name = viewerId) => chat(race, { viewerId, name, text });
const ticks = (race: Race, n: number) => { for (let i = 0; i < n; i++) tickRace(race); };
const racing = () => {
  const race = createRace(course(), ARENA, 1);
  openJoinWindow(race, { joinSeconds: 1 });
  say(race, 'a', '!rhino', 'Kane');
  say(race, 'b', '!rhino', 'Kara');
  ticks(race, 4 * TICK_HZ);
  return race;
};

describe('audience interactions', () => {
  it('parses names, rejects ambiguous targets without spending cooldown, and shows phase commands', () => {
    const race = createRace(course(), ARENA, 1);
    expect(commandList(race)).toEqual([]);
    openJoinWindow(race, { joinSeconds: 1 });
    expect(commandList(race)).toEqual(['!rhino']);
    say(race, 'a', '!rhino', 'Kane');
    say(race, 'b', '!rhino', 'Kara');
    say(race, 'c', '!rhino', 'Kandy');
    ticks(race, TICK_HZ);
    expect(commandList(race)).toEqual([]);
    ticks(race, 3 * TICK_HZ);
    expect(commandList(race)).toContain('!shield (racers)');
    expect(say(race, 'v', '?boost Kane').reason).toBe('ignored');
    expect(say(race, 'v', '?missile Kane').reason).toBe('ignored');
    expect(say(race, 'v', '!boost kan').reason).toBe('ambiguous name');
    expect(say(race, 'v', '!boost kar').ok).toBe(true);
    expect(say(race, 'v', '!boost ka')).toMatchObject({ ok: false }); // viewer cooldown after the accepted prefix
    expect(say(race, 'x', '!boost ka').reason).toBe('unknown name');
    expect(say(race, 'w', '  !BOOST @kane  ')).toMatchObject({ ok: true });
    expect(race.racers.find((r) => r.name === 'Kane')!.tank!.speedFactor).toBe(1.5);
  });

  it('boost expires while stunned; shield absorbs a launched missile', () => {
    const race = racing();
    expect(say(race, 'v', '!boost Kane').ok).toBe(true);
    expect(say(race, 'a', '!shield').ok).toBe(true);
    expect(say(race, 'w', '!missile Kane').ok).toBe(true);
    ticks(race, 2 * TICK_HZ);
    const kane = race.racers.find((r) => r.name === 'Kane')!;
    expect(kane.shieldUntil).toBeGreaterThan(race.frame);
    expect(kane.stunUntil).toBe(0);
    ticks(race, 4 * TICK_HZ);
    expect(kane.tank!.speedFactor).toBe(1);
    expect(say(race, 'x', '!missile Kane').ok).toBe(true);
    ticks(race, 2 * TICK_HZ);
    expect(kane.stunUntil).toBeGreaterThan(race.frame);
    expect(say(race, 'y', '!missile Kane').ok).toBe(false); // protected by named hit
  });

  it('random hits can select a protected target, and stun immunity prevents another delay', () => {
    const race = racing();
    const kane = race.racers.find((r) => r.name === 'Kane')!;
    expect(say(race, 'v', '!missile Kane').ok).toBe(true);
    ticks(race, 2 * TICK_HZ);
    const first = kane.stunUntil;
    expect(first).toBeGreaterThan(race.frame);
    expect(say(race, 'w', '!missile Kane').ok).toBe(false);
    ticks(race, 3 * TICK_HZ);
    expect(say(race, 'x', '!missile Kane').ok).toBe(false);
    expect(kane.stunUntil).toBe(first);
  });

  it('uses one viewer cooldown with the duration of the last successful interaction', () => {
    const race = racing();
    expect(say(race, 'a', '!shield').ok).toBe(true);
    expect(say(race, 'a', '!boost Kara').reason).toMatch(/cooldown 30/);
    ticks(race, 30 * TICK_HZ);
    expect(say(race, 'a', '!boost Kara').ok).toBe(true);
    expect(say(race, 'a', '!shield').reason).toMatch(/cooldown 20/);
    expect(say(race, 'outsider', '!shield').reason).toMatch(/racer/);
    expect(say(race, 'outsider', '!boost Kara').ok).toBe(true);
  });

  it('ignores unavailable commands and rate limits failure feed', () => {
    const race = racing();
    race.enabled.delete('missile');
    expect(commandList(race)).not.toContain('!missile [name]');
    expect(say(race, 'v', '!missile Kane').reason).toBe('ignored');
    expect(say(race, 'v', '!boost missing').ok).toBe(false);
    expect(say(race, 'v', '!boost missing').ok).toBe(false);
    expect(race.feed).toHaveLength(1);
  });

  it('holds a stunned tank mid-step and excludes it from another random stun until immunity ends', () => {
    const race = racing();
    expect(say(race, 'v', '!missile').ok).toBe(true);
    ticks(race, 2 * TICK_HZ);
    const hit = race.racers.find((r) => r.stunUntil > race.frame)!;
    expect(hit).toBeDefined();
    const x = hit.tank!.x, y = hit.tank!.y;
    ticks(race, 2 * TICK_HZ);
    expect([hit.tank!.x, hit.tank!.y]).toEqual([x, y]);
    expect(say(race, 'w', `!missile ${hit.name}`).reason).toBe('target unable');
    expect(say(race, 'w', '!missile').ok).toBe(true);
    ticks(race, 2 * TICK_HZ);
    expect(hit.stunUntil).toBeLessThanOrEqual(race.frame);
  });
});

describe('joining', () => {
  it('takes !rhino only during the join window, once per viewer, and ignores every other line', () => {
    const race = createRace(course(), ARENA, 1);
    expect(say(race, 'a', '!rhino')).toEqual({ ok: false, reason: 'ignored' }); // no join window yet
    openJoinWindow(race, { joinSeconds: 2 });
    expect(say(race, 'a', '  !RHINO ')).toMatchObject({ ok: true });
    expect(say(race, 'a', '!rhino', 'other name')).toEqual({ ok: false, reason: 'ignored' });
    for (const text of ['rhino', '!rhinoo', '!rhino now', 'hello', '!boost']) expect(say(race, 'b', text)).toEqual({ ok: false, reason: 'ignored' });
    ticks(race, 2 * TICK_HZ);
    expect(race.phase).toBe('countdown');
    expect(say(race, 'b', '!rhino')).toEqual({ ok: false, reason: 'ignored' });
    expect(standings(race).map((s) => s.name)).toContain('a');
  });

  it('fills the field with bots up to 8 and starts no race without viewers', () => {
    const race = createRace(course(), ARENA, 1);
    openJoinWindow(race, { joinSeconds: 1 });
    say(race, 'twitch:1', '!rhino', 'p0mz0r');
    say(race, 'twitch:2', '!rhino', 'Kane');
    ticks(race, TICK_HZ);
    expect(standings(race).map((s) => [s.name, s.bot]).sort()).toEqual([
      ['Bot1', true], ['Bot2', true], ['Bot3', true], ['Bot4', true], ['Bot5', true], ['Bot6', true], ['Kane', false], ['p0mz0r', false],
    ]);

    const empty = createRace(course(), ARENA, 1);
    openJoinWindow(empty, { joinSeconds: 1 });
    ticks(empty, TICK_HZ);
    expect(empty.phase).toBe('idle');
    expect(standings(empty)).toEqual([]);
  });

  it('closes the join window when 10 have joined and suffixes colliding names with #2', () => {
    const race = createRace(course(), ARENA, 1);
    openJoinWindow(race);
    expect(say(race, 'twitch:1', '!rhino', 'Bot1')).toEqual({ ok: true, reason: 'joined as Bot1#2' });
    expect(say(race, 'twitch:2', '!rhino', 'Kane')).toEqual({ ok: true, reason: 'joined as Kane' });
    expect(say(race, 'youtube:9', '!rhino', 'kane')).toEqual({ ok: true, reason: 'joined as kane#2' });
    expect(say(race, 'twitch:3', '!rhino', 'bot23')).toEqual({ ok: true, reason: 'joined as bot23' });
    for (let i = 4; i <= 9; i++) say(race, `v${i}`, '!rhino');
    expect(race.phase).toBe('countdown');
    expect(standings(race)).toHaveLength(10);
    expect(say(race, 'late', '!rhino')).toEqual({ ok: false, reason: 'ignored' });
  });
});

/** Opens a race, joins `viewers`, and ticks to the results (or `maxTicks`), recording each tank's centre every frame. */
function runRace(file: CourseFile, seed: number, viewers: string[], opts: { finishSeconds?: number; maxTicks?: number } = {}) {
  const race = createRace(course(file), ARENA, seed);
  openJoinWindow(race, { joinSeconds: 1, finishSeconds: opts.finishSeconds ?? 60 });
  for (const v of viewers) say(race, v, '!rhino');
  const trace = new Map<string, { x: number; y: number; progress: number }[]>();
  for (let i = 0; i < (opts.maxTicks ?? 20_000) && race.phase !== 'results'; i++) {
    tickRace(race);
    for (const r of race.racers) if (r.tank && r.finishedAt === undefined) {
      const t = trace.get(r.name) ?? [];
      t.push({ x: r.tank.x / 256, y: r.tank.y / 256, progress: r.progress });
      trace.set(r.name, t);
    }
  }
  return { race, trace };
}

describe('racing', () => {
  it('drives every tank through the unrolled laps into the finish area and lists placings', () => {
    const { race, trace } = runRace(loopCourse(3), 1, ['p0mz0r', 'Kane']);
    expect(race.phase).toBe('results');
    expect(race.results).toHaveLength(8);
    expect(race.results.every((s) => s.finishTime !== undefined)).toBe(true);
    const times = race.results.map((s) => s.finishTime!);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const [name, points] of trace) {
      // The far corner (24,16) is reached once per lap: three separate visits within 2.25 cells.
      let visits = 0, inside = false;
      for (const p of points) {
        const now = Math.hypot(p.x - 24.5, p.y - 16.5) <= 2.25;
        if (now && !inside) visits++;
        inside = now;
      }
      expect(visits, name).toBe(3);
      const last = points[points.length - 1]!;
      expect(Math.hypot(last.x - 3.5, last.y - 7.5), name).toBeLessThan(2.5); // into the finish area
    }
  });
});

describe('ending', () => {
  it('ends the race when the finish timer runs out and places unfinished tanks by course progress', () => {
    const race = createRace(course(loopCourse(3)), ARENA, 2);
    openJoinWindow(race, { joinSeconds: 1, finishSeconds: 5 });
    say(race, 'a', '!rhino');
    let firstFinish = -1;
    for (let i = 0; i < 20_000 && race.phase !== 'results'; i++) {
      tickRace(race);
      if (firstFinish < 0 && standings(race)[0]!.finishTime !== undefined) firstFinish = race.frame;
    }
    expect(race.phase).toBe('results');
    expect(race.frame - firstFinish).toBe(5 * TICK_HZ);
    const finished = race.results.filter((s) => s.finishTime !== undefined), dnf = race.results.filter((s) => s.finishTime === undefined);
    expect(finished.length).toBeGreaterThan(0);
    expect(dnf.length).toBeGreaterThan(0);
    expect(race.results.slice(0, finished.length)).toEqual(finished); // finishers first
    const progress = dnf.map((s) => s.progress);
    expect(progress).toEqual([...progress].sort((a, b) => b - a));
    expect(progress.every((p) => p > 0.5 && p < 1)).toBe(true);
  });
});

describe('course progress', () => {
  it("doesn't jump between passes on a self-crossing course", () => {
    const open = grid(Array.from({ length: 30 }, () => '.'.repeat(30)));
    // Corner to corner through the middle, up the side, back through the middle the other way, finish.
    const eight: CourseFile = { ...loopCourse(), startGrid: START, waypoints: [[25, 25], [25, 4], [4, 25], [4, 10]], laps: [], finish: [3, 7] };
    const race = createRace(loadCourse(eight, MAP, open), open, 3);
    openJoinWindow(race, { joinSeconds: 1 });
    say(race, 'a', '!rhino');
    const last = new Map<string, number>();
    let biggest = 0, ticksRun = 0;
    for (; ticksRun < 20_000 && race.phase !== 'results'; ticksRun++) {
      tickRace(race);
      for (const r of race.racers) {
        if (r.tank) biggest = Math.max(biggest, Math.abs(r.progress - (last.get(r.name) ?? r.progress)));
        if (r.tank) last.set(r.name, r.progress);
      }
    }
    expect(race.phase).toBe('results');
    // A Rhino covers ~0.1 cell a frame; cutting a corner inside the 2.25-cell reach gains up to ~6 at once.
    // Snapping to the other pass through the middle would jump ~40.
    expect(biggest).toBeLessThan(10);
    // ...and it keeps up: every tank was near the end of the line before it finished.
    expect(Math.min(...last.values())).toBeGreaterThan(race.course.length - 4);
  });

  it('replays the same race from the same seed', () => {
    const run = (seed: number) => {
      const { race, trace } = runRace(loopCourse(2), seed, ['p0mz0r', 'Kane', 'Yuri']);
      return JSON.stringify([race.results, [...trace]]);
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });
});

describeInstall('bundled courses', () => {
  it.each(Object.keys(COURSES))('%s loads over its battlefield from the install', async (path) => {
    const file = COURSES[path]!;
    const course = loadCourse(file, await readFromDir(file.map), (await importBattlefield(readFromDir, file.map)).grid);
    expect(course.startGrid).toHaveLength(10);
    expect(course.finishArea.size).toBeGreaterThan(0);
  }, 30_000);
});
