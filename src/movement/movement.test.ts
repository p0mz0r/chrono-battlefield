import { describe, expect, it } from 'vitest';
import { createTank, isDriving, orderMove, tankCell, tick, type CellGrid } from './index.js';

/** A grid from rows of chars: `.` clear (100%), `o` ore (70%), `#` blocked. */
function grid(rows: string[]): CellGrid {
  const speeds: Record<string, number> = { '.': 1, o: 0.7, '#': 0 };
  return {
    width: rows[0]!.length,
    height: rows.length,
    speed: (x, y) => speeds[rows[y]![x]!]!,
  };
}

/** Ticks until the tank stops driving, returning every cell it stood in. */
function drive(tank: ReturnType<typeof createTank>, g: CellGrid, maxTicks = 2000) {
  const cells: string[] = [];
  let ticks = 0;
  while (isDriving(tank) && ticks < maxTicks) {
    tick(tank, g);
    ticks++;
    const c = tankCell(tank);
    const key = `${c.x},${c.y}`;
    if (cells.at(-1) !== key) cells.push(key);
  }
  return { cells, ticks };
}

describe('movement', () => {
  it('drives the travel-time route around ore and never enters a blocked cell', () => {
    const g = grid([
      '.......',
      '...#...',
      '.ooooo.',
      '...#...',
      '.......',
    ]);
    const tank = createTank({ x: 0, y: 2 });
    expect(orderMove(tank, g, { x: 6, y: 2 })).toBe(true);
    const { cells } = drive(tank, g);

    expect(tankCell(tank)).toEqual({ x: 6, y: 2 });
    expect(isDriving(tank)).toBe(false);
    expect(cells).not.toContain('3,1');
    expect(cells).not.toContain('3,3');
    for (let x = 1; x <= 5; x++) expect(cells).not.toContain(`${x},2`);
  });

  it('turns in place at ROT=5, then drives a cell in ~11 frames (Speed=6)', () => {
    const g = grid(['...........']);
    const tank = createTank({ x: 0, y: 0 }, 0); // facing north, ordered east
    orderMove(tank, g, { x: 10, y: 0 });
    for (let i = 0; i < 12; i++) tick(tank, g);
    expect([tank.x, tank.y]).toEqual([128, 128]);
    expect(tank.facing).not.toBe(0);
    const { ticks } = drive(tank, g);
    // 90° at 1280/65536 per frame ≈ 13 frames, then 10 cells at 24 leptons/frame ≈ 107.
    expect(12 + ticks).toBeGreaterThanOrEqual(115);
    expect(12 + ticks).toBeLessThanOrEqual(125);
  });

  it('follows curved tracks without jumping on a winding route', () => {
    const g = grid([
      '..........',
      '.####.###.',
      '....#.#...',
      '.##.#.#.##',
      '.#.......#',
      '.#####.#..',
    ]);
    const tank = createTank({ x: 0, y: 0 });
    orderMove(tank, g, { x: 2, y: 4 });
    let last = [tank.x, tank.y];
    let maxStep = 0;
    while (isDriving(tank)) {
      tick(tank, g);
      maxStep = Math.max(maxStep, Math.hypot(tank.x - last[0]!, tank.y - last[1]!));
      last = [tank.x, tank.y];
      expect(g.speed(tankCell(tank).x, tankCell(tank).y)).toBeGreaterThan(0);
    }
    expect(tankCell(tank)).toEqual({ x: 2, y: 4 });
    expect(maxStep).toBeLessThan(40);
  });
});
