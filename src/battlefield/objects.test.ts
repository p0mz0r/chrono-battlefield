import { expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { loadMap, mountTheater } from '../ra2/mount.js';
import { placeObjects } from './objects.js';
import { Stock } from './stock.js';

describeInstall('building overlays', () => {
  it('draws the oil derrick pump jack and flame over its base, and skips an overlay with no art', async () => {
    const map = await loadMap(readFromDir, 'Hills.mmx');
    const stock = new Stock(map, await mountTheater(readFromDir, map.theater));
    const derrick = map.structures.find((s) => s.type === 'CAOILD')!;
    const at = (objects: ReturnType<typeof placeObjects>['objects']) => objects.filter((o) => o.kind === 'building' && o.cellX === derrick.x && o.cellY === derrick.y);
    const placed = placeObjects(stock, 0, 0);
    expect(at(placed.objects)).toHaveLength(3); // base, CAOILD_A, CAOILD_F
    expect(placed.missingOverlays.size).toBe(0);

    const artFile = stock.artFile.bind(stock);
    stock.artFile = (type) => (type === 'CAOILD_F' ? undefined : artFile(type));
    const skipped = placeObjects(stock, 0, 0);
    expect(at(skipped.objects)).toHaveLength(2);
    expect(skipped.missingOverlays).toContain('CAOILD: CAOILD_F');
    expect(skipped.missingArt.size).toBe(0);
  }, 30_000);
});
