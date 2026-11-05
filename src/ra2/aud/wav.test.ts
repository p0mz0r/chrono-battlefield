import { expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../../test/install.js';
import { readNested } from '../mount.js';
import { decodeWav } from './wav.js';

describeInstall('EVA WAV reader', () => {
  it('decodes the nuclear announcements to mono PCM and trims block padding using fact', async () => {
    for (const [name, length] of [['ceva001', 49407], ['ceva003', 27037], ['ceva002', 49381]] as const) {
      const bytes = await readNested(readFromDir, 'langmd.mix', ['audiomd.mix', `${name}.wav`]);
      const sound = decodeWav(bytes);
      expect(sound.channels).toBe(1);
      expect(sound.sampleRate).toBe(22050);
      expect(sound.samples).toHaveLength(length);
      expect(sound.samples.some(value => Math.abs(value) > 100)).toBe(true);
      if (name === 'ceva001') expect([...sound.samples.subarray(0, 3)]).toEqual([-66, -70, -59]);
      expect(() => decodeWav(bytes.subarray(0, bytes.length - 1))).toThrow(/WAV/);
    }
  });
});
