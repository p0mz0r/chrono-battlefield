import { expect, it, vi } from 'vitest';
import { readFromDir } from '../test/install.js';
import { loadSounds } from './audio.js';

it.skipIf(!process.env.RA2_DIR)('plays stock cues with duplicate, Limit and mute controls', async () => {
  let started = 0, master: { gain: { value: number } } | undefined, last: { gain: { value: number } } | undefined;
  let context: Context;
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) });
  class Context {
    constructor() { context = this; }
    currentTime = 0;
    destination = {};
    createGain() { const gain = { gain: { value: 1 }, connect: () => this.destination }; master ??= gain; last = gain; return gain; }
    createBuffer(_channels: number, length: number, sampleRate: number) { return { length, sampleRate, copyToChannel() {} }; }
    createBufferSource() { return { buffer: undefined, onended: undefined, connect: () => ({ connect() {} }), start: () => { started++; } }; }
    resume() { return Promise.resolve(); }
  }
  vi.stubGlobal('AudioContext', Context);
  try {
    const sound = await loadSounds(readFromDir);
    sound.play('ready');
    sound.play('ready');
    expect(started).toBe(1);
    expect(last!.gain.value).toBe(0.85); // GenSovVehicleSelect Volume=85 is a percentage
    for (let n = 0; n < 4; n++) { context!.currentTime += 0.11; sound.play('cannon'); }
    expect(started).toBe(4); // RhinoTankAttack Limit=3
    sound.mute();
    expect(master!.gain.value).toBe(0);
    expect(storage.get('rhino-mute')).toBe('1');
  } finally { vi.unstubAllGlobals(); }
});
