import type { Bridge, CellGrid } from '../battlefield/grid.js';
import { drivable, findRoute, stepTo, type Cell, type Field, type Spot, type Tank } from '../movement/index.js';

type Traveller = { tank: Tank; goals: Cell[] };

const index = (grid: CellGrid, spot: Cell) => spot.y * grid.width + spot.x;
const same = (a: Spot, b: Spot) => a.x === b.x && a.y === b.y && a.deck === b.deck;

function reaches(grid: CellGrid, from: Spot, goals: Cell[]): boolean {
  for (const goal of goals) {
    const route = findRoute(grid, from, goal);
    if (!route) return false;
    for (const face of route) from = stepTo(grid, from, face)!;
  }
  return true;
}

/** Commit a whole-bridge collapse only if all unfinished tanks can still complete their remaining legs. */
export function destroyBridge(grid: CellGrid, field: Field, id: number, travellers: Traveller[]): boolean {
  const bridge = grid.bridges[id];
  if (!bridge || bridge.destroyed) return false;
  const original = bridge.cells.map((i) => [grid.speed[i]!, grid.deck[i]!] as const);
  for (const i of bridge.cells) {
    if (bridge.kind === 'high') grid.deck[i] = -1;
    else grid.speed[i] = 0;
  }

  const displaced = new Map<Tank, Spot>();
  const occupied = field.tanks.flatMap((t) => [t.cell, ...t.ahead]);
  const landings = Array.from({ length: grid.width * grid.height }, (_, i) => ({ x: i % grid.width, y: Math.floor(i / grid.width), deck: false }));
  let safe = true;
  for (const { tank, goals } of travellers) {
    const onBridge = grid.bridge[index(grid, tank.cell)] === id;
    let from = tank.cell;
    if (onBridge) {
      const landing = landings
        .filter((s) => grid.bridge[index(grid, s)] === -1 && drivable(grid, s.x, s.y) && !occupied.some((held) => same(held, s)))
        .sort((a, b) => Math.hypot(a.x - tank.cell.x, a.y - tank.cell.y) - Math.hypot(b.x - tank.cell.x, b.y - tank.cell.y))
        .find((s) => reaches(grid, s, goals));
      if (!landing) { safe = false; break; }
      displaced.set(tank, landing);
      occupied.push(landing);
      from = landing;
    }
    if (!reaches(grid, from, goals)) { safe = false; break; }
  }
  if (!safe) {
    bridge.cells.forEach((i, n) => { [grid.speed[i], grid.deck[i]] = original[n]!; });
    return false;
  }

  bridge.intactSpeed = original.map(([speed]) => speed);
  bridge.destroyed = true;
  for (const tank of field.tanks) {
    const landing = displaced.get(tank);
    if (!landing && !tank.ahead.some((s) => grid.bridge[index(grid, s)] === id)) continue;
    tank.cell = landing ?? tank.cell;
    tank.x = tank.cell.x * 256 + 128;
    tank.y = tank.cell.y * 256 + 128;
    tank.track = -1;
    tank.path = [];
    tank.ahead = [];
    tank.headTo = { ...tank.cell };
    tank.accum = 0;
    tank.goal = undefined;
    tank.lastNewCell = field.frame;
  }
  return true;
}

/** Repair always restores the imported bridge's passability. */
export function repairBridge(grid: CellGrid, id: number): void {
  const bridge: Bridge | undefined = grid.bridges[id];
  if (!bridge?.destroyed) return;
  bridge.cells.forEach((i, n) => {
    if (bridge.kind === 'high') grid.deck[i] = grid.level[i]! + 4;
    else grid.speed[i] = bridge.intactSpeed![n]!;
  });
  bridge.destroyed = false;
}
