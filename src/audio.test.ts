import { expect, it, vi } from 'vitest';
import { readFromDir } from '../test/install.js';
import { loadSounds } from './audio.js';
import type { ReadFile } from './ra2/mount.js';

it.skipIf(!process.env.RA2_DIR)('plays stock cues with duplicate, Limit and mute controls; a second load reads no audio', async () => {
  const stopped: number[] = [], sources: { buffer: { length: number; sampleRate: number } | undefined; loop: boolean }[] = [];
  let started = 0, master: { gain: { value: number } } | undefined, last: { gain: { value: number } } | undefined;
  let context: Context;
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) });
  class Context {
    constructor() { context = this; }
    currentTime = 0;
    destination = {};
    createGain() { const gain = { gain: { value: 1 }, connect: (node: unknown) => node }; master ??= gain; last = gain; return gain; }
    createBuffer(_channels: number, length: number, sampleRate: number) { return { length, sampleRate, copyToChannel() {} }; }
    createBufferSource() { const source = { buffer: undefined, loop: false, onended: undefined, connect: () => ({ connect() {} }), start: () => { started++; }, stop: (when: number) => { stopped.push(when); } }; sources.push(source); return source; }
    resume() { return Promise.resolve(); }
  }
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('DynamicsCompressorNode', class { connect() { return {}; } });
  try {
    const map = new Map<string, unknown>();
    const store = { get: async (k: string) => map.get(k), set: async (k: string, v: unknown) => void map.set(k, v), keys: async () => [...map.keys()], delete: async (k: string) => void map.delete(k) };
    const audioReads: string[] = [];
    const read: ReadFile = (path, ...range) => (/^lang/.test(path) && audioReads.push(path), readFromDir(path, ...range));
    await loadSounds(read, store);
    expect(audioReads).toContain('language.mix');
    audioReads.length = 0;
    master = undefined;
    const sound = await loadSounds(read, store);
    expect(audioReads).toEqual([]);
    sound.play('ready');
    sound.play('ready');
    expect(started).toBe(1);
    expect(last!.gain.value).toBe(0.85); // GenSovVehicleSelect Volume=85 is a percentage
    for (let n = 0; n < 4; n++) { context!.currentTime += 0.11; sound.play('cannon'); }
    expect(started).toBe(4); // RhinoTankAttack Limit=3
    for (const cue of ['nukeDetected', 'nukeReady', 'nukeLaunch', 'nukeSiren', 'nukeExplosion']) sound.play(cue);
    expect(started).toBe(9);
    expect(stopped).toEqual([context!.currentTime + 2.1]); // the siren is cut as the nuke lands
    for (const cue of ['kirovCreated', 'kirovDrone', 'kirovAttack']) sound.play(cue);
    expect(started).toBe(12);
    const seconds = (n: number) => +(sources.at(n)!.buffer!.length / sources.at(n)!.buffer!.sampleRate).toFixed(2);
    expect(seconds(-3)).toBe(1.52); // vkirsea, "Kirov reporting" (KirovCreated)
    expect([seconds(-2), sources.at(-2)!.loop]).toEqual([0.89, true]); // vkirlo2a, the drone's loop body, not its 0.36 s start
    expect(stopped.at(-1)).toBe(context!.currentTime + 6); // the drone stops as the Kirov lands
    sound.mute();
    expect(master!.gain.value).toBe(0);
    expect(storage.get('rhino-mute')).toBe('1');
  } finally { vi.unstubAllGlobals(); }
});
