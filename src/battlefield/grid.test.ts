// Runs without the install, so CI covers the grid rules; import.test.ts checks them against real maps.
import { expect, it } from 'vitest';
import { IniFile } from '../ra2/index.js';
import { buildGrid } from './grid.js';
import type { Stock } from './stock.js';

const W = 7;

/** A flat 7×7 Clear battlefield at level 0 with the given overlays. */
function grid(overlays: [number, number, string][]) {
  const types = [...new Set(overlays.map(([, , t]) => t))];
  const overlay = new Uint8Array(512 * 512).fill(0xff);
  for (const [x, y, t] of overlays) overlay[y * 512 + x] = types.indexOf(t);
  const tiles = Array.from({ length: W * W }, (_, i) => ({ x: i % W, y: Math.floor(i / W), z: 0 }));
  const stock = {
    map: { tiles, overlay, terrainObjects: [], structures: [] },
    rules: IniFile.parse('[Clear]\nTrack=100\n'),
    overlayTypes: types,
  } as unknown as Stock;
  return buildGrid(stock, () => undefined);
}

const decks = (g: ReturnType<typeof grid>) => g.deck.flatMap((d, i) => (d >= 0 ? [[i % W, Math.floor(i / W)]] : []));

it('widens a high bridge deck one cell either side across its line, owned by the bridge (#80)', () => {
  const g = grid([[2, 3, 'BRIDGEB1'], [3, 3, 'BRIDGEB1'], [4, 3, 'BRIDGEB1']]);
  expect(decks(g)).toEqual([[2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3], [2, 4], [3, 4], [4, 4]]);
  expect(g.deck[2 * W + 3]).toBe(4);
  expect(g.bridges).toHaveLength(1);
  expect(g.bridges[0]!.cells).toHaveLength(9);
  expect(g.bridge.filter((b) => b === 0)).toHaveLength(9);
});

it('widens a *2 bridge along x and stops at the map edge', () => {
  const g = grid([[0, 5, 'BRIDGE2'], [0, 6, 'BRIDGE2']]);
  expect(decks(g)).toEqual([[0, 5], [1, 5], [0, 6], [1, 6]]); // (6, 4), one index before (0, 5), stays ground
});

it('gives a low bridge no deck and no side cells', () => {
  const g = grid([[3, 3, 'LOBRDG01']]);
  expect(decks(g)).toEqual([]);
  expect(g.bridges[0]!.cells).toEqual([3 * W + 3]);
});
