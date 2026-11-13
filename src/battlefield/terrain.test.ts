import { expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { loadMap, mountTheater } from '../ra2/mount.js';
import { Stock } from './stock.js';
import { bakeTerrain, CHUNK } from './terrain.js';

describeInstall('bakeTerrain', () => {
  it.each(['Hills.mmx', 'SinkSwim.yro'])('draws every cell of %s', async (name) => {
    const map = await loadMap(readFromDir, name);
    const vfs = await mountTheater(readFromDir, map.theater);
    const terrain = bakeTerrain(new Stock(map, vfs));
    expect(terrain.missing).toBe(0);
    expect(terrain.chunks.length).toBeGreaterThan(0);
  }, 30_000);

  it('records the mesa in front of the low ground behind it on Hills (#140)', async () => {
    const map = await loadMap(readFromDir, 'Hills.mmx');
    const terrain = bakeTerrain(new Stock(map, await mountTheater(readFromDir, map.theater)));
    // Hills Sprint's route cell (66, 52) is level 2; a tank there is drawn at its centre.
    const x = (66.5 - 52.5) * 30 + 30 - terrain.originX, y = (66.5 + 52.5 - 2) * 15 - terrain.originY - 10;
    const chunk = terrain.chunks.find((c) => c.x === Math.floor(x / CHUNK) * CHUNK && c.y === Math.floor(y / CHUNK) * CHUNK)!;
    const o = ((y % CHUNK) * CHUNK + (x % CHUNK)) * 4;
    expect(chunk.depth[o]! + chunk.depth[o + 1]! * 256).toBeGreaterThan(66 + 52);
    expect(chunk.depth[o + 2]! - 1).toBeGreaterThanOrEqual(2 + 2);
  }, 30_000);
});
