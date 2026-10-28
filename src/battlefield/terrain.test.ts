import { expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { loadMap, mountTheater } from '../ra2/mount.js';
import { Stock } from './stock.js';
import { bakeTerrain } from './terrain.js';

describeInstall('bakeTerrain', () => {
  it.each(['Hills.mmx', 'SinkSwim.yro'])('draws every cell of %s', async (name) => {
    const map = await loadMap(readFromDir, name);
    const vfs = await mountTheater(readFromDir, map.theater);
    const terrain = bakeTerrain(new Stock(map, vfs));
    expect(terrain.missing).toBe(0);
    expect(terrain.chunks.length).toBeGreaterThan(0);
  }, 30_000);
});
