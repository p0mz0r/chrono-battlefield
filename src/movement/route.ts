/** A cell on the battlefield grid: x grows south-east on screen, y south-west. */
export interface Cell {
  x: number;
  y: number;
}

/** A cell on one layer: the ground, or the high-bridge deck above it. Occupancy is per spot. */
export interface Spot extends Cell {
  deck: boolean;
}

/**
 * What movement reads from a battlefield: the plain arrays of `battlefield/grid.ts`'s `CellGrid`
 * (index `y * width + x`), so the imported grid is passed straight in.
 */
export interface CellGrid {
  readonly width: number;
  readonly height: number;
  /** Ground `Track=` fraction (1 clear, 0.7 ore…); 0 = impassable. */
  readonly speed: ArrayLike<number>;
  /** Height level 0–15. */
  readonly level: ArrayLike<number>;
  /** TMP ramp type, 0 = flat. */
  readonly ramp: ArrayLike<number>;
  /** Trees, walls, buildings. */
  readonly blocked: ArrayLike<boolean>;
  /** High-bridge deck level (cell level + 4), or -1. */
  readonly deck: ArrayLike<number>;
}

/** rulesmd `[Road] Track=100%`: the speed on a high-bridge deck. */
const DECK_SPEED = 1;

/** Steps for the 8 facings, RA1 order: 0 = north (-y), clockwise. */
export const STEPS: readonly Cell[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

const inside = (g: CellGrid, x: number, y: number) => x >= 0 && y >= 0 && x < g.width && y < g.height;

/** True if a tank can stand on the ground of (x, y). */
export function drivable(g: CellGrid, x: number, y: number): boolean {
  if (!inside(g, x, y)) return false;
  const i = y * g.width + x;
  return g.speed[i]! > 0 && !g.blocked[i];
}

/** Height level of a spot. */
export function spotLevel(g: CellGrid, s: Spot): number {
  const i = s.y * g.width + s.x;
  return s.deck ? g.deck[i]! : g.level[i]!;
}

/** Speed fraction a tank drives at into a spot. */
export function spotSpeed(g: CellGrid, s: Spot): number {
  return s.deck ? DECK_SPEED : g.speed[s.y * g.width + s.x]!;
}

/** Same level, or one level apart with the lower spot on a ramp (a deck is flat). */
function climbable(fromLevel: number, fromRamp: number, toLevel: number, toRamp: number): boolean {
  const d = toLevel - fromLevel;
  return d === 0 || (d === 1 && fromRamp !== 0) || (d === -1 && toRamp !== 0);
}

/**
 * The spot one step in `face` from `from`, or undefined if a tank can't drive there. A tank at deck
 * height drives onto a neighbouring deck; otherwise it stays on (or under it, on) the ground.
 * Diagonals are allowed between two blocked orthogonals (#18).
 */
export function stepTo(g: CellGrid, from: Spot, face: number): Spot | undefined {
  const x = from.x + STEPS[face]!.x, y = from.y + STEPS[face]!.y;
  if (!inside(g, x, y)) return undefined;
  const i = y * g.width + x, j = from.y * g.width + from.x;
  const level = spotLevel(g, from), ramp = from.deck ? 0 : g.ramp[j]!;
  if (g.deck[i]! >= 0 && climbable(level, ramp, g.deck[i]!, 0)) return { x, y, deck: true };
  if (drivable(g, x, y) && climbable(level, ramp, g.level[i]!, g.ramp[i]!)) return { x, y, deck: false };
  return undefined;
}

/** Spot index for per-layer arrays: (y * width + x) * 2 + deck. */
export const spotIndex = (g: CellGrid, s: Spot) => (s.y * g.width + s.x) * 2 + (s.deck ? 1 : 0);

/**
 * 8-neighbour A* where a step costs its travel time: distance (1, or √2 on diagonals) over the
 * entered spot's speed (ADR 0005), times `price(spotIndex)` (occupancy pricing, default 1).
 * Returns the facings (0-7) to step, or undefined when `to` (either layer) can't be reached.
 */
export function findRoute(g: CellGrid, from: Spot, to: Cell, price?: (spot: number) => number): number[] | undefined {
  const w = g.width, n = w * g.height * 2;
  const cost = new Float64Array(n).fill(Infinity);
  const via = new Int8Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = spotIndex(g, from);
  // ponytail: binary heap with lazy deletion; fine for ≤ 512×512 battlefields.
  const heap: [number, number, number][] = []; // [f, seq, spot]
  let seq = 0;
  const less = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (item: [number, number, number]) => {
    heap.push(item);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!];
        i = m;
      }
    }
    return top;
  };
  const spotOf = (s: number): Spot => { const c = s >> 1; return { x: c % w, y: Math.floor(c / w), deck: (s & 1) === 1 }; };
  const h = (s: Spot) => {
    const dx = Math.abs(s.x - to.x), dy = Math.abs(s.y - to.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  let goal = -1;
  cost[start] = 0;
  push([h(from), seq++, start]);
  while (heap.length) {
    const [, , s] = pop();
    if (closed[s]) continue;
    const here = spotOf(s);
    if (here.x === to.x && here.y === to.y) { goal = s; break; }
    closed[s] = 1;
    for (let f = 0; f < 8; f++) {
      const next = stepTo(g, here, f);
      if (!next) continue;
      const ns = spotIndex(g, next);
      const gc = cost[s]! + ((f & 1 ? Math.SQRT2 : 1) / spotSpeed(g, next)) * (price?.(ns) ?? 1);
      if (gc < cost[ns]!) {
        cost[ns] = gc;
        via[ns] = f;
        parent[ns] = s;
        push([gc + h(next), seq++, ns]);
      }
    }
  }
  if (goal < 0) return undefined;
  const facings: number[] = [];
  for (let s = goal; s !== start; ) {
    facings.push(via[s]!);
    s = parent[s]!;
  }
  return facings.reverse();
}

