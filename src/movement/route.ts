/** A cell on the battlefield grid: x grows south-east on screen, y south-west. */
export interface Cell {
  x: number;
  y: number;
}

/** The only thing movement needs from a battlefield. */
export interface CellGrid {
  readonly width: number;
  readonly height: number;
  /** Speed fraction a tank drives at into this cell (`Track=` %: 1 clear, 0.7 ore…); 0 = impassable. */
  speed(x: number, y: number): number;
}

/** Steps for the 8 facings, RA1 order: 0 = north (-y), clockwise. */
export const STEPS: readonly Cell[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

export function passable(grid: CellGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height && grid.speed(x, y) > 0;
}

/**
 * 8-neighbour A* where a step costs its travel time: distance (1, or √2 on diagonals) over the
 * entered cell's speed (ADR 0005). Diagonals are allowed between two blocked orthogonals (#18).
 * Returns the facings (0-7) to step, or undefined when `to` can't be reached.
 */
export function findRoute(grid: CellGrid, from: Cell, to: Cell): number[] | undefined {
  if (!passable(grid, to.x, to.y)) return undefined;
  const w = grid.width, n = w * grid.height;
  const cost = new Float64Array(n).fill(Infinity);
  const via = new Int8Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = from.y * w + from.x, goal = to.y * w + to.x;
  // ponytail: binary heap with lazy deletion; fine for ≤ 512×512 battlefields.
  const heap: [number, number, number][] = []; // [f, seq, cell]
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
  const h = (c: number) => {
    const dx = Math.abs((c % w) - to.x), dy = Math.abs(Math.floor(c / w) - to.y);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };

  cost[start] = 0;
  push([h(start), seq++, start]);
  while (heap.length) {
    const [, , c] = pop();
    if (c === goal) break;
    if (closed[c]) continue;
    closed[c] = 1;
    const cx = c % w, cy = Math.floor(c / w);
    for (let f = 0; f < 8; f++) {
      const nx = cx + STEPS[f]!.x, ny = cy + STEPS[f]!.y;
      if (!passable(grid, nx, ny)) continue;
      const nc = ny * w + nx;
      const g = cost[c]! + (f & 1 ? Math.SQRT2 : 1) / grid.speed(nx, ny);
      if (g < cost[nc]!) {
        cost[nc] = g;
        via[nc] = f;
        push([g + h(nc), seq++, nc]);
      }
    }
  }
  if (cost[goal] === Infinity) return undefined;
  const facings: number[] = [];
  for (let c = goal; c !== start; ) {
    const f = via[c]!;
    facings.push(f);
    c -= STEPS[f]!.y * w + STEPS[f]!.x;
  }
  return facings.reverse();
}
