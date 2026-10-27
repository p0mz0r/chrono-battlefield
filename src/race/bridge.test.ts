import { describe, expect, it } from 'vitest';
import { addTank, createField, findRoute, orderMove, type Tank } from '../movement/index.js';
import type { CellGrid } from '../battlefield/grid.js';
import { destroyBridge, repairBridge } from './bridge.js';

function grid(rows: string[], kind: 'high' | 'low'): CellGrid {
  const width = rows[0]!.length, cells = rows.join(''), n = cells.length;
  const bridge = Array.from(cells, (c) => c === '=' ? 0 : -1);
  const span = bridge.flatMap((id, i) => id === 0 ? [i] : []);
  return {
    width, height: rows.length, land: new Array(n).fill('Clear'),
    speed: Array.from(cells, (c) => c === '~' || (kind === 'high' && c === '=') ? 0 : 1),
    level: Array.from(cells, (c) => c === '.' ? 4 : 0), ramp: new Array(n).fill(0),
    blocked: new Array(n).fill(false), deck: Array.from(cells, (c) => c === '=' && kind === 'high' ? 4 : -1),
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
    const g = grid(['.......', '.===...', '.......'], kind), field = createField(g, 1);
    const on = addTank(field, { x: 2, y: 1 });
    if (kind === 'high') on.cell.deck = true;
    const other = addTank(field, { x: 0, y: 1 });
    orderMove(field, other, { x: 6, y: 1 });
    const before = g.speed[8];
    expect(destroyBridge(g, field, 0, [racer(on, [{ x: 6, y: 1 }]), racer(other, [{ x: 6, y: 1 }])])).toBe(true);
    expect(g.bridge[on.cell.y * g.width + on.cell.x]).toBe(-1);
    expect(on.cell.deck).toBe(false);
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
});
