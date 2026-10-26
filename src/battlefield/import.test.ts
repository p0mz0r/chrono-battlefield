import { describe, expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { importBattlefield } from './import.js';

describeInstall('importBattlefield on the install', () => {
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
});

describe('importBattlefield', () => {
  it('refuses a map with an unknown theater', async () => {
    const read = async () => new TextEncoder().encode('[Map]\nTheater=MARS\n');
    await expect(importBattlefield(read, 'mars.map')).rejects.toThrow(/Unknown theater: MARS/);
  });
});
