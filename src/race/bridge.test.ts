import { describe, expect, it } from 'vitest';
import { addTank, createField, findRoute, orderMove, type Tank } from '../movement/index.js';
import type { CellGrid } from '../battlefield/grid.js';
import { destroyBridge, repairBridge } from './bridge.js';
import { loadCourse, mapHash, type CourseFile } from './course.js';
import { chat, createRace, openJoinWindow, tickRace } from './race.js';
import { TICK_HZ } from '../movement/index.js';

function grid(rows: string[], kind: 'high' | 'low'): CellGrid {
  const width = rows[0]!.length, cells = rows.join(''), n = cells.length;
  const bridge = Array.from(cells, (c) => c === '=' || c === '+' ? 0 : -1);
  const span = bridge.flatMap((id, i) => id === 0 ? [i] : []);
  return {
    width, height: rows.length, land: new Array(n).fill('Clear'),
    speed: Array.from(cells, (c) => c === '~' || (kind === 'high' && c === '=') ? 0 : 1),
    level: Array.from(cells, (c) => c === '.' ? 4 : 0), ramp: new Array(n).fill(0),
    blocked: new Array(n).fill(false), deck: Array.from(cells, (c) => (c === '=' || c === '+') && kind === 'high' ? 4 : -1),
    bridge, bridges: [{ kind, cells: span }],
  };
}

const racer = (tank: Tank, goals: { x: number; y: number }[]) => ({ tank, goals });

describe('bridges in play', () => {
  it('refuses the only crossing without changing passability or moving a tank', () => {
    const g = grid(['~~~~~', '.===.', '~~~~~'], 'high'), field = createField(g, 1);
    const tank = addTank(field, { x: 0, y: 1 });
    expect(findRoute(g, tank.cell, { x: 4, y: 1 })).toBeDefined();
    expect(destroyBridge(g, field, 0, [racer(tank, [{ x: 4, y: 1 }])])).toBe(false);
    expect(g.deck[7]).toBe(4);
    expect(tank.cell).toEqual({ x: 0, y: 1, deck: false });
    expect(findRoute(g, tank.cell, { x: 4, y: 1 })).toBeDefined();
  });

  it.each(['high', 'low'] as const)('removes and restores a %s bridge, moving deck and ground tanks off it', (kind) => {
    const g = grid(['.......', kind === 'high' ? '.=+=...' : '.===...', '.......'], kind), field = createField(g, 1);
    const on = addTank(field, { x: 2, y: 1 });
    if (kind === 'high') on.cell.deck = true;
    const under = kind === 'high' ? addTank(field, { x: 2, y: 1 }) : undefined;
    const other = addTank(field, { x: 0, y: 1 });
    orderMove(field, other, { x: 6, y: 1 });
    const before = g.speed[8];
    expect(destroyBridge(g, field, 0, [racer(on, [{ x: 6, y: 1 }]), ...(under ? [racer(under, [{ x: 6, y: 1 }])] : []), racer(other, [{ x: 6, y: 1 }])])).toBe(true);
    expect(g.bridge[on.cell.y * g.width + on.cell.x]).toBe(-1);
    if (under) expect(g.bridge[under.cell.y * g.width + under.cell.x]).toBe(-1);
    expect(on.cell.deck).toBe(false);
    expect(other.path).toEqual([]);
    expect(g.deck[8]).toBe(-1);
    if (kind === 'low') expect(g.speed[8]).toBe(0);
    repairBridge(g, 0);
    expect(g.deck[8]).toBe(kind === 'high' ? 4 : -1);
    expect(g.speed[8]).toBe(before);
  });

  it('checks the remaining waypoint leg as well as the finish', () => {
    const g = grid(['~~~~~', '.===.', '.~~~.', '.~~~.'], 'high'), field = createField(g, 1);
    const tank = addTank(field, { x: 0, y: 3 });
    expect(destroyBridge(g, field, 0, [racer(tank, [{ x: 4, y: 1 }, { x: 0, y: 3 }])])).toBe(false);
  });

  it('accepts any reachable cell of the finish area', () => {
    const g = grid(['~~~~~', '.===.', '~~~~~'], 'high'), field = createField(g, 1);
    const tank = addTank(field, { x: 0, y: 1 });
    expect(destroyBridge(g, field, 0, [{ tank, goals: [], finishes: [{ x: 4, y: 1 }, { x: 0, y: 1 }] }])).toBe(true);
  });

  it('spends viewer cooldown only on a successful toggle and locks bridge changes for 10 s', () => {
    const g = grid(['............', '.....==.....', '............', '............'], 'low');
    const map = new TextEncoder().encode('bridge test');
    const file: CourseFile = {
      name: 'Bridge test', map: 'test.map', mapHash: mapHash(map), source: 'shipped', author: 'tests', link: '',
      startGrid: Array.from({ length: 10 }, (_, x): [number, number] => [x, 0]),
      waypoints: [[8, 1]], laps: [], finish: [11, 1], bridges: [[5, 1]],
    };
    const race = createRace(loadCourse(file, map, g), g, 1);
    openJoinWindow(race, { joinSeconds: 1 });
    chat(race, { viewerId: 'r', name: 'Racer', text: '!rhino' });
    for (let i = 0; i < 4 * TICK_HZ; i++) tickRace(race);
    expect(race.phase).toBe('racing');
    const say = (viewerId: string) => chat(race, { viewerId, name: viewerId, text: '!bridge B1' });
    expect(say('a')).toEqual({ ok: true, reason: 'bridge B1 destroyed' });
    expect(race.feed).toEqual(['a ▸ bridge ▸ B1']);
    expect(g.speed[17]).toBe(0);
    expect(say('b')).toEqual({ ok: false, reason: 'bridge cooldown 10 s' });
    expect(race.cooldowns.has('b')).toBe(false);
    expect(race.feed.at(-1)).toContain('bridge cooldown 10 s');
    race.frame += 10 * TICK_HZ;
    expect(say('b')).toEqual({ ok: true, reason: 'bridge B1 repaired' });
    expect(g.speed[17]).toBe(1);
    expect(say('b')).toEqual({ ok: false, reason: 'cooldown 60 s' });
  });

  it('shows a refused collapse in the feed without spending viewer cooldown', () => {
    const g = grid(Array.from({ length: 10 }, (_, y) => y === 5 ? '.===.' : '.~~~.'), 'high');
    const map = new TextEncoder().encode('one crossing');
    const file: CourseFile = {
      name: 'One crossing', map: 'test.map', mapHash: mapHash(map), source: 'shipped', author: 'tests', link: '',
      startGrid: Array.from({ length: 10 }, (_, y): [number, number] => [0, y]),
      waypoints: [], laps: [], finish: [4, 5], bridges: [[2, 5]],
    };
    const race = createRace(loadCourse(file, map, g), g, 1);
    openJoinWindow(race, { joinSeconds: 1 });
    chat(race, { viewerId: 'r', name: 'Racer', text: '!rhino' });
    for (let i = 0; i < 4 * TICK_HZ; i++) tickRace(race);
    const result = chat(race, { viewerId: 'v', name: 'Viewer', text: '!bridge B1' });
    expect(result).toEqual({ ok: false, reason: 'bridge B1 refused: route to finish lost' });
    expect(race.feed.at(-1)).toContain(result.reason);
    expect(race.cooldowns.has('v')).toBe(false);
    expect(g.deck[5 * g.width + 2]).toBe(4);
  });
});
