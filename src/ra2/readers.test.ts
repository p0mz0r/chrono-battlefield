// One small test per reader against the real install (ADR 0003). Expected values come from
// the install itself, checked by hand with the #5 prototype (chrono-notes/env.md) and the research docs.
import { beforeAll, expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { AudioBank, HvaFile, IniFile, MixFile, Palette, ShpFile, TmpFile, type Vfs, VxlFile } from './index.js';
import { loadMap, mountTheater, readNested } from './mount.js';

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

  it('MIX: reads the headerless audio MIXes nested in language.mix and langmd.mix', async () => {
    // Sizes from the #26 correction comment, in decimal bytes.
    const ra2 = MixFile.parse(await readNested(readFromDir, 'language.mix', ['audio.mix']));
    const yr = MixFile.parse(await readNested(readFromDir, 'langmd.mix', ['audiomd.mix']));
    expect([ra2.count, yr.count]).toEqual([461, 740]);
    expect(ra2.getEntry('audio.bag')!.size).toBe(17643176);
    expect(ra2.getEntry('audio.idx')!.size).toBe(41520);
    expect(yr.getEntry('audio.bag')!.size).toBe(37625632);
    expect(yr.getEntry('audio.idx')!.size).toBe(82272);
    const bank = AudioBank.parse(ra2.read('audio.idx')!, ra2.read('audio.bag')!);
    expect(bank.count).toBe(1153);
    const sample = bank.decode('vrhiatta')!;
    expect(sample.sampleRate).toBe(22050);
    expect(sample.samples.length).toBeGreaterThan(1000);
    expect(sample.samples.some(value => Math.abs(value) > 100)).toBe(true);
    // The join voice line: block boundaries must be no rougher than the signal (a zeroed
    // block state clicked there at ~9× the average step, heard as crackle).
    const yrBank = AudioBank.parse(yr.read('audio.idx')!, yr.read('audio.bag')!), entry = yrBank.entry('vgrssea')!;
    const voice = yrBank.decode('vgrssea')!.samples, body = yr.read('audio.bag')!.subarray(entry.offset, entry.offset + entry.size);
    const perBlock = (512 - 4) * 2 + 1;
    for (let k = 0; k * 512 < body.length; k++) expect(voice[k * perBlock]).toBe((body[k * 512]! | body[k * 512 + 1]! << 8) << 16 >> 16);
    let boundary = 0, blocks = 0, step = 0;
    for (let i = perBlock; i < voice.length; i += perBlock) { boundary += Math.abs(voice[i]! - voice[i - 1]!); blocks++; }
    for (let i = 1; i < voice.length; i++) step += Math.abs(voice[i]! - voice[i - 1]!);
    expect(boundary / blocks).toBeLessThan(3 * step / voice.length);
    const pcm = bank.decode('icraloop')!;
    expect(pcm.samples.length).toBe(bank.entry('icraloop')!.size / 2);
    expect(pcm.samples.some(value => value !== 0)).toBe(true);
  });

  it('audio: resolves the selected stock cues in the INIs and banks', async () => {
    const base = MixFile.parse(await readNested(readFromDir, 'language.mix', ['audio.mix']));
    const yr = MixFile.parse(await readNested(readFromDir, 'langmd.mix', ['audiomd.mix']));
    const banks = [yr, base].map(mix => AudioBank.parse(mix.read('audio.idx')!, mix.read('audio.bag')!));
    const inis = [IniFile.parse(await readNested(readFromDir, 'expandmd01.mix', ['soundmd.ini'])), IniFile.parse(await readNested(readFromDir, 'ra2.mix', ['local.mix', 'sound.ini']))];
    for (const event of ['GenSovVehicleSelect', 'RhinoTankAttack', 'Explosion06', 'V3Attack', 'Explosion12', 'DreadnoughtAttack', 'TeslaCoilPowerUp', 'TeslaTankAttack', 'ChronosphereMove', 'Explosion11', 'BridgeRepaired', 'CrateSpeed', 'ForceShieldStarting']) {
      const sample = inis.map(ini => ini.getSection(event)).find(Boolean)?.getString('Sounds').split(/\s+/)[0]?.replace(/^\$/, '');
      expect(sample, event).toBeTruthy();
      expect(banks.some(bank => bank.has(sample!)), event + ': ' + sample).toBe(true);
    }
  });
});
