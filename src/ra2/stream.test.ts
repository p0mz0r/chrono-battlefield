import { expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import { MixFile } from './mix/mixFile.js';

describeInstall('MIX index reads', () => {
  it('opens the encrypted index without retaining the archive body', async () => {
    const bytes = await readFromDir('ra2md.mix');
    const size = MixFile.indexSize(bytes.subarray(0, 92));
    const index = MixFile.parseIndex(bytes.subarray(0, size));
    expect(index.count).toBe(25);
    expect(index.getEntry('isodes.mix')).toEqual(MixFile.parse(bytes).getEntry('isodes.mix'));
    expect(index.buffer.byteLength).toBeLessThan(1024);
  });
});
