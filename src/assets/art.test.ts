import { beforeAll, expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { mountTheater } from '../ra2/mount.js';
import { IniFile, type Vfs } from '../ra2/index.js';
import { MAX_TANKS } from '../race/race.js';
import { DESO_SEQUENCE, desolatorFrame, prerenderAircraft, prerenderAnim, prerenderRhinos, prerenderRocket, prerenderTank } from './rhino.js';

const painted = (rgba: Uint8Array | Uint8ClampedArray) => rgba.some((v, i) => i % 4 === 3 && v > 0);

it('the Desolator stands facing its way, deploys over the last second before its radiation lands, then erupts on a loop', () => {
  expect(desolatorFrame(-2, 0)).toBe(0);
  expect(desolatorFrame(-1.5, 5)).toBe(5);
  expect(desolatorFrame(-1, 3)).toBe(299);
  expect(desolatorFrame(-0.01, 3)).toBe(313);
  expect(desolatorFrame(0, 3)).toBe(292);
  expect(desolatorFrame(6 / 15, 3)).toBe(298);
  expect(desolatorFrame(7 / 15, 3)).toBe(292);
});

describeInstall('interaction art from the install', () => {
  let vfs: Vfs;
  beforeAll(async () => { vfs = await mountTheater(readFromDir, 'temperate'); });

  it('prerenders the Tesla tank like the Rhino: 32 hull and 32 turret facings', () => {
    const tesla = prerenderTank(vfs, 'temperate', 'ttnk');
    expect(tesla.body.frames).toHaveLength(32);
    expect(tesla.turret.sprite.frames).toHaveLength(32);
    expect(painted(tesla.body.colorRgba)).toBe(true);
  });

  it('prerenders a Rhino per house colour from rulesmd [Colors]: enough for a full field, recolouring only the house-colour area', () => {
    const rhinos = prerenderRhinos(vfs, 'temperate');
    expect(rhinos.length).toBeGreaterThanOrEqual(MAX_TANKS);
    // Flat plus a tilt per uphill direction, 32 facings each, hull and turret alike (#150).
    expect(rhinos[0]!.body.frames).toHaveLength(9 * 32);
    expect(rhinos[0]!.turret.sprite.frames).toHaveLength(9 * 32);
    expect(new Set(rhinos.map((r) => r.rgb)).size).toBe(rhinos.length);
    const [a, b] = rhinos.map((r) => r.body.colorRgba);
    let same = 0, differ = 0, red = 0;
    for (let p = 0; p < a!.length; p += 4) {
      if (!a![p + 3]) continue;
      if (a![p] === b![p] && a![p + 1] === b![p + 1] && a![p + 2] === b![p + 2]) same++; else differ++;
      if (a![p]! > 128 && !a![p + 1] && !a![p + 2]) red++;
    }
    // Most of the hull keeps its own colours; the house-colour area takes the colour, shaded.
    expect(differ).toBeGreaterThan(50);
    expect(same).toBeGreaterThan(differ);
    expect(red).toBe(0);
    // A colour's tank is shaded: its house-colour pixels are not one flat value.
    const shades = new Set<number>();
    for (let p = 0; p < a!.length; p += 4) if (a![p + 3] === 255 && (a![p] !== b![p] || a![p + 1] !== b![p + 1])) shades.add(a![p]! << 16 | a![p + 1]! << 8 | a![p + 2]!);
    expect(shades.size).toBeGreaterThan(5);
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

  it('prerenders the Kirov airship and its bomb in 32 facings, and takes its blast from the stock animations', () => {
    for (const name of ['zep', 'zbomb']) {
      const art = prerenderAircraft(vfs, 'temperate', name, 40);
      expect(art.frames).toHaveLength(32);
      expect(painted(art.colorRgba)).toBe(true);
    }
    expect(painted(prerenderAnim(vfs, 'explolrg').colorRgba)).toBe(true);
  });

  it('prerenders the Desolator from deso.shp, its frames where artmd.ini DesoSequence puts them', () => {
    const deso = prerenderAnim(vfs, 'deso', 'temperate');
    expect(painted(deso.colorRgba)).toBe(true);
    const seq = IniFile.parse(vfs.openFile('artmd.ini')!).getSection('DesoSequence')!;
    for (const [name, [start, count, facings]] of Object.entries(DESO_SEQUENCE)) {
      expect(seq.getString(name).split(',').slice(0, 3).map(Number)).toEqual([start, count, facings]);
      expect(deso.frameCount).toBeGreaterThanOrEqual(start + count + 7 * facings);
    }
  });
});
