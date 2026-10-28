import type { Bridge, CellGrid } from '../battlefield/grid.js';
import { findLanding, findRoute, moveTank, stepTo, TICK_HZ, type Cell, type Field, type Spot, type Tank } from '../movement/index.js';
import type { ChatResult, Race } from './race.js';

export type BridgeGrid = Pick<CellGrid, 'width' | 'height' | 'speed' | 'level' | 'ramp' | 'blocked' | 'deck' | 'bridge' | 'bridges'>;

type Traveller = { tank: Tank; goals: Cell[]; finishes?: Cell[] };

const index = (grid: BridgeGrid, spot: Cell) => spot.y * grid.width + spot.x;
const same = (a: Spot, b: Spot) => a.x === b.x && a.y === b.y && a.deck === b.deck;

function reaches(grid: BridgeGrid, from: Spot, goals: Cell[], finishes?: Cell[]): boolean {
  for (const goal of goals) {
    const route = findRoute(grid, from, goal);
    if (!route) return false;
    for (const face of route) from = stepTo(grid, from, face)!;
  }
  return !finishes || finishes.some((finish) => findRoute(grid, from, finish) !== undefined);
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
  let safe = true;
  for (const { tank, goals, finishes } of travellers) {
    const onBridge = grid.bridge[index(grid, tank.cell)] === id;
    let from = tank.cell;
    if (onBridge) {
      const taken = [...displaced.values()];
      const landing = findLanding(field, tank, tank.cell, (s) => !taken.some((t) => same(t, s)) && reaches(grid, s, goals, finishes));
      if (!landing) { safe = false; break; }
      displaced.set(tank, landing);
      from = landing;
    }
    if (!reaches(grid, from, goals, finishes)) { safe = false; break; }
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
    moveTank(field, tank, landing ?? tank.cell);
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
    const finishArea = [...(race.course.finishArea.has(index(grid, race.course.finish)) ? [race.course.finish] : []), ...[...race.course.finishArea]
      .filter((i) => i !== index(grid, race.course.finish))
      .map((i) => ({ x: i % grid.width, y: Math.floor(i / grid.width) }))];
    const travellers = race.racers.filter((r) => r.finishedAt === undefined && r.tank)
      .map((r) => ({ tank: r.tank!, goals: race.course.waypoints.slice(r.next), finishes: finishArea }));
    if (!destroyBridge(grid, race.field, id, travellers)) return { ok: false, reason: `bridge ${label!.toUpperCase()} refused: route to finish lost` };
  }
  bridge.changedAt = race.frame;
  return { ok: true, reason: `bridge ${label!.toUpperCase()} ${bridge.destroyed ? 'destroyed' : 'repaired'}` };
}
