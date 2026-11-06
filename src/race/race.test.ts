import { describe, expect, it } from 'vitest';
import type { CellGrid } from '../movement/index.js';
import { courseProgress, loadCourse, mapHash, type CourseFile } from './course.js';
import { chat, commandList, createRace, endRace, hypeLive, openJoinWindow, paid, simulateRace, standings, tickRace, type Race, type Racer } from './race.js';
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
  it('drives a chosen fork through its via cell and rejoins at the next waypoint', () => {
    const open = grid(Array.from({ length: 20 }, () => '.'.repeat(30)));
    const file: CourseFile = { ...loopCourse(1), waypoints: [[14, 3], [19, 3], [24, 3]], laps: [], finish: [27, 3], forks: [{ from: 0, to: 2, via: [[14, 15], [24, 15]], weight: 100 }] };
    const race = createRace(loadCourse(file, MAP, open), open, 5);
    simulateRace(race, race.course, 1);
    ticks(race, 3 * TICK_HZ);
    const runner = race.racers[0]!;
    let sawFork = false, sawVia = false;
    for (let i = 0; i < 8000 && runner.finishedAt === undefined; i++) {
      tickRace(race);
      if (runner.fork) { sawFork = true; expect(runner.next).toBe(2); }
      if (runner.fork?.nextVia === 1) sawVia = true;
    }
    expect(sawFork).toBe(true);
    expect(sawVia).toBe(true);
    expect(runner.fork).toBeUndefined();
    expect(runner.finishedAt).toBeDefined();

    file.forks![0]!.weight = 0;
    const straight = createRace(loadCourse(file, MAP, open), open, 5);
    simulateRace(straight, straight.course, 1);
    ticks(straight, 3 * TICK_HZ);
    let sawMainWaypoint = false;
    for (let i = 0; i < 8000 && straight.racers[0]!.finishedAt === undefined; i++) {
      tickRace(straight);
      expect(straight.racers[0]!.fork).toBeUndefined();
      if (straight.racers[0]!.next === 1) sawMainWaypoint = true;
    }
    expect(sawMainWaypoint).toBe(true);
    expect(straight.racers[0]!.finishedAt).toBeDefined();
  });
});

const course = (file = loopCourse()) => loadCourse(file, MAP, ARENA);
const say = (race: Race, viewerId: string, text: string, name = viewerId) => chat(race, { viewerId, name, text });
const ticks = (race: Race, n: number) => { for (let i = 0; i < n; i++) tickRace(race); };
const racing = (seed = 1) => {
  const race = createRace(course(), ARENA, seed);
  openJoinWindow(race, { joinSeconds: 1 });
  say(race, 'a', '!rhino', 'Kane');
  say(race, 'b', '!rhino', 'Kara');
  ticks(race, 4 * TICK_HZ);
  return race;
};

describe('audience interactions', () => {
  it('emits sounds for a join and accepted effects', () => {
    const race = createRace(course(), ARENA, 1);
    openJoinWindow(race, { joinSeconds: 1 });
    say(race, 'a', '!rhino', 'Kane');
    expect(race.sounds).toEqual(['ready']);
    ticks(race, 4 * TICK_HZ);
    race.sounds.length = 0;
    expect(say(race, 'viewer', '!boost Kane').ok).toBe(true);
    expect(say(race, 'a', '!v3').ok).toBe(true);
    expect(race.sounds).toEqual(['boost', 'cannon', 'v3Launch']);
  });
  it('fires V3 past the firer into the first tank, and misses one that dodges', () => {
    const race = racing();
    const firer = race.racers[0]!, near = race.racers[1]!, far = race.racers[2]!;
    for (const r of race.racers) if (r.bot) r.botNext = Infinity;
    for (const r of race.racers) r.tank!.stunnedUntil = 1000;
    for (const [r, x, y] of [[firer, 10, 10], [near, 10, 7], [far, 10, 4]] as const) {
      r.tank!.x = (x + 0.5) * 256; r.tank!.y = (y + 0.5) * 256;
      r.tank!.cell = { x, y, deck: false };
    }
    firer.tank!.facing = 0;
    expect(say(race, 'a', '!v3 fwd').ok).toBe(true); // works while stunned
    ticks(race, 2 * TICK_HZ);
    expect(near.stunUntil).toBeGreaterThan(race.frame);
    expect(firer.stunUntil).toBe(0);
    expect(far.stunUntil).toBe(0);

    race.cooldowns.delete('a');
    near.tank!.x = 13.5 * 256; near.tank!.cell.x = 13;
    expect(say(race, 'a', '!v3 fwd').ok).toBe(true);
    ticks(race, 2 * TICK_HZ);
    expect(far.stunUntil).toBeGreaterThan(race.frame);
    expect(near.stunUntil).toBeLessThanOrEqual(race.frame);
  });

  it('defaults the leading racer to a backward V3, and detonates Tesla after two seconds in a three-cell radius', () => {
    const race = racing();
    const leader = race.racers[0]!, behind = race.racers[1]!, other = race.racers[2]!;
    for (const r of race.racers) if (r.bot) r.botNext = Infinity;
    for (const r of race.racers) r.tank!.stunnedUntil = 1000;
    for (const [r, x, y] of [[leader, 10, 10], [behind, 10, 13], [other, 15, 13]] as const) {
      r.tank!.x = (x + 0.5) * 256; r.tank!.y = (y + 0.5) * 256;
      r.tank!.cell = { x, y, deck: false };
    }
    leader.progress = race.course.length;
    leader.tank!.facing = 0;
    expect(say(race, 'a', '!v3').ok).toBe(true);
    console.log(JSON.stringify(race.v3s), standings(race).map(s=>s.name+':'+s.finishTime+':'+s.progress));
    ticks(race, 2 * TICK_HZ);
    console.log(race.racers.map(r=>r.name+':'+r.stunUntil+':'+r.tank!.x/256+','+r.tank!.y/256));
    expect(behind.stunUntil).toBeGreaterThan(race.frame);

    ticks(race, 3 * TICK_HZ);
    behind.tank!.x = 10.5 * 256; behind.tank!.y = 13.5 * 256;
    behind.tank!.cell = { x: 10, y: 13, deck: false };
    behind.tank!.stunnedUntil = 1000;
    behind.shieldUntil = race.frame + 6 * TICK_HZ;
    other.tank!.x = 12.5 * 256; other.tank!.y = 13.5 * 256; other.tank!.cell = { x: 12, y: 13, deck: false };
    const out = race.racers[3]!;
    out.tank!.x = 17.5 * 256; out.tank!.y = 13.5 * 256; out.tank!.cell = { x: 17, y: 13, deck: false };
    expect(say(race, 'viewer', '!tesla Kara').ok).toBe(true);
    ticks(race, 2 * TICK_HZ - 1);
    expect(other.stunUntil).toBeLessThanOrEqual(race.frame);
    tickRace(race);
    expect(behind.stunUntil).toBeLessThanOrEqual(race.frame); // shield
    expect(other.stunUntil).toBeGreaterThan(race.frame);
    expect(out.stunUntil).toBeLessThanOrEqual(race.frame);
  });

  it('keeps the Tesla tank beside its target through the charge, so a target driving on is still stunned', () => {
    const race = racing();
    for (const r of race.racers) r.botNext = Infinity;
    const kara = race.racers[1]!, from = { x: kara.tank!.x / 256, y: kara.tank!.y / 256 };
    expect(say(race, 'viewer', '!tesla Kara').ok).toBe(true);
    ticks(race, 2 * TICK_HZ);
    expect(Math.hypot(kara.tank!.x / 256 - from.x, kara.tank!.y / 256 - from.y)).toBeGreaterThan(3);
    expect(kara.stunUntil).toBeGreaterThan(race.frame);
  });

  it('counts the leading tank among unfinished tanks only for the V3 default', () => {
    const race = racing();
    const firer = race.racers[0]!, ahead = race.racers[1]!, behind = race.racers[2]!, done = race.racers[3]!;
    for (const r of race.racers) { r.botNext = Infinity; r.tank!.stunnedUntil = 1000; }
    for (const [r, x, y] of [[firer, 10, 10], [ahead, 10, 7], [behind, 10, 13]] as const) {
      r.tank!.x = (x + 0.5) * 256; r.tank!.y = (y + 0.5) * 256;
      r.tank!.cell = { x, y, deck: false };
    }
    firer.tank!.facing = 0;
    for (const r of race.racers) r.progress = 0;
    firer.progress = 50;
    done.progress = 99; done.finishedAt = race.frame; race.timer = race.finishFrames;
    expect(say(race, 'a', '!v3').ok).toBe(true);
    ticks(race, 2 * TICK_HZ);
    expect(behind.stunUntil).toBeGreaterThan(race.frame);
    expect(ahead.stunUntil).toBe(0);
  });

  it('runs bot shields and V3s on a repeatable seeded schedule', () => {
    const trace = (seed: number) => {
      const race = createRace(course(), ARENA, seed);
      openJoinWindow(race, { joinSeconds: 1 }); say(race, 'a', '!rhino');
      ticks(race, 4 * TICK_HZ);
      const events: string[] = [];
      for (let i = 0; i < 30 * TICK_HZ; i++) {
        const shields = race.racers.filter((r) => r.bot && r.shieldUntil > race.frame).length;
        const rockets = race.v3s.length;
        tickRace(race);
        if (race.racers.filter((r) => r.bot && r.shieldUntil > race.frame).length > shields) events.push(`shield:${race.frame}`);
        if (race.v3s.length > rockets) events.push(`v3:${race.frame}`);
      }
      return events;
    };
    expect(trace(7)).toEqual(trace(7));
    expect(trace(7)).not.toEqual(trace(8));
    expect(trace(7).some((event) => event.startsWith('shield'))).toBe(true);
    expect(trace(7).some((event) => event.startsWith('v3'))).toBe(true);
  });

  const kaneOf = (race: Race) => race.racers.find((r) => r.name === 'Kane')!;
  const cellIndex = (race: Race, r: Racer) => r.tank!.cell.y * race.field.grid.width + r.tank!.cell.x;
  /** Every other tank's spots, to check a move never lands on one. */
  const othersHeld = (race: Race, r: Racer) => new Set(race.field.tanks.filter((t) => t !== r.tank).flatMap((t) => [t.cell, ...t.ahead]).map((s) => `${s.x},${s.y},${s.deck}`));

  it('sends a named tank back 15–30% of the course as drawn, or on a misfire forward 5–10%, and it drives on', () => {
    const shares: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const race = racing(seed);
      ticks(race, 500);
      const kane = kaneOf(race), before = kane.progress, held = othersHeld(race, kane), left = { x: kane.tank!.cell.x, y: kane.tank!.cell.y };
      kane.tank!.stunnedUntil = race.field.frame + 20;
      expect(say(race, 'viewer', '!chrono Kane')).toEqual({ ok: true, reason: 'chrono Kane' });
      expect(kane.warp).toEqual({ from: left, to: { x: kane.tank!.cell.x, y: kane.tank!.cell.y }, at: race.frame }); // drawn as a warp at both cells
      shares.push((kane.progress - before) / race.course.drawnLength);
      expect(held.has(`${kane.tank!.cell.x},${kane.tank!.cell.y},false`)).toBe(false);
      expect(kane.tank!.cell.deck).toBe(false);
      expect(kane.tank!.stunnedUntil).toBe(race.field.frame + 20);
      const landed = kane.progress;
      ticks(race, 150);
      expect(kane.progress).toBeGreaterThan(landed + 2);
    }
    // ±1 cell: the landing is the cell nearest the spot on the ideal line.
    const slack = 1 / course().drawnLength;
    for (const share of shares) expect((share >= -0.30 - slack && share <= -0.15 + slack) || (share >= 0.05 - slack && share <= 0.10 + slack), `share ${share}`).toBe(true);
    const misfires = shares.filter((share) => share > 0).length;
    expect(misfires).toBeGreaterThan(2);
    expect(misfires).toBeLessThan(16);
  });

  it('never lets a misfire reach the finish area', () => {
    let misfires = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const race = racing(seed);
      const kane = kaneOf(race);
      // Close enough to the finish that any misfire would overshoot it.
      while (!(kane.next === race.course.waypoints.length && race.course.length - kane.progress < race.course.drawnLength * 0.05)) tickRace(race);
      const before = kane.progress;
      say(race, 'viewer', '!chrono Kane');
      if (kane.progress <= before) continue;
      misfires++;
      expect(race.course.finishArea.has(cellIndex(race, kane))).toBe(false);
      expect(kane.finishedAt).toBeUndefined();
    }
    expect(misfires).toBeGreaterThan(0);
  });

  it('drops a lap when a tank is sent back across a lap section', () => {
    const lapEnd = 3; // unrolled index of the last waypoint of lap 1
    let sentBack = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const race = racing(seed);
      const kane = kaneOf(race);
      // Lap 2 just begun: any send-back crosses the end of lap 1.
      while (!(kane.next === lapEnd + 1 && kane.progress - race.course.waypointAlong[lapEnd]! > 1)) tickRace(race);
      expect(kane.progress - race.course.waypointAlong[lapEnd]!).toBeLessThan(race.course.drawnLength * 0.15);
      const before = kane.progress;
      say(race, 'viewer', '!chrono Kane');
      if (kane.progress > before) continue;
      sentBack++;
      expect(kane.next).toBeLessThanOrEqual(lapEnd);
      expect(kane.progress).toBeLessThan(race.course.waypointAlong[lapEnd]!);
      ticks(race, 4000);
      expect(kane.finishedAt).toBeDefined(); // drove lap 1's end and all of lap 2 again
    }
    expect(sentBack).toBeGreaterThan(0);
  });

  it('rejects a named chronosphere on a shielded or protected tank without spending cooldown', () => {
    const race = racing();
    ticks(race, 100);
    expect(commandList(race)).toContain('!chrono [name]');
    say(race, 'a', '!shield');
    expect(say(race, 'viewer', '!chrono Kane')).toEqual({ ok: false, reason: 'target unable' });
    expect(say(race, 'viewer', '!chrono Kara').ok).toBe(true);
    expect(say(race, 'other', '!chrono Kara')).toEqual({ ok: false, reason: 'target protected' });
    // Random targets reroll past the shield; protection doesn't stop a random hit.
    const hit = Array.from({ length: 20 }, (_, i) => say(race, `random${i}`, '!chrono').reason);
    expect(hit).not.toContain('chrono Kane');
    expect(hit).toContain('chrono Kara');
  });

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

  it('names the viewer, the interaction and the tank in the feed when an interaction lands', () => {
    const race = racing();
    for (const r of race.racers) if (r.bot) r.botNext = Infinity;
    expect(say(race, 'v', '!boost Kane', 'Vera').ok).toBe(true);
    expect(say(race, 'b', '!shield', 'Kara').ok).toBe(true);
    expect(say(race, 'w', '!chrono Bot1', 'Wes').ok).toBe(true);
    expect(race.feed).toEqual(['Vera ▸ boost ▸ Kane', 'Kara ▸ shield ▸ Kara', 'Wes ▸ chrono ▸ Bot1']);
    expect(say(race, 'x', '!missile Bot2', 'Xan').ok).toBe(true);
    expect(race.feed).toHaveLength(3); // a missile lands on impact
    ticks(race, Math.round(1.5 * TICK_HZ));
    expect(race.feed.at(-1)).toBe('Xan ▸ missile ▸ Bot2');
    expect(say(race, 'z', '!boost missing', 'Zed').ok).toBe(false);
    expect(race.feed).toEqual(['Vera ▸ boost ▸ Kane', 'Kara ▸ shield ▸ Kara', 'Wes ▸ chrono ▸ Bot1', 'Xan ▸ missile ▸ Bot2', 'Zed: unknown name']);
    expect(say(race, 'y', '!missile Kara', 'Yan').ok).toBe(true);
    ticks(race, Math.round(1.5 * TICK_HZ));
    expect(race.feed.at(-1)).toBe('Zed: unknown name'); // Kara's shield stopped it: nothing landed
  });

  it('names every tank a Tesla strike stuns', () => {
    const race = racing();
    for (const r of race.racers) { r.botNext = Infinity; r.tank!.stunnedUntil = 1000; }
    const [kane, kara, near, far] = race.racers as [Racer, Racer, Racer, Racer];
    for (const [r, x, y] of [[kane, 10, 14], [kara, 12, 14], [near, 10, 16], [far, 20, 16]] as const) {
      r.tank!.x = (x + 0.5) * 256; r.tank!.y = (y + 0.5) * 256;
      r.tank!.cell = { x, y, deck: false };
    }
    expect(say(race, 'y', '!tesla Kane', 'Yan').ok).toBe(true);
    ticks(race, 2 * TICK_HZ);
    expect(race.feed).toEqual(expect.arrayContaining(['Yan ▸ tesla ▸ Kane', 'Yan ▸ tesla ▸ Kara', `Yan ▸ tesla ▸ ${near.name}`]));
    expect(race.feed.join()).not.toContain(far.name);
  });

  it('names the tank a V3 strikes, and a bot shielding itself', () => {
    const race = racing();
    const firer = race.racers[0]!, near = race.racers[1]!, bot = race.racers[2]!;
    for (const r of race.racers) { r.botNext = Infinity; r.tank!.stunnedUntil = 1000; }
    for (const [r, x, y] of [[firer, 10, 14], [near, 10, 16]] as const) {
      r.tank!.x = (x + 0.5) * 256; r.tank!.y = (y + 0.5) * 256;
      r.tank!.cell = { x, y, deck: false };
    }
    firer.tank!.facing = 0;
    expect(say(race, 'a', '!v3 back', 'Kane').ok).toBe(true);
    expect(race.feed).toEqual([]);
    ticks(race, TICK_HZ);
    expect(race.feed).toEqual(['Kane ▸ v3 ▸ Kara']);
    bot.botV3Next = false; bot.botNext = race.frame + 1;
    tickRace(race);
    expect(race.feed.at(-1)).toBe(`${bot.name} ▸ shield ▸ ${bot.name}`);
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
  race.enabled.delete('v3'); race.enabled.delete('shield'); // isolate course traversal from audience effects
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
  it('cancels before halfway, but ends with results at halfway', () => {
    const race = racing();
    endRace(race);
    expect(race.phase).toBe('cancelled');
    expect(race.results).toEqual([]);

    const next = racing();
    next.racers[0]!.finishedAt = next.frame;
    for (const r of next.racers.slice(1)) r.progress = next.course.length * 3 / 7;
    endRace(next);
    expect(next.phase).toBe('results');
    expect(next.results).toHaveLength(8);

    const joining = createRace(course(), ARENA, 1);
    openJoinWindow(joining);
    endRace(joining);
    expect(joining.phase).toBe('cancelled');

    const countdown = createRace(course(), ARENA, 1);
    openJoinWindow(countdown, { joinSeconds: 1 });
    say(countdown, 'a', '!rhino');
    ticks(countdown, TICK_HZ);
    endRace(countdown);
    expect(countdown.phase).toBe('cancelled');
  });

  it('pause freezes chat, cooldowns, protections and the finish timer', () => {
    const race = racing();
    expect(say(race, 'a', '!shield').ok).toBe(true);
    race.racers[0]!.finishedAt = race.frame;
    race.timer = 2 * TICK_HZ;
    race.paused = true;
    const before = [race.frame, race.timer, race.field.frame, race.racers[0]!.shieldUntil];
    ticks(race, 3 * TICK_HZ);
    expect([race.frame, race.timer, race.field.frame, race.racers[0]!.shieldUntil]).toEqual(before);
    expect(say(race, 'b', '!boost').reason).toBe('ignored');
    expect(commandList(race)).toEqual([]);
    race.paused = false;
    tickRace(race);
    expect(race.timer).toBe(2 * TICK_HZ - 1);
  });

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

  it('gives each race its own seed, and replays the second race of a session from that seed', () => {
    const run = (race: Race) => {
      openJoinWindow(race, { joinSeconds: 1, finishSeconds: 5 });
      say(race, 'a', '!rhino'); say(race, 'b', '!rhino');
      for (let i = 0; i < 20_000 && race.phase !== 'results'; i++) {
        tickRace(race);
        if (race.frame === 10 * TICK_HZ) say(race, 'a', '!chrono b');
      }
      return race.results;
    };
    const session = createRace(course(loopCourse(1)), ARENA, 1);
    run(session);
    const second = run(session);
    expect(session.seed).not.toBe(1);
    expect(run(createRace(course(loopCourse(1)), ARENA, session.seed))).toEqual(second);
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

describe('paid events', () => {
  const redeem = (race: Race, viewerId: string, name: string, reference: string) =>
    paid(race, { viewerId, name, event: 'chronoSwap', via: 'redemption', reference });
  const calm = (seed = 1) => {
    const race = racing(seed);
    for (const r of race.racers) if (r.bot) r.botNext = Infinity;
    ticks(race, 5 * TICK_HZ); // the field spreads out
    race.sounds.length = 0;
    return race;
  };

  it('plays a Chrono swap redemption in its turn and settles it fulfilled when it lands', () => {
    const race = calm();
    const before = standings(race).map((s) => s.name);
    expect(redeem(race, 'v', 'Vera', 'r1')).toEqual({ ok: true, reason: 'queued' });
    tickRace(race);
    expect(race.sounds).toContain('chronoSelect');
    ticks(race, 3 * TICK_HZ - 1);
    expect(race.settlements).toEqual([]);
    const at = new Map(race.racers.map((r) => [r.name, { x: r.tank!.x, y: r.tank!.y }]));
    tickRace(race);
    expect(race.sounds).toContain('chrono');
    expect(race.settlements).toEqual([{ reference: 'r1', outcome: 'fulfilled' }]);
    const line = race.feed.at(-1)!;
    const [, a, b] = line.match(/^Vera ▸ CHRONO SWAP ▸ (\S+) ⇄ (\S+)$/)!;
    const half = before.length / 2;
    expect([before.indexOf(a!) < half, before.indexOf(b!) < half].sort()).toEqual([false, true]);
    const ra = race.racers.find((r) => r.name === a)!;
    expect(Math.hypot(ra.tank!.x - at.get(b!)!.x, ra.tank!.y - at.get(b!)!.y) / 256).toBeLessThan(3);
  });

  it('plays one big event at a time in arrival order, 10 s apart', () => {
    const race = calm();
    redeem(race, 'v', 'Vera', 'r1');
    redeem(race, 'w', 'Wes', 'r2');
    const turns: number[] = [];
    for (let i = 0; i < 20 * TICK_HZ; i++) {
      tickRace(race);
      if (race.sounds.splice(0).includes('chronoSelect')) turns.push(race.frame);
    }
    expect(turns).toHaveLength(2);
    expect(turns[1]! - turns[0]!).toBe(13 * TICK_HZ); // 3 s build-up, then the 10 s gap
    expect(race.feed.filter((l) => l.includes('CHRONO SWAP')).map((l) => l.split(' ')[0])).toEqual(['Vera', 'Wes']);
    expect(race.settlements).toEqual([{ reference: 'r1', outcome: 'fulfilled' }, { reference: 'r2', outcome: 'fulfilled' }]);
  });

  it('keeps the 10 s gap after a swap that fizzles on landing', () => {
    const race = calm();
    redeem(race, 'v', 'Vera', 'r1');
    redeem(race, 'w', 'Wes', 'r2');
    tickRace(race); // r1's turn comes
    const turn = race.frame;
    for (const r of race.racers) r.shieldUntil = race.frame + 4 * TICK_HZ; // up at landing, gone soon after
    let next: number | undefined;
    for (let i = 0; i < 20 * TICK_HZ && next === undefined; i++) {
      race.sounds.length = 0;
      tickRace(race);
      if (race.sounds.includes('chronoSelect')) next = race.frame;
    }
    expect(race.settlements[0]).toEqual({ reference: 'r1', outcome: 'refunded' });
    expect(next! - turn).toBe(13 * TICK_HZ);
  });

  it('splits only the tanks still racing into front and back half', () => {
    const race = calm();
    const order = standings(race).map((s) => s.name);
    for (const r of race.racers) if (order.indexOf(r.name) < 4) r.finishedAt = race.frame;
    race.timer = race.finishFrames; // as a real first finish starts the finish timer
    redeem(race, 'v', 'Vera', 'r1');
    ticks(race, 3 * TICK_HZ + 1);
    expect(race.settlements).toEqual([{ reference: 'r1', outcome: 'fulfilled' }]);
    const [, a, b] = race.feed.at(-1)!.match(/^Vera ▸ CHRONO SWAP ▸ (\S+) ⇄ (\S+)$/)!;
    expect([4, 5]).toContain(order.indexOf(a!));
    expect([6, 7]).toContain(order.indexOf(b!));
  });

  it('replaces a pick that finishes before landing with another from its half', () => {
    const race = calm();
    redeem(race, 'v', 'Vera', 'r1');
    tickRace(race);
    const order = standings(race).map((s) => s.name);
    const [front, back] = race.queue[0]!.picks;
    front!.finishedAt = race.frame;
    race.timer = race.finishFrames; // as a real first finish starts the finish timer
    tickRace(race);
    expect(race.queue[0]!.picks[0]).not.toBe(front); // at once, so the target ring follows
    ticks(race, 3 * TICK_HZ - 1);
    const [, a, b] = race.feed.at(-1)!.match(/^Vera ▸ CHRONO SWAP ▸ (\S+) ⇄ (\S+)$/)!;
    expect(b).toBe(back!.name);
    expect(a).not.toBe(front!.name);
    expect(order.indexOf(a!)).toBeLessThan(order.length / 2);
  });

  it('refunds a redemption that fizzles, is still queued at race end, or comes outside a race', () => {
    const race = calm();
    for (const r of race.racers) r.shieldUntil = Infinity;
    redeem(race, 'v', 'Vera', 'r1');
    tickRace(race);
    expect(race.settlements).toEqual([{ reference: 'r1', outcome: 'refunded' }]);
    expect(race.feed.at(-1)).toBe('Vera ▸ CHRONO SWAP · refunded');
    expect(say(race, 'w', '!boost nobody', 'Wes').ok).toBe(false);
    redeem(race, 'w', 'Wes', 'r2');
    tickRace(race);
    expect(race.settlements.at(-1)).toEqual({ reference: 'r2', outcome: 'refunded' });
    expect(race.feed.at(-1)).toBe('Wes: unknown name'); // the refund tag waits out the viewer's throttle

    for (const r of race.racers) r.shieldUntil = 0;
    race.settlements.length = 0;
    redeem(race, 'v', 'Vera', 'r3');
    redeem(race, 'w', 'Wes', 'r4');
    tickRace(race); // r3's turn comes
    endRace(race);
    expect(race.settlements).toEqual([{ reference: 'r3', outcome: 'refunded' }, { reference: 'r4', outcome: 'refunded' }]);
    expect(redeem(race, 'v', 'Vera', 'r5')).toEqual({ ok: false, reason: 'not racing' });
    openJoinWindow(race);
    expect(redeem(race, 'v', 'Vera', 'r6').ok).toBe(false);
    expect(race.settlements.slice(2)).toEqual([{ reference: 'r5', outcome: 'refunded' }, { reference: 'r6', outcome: 'refunded' }]);
  });

  it.each([1, 2, 3])('lets every tank still finish after Chrono swaps (seed %i)', (seed) => {
    const race = calm(seed);
    race.finishFrames = Infinity;
    for (let n = 0; n < 3; n++) redeem(race, `v${n}`, `V${n}`, `r${n}`);
    for (let i = 0; i < 400 * TICK_HZ && race.phase === 'racing'; i++) tickRace(race);
    expect(race.settlements.map((s) => s.outcome)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(race.racers.every((r) => r.finishedAt !== undefined)).toBe(true);
  });
});

describe('Kirov airship', () => {
  const redeem = (race: Race, viewerId = 'v', name = 'Vera') => paid(race, { viewerId, name, event: 'kirov', via: 'redemption', reference: viewerId });
  const calm = (seed = 1) => {
    const race = racing(seed);
    for (const r of race.racers) if (r.bot) r.botNext = Infinity;
    ticks(race, 5 * TICK_HZ); // the field spreads out
    race.sounds.length = 0;
    return race;
  };
  const leader = (race: Race) => race.racers.find((r) => r.name === standings(race)[0]!.name)!;

  const at = (r: Racer) => ({ x: r.tank!.x / 256, y: r.tank!.y / 256 });
  const off = (r: Racer, p: { x: number; y: number }) => Math.hypot(at(r).x - p.x, at(r).y - p.y);
  /** Ticks until the Kirov's first bomb drops; that frame. */
  const untilBombing = (race: Race) => {
    for (let i = 0; i < 60 * TICK_HZ && !race.sounds.includes('kirovAttack'); i++) { race.sounds.length = 0; tickRace(race); }
    return race.frame;
  };

  it('hovers 5–10 cells ahead of the leading tank, and drops its first bomb, fulfilled, once a tank is within 2.5 cells', () => {
    const race = calm();
    redeem(race);
    const lead = leader(race), from = lead.progress;
    tickRace(race);
    expect(race.sounds).toContain('kirovCreated');
    const turn = race.queue[0]!, spot = { ...turn.ship! };
    const ahead = courseProgress(race.course, spot.x, spot.y, lead.next) - from;
    expect(ahead).toBeGreaterThanOrEqual(5 - 0.01);
    expect(ahead).toBeLessThanOrEqual(10 + 0.01);
    let first: number | undefined;
    for (let i = 0; i < 30 * TICK_HZ && first === undefined; i++) {
      const inRange = race.racers.some((r) => off(r, spot) <= 2.5), leading = leader(race);
      race.sounds.length = 0;
      tickRace(race);
      if (!inRange) expect(turn.picks, 'the target is the leading tank while it waits').toEqual([leading]);
      if (race.sounds.includes('kirovAttack')) first = race.frame;
      expect(race.sounds.includes('kirovAttack')).toBe(inRange);
      expect(race.settlements).toEqual(inRange ? [{ reference: 'v', outcome: 'fulfilled' }] : []);
    }
    expect(first).toBeDefined();
    expect(off(turn.picks[0]!, spot)).toBeLessThan(4); // the tank that came in range is the one the camera holds on
  });

  /** Plays a Kirov from its turn to its landing, checking every bomb: each tank within 1.5 cells is knocked back and stunned, no other. */
  const bombingRun = (race: Race) => {
    tickRace(race);
    const spot = { ...race.queue[0]!.ship! }, from = untilBombing(race), drops = [from];
    const caught: Racer[] = [], knocks: number[] = [];
    while (race.queue.length) {
      const inBlast = race.racers.filter((r) => r.finishedAt === undefined && off(r, spot) <= 1.5);
      const before = new Map(race.racers.map((r) => [r, { progress: r.progress, stunUntil: r.stunUntil, immune: r.immunityUntil > race.frame + 1 }]));
      race.sounds.length = 0;
      tickRace(race);
      if (race.sounds.includes('kirovAttack')) drops.push(race.frame);
      const impact = (race.frame - from - TICK_HZ / 2) % TICK_HZ === 0 && race.frame >= from + TICK_HZ / 2;
      for (const r of race.racers) {
        const was = before.get(r)!;
        if (!impact || !inBlast.includes(r)) {
          if (was.stunUntil <= race.frame) expect(r.stunUntil, `${r.name} untouched`).toBe(was.stunUntil);
          continue;
        }
        if (!caught.includes(r)) caught.push(r);
        // Always knocked back, never left in place or sent forward.
        expect(was.progress - r.progress, `${r.name} knocked back`).toBeGreaterThan(0.5);
        knocks.push(was.progress - r.progress);
        if (!was.immune) expect(r.stunUntil, `${r.name} stunned`).toBe(race.frame + 3 * TICK_HZ);
      }
    }
    return { spot, from, drops, caught, knocks };
  };

  it.each([1, 2, 3])('drops 7 bombs 1 s apart on its spot, each stunning and knocking back every tank within 1.5 cells, with one feed line at the end (seed %i)', (seed) => {
    const race = calm(seed);
    redeem(race);
    const { spot, from, drops, caught, knocks } = bombingRun(race);
    expect(Math.max(...knocks)).toBeLessThan(4 + 2); // on open ground, about 4 cells
    expect(drops.slice(1)).toEqual([1, 2, 3, 4, 5, 6].map((s) => from + s * TICK_HZ));
    expect(race.landed?.ship?.x).toBe(spot.x);
    expect(race.frame).toBe(from + 6.5 * TICK_HZ); // lands with its last bomb, 0.5 s after it drops
    expect(caught.length).toBeGreaterThan(0);
    expect(race.feed.filter((l) => l.includes('KIROV'))).toEqual([`Vera ▸ KIROV ▸ ${caught[0]!.name}${caught.length > 1 ? ` +${caught.length - 1}` : ''}`]);
    expect(new Set(race.racers.map((r) => `${r.tank!.cell.x},${r.tank!.cell.y}`)).size).toBe(race.racers.length); // each on its own cell
  });

  it.each([1, 2, 3])('always knocks a tank back, even in a one-cell corridor packed with tanks (seed %i)', (seed) => {
    // 40×9: an open start area, then a corridor one cell wide to the finish.
    const corridor = grid(Array.from({ length: 9 }, (_, y) => Array.from({ length: 40 }, (_, x) => (x < 8 || y === 4 ? '.' : '#')).join('')));
    const file: CourseFile = { ...loopCourse(1), startGrid: [[1, 1], [3, 1], [5, 1], [1, 4], [3, 4], [5, 4], [1, 7], [3, 7], [5, 7], [6, 4]], waypoints: [[20, 4]], laps: [], finish: [37, 4] };
    const race = createRace(loadCourse(file, MAP, corridor), corridor, seed);
    openJoinWindow(race, { joinSeconds: 1 });
    say(race, 'a', '!rhino', 'Kane');
    ticks(race, 4 * TICK_HZ);
    for (const r of race.racers) if (r.bot) r.botNext = Infinity;
    ticks(race, 4 * TICK_HZ); // the leaders are in the corridor, the rest queue behind
    redeem(race);
    expect(bombingRun(race).caught.length).toBeGreaterThan(0);
  });

  it('a shield up when a bomb lands blocks it; stun immunity blocks only the stun', () => {
    const victim = (shielded: boolean) => {
      const race = calm();
      redeem(race);
      tickRace(race);
      const spot = race.queue[0]!.ship!;
      ticks(race, untilBombing(race) + TICK_HZ / 2 - 1 - race.frame); // the frame before the first bomb lands
      const r = race.racers.find((r) => off(r, spot) <= 1.5)!;
      if (shielded) r.shieldUntil = race.frame + 2; else r.immunityUntil = race.frame + 10 * TICK_HZ;
      const { progress, stunUntil } = r;
      tickRace(race);
      return { dropped: progress - r.progress, stunned: r.stunUntil !== stunUntil };
    };
    const shield = victim(true), immune = victim(false);
    expect(shield.stunned).toBe(false);
    expect(shield.dropped).toBeLessThan(0.5);
    expect(immune.stunned).toBe(false);
    expect(immune.dropped).toBeGreaterThan(0.5);
  });

  it('is refunded when the race ends before a tank comes in range, but not once it has started bombing', () => {
    const waiting = calm();
    redeem(waiting);
    tickRace(waiting);
    endRace(waiting);
    expect(waiting.settlements).toEqual([{ reference: 'v', outcome: 'refunded' }]);
    const bombing = calm();
    redeem(bombing);
    untilBombing(bombing);
    endRace(bombing);
    expect(bombing.settlements).toEqual([{ reference: 'v', outcome: 'fulfilled' }]);
  });

  it.each([1, 2, 3])('lets every tank still finish after Kirov knockbacks (seed %i)', (seed) => {
    const race = calm(seed);
    race.finishFrames = Infinity;
    for (let n = 0; n < 3; n++) redeem(race, `v${n}`, `V${n}`);
    for (let i = 0; i < 400 * TICK_HZ && race.phase === 'racing'; i++) tickRace(race);
    expect(race.settlements.map((s) => s.outcome)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(race.racers.every((r) => r.finishedAt !== undefined)).toBe(true);
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

describe('editor simulation', () => {
  it('races ten bots and no viewers, even over a running race', () => {
    const race = racing();
    simulateRace(race, course());
    expect(race.phase).toBe('countdown');
    expect(race.racers.map((r) => r.bot)).toEqual(new Array(10).fill(true));
    ticks(race, 3 * TICK_HZ + 1);
    expect(race.phase).toBe('racing');
  });
});

describe('hype meter', () => {
  const redeem = (race: Race, viewerId: string) => paid(race, { viewerId, name: viewerId, event: 'chronoSwap', via: 'redemption', reference: viewerId });
  const calm = () => {
    const race = racing();
    for (const r of race.racers) if (r.bot) r.botNext = Infinity;
    race.sounds.length = 0;
    return race;
  };

  it('adds 1 per accepted chat command and 2 per redemption; failed commands, plain chat and bots add nothing', () => {
    const bots = racing();
    ticks(bots, 15 * TICK_HZ);
    expect(bots.feed.some((line) => /shield/.test(line))).toBe(true);
    expect(bots.hype.points).toBe(0);
    const race = calm();
    say(race, 'v', '!boost');
    say(race, 'v', '!boost'); // cooldown
    say(race, 'w', 'gg !boost');
    say(race, 'w', '!missile Nobody');
    redeem(race, 'x');
    expect(race.hype.points).toBe(3);
  });

  it('drains 1 point per 2 s once nobody has added for 5 s', () => {
    const race = calm();
    for (const v of ['a', 'b', 'c']) say(race, v, '!boost');
    ticks(race, 7 * TICK_HZ - 1);
    expect(race.hype.points).toBe(3);
    tickRace(race);
    expect(race.hype.points).toBe(2);
    ticks(race, 4 * TICK_HZ);
    expect(race.hype.points).toBe(0);
    ticks(race, 4 * TICK_HZ);
    expect(race.hype.points).toBe(0);
  });

  let fans = 0;
  const fill = (race: Race, points: number) => { for (let i = 0; i < points; i++) say(race, `fan${fans++}`, '!boost'); };
  const count = (race: Race, cue: string) => race.sounds.filter((s) => s === cue).length;

  it('plays EVA "Nuclear silo detected" once per filling, the first time the meter reaches half', () => {
    const race = calm();
    fill(race, 14);
    expect(count(race, 'nukeDetected')).toBe(0);
    fill(race, 1);
    expect(count(race, 'nukeDetected')).toBe(1);
    ticks(race, 7 * TICK_HZ); // drains below half
    fill(race, 1);
    expect(race.hype.points).toBe(15);
    expect(count(race, 'nukeDetected')).toBe(1);
    ticks(race, 40 * TICK_HZ); // empty: the next filling warns again
    fill(race, 15);
    expect(count(race, 'nukeDetected')).toBe(2);
  });

  it('arms at full for 30 s with !nuke on the command list, then drains from full and can arm again', () => {
    const race = calm();
    fill(race, 30);
    expect(count(race, 'nukeReady')).toBe(1);
    expect(commandList(race)).toContain('!nuke');
    ticks(race, 30 * TICK_HZ - 1);
    fill(race, 3);
    expect(race.hype.points).toBe(30);
    expect(commandList(race)).toContain('!nuke');
    tickRace(race);
    expect(commandList(race)).not.toContain('!nuke');
    ticks(race, 2 * TICK_HZ);
    expect(race.hype.points).toBe(29);
    fill(race, 1);
    expect(count(race, 'nukeReady')).toBe(2);
  });

  it('ignores !nuke silently outside an armed meter', () => {
    const race = calm();
    expect(say(race, 'a', '!nuke')).toEqual({ ok: false, reason: 'ignored' });
    expect(race.feed).toEqual([]);
  });

  it('counts each viewer once per arming for free, posts each call, and empties the meter at 5 calls', () => {
    const race = calm();
    say(race, 'a', '!boost', 'Kane');
    fill(race, 29);
    expect(say(race, 'a', '!nuke', 'Kane').ok).toBe(true); // on cooldown from the boost
    expect(say(race, 'a', '!nuke', 'Kane').ok).toBe(false);
    expect(say(race, 'b', '!nuke', 'Kara').ok).toBe(true);
    expect(say(race, 'b', '!boost', 'Kara').ok).toBe(true); // no cooldown started
    expect(race.feed.slice(-3, -1)).toEqual(['Kane ▸ NUKE 1/5', 'Kara ▸ NUKE 2/5']);
    for (const v of ['c', 'd']) say(race, v, '!nuke');
    expect(race.hype.points).toBe(30);
    say(race, 'e', '!nuke');
    expect(race.feed.at(-1)).toBe('e ▸ NUKE 5/5');
    expect(race.hype.points).toBe(0);
    expect(commandList(race)).not.toContain('!nuke');
    fill(race, 15);
    expect(count(race, 'nukeDetected')).toBe(2);
  });

  it('starts empty each race, with nothing carried over', () => {
    const race = calm();
    fill(race, 30);
    say(race, 'a', '!nuke');
    endRace(race);
    expect(commandList(race)).not.toContain('!nuke');
    openJoinWindow(race, { joinSeconds: 1 });
    say(race, 'a', '!rhino');
    ticks(race, 4 * TICK_HZ);
    expect(race.hype.points).toBe(0);
    expect(say(race, 'a', '!nuke').ok).toBe(false);
    fill(race, 30);
    expect(say(race, 'a', '!nuke').ok).toBe(true);
    expect(race.feed.at(-1)).toBe('a ▸ NUKE 1/5');
  });
});

describe('nuke', () => {
  const redeem = (race: Race, viewerId: string) => paid(race, { viewerId, name: viewerId, event: 'chronoSwap', via: 'redemption', reference: viewerId });
  let fans = 0;
  /** Fills the meter and has 5 viewers call `!nuke`. */
  const setOff = (race: Race) => {
    for (let i = 0; i < 30; i++) say(race, `fan${fans++}`, '!boost');
    for (const v of ['n1', 'n2', 'n3', 'n4', 'n5']) say(race, v, '!nuke', v.toUpperCase());
  };
  const calm = (seed = 1) => {
    const race = racing(seed);
    for (const r of race.racers) if (r.bot) r.botNext = Infinity;
    ticks(race, 5 * TICK_HZ); // the field spreads out
    race.sounds.length = 0;
    return race;
  };

  it('takes the next turn on the 5th call, ahead of waiting paid events, behind the one playing', () => {
    const race = calm();
    redeem(race, 'v');
    tickRace(race); // v's Chrono swap plays
    redeem(race, 'w');
    setOff(race);
    expect(race.queue.map((t) => `${t.event} ${t.by}`)).toEqual(['chronoSwap v', 'nuke CHAT', 'chronoSwap w']);
    expect(race.queue[1]!.callers).toEqual(['N1', 'N2', 'N3', 'N4', 'N5']);
    const idle = calm();
    redeem(idle, 'w');
    setOff(idle);
    expect(idle.queue.map((t) => t.event)).toEqual(['nuke', 'chronoSwap']);
    const first = idle.queue[0];
    setOff(idle); // a second nuke waits behind the first
    expect(idle.queue.map((t) => t.event)).toEqual(['nuke', 'nuke', 'chronoSwap']);
    expect(idle.queue[0]).toBe(first);
  });

  it('never shortens a longer stun already running', () => {
    const race = calm();
    setOff(race);
    tickRace(race);
    const lands = race.queue[0]!.lands!, burning = race.racers[0]!;
    ticks(race, lands - race.frame - 1);
    burning.stunUntil = race.frame + 20 * TICK_HZ;
    tickRace(race);
    expect(burning.stunUntil).toBe(lands - 1 + 20 * TICK_HZ);
  });

  it('launches with EVA, sounds the siren as the missile falls, and lands on the leading tank 3 s after EVA', () => {
    const race = calm();
    setOff(race);
    race.sounds.length = 0; // the meter's own EVA lines
    const cues: [number, string][] = [];
    for (let i = 0; i < 4 * TICK_HZ; i++) {
      tickRace(race);
      for (const cue of race.sounds.splice(0)) if (cue.startsWith('nuke')) cues.push([race.frame, cue]);
    }
    const launch = cues[0]![0];
    expect(cues).toEqual([[launch, 'nukeLaunch'], [launch + 27, 'nukeSiren'], [launch + 3 * TICK_HZ, 'nukeExplosion']]);
    expect(race.landed?.event).toBe('nuke');
    expect(race.feed.at(-1)).toBe('CHAT ▸ NUKE ▸ all');
    expect(race.settlements).toEqual([]);
  });

  it('stuns every tank for 2 s + progress % × 60 ms + 0–2 s; only a shield up at impact saves it, stun immunity does not', () => {
    const race = calm(4);
    setOff(race);
    tickRace(race); // the turn comes
    const lands = race.queue[0]!.lands!;
    const [shielded, immune, early] = race.racers;
    ticks(race, lands - race.frame - 1);
    shielded!.shieldUntil = race.frame + 2; // up at impact
    immune!.immunityUntil = race.frame + 10 * TICK_HZ;
    early!.shieldUntil = race.frame; // gone by impact
    const pct = new Map(race.racers.map((r) => [r, r.progress / race.course.length * 100]));
    tickRace(race);
    expect(race.frame).toBe(lands);
    expect(shielded!.stunUntil).toBeLessThan(lands);
    const stuns = race.racers.filter((r) => r !== shielded).map((r) => {
      const s = (r.stunUntil - lands) / TICK_HZ, base = 2 + pct.get(r)! * 0.06;
      expect(s).toBeGreaterThanOrEqual(base - 1 / TICK_HZ);
      expect(s).toBeLessThanOrEqual(base + 2 + 1 / TICK_HZ);
      expect(r.tank!.stunnedUntil).toBe(race.field.frame - 1 + r.stunUntil - lands); // set before the field steps that frame
      return r.stunUntil;
    });
    expect(new Set(stuns).size).toBeGreaterThan(stuns.length / 2); // not all at once: frames can coincide
    const again = calm(4);
    setOff(again);
    ticks(again, lands - again.frame - 1);
    again.racers[0]!.shieldUntil = again.frame + 2;
    again.racers[1]!.immunityUntil = again.frame + 10 * TICK_HZ;
    tickRace(again);
    expect(again.racers.slice(1).map((r) => r.stunUntil)).toEqual(stuns); // seeded
  });

  it('sets off at most 2 a race, and the meter is gone after the 2nd', () => {
    const race = calm();
    setOff(race);
    expect(hypeLive(race)).toBe(true);
    setOff(race);
    expect(race.queue.filter((t) => t.event === 'nuke')).toHaveLength(2);
    expect(hypeLive(race)).toBe(false);
    say(race, 'late', '!boost');
    expect(race.hype.points).toBe(0);
    for (let i = 0; i < 30; i++) say(race, `more${i}`, '!boost');
    expect(commandList(race)).not.toContain('!nuke');
    endRace(race);
    openJoinWindow(race, { joinSeconds: 1 });
    expect(hypeLive(race)).toBe(true);
  });

  it('drops a nuke still waiting or in flight when the race ends', () => {
    const race = calm();
    setOff(race);
    tickRace(race); // in flight
    endRace(race);
    expect(race.queue).toEqual([]);
    expect(race.settlements).toEqual([]);
    expect(race.racers.every((r) => r.stunUntil <= race.frame)).toBe(true);
  });
});
