import type { IsoTile, TmpTile } from '../ra2/index.js';
import type { Stock } from './stock.js';

export const LAND_TYPES = [
  'Clear', 'Road', 'Water', 'Rock', 'Wall', 'Tiberium', 'Beach', 'Rough', 'Ice', 'Railroad', 'Tunnel', 'Weeds',
] as const;
export type LandType = (typeof LAND_TYPES)[number];

/** A run of connected bridge overlay cells: one bridge as a course can put it in play. */
export interface Bridge {
  /** `high`: `BRIDGE1/2`, `BRIDGEB1/2`, a deck 4 levels up that tanks drive over and under. `low`: `LOBRDG*`/`LOBRDB*`, road at ground level. */
  kind: 'high' | 'low';
  /** Cell indices (`y * width + x`). */
  cells: number[];
  /** Runtime state while this bridge is in play. */
  destroyed?: boolean;
  intactSpeed?: number[];
  changedAt?: number;
}

/**
 * What movement needs to know about a battlefield, as plain data. Cell (x, y) in RA2 cell coordinates is index
 * `y * width + x`; cells the map doesn't cover have speed 0.
 */
export interface CellGrid {
  width: number;
  height: number;
  /** Ground land type: the tile's terrain byte, overridden by overlay (`Land=`, ore = Tiberium) and cliff-foot Rock. */
  land: LandType[];
  /** Ground speed for a Track unit as a fraction (rulesmd `Track=`, 1 = full, 0 = impassable). Blockers aren't folded in. */
  speed: number[];
  /** Height level 0–15. */
  level: number[];
  /** TMP ramp type, 0 = flat. A one-level step is legal only onto or off the lower cell's ramp. */
  ramp: number[];
  /** Hard blockers: a tree, wall or building stands on the cell. */
  blocked: boolean[];
  /** High-bridge deck level (cell level + 4), or -1 where there is no deck. The deck drives at `Track=` Road speed. */
  deck: number[];
  /** Index into `bridges`, or -1. */
  bridge: number[];
  bridges: Bridge[];
}

// TMP per-cell terrain byte → land type (OpenRA's LegacyTilesetImporter; byte 10 "Beach" is shoreline water).
const TERRAIN_BYTE: LandType[] = [
  'Clear', 'Ice', 'Ice', 'Ice', 'Ice', 'Tunnel', 'Railroad', 'Rock',
  'Rock', 'Water', 'Beach', 'Road', 'Road', 'Clear', 'Rough', 'Rock',
];

// CliffBackImpassability=2: these land types turn to Rock when one of these neighbours stands 4+ levels higher.
const CLIFF_BACK_LAND = new Set<LandType>(['Clear', 'Water', 'Beach', 'Ice']);
const CLIFF_BACK_OFFSETS = [[0, -1], [-1, 0], [1, -1], [-1, 1], [1, 1], [2, 2]] as const;

export const isHighBridge = (type: string) => /^BRIDGEB?[12]$/i.test(type);
export const isLowBridge = (type: string) => /^LOBRD/i.test(type);

export function buildGrid(stock: Stock, tileAt: (t: IsoTile) => TmpTile | undefined): CellGrid {
  const { map, rules } = stock;
  let width = 0, height = 0;
  for (const t of map.tiles) { width = Math.max(width, t.x + 1); height = Math.max(height, t.y + 1); }
  const n = width * height;
  const grid: CellGrid = {
    width, height,
    land: new Array<LandType>(n).fill('Rock'),
    speed: new Array<number>(n).fill(0),
    level: new Array<number>(n).fill(0),
    ramp: new Array<number>(n).fill(0),
    blocked: new Array<boolean>(n).fill(false),
    deck: new Array<number>(n).fill(-1),
    bridge: new Array<number>(n).fill(-1),
    bridges: [],
  };
  const covered = new Array<boolean>(n).fill(false);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;

  for (const t of map.tiles) {
    const i = t.y * width + t.x, tile = tileAt(t);
    covered[i] = true;
    grid.level[i] = t.z;
    grid.land[i] = TERRAIN_BYTE[tile?.terrainType ?? 0] ?? 'Clear';
    grid.ramp[i] = tile?.rampType ?? 0;
  }

  if (rules.getSection('General')?.getInt('CliffBackImpassability') === 2) {
    const ground = [...grid.land];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!CLIFF_BACK_LAND.has(ground[i]!)) continue;
      if (CLIFF_BACK_OFFSETS.some(([dx, dy]) => inside(x + dx, y + dy) && grid.level[(y + dy) * width + x + dx]! >= grid.level[i]! + 4)) {
        grid.land[i] = 'Rock';
      }
    }
  }

  const bridgeKind: ('high' | 'low' | undefined)[] = new Array(n);
  const across: number[] = []; // per high overlay cell: index step across its line (`*1` runs along x, `*2` along y)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const id = map.overlay[y * 512 + x]!;
    if (id === 0xff) continue;
    const type = stock.overlayTypes[id];
    if (!type) continue;
    const i = y * width + x, sec = rules.getSection(type);
    if (isHighBridge(type)) { bridgeKind[i] = 'high'; grid.deck[i] = grid.level[i]! + 4; across[i] = type.endsWith('1') ? width : 1; continue; }
    if (isLowBridge(type)) bridgeKind[i] = 'low';
    if (sec?.getBool('Wall')) grid.blocked[i] = true;
    const land = sec?.getString('Land');
    if (land && (LAND_TYPES as readonly string[]).includes(land)) grid.land[i] = land as LandType;
    else if (sec?.getBool('Tiberium')) grid.land[i] = 'Tiberium';
  }

  for (const t of map.terrainObjects) if (inside(t.x, t.y)) grid.blocked[t.y * width + t.x] = true;
  for (const s of map.structures) {
    if (s.x === undefined || s.y === undefined || stock.invisible(s.type)) continue;
    const [fw, fh] = foundation(stock, s.type);
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
      if (inside(s.x + dx, s.y + dy)) grid.blocked[(s.y + dy) * width + s.x + dx] = true;
    }
  }

  const track = (land: LandType) => parseFloat(rules.getSection(land)?.getString('Track') ?? '0') / 100 || 0;
  for (let i = 0; i < n; i++) if (covered[i]) grid.speed[i] = track(grid.land[i]!);

  // Bridges: 4-connected runs of the same kind.
  for (let start = 0; start < n; start++) {
    const kind = bridgeKind[start];
    if (!kind || grid.bridge[start] !== -1) continue;
    const id = grid.bridges.length, cells: number[] = [];
    const stack = [start];
    grid.bridge[start] = id;
    while (stack.length) {
      const i = stack.pop()!, x = i % width, y = (i - x) / width;
      cells.push(i);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const j = (y + dy) * width + x + dx;
        if (inside(x + dx, y + dy) && bridgeKind[j] === kind && grid.bridge[j] === -1) { grid.bridge[j] = id; stack.push(j); }
      }
    }
    // A high deck is its overlay line ±1 cell across, end cells included; each side cell is deck at its own level + 4 (#80).
    // ponytail: a side cell two bridges share goes to the first one scanned (RA2: last placed); no shipped map has one.
    if (kind === 'high') for (const i of [...cells]) for (const j of [i - across[i]!, i + across[i]!]) {
      const x = j % width;
      if (j < 0 || j >= n || !covered[j] || Math.abs(x - i % width) > 1 || bridgeKind[j] || grid.bridge[j] !== -1) continue;
      grid.deck[j] = grid.level[j]! + 4;
      grid.bridge[j] = id;
      cells.push(j);
    }
    grid.bridges.push({ kind, cells: cells.sort((a, b) => a - b) });
  }
  return grid;
}

/** A building's foundation in cells from artmd `Foundation=WxH` (`Custom` uses `Foundation.X/Y`). */
export function foundation(stock: Stock, type: string): [number, number] {
  const art = stock.artOf(type);
  const raw = art?.getString('Foundation') || '1x1';
  if (/^custom$/i.test(raw)) return [art!.getInt('Foundation.X', 1), art!.getInt('Foundation.Y', 1)];
  const [w, h] = raw.split(/x/i).map(Number);
  return [w || 1, h || 1];
}
