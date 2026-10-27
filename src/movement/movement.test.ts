import { describe, expect, it } from 'vitest';
import { addTank, createField, isDriving, orderMove, tankCell, tick, type CellGrid, type Field, type Tank } from './index.js';

/**
 * A grid from rows of chars: `.` clear (100%), `o` ore (70%), `#` tree (hard blocker), `~` water,
 * `=` water under a high-bridge deck, `+` clear ground under a high-bridge deck.
 * `levels`: optional rows of height digits, `r` in `ramps` marks a ramp cell.
 */
function grid(rows: string[], levels?: string[], ramps?: string[]): CellGrid {
  const width = rows[0]!.length, height = rows.length;
  const g = { width, height, speed: [] as number[], level: [] as number[], ramp: [] as number[], blocked: [] as boolean[], deck: [] as number[] };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ch = rows[y]![x]!, level = Number(levels?.[y]![x] ?? 0);
    g.speed.push({ '.': 1, o: 0.7, '#': 1, '~': 0, '=': 0, '+': 1 }[ch]!);
    g.level.push(level);
    g.ramp.push(ramps?.[y]![x] === 'r' ? 1 : 0);
    g.blocked.push(ch === '#');
    g.deck.push(ch === '=' || ch === '+' ? level + 4 : -1);
  }
  return g satisfies CellGrid;
}

const key = (t: Tank) => { const c = tankCell(t); return `${c.x},${c.y}`; };

/** Ticks until no tank drives, returning every cell each tank stood in. */
function run(field: Field, maxTicks = 3000) {
  const cells = field.tanks.map((t) => [key(t)]);
  let ticks = 0;
  while (field.tanks.some(isDriving) && ticks < maxTicks) {
    tick(field);
    ticks++;
    field.tanks.forEach((t, i) => { if (cells[i]!.at(-1) !== key(t)) cells[i]!.push(key(t)); });
  }
  return { cells, ticks };
}

describe('movement', () => {
  it('drives the travel-time route around ore and never enters a blocked cell', () => {
    const field = createField(grid([
      '.......',
      '...#...',
      '.ooooo.',
      '...#...',
      '.......',
    ]), 1);
    const tank = addTank(field, { x: 0, y: 2 });
    expect(orderMove(field, tank, { x: 6, y: 2 })).toBe(true);
    const { cells: [cells] } = run(field);

    expect(key(tank)).toBe('6,2');
    expect(isDriving(tank)).toBe(false);
    expect(cells).not.toContain('3,1');
    expect(cells).not.toContain('3,3');
    for (let x = 1; x <= 5; x++) expect(cells).not.toContain(`${x},2`);
  });

  it('turns in place at ROT=5, then drives a cell in ~11 frames (Speed=6)', () => {
    const field = createField(grid(['...........']), 1);
    const tank = addTank(field, { x: 0, y: 0 }, { facing: 0 }); // facing north, ordered east
    orderMove(field, tank, { x: 10, y: 0 });
    for (let i = 0; i < 12; i++) tick(field);
    expect([tank.x, tank.y]).toEqual([128, 128]);
    expect(tank.facing).not.toBe(0);
    const { ticks } = run(field);
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
    const field = createField(g, 1);
    const tank = addTank(field, { x: 0, y: 0 });
    orderMove(field, tank, { x: 2, y: 4 });
    let last = [tank.x, tank.y];
    let maxStep = 0;
    while (isDriving(tank)) {
      tick(field);
      maxStep = Math.max(maxStep, Math.hypot(tank.x - last[0]!, tank.y - last[1]!));
      last = [tank.x, tank.y];
      const c = tankCell(tank);
      expect(g.blocked[c.y * g.width + c.x]).toBe(false);
    }
    expect(key(tank)).toBe('2,4');
    expect(maxStep).toBeLessThan(40);
  });

  it('changes level only over a ramp', () => {
    const rows = ['......'], levels = ['001111'];
    const flat = createField(grid(rows, levels), 1);
    expect(orderMove(flat, addTank(flat, { x: 0, y: 0 }), { x: 5, y: 0 })).toBe(false);

    const ramped = createField(grid(rows, levels, ['.r....']), 1);
    const tank = addTank(ramped, { x: 0, y: 0 });
    expect(orderMove(ramped, tank, { x: 5, y: 0 })).toBe(true);
    run(ramped);
    expect(key(tank)).toBe('5,0');
  });

  it('crosses a high-bridge deck over a tank parked under it', () => {
    const field = createField(grid(
      ['~~.~~', '.=+=.', '~~.~~'],
      ['00000', '40004', '00000'],
    ), 1);
    const parked = addTank(field, { x: 2, y: 1 });
    const crosser = addTank(field, { x: 0, y: 1 });
    expect(orderMove(field, crosser, { x: 4, y: 1 })).toBe(true);
    let sawDeck = false;
    while (isDriving(crosser)) {
      tick(field);
      const c = tankCell(crosser);
      if (c.x === 2) sawDeck = c.deck;
    }
    expect(key(crosser)).toBe('4,1');
    expect(sawDeck).toBe(true);
    expect(tankCell(parked)).toEqual({ x: 2, y: 1, deck: false });
  });
});
