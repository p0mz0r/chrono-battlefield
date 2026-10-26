// One small test per reader against the real install (ADR 0003). Expected values come from
// the install itself, checked by hand with the #5 prototype (chrono-notes/env.md) and the research docs.
import { beforeAll, expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { HvaFile, IniFile, MixFile, Palette, ShpFile, TmpFile, type Vfs, VxlFile } from './index.js';
import { loadMap, mountTheater } from './mount.js';

describeInstall('RA2 readers', () => {
  let vfs: Vfs;
  const open = (name: string) => {
    const bytes = vfs.openFile(name);
    if (!bytes) throw new Error(`not in VFS: ${name}`);
    return bytes;
  };
  beforeAll(async () => {
    vfs = await mountTheater(readFromDir, 'temperate');
  }, 30_000);

  it('MIX: lists the top-level archive and nested YR theater MIXes', async () => {
    const ra2md = MixFile.parse(await readFromDir('ra2md.mix'));
    expect(ra2md.count).toBe(25);
    expect(ra2md.getEntry('isodes.mix')).toBeDefined();
    expect(vfs.openFile('rulesmd.ini')?.length).toBe(743_215);
  });

  it('INI: reads [OverlayTypes] in order', () => {
    const rules = IniFile.parse(open('rulesmd.ini'));
    const overlays = rules.readRegistry('OverlayTypes');
    expect(overlays[0]).toBe('GASAND');
    expect(overlays[24]).toBe('BRIDGE1');
  });

  it('map: opens a Westwood package and decodes its tiles', async () => {
    const map = await loadMap(readFromDir, 'Hills.mmx');
    expect(map.theater.toUpperCase()).toBe('TEMPERATE');
    expect(map.tiles.length).toBeGreaterThan(1000);
    expect(map.overlay.length).toBe(512 * 512);
  });

  it('TMP: decodes a 60×30 terrain tile', () => {
    const tmp = TmpFile.parse(open('clat12.tem'));
    expect(tmp.getTile(0)!.bitmap.length).toBe(60 * 30);
  });

  it('SHP: decodes a building frame', () => {
    const shp = ShpFile.parse(open('ggcnst.shp'));
    expect(shp.count).toBeGreaterThan(0);
    const f = shp.frame(0);
    expect(f.pixels.length).toBe(f.cx * f.cy);
  });

  it('VXL/HVA: reads the Rhino hull and its animation', () => {
    expect(open('htnk.vxl').length).toBe(34_550);
    const vxl = VxlFile.parse(open('htnk.vxl'));
    const hva = HvaFile.parse(open('htnk.hva'));
    expect(vxl.sectionCount).toBeGreaterThan(0);
    expect(hva.matrix(0, 0)).toHaveLength(12);
  });

  it('PAL: expands the temperate tile palette to 256 colours', () => {
    const pal = Palette.parse(open('isotem.pal'));
    expect(pal.length).toBe(256);
  });
});
