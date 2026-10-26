import { describe, expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { MixFile } from '../ra2/index.js';
import { importBattlefield } from './import.js';

describeInstall('importBattlefield on the install', () => {
  it.each([['amazon.mmx', 'TEMPERATE'], ['Arena.mmx', 'URBAN'], ['Break.mmx', 'SNOW'], ['HighExpR.yro', 'DESERT'], ['IrvineCa.yro', 'NEWURBAN'], ['MoonPatr.yro', 'LUNAR']])('imports every art layer of %s', async (path, theater) => {
    const battlefield = await importBattlefield(readFromDir, path!);
    expect(battlefield.theater).toBe(theater);
    expect(battlefield.terrain.missing).toBe(0);
    expect(battlefield.images.length).toBeGreaterThan(0);
  }, 30_000);

  it('passes the support rule for a Westwood map and finds its bridges', async () => {
    const battlefield = await importBattlefield(readFromDir, 'Hills.mmx');
    const { grid } = battlefield;
    // Hills has one wooden high bridge (BRIDGEB1/2, overlay 237/238 by [OverlayTypes] position).
    expect(grid.bridges.map((b) => b.kind)).toContain('high');
    const deck = grid.bridges.find((b) => b.kind === 'high')!.cells[0]!;
    expect(grid.deck[deck]).toBe(grid.level[deck]! + 4);
    expect(grid.blocked.some(Boolean)).toBe(true);
    expect(battlefield.objects.length).toBeGreaterThan(0);
  }, 30_000);
  it('refuses an invalid tile index instead of silently drawing clear ground', async () => {
    // One LZO literal cell at (1,1), tile 999999, sub-tile 0, height 0.
    const pack = Buffer.from([15, 0, 11, 0, 28, 1, 0, 1, 0, 63, 66, 15, 0, 0, 0, 0, 17, 0, 0]).toString('base64');
    const text = `[Map]\nTheater=TEMPERATE\n[IsoMapPack5]\n1=${pack}\n`;
    const read = (path: string) => path === 'invalid.map' ? Promise.resolve(new TextEncoder().encode(text)) : readFromDir(path);
    const reason = await importBattlefield(read, 'invalid.map').then(() => 'accepted', (error: Error) => error.message);
    expect(reason).toMatch(/cells have no tile art/);
  }, 30_000);

  it('honours map Image overrides and refuses missing art in its theater', async () => {
    const source = MixFile.parse(await readFromDir('Hills.mmx')).read('hills.map')!;
    const text = new TextDecoder().decode(source) + '\n[TerrainTypes]\n999=TESTTREE\n[Terrain]\n100100=TESTTREE\n[TESTTREE]\nImage=MISSING_TEST_ART\n';
    const read = (path: string) => path === 'custom.map' ? Promise.resolve(new TextEncoder().encode(text)) : readFromDir(path);
    await expect(importBattlefield(read, 'custom.map')).rejects.toThrow(/no art in TEMPERATE for.*TESTTREE/);
  }, 30_000);

  it('warns when dropping units and gameplay overrides including SpecialFlags', async () => {
    const source = MixFile.parse(await readFromDir('Hills.mmx')).read('hills.map')!;
    const text = new TextDecoder().decode(source) + '\n[Units]\n999=Neutral,HTNK,256,100,100,0,Guard,none,0,-1,0,-1,1,0\n[SpecialFlags]\nDestroyableBridges=no\n[General]\nCliffBackImpassability=0\n';
    const read = (path: string) => path === 'custom.map' ? Promise.resolve(new TextEncoder().encode(text)) : readFromDir(path);
    const result = await importBattlefield(read, 'custom.map');
    expect(result.warnings.join(';')).toMatch(/dropped .*units/);
    expect(result.warnings.join(';')).toContain('SpecialFlags');
    expect(result.warnings.join(';')).toContain('General');
    expect(result.grid.bridges.length).toBeGreaterThan(0);
  }, 30_000);

});

describe('importBattlefield', () => {
  it('refuses a map with an unknown theater', async () => {
    const read = async () => new TextEncoder().encode('[Map]\nTheater=MARS\n');
    await expect(importBattlefield(read, 'mars.map')).rejects.toThrow(/Unknown theater: MARS/);
  });
});
