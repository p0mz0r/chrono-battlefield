import { beforeAll, expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { mountTheater } from '../ra2/mount.js';
import type { Vfs } from '../ra2/index.js';
import { prerenderAnim, prerenderRocket, prerenderTank } from './rhino.js';

const painted = (rgba: Uint8Array | Uint8ClampedArray) => rgba.some((v, i) => i % 4 === 3 && v > 0);

describeInstall('interaction art from the install', () => {
  let vfs: Vfs;
  beforeAll(async () => { vfs = await mountTheater(readFromDir, 'temperate'); });

  it('prerenders the Tesla tank like the Rhino: 32 hull and 32 turret facings', () => {
    const tesla = prerenderTank(vfs, 'temperate', 'ttnk');
    expect(tesla.body.frames).toHaveLength(32);
    expect(tesla.turret.sprite.frames).toHaveLength(32);
    expect(painted(tesla.body.colorRgba)).toBe(true);
  });

  it('takes the V3 rocket for the V3 and the Dreadnought missile for the homing missile, each falling back to the other', () => {
    const hiding = (re: RegExp) => ({ openFile: (n: string) => (re.test(n) ? undefined : vfs.openFile(n)) });
    expect(prerenderRocket(vfs, 'temperate', 'v3rocket').name).toBe('v3rocket');
    expect(prerenderRocket(vfs, 'temperate', 'dmisl').name).toBe('dmisl');
    expect(prerenderRocket(hiding(/^v3rocket/), 'temperate', 'v3rocket').name).toBe('dmisl');
    expect(prerenderRocket(hiding(/^dmisl/), 'temperate', 'dmisl').name).toBe('v3rocket');
    expect(() => prerenderRocket(hiding(/^(v3rocket|dmisl)/), 'temperate', 'dmisl')).toThrow(/Missing install file: dmisl\.vxl/);
    expect(painted(prerenderRocket(vfs, 'temperate', 'v3rocket').colorRgba)).toBe(true);
  });

  it('takes the chronosphere warp, the stun fire, the nuke and its mushroom cloud from the stock animations', () => {
    for (const name of ['chronofd', 'chronotg', 'fire01', 'nukeanim']) expect(painted(prerenderAnim(vfs, name).colorRgba)).toBe(true);
    expect(painted(prerenderAnim(vfs, 'nkmsldn', 'temperate').colorRgba)).toBe(true);
    expect(() => prerenderAnim(vfs, 'nosuchanim')).toThrow(/Missing install file: nosuchanim\.shp/);
  });
});
