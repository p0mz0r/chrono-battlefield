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

  it('draws the tech outpost repair pad (IdleAnim) over its base', async () => {
    const map = await loadMap(readFromDir, 'Carville.mmx');
    const stock = new Stock(map, await mountTheater(readFromDir, map.theater));
    const outpost = map.structures.find((s) => s.type === 'CAOUTP')!;
    const placed = placeObjects(stock, 0, 0).objects.filter((o) => o.kind === 'building' && o.cellX === outpost.x && o.cellY === outpost.y);
    expect(placed).toHaveLength(5); // base, CAOUTP_F, CAOUTP_D, CAOUTPBB, the OUTP voxel gun
  }, 30_000);
});

describeInstall('house colour', () => {
  it('draws a neutral building\'s remap ramp grey, not the file\'s red', async () => {
    const map = await loadMap(readFromDir, 'DeepFrze.yro');
    const stock = new Stock(map, await mountTheater(readFromDir, map.theater));
    const { images, objects } = placeObjects(stock, 0, 0);
    const cannon = objects.find((o) => o.kind === 'building' && o.cellX === 75 && o.cellY === 112)!;
    const { rgba } = images[cannon.image]!;
    let red = 0;
    for (let p = 0; p < rgba.length; p += 4) if (rgba[p + 3] && rgba[p]! > 128 && rgba[p + 1] === 0 && rgba[p + 2] === 0) red++;
    expect(red).toBe(0);
    // The voxel gun and barrel stand on the base: a second, wider image at the same cell.
    const gun = objects.filter((o) => o.cellX === 75 && o.cellY === 112)[1]!;
    expect(images[gun.image]!.width).toBeGreaterThan(images[cannon.image]!.width);
  }, 30_000);
});
