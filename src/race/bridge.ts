import type { Bridge, CellGrid } from '../battlefield/grid.js';
import { drivable, findRoute, stepTo, TICK_HZ, type Cell, type Field, type Spot, type Tank } from '../movement/index.js';
import type { ChatResult, Race } from './race.js';

export type BridgeGrid = Pick<CellGrid, 'width' | 'height' | 'speed' | 'level' | 'ramp' | 'blocked' | 'deck' | 'bridge' | 'bridges'>;

type Traveller = { tank: Tank; goals: Cell[] };

const index = (grid: BridgeGrid, spot: Cell) => spot.y * grid.width + spot.x;
const same = (a: Spot, b: Spot) => a.x === b.x && a.y === b.y && a.deck === b.deck;

function reaches(grid: BridgeGrid, from: Spot, goals: Cell[]): boolean {
  for (const goal of goals) {
    const route = findRoute(grid, from, goal);
    if (!route) return false;
    for (const face of route) from = stepTo(grid, from, face)!;
  }
  return true;
}

/** Commit a whole-bridge collapse only if all unfinished tanks can still complete their remaining legs. */
export function destroyBridge(grid: BridgeGrid, field: Field, id: number, travellers: Traveller[]): boolean {
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
    tank.path = [];
    tank.goal = undefined;
    if (!landing && !tank.ahead.some((s) => grid.bridge[index(grid, s)] === id)) continue;
    tank.cell = landing ?? tank.cell;
    tank.x = tank.cell.x * 256 + 128;
    tank.y = tank.cell.y * 256 + 128;
    tank.track = -1;
    tank.ahead = [];
    tank.headTo = { ...tank.cell };
    tank.accum = 0;
    tank.lastNewCell = field.frame;
  }
  return true;
}

/** Repair always restores the imported bridge's passability. */
export function repairBridge(grid: BridgeGrid, id: number): void {
  const bridge: Bridge | undefined = grid.bridges[id];
  if (!bridge?.destroyed) return;
  bridge.cells.forEach((i, n) => {
    if (bridge.kind === 'high') grid.deck[i] = grid.level[i]! + 4;
    else grid.speed[i] = bridge.intactSpeed![n]!;
  });
  bridge.destroyed = false;
}

/** Chat effect for a course-labelled bridge. A refused collapse leaves both state and viewer cooldown unchanged. */
export function toggleBridge(race: Race, label: string | undefined): ChatResult {
  const number = /^b([1-9]\d*)$/i.exec(label ?? '');
  const cell = number ? race.course.file.bridges[Number(number[1]) - 1] : undefined;
  const grid = race.bridgeGrid;
  const id = grid && cell && grid.bridge[cell[1] * grid.width + cell[0]];
  if (!grid || id === undefined || id < 0) return { ok: false, reason: 'unknown bridge' };
  const bridge = grid.bridges[id]!;
  if (bridge.changedAt !== undefined && race.frame - bridge.changedAt < 10 * TICK_HZ) {
    return { ok: false, reason: `bridge cooldown ${Math.ceil((10 * TICK_HZ - (race.frame - bridge.changedAt)) / TICK_HZ)} s` };
  }
  if (bridge.destroyed) {
    repairBridge(grid, id);
    for (const tank of race.field.tanks) { tank.path = []; tank.goal = undefined; }
  }
  else {
    const travellers = race.racers.filter((r) => r.finishedAt === undefined && r.tank)
      .map((r) => ({ tank: r.tank!, goals: [...race.course.waypoints.slice(r.next), race.course.finish] }));
    if (!destroyBridge(grid, race.field, id, travellers)) return { ok: false, reason: `bridge ${label!.toUpperCase()} refused: route to finish lost` };
  }
  bridge.changedAt = race.frame;
  return { ok: true, reason: `bridge ${label!.toUpperCase()} ${bridge.destroyed ? 'destroyed' : 'repaired'}` };
}
