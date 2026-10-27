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

/** Spots a tank holds: the one it stands in plus those its track reserves. */
const held = (t: Tank) => [t.cell, ...t.ahead].map((c) => `${c.x},${c.y},${c.deck}`);

/** Fails if two tanks hold the same spot, unless one of them is ghosting. */
function expectNoOverlap(field: Field) {
  const owner = new Map<string, Tank>();
  for (const t of field.tanks) for (const s of held(t)) {
    const other = owner.get(s);
    if (other && !t.ghost && !other.ghost) expect.fail(`tanks ${other.id} and ${t.id} both hold ${s} at frame ${field.frame}`);
    owner.set(s, t);
  }
}

/** Ticks until no tank drives, returning every cell each tank stood in. Checks occupancy every tick. */
function run(field: Field, maxTicks = 3000) {
  const cells = field.tanks.map((t) => [key(t)]);
  let ticks = 0;
  while (field.tanks.some(isDriving) && ticks < maxTicks) {
    tick(field);
    expectNoOverlap(field);
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

  it('scales speed by the speed multiplier, never the turn rate', () => {
    const timing = (speedFactor: number) => {
      const field = createField(grid(['...........']), 1);
      const tank = addTank(field, { x: 0, y: 0 }, { facing: 0, speedFactor });
      orderMove(field, tank, { x: 10, y: 0 });
      let turned = 0;
      while (tank.x === 128) { tick(field); turned++; }
      return { turned, total: turned + run(field).ticks };
    };
    const normal = timing(1), boosted = timing(2);
    expect(boosted.turned).toBe(normal.turned);
    expect(boosted.total - boosted.turned).toBeCloseTo((normal.total - normal.turned) / 2, -1);
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

  it('cuts a corner between two blockers (#18)', () => {
    const field = createField(grid([
      '...#.',
      '..#..',
      '.#...',
      '#....',
      '.....',
    ]), 1);
    const tank = addTank(field, { x: 1, y: 1 }); // through the diagonal gap between (2,1) and (1,2)
    orderMove(field, tank, { x: 3, y: 3 });
    const { cells: [cells] } = run(field);
    expect(cells).toEqual(['1,1', '2,2', '3,3']);
  });

  it('lets two crossing tanks through without ever sharing a cell', () => {
    const field = createField(grid(['.....', '.....', '.....', '.....', '.....']), 1);
    const a = addTank(field, { x: 0, y: 2 }, { facing: 16384 });
    const b = addTank(field, { x: 2, y: 0 }, { facing: 32768 });
    orderMove(field, a, { x: 4, y: 2 });
    orderMove(field, b, { x: 2, y: 4 });
    run(field);
    expect([key(a), key(b)]).toEqual(['4,2', '2,4']);
  });

  it('asks a stationary tank on its goal to make way, never stopping short', () => {
    const field = createField(grid(['#####', '.....', '####.']), 1);
    const parked = addTank(field, { x: 4, y: 1 });
    const mover = addTank(field, { x: 0, y: 1 }, { facing: 16384 });
    orderMove(field, mover, { x: 4, y: 1 });
    run(field);
    expect(key(mover)).toBe('4,1');
    expect(key(parked)).toBe('4,2');
  });

  it('waits behind a moving tank, then detours after BlockagePathDelay', () => {
    const field = createField(grid([
      '..........',
      '.########.',
      '.########.',
      '.########.',
      '..........',
    ]), 1);
    const slow = addTank(field, { x: 2, y: 0 }, { facing: 16384, speedFactor: 0.05 });
    const fast = addTank(field, { x: 0, y: 0 }, { facing: 16384 });
    orderMove(field, slow, { x: 8, y: 0 });
    orderMove(field, fast, { x: 9, y: 0 });
    let stay = 0, longestStay = 0, detoured = false;
    while (isDriving(fast) && field.frame < 3000) {
      const before = key(fast);
      tick(field);
      expectNoOverlap(field);
      stay = key(fast) === before ? stay + 1 : 0;
      longestStay = Math.max(longestStay, stay);
      if (tankCell(fast).y === 4) detoured = true;
    }
    expect(key(fast)).toBe('9,0');
    expect(detoured).toBe(true);
    expect(longestStay).toBeGreaterThanOrEqual(60);
    expect(tankCell(slow).x).toBeLessThan(8); // passed it while it was still driving
  });

  it('resolves a head-on jam in a one-cell corridor', () => {
    const field = createField(grid([
      '..#####..',
      '.........',
      '..#####..',
    ]), 1);
    const east = addTank(field, { x: 0, y: 1 }, { facing: 16384 });
    const west = addTank(field, { x: 8, y: 1 }, { facing: 49152 });
    orderMove(field, east, { x: 8, y: 1 });
    orderMove(field, west, { x: 0, y: 1 });
    run(field);
    expect([key(east), key(west)]).toEqual(['8,1', '0,1']);
  });

  it('ghosts a tank stuck for 10 s until it stands on a free cell', () => {
    const field = createField(grid(['.....']), 1);
    const stuck = addTank(field, { x: 0, y: 0 }, { facing: 16384 });
    const cornered = addTank(field, { x: 3, y: 0 }, { facing: 16384 });
    orderMove(field, stuck, { x: 4, y: 0 });
    let lastNewCell = 0, ghostedAfter = -1, cell = key(stuck);
    while ((isDriving(stuck) || stuck.ghost) && field.frame < 3000) {
      tick(field);
      expectNoOverlap(field);
      if (stuck.ghost && ghostedAfter < 0) ghostedAfter = field.frame - lastNewCell;
      if (key(stuck) !== cell) [cell, lastNewCell] = [key(stuck), field.frame];
    }
    expect(ghostedAfter).toBeGreaterThanOrEqual(300);
    expect(ghostedAfter).toBeLessThan(310);
    expect(stuck.ghost).toBe(false);
    expect([key(stuck), key(cornered)]).toEqual(['4,0', '3,0']);
  });

  it('sends ten tanks through a choke point, replaying the same from the same seed', () => {
    const choke = [
      '.....#.....',
      '.....#.....',
      '.....#.....',
      '.....#.....',
      '...........',
      '.....#.....',
      '.....#.....',
      '.....#.....',
      '.....#.....',
      '.....#.....',
    ];
    const race = (seed: number) => {
      const field = createField(grid(choke), seed);
      for (let i = 0; i < 10; i++) {
        const t = addTank(field, { x: i % 2, y: i }, { facing: 16384 });
        orderMove(field, t, { x: 9 + (i % 2), y: i });
      }
      const trace: string[] = [];
      while (field.tanks.some(isDriving) && field.frame < 6000) {
        tick(field);
        expectNoOverlap(field);
        trace.push(field.tanks.map((t) => `${t.x},${t.y},${t.facing}`).join(' '));
      }
      return { field, trace };
    };
    const a = race(7), b = race(7), c = race(8);
    expect(a.field.tanks.map(key)).toEqual(a.field.tanks.map((_, i) => `${9 + (i % 2)},${i}`));
    expect(a.trace).toEqual(b.trace);
    expect(a.trace).not.toEqual(c.trace);
  });
});
