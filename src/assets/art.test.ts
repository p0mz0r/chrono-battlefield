import { beforeAll, expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { mountTheater } from '../ra2/mount.js';
import type { Vfs } from '../ra2/index.js';
import { prerenderRocket, prerenderTank } from './rhino.js';

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

  it('takes the V3 rocket, falling back to the Dreadnought missile and back again', () => {
    const hiding = (prefix: string) => ({ openFile: (n: string) => (n.startsWith(prefix) ? undefined : vfs.openFile(n)) });
    expect(prerenderRocket(vfs, 'temperate').name).toBe('v3rocket');
    expect(prerenderRocket(hiding('v3rocket'), 'temperate').name).toBe('dmisl');
    expect(prerenderRocket(hiding('dmisl'), 'temperate').name).toBe('v3rocket');
    const neither = { openFile: (n: string) => (/^(v3rocket|dmisl)/.test(n) ? undefined : vfs.openFile(n)) };
    expect(() => prerenderRocket(neither, 'temperate')).toThrow(/Missing install file: v3rocket\.vxl/);
    expect(painted(prerenderRocket(vfs, 'temperate').colorRgba)).toBe(true);
  });
});
