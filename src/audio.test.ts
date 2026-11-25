import { expect, it, vi } from 'vitest';
import { readFromDir } from '../test/install.js';
import { loadSounds } from './audio.js';
import type { ReadFile } from './ra2/mount.js';

it.skipIf(!process.env.RA2_DIR)('plays stock cues with duplicate, Limit, mute and volume controls; a second load reads no audio', async () => {
  const stopped: number[] = [], sources: { buffer: { length: number; sampleRate: number } | undefined }[] = [];
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
    createBufferSource() { const source = { buffer: undefined, onended: undefined, connect: () => ({ connect() {} }), start: () => { started++; }, stop: (when: number) => { stopped.push(when); } }; sources.push(source); return source; }
    resume() { return Promise.resolve(); }
  }
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('DynamicsCompressorNode', class { connect() { return {}; } });
  try {
    const map = new Map<string, unknown>();
    const store = { get: async (k: string) => map.get(k), set: async (k: string, v: unknown) => void map.set(k, v), keys: async () => [...map.keys()], delete: async (k: string) => void map.delete(k) };
    const audioReads: string[] = [];
    const read: ReadFile = (path, ...range) => {
      if (/^lang/.test(path)) audioReads.push(path);
      return readFromDir(path, ...range);
    };
    await loadSounds(read, store);
    expect(audioReads).toContain('language.mix');
    audioReads.length = 0;
    master = undefined;
    storage.set('rhino-volume', '0.5');
    const sound = await loadSounds(read, store);
    expect(audioReads).toEqual([]);
    expect(master!.gain.value).toBe(0.5); // the remembered volume
    sound.play('ready');
    sound.play('ready');
    expect(started).toBe(1);
    expect(last!.gain.value).toBe(0.85); // GenSovVehicleSelect Volume=85 is a percentage
    for (let n = 0; n < 4; n++) { context!.currentTime += 0.11; sound.play('cannon'); }
    expect(started).toBe(4); // RhinoTankAttack Limit=3
    for (const cue of ['nukeDetected', 'nukeReady', 'nukeLaunch', 'nukeSiren', 'nukeExplosion']) sound.play(cue);
    expect(started).toBe(9);
    expect(stopped).toEqual([context!.currentTime + 2.1]); // the siren is cut as the nuke lands
    for (const cue of ['kirovCreated', 'kirovAttack']) sound.play(cue);
    expect(started).toBe(11);
    const seconds = (n: number) => +(sources.at(n)!.buffer!.length / sources.at(n)!.buffer!.sampleRate).toFixed(2);
    expect(seconds(-2)).toBe(1.52); // vkirsea, "Kirov reporting" (KirovCreated)
    const voices = new Set<number>();
    for (let n = 0; n < 200; n++) { context!.currentTime += 0.11; sound.play('desolatorVoice'); voices.add(seconds(-1)); }
    expect(voices.size).toBe(16); // DesolatorSelect ×5, DesolatorAttackCommand ×6, DesolatorMove ×5
    sound.play('desolatorDeploy');
    expect(started).toBe(212);
    expect(sound.mute()).toEqual({ gain: 0.5, muted: true });
    expect(master!.gain.value).toBe(0);
    expect(storage.get('rhino-mute')).toBe('1');
    expect(sound.mute()).toEqual({ gain: 0.5, muted: false });
    expect(master!.gain.value).toBe(0.5); // unmuting returns to the chosen volume
    expect(sound.volume(-0.1)).toEqual({ gain: 0.4, muted: false });
    expect(master!.gain.value).toBe(0.4);
    expect(storage.get('rhino-volume')).toBe('0.4');
    sound.mute();
    expect(sound.volume(0.1)).toEqual({ gain: 0.5, muted: false }); // changing the volume unmutes
    expect(master!.gain.value).toBe(0.5);
    expect(storage.get('rhino-mute')).toBe('0');
    for (let n = 0; n < 8; n++) sound.volume(0.1);
    expect(sound.volume(0.1).gain).toBe(1);
    for (let n = 0; n < 12; n++) sound.volume(-0.1);
    expect(sound.volume(-0.1).gain).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});
