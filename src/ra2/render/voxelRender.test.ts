import { beforeAll, describe, expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../../test/install.js';
import { prerenderRocket, prerenderTank } from '../../assets/rhino.js';
import { HvaFile, Palette, VxlFile, type Vfs, type VxlSection } from '../index.js';
import { mountTheater } from '../mount.js';
import type { ConvertedSprite } from './sprite.js';
import { deriveModelScale, facingAngle, projectModelPoint, renderVoxelToSprite } from './voxelRender.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** HVA bytes for `matrices[section][frame]`, laid out frame by frame like the game's files. */
function hva(matrices: number[][][]): HvaFile {
  const sections = matrices.length, frames = matrices[0]!.length;
  const bytes = new Uint8Array(24 + (16 + 48 * frames) * sections), dv = new DataView(bytes.buffer);
  dv.setInt32(16, frames, true);
  dv.setInt32(20, sections, true);
  for (let s = 0; s < sections; s++) bytes.set(new TextEncoder().encode(`S${s}`), 24 + 16 * s);
  for (let f = 0; f < frames; f++) for (let s = 0; s < sections; s++) {
    matrices[s]![f]!.forEach((v, k) => dv.setFloat32(24 + 16 * sections + (f * sections + s) * 48 + 4 * k, v, true));
  }
  return HvaFile.parse(bytes);
}

/** A 2×2×2 grid with bounds one unit per step, voxels in the remap ramp and out of it. */
function section(over: Partial<VxlSection> = {}): VxlSection {
  return {
    index: 0, name: 'S0', cx: 2, cy: 2, cz: 2, scale: 1 / 12, transform: IDENTITY, normalsMode: 4,
    minBounds: [-1, -1, 0], maxBounds: [1, 1, 2],
    voxels: [{ x: 0, y: 0, z: 0, color: 20, normal: 0 }, { x: 1, y: 0, z: 0, color: 100, normal: 10 }, { x: 1, y: 1, z: 1, color: 150, normal: 50 }],
    ...over,
  };
}
const model = (...sections: VxlSection[]) => ({ sections }) as unknown as VxlFile;
const palette = Palette.parse(new Uint8Array(768).map((_, i) => i % 64));
const render = (vxl: VxlFile, h = hva([[IDENTITY]]), pivot?: [number, number, number]) =>
  renderVoxelToSprite('t', vxl, h, palette, { facingCount: 8, ...(pivot ? { pivot } : {}) });

describe('HVA reader', () => {
  it('reads the matrices frame by frame', () => {
    const file = hva([0, 1, 2].map((s) => [0, 1].map((f) => [1, 0, 0, 10 * s + f, 0, 1, 0, 0, 0, 0, 1, 0])));
    for (let s = 0; s < 3; s++) for (let f = 0; f < 2; f++) expect(file.matrix(s, f)[3]).toBe(10 * s + f);
  });
});

describe('voxel renderer units', () => {
  it('sizes a model by its bounds: the tailer scale does not change the render', () => {
    expect(render(model(section({ scale: 0.8 })))).toEqual(render(model(section())));
    expect(deriveModelScale([section({ minBounds: [-20, -10, 0], maxBounds: [25, 10, 12] })], 54)).toBe(54 / 90);
  });

  it('takes HVA translation times the tailer scale as bounds units', () => {
    const moved = hva([[[1, 0, 0, 4, 0, 1, 0, 0, 0, 0, 1, 0]]]); // 4 × 0.25 = one bounds unit along x
    const viaHva = render(model(section({ scale: 0.25 })), moved, [0, 0, 0]);
    const viaBounds = render(model(section({ minBounds: [0, -1, 0], maxBounds: [2, 1, 2] })), undefined, [0, 0, 0]);
    expect(viaHva).toEqual(viaBounds);
  });

  it('ignores the section tailer transform (HVA frame 0 carries it)', () => {
    expect(render(model(section({ transform: [0, -1, 0, 50, 1, 0, 0, 20, 0, 0, 1, 30] })))).toEqual(render(model(section())));
  });

  it('turns about the pivot, which the sprite origin marks', () => {
    // One voxel at bounds (10, 0, 0), drawn at 1 px per bounds unit.
    const voxel = section({ cx: 1, cy: 1, cz: 1, minBounds: [9.5, -0.5, -0.5], maxBounds: [10.5, 0.5, 0.5], voxels: [{ x: 0, y: 0, z: 0, color: 100, normal: 0 }] });
    const centroid = (s: ConvertedSprite, i: number) => {
      const f = s.frames[i]!;
      let n = 0, x = 0, y = 0;
      for (let py = 0; py < f.h; py++) for (let px = 0; px < f.w; px++) {
        const a = s.colorRgba[((f.y + py) * s.atlasWidth + f.x + px) * 4 + 3]!;
        n += a; x += a * (px + 0.5); y += a * (py + 0.5);
      }
      return [x / n, y / n];
    };
    const opts = { facingCount: 8, footprintPx: 2 };
    const about0 = renderVoxelToSprite('t', model(voxel), hva([[IDENTITY]]), palette, { ...opts, pivot: [0, 0, 0] });
    const aboutItself = renderVoxelToSprite('t', model(voxel), hva([[IDENTITY]]), palette, opts);
    for (let i = 0; i < 8; i++) {
      const a = facingAngle(i), p = projectModelPoint(10 * Math.cos(a), 10 * Math.sin(a), 0);
      const [x, y] = centroid(about0, i);
      expect(Math.abs(x! - about0.origin![0] - p.sx)).toBeLessThan(1);
      expect(Math.abs(y! - about0.origin![1] - p.sy)).toBeLessThan(1);
      const [x2, y2] = centroid(aboutItself, i);
      expect(Math.hypot(x2! - aboutItself.origin![0], y2! - aboutItself.origin![1])).toBeLessThan(1);
    }
  });
});

describeInstall('voxel renderer on the install', () => {
  let vfs: Vfs;
  beforeAll(async () => { vfs = await mountTheater(readFromDir, 'temperate'); }, 30_000);

  it('reads yaggun.hva frame by frame: frame 0 matches each section\'s tailer', () => {
    const vxl = VxlFile.parse(vfs.openFile('yaggun.vxl')!), file = HvaFile.parse(vfs.openFile('yaggun.hva')!);
    expect(file.frameCount).toBe(2);
    for (const s of vxl.sections) {
      for (const k of [3, 7, 11]) expect(file.matrix(s.index, 0)[k]! * s.scale).toBeCloseTo(s.transform[k]!, 3);
    }
  });

  // Measured with the renderer before #74 (grid units, section-scale sized): size, origin, opaque pixels over
  // all 32 facings, and the turret pivot. Bounds units change these by a fraction of a voxel at most.
  const before: Record<string, { w: number; h: number; origin?: [number, number]; opaque: number; pivot?: [number, number, number] }> = {
    htnk: { w: 47, h: 32, origin: [22.68, 15.06], opaque: 26722 },
    htnktur: { w: 55, h: 31, origin: [26.59, 12.52], opaque: 10245, pivot: [-3.41, 0.12, 6.28] },
    ttnk: { w: 45, h: 33, origin: [21.51, 15.13], opaque: 25274 },
    ttnktur: { w: 29, h: 21, origin: [13.68, 9.52], opaque: 10362, pivot: [1.38, -0.01, 5.57] },
    // The V3's HVA lowers it 16.6 units, which the old renderer applied 12× too far: its origin was [11.13, 1.86].
    v3rocket: { w: 24, h: 19, origin: [10.5, 7.43], opaque: 3354 },
    dmisl: { w: 24, h: 21, origin: [10.82, 9.27], opaque: 4110 },
  };

  it('draws the Rhino, Tesla tank and rockets as before', () => {
    const opaque = (s: ConvertedSprite) => s.colorRgba.filter((v, i) => i % 4 === 3 && v > 0).length;
    const sprites: Record<string, [ConvertedSprite, (readonly number[])?]> = {};
    for (const unit of ['htnk', 'ttnk']) {
      const { body, turret } = prerenderTank(vfs, 'temperate', unit);
      sprites[unit] = [body];
      sprites[`${unit}tur`] = [turret.sprite, turret.pivot];
    }
    for (const r of ['v3rocket', 'dmisl'] as const) sprites[r] = [prerenderRocket(vfs, 'temperate', r)];
    for (const [name, [s, pivot]] of Object.entries(sprites)) {
      const was = before[name]!;
      expect(s.frames, name).toHaveLength(32);
      expect(Math.abs(s.spriteWidth - was.w), name).toBeLessThanOrEqual(2);
      expect(Math.abs(s.spriteHeight - was.h), name).toBeLessThanOrEqual(2);
      if (was.origin) for (const i of [0, 1]) expect(Math.abs(s.origin![i]! - was.origin[i]!), name).toBeLessThan(1);
      expect(Math.abs(opaque(s) / was.opaque - 1), name).toBeLessThan(0.03);
      if (was.pivot) for (const i of [0, 1, 2]) expect(Math.abs(pivot![i]! - was.pivot[i]!), name).toBeLessThan(0.3);
    }
  }, 30_000);
});
