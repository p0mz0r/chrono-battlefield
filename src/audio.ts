import { cachedImport, importStore, type Store } from './install/cache.js';
import { AudioBank, decodeWav, IniFile } from './ra2/index.js';
import { locateNested, readNested, type ReadFile } from './ra2/mount.js';

// Stock sound events. The Rhino ready sample is a voice, not an EVA announcement.
const EVENTS = {
  ready: 'GenSovVehicleSelect', cannon: 'RhinoTankAttack', hit: 'Explosion06',
  v3Launch: 'V3Attack', v3Impact: 'Explosion12',
  missileLaunch: 'DreadnoughtAttack', missileImpact: 'Explosion06',
  teslaCharge: 'TeslaCoilPowerUp', teslaStrike: 'TeslaTankAttack',
  chrono: 'ChronosphereMove', chronoSelect: 'ChronosphereSelect', bridgeCollapse: 'Explosion11', bridgeRepair: 'BridgeRepaired',
  boost: 'CrateSpeed', shield: 'ForceShieldStarting',
} as const;

const EVA_EVENTS = {
  nukeDetected: 'EVA_NuclearSiloDetected', nukeReady: 'EVA_NuclearMissileReady', nukeLaunch: 'EVA_NuclearMissileLaunched',
} as const;

type Cue = keyof typeof EVENTS | keyof typeof EVA_EVENTS;
type Sound = { buffer: AudioBuffer; limit: number; volume: number };
type Decoded = { samples: Int16Array; sampleRate: number; limit: number; volume: number };

/** Each cue's PCM and INI settings, read from the install. */
async function decodeSounds(read: ReadFile): Promise<Record<Cue, Decoded>> {
  const [baseIni, yrIni, evaIni] = await Promise.all([
    readNested(read, 'ra2.mix', ['local.mix', 'sound.ini']), readNested(read, 'expandmd01.mix', ['soundmd.ini']),
    readNested(read, 'ra2md.mix', ['localmd.mix', 'evamd.ini']),
  ]);
  const banks = await Promise.all([
    { path: 'langmd.mix', nested: 'audiomd.mix' }, { path: 'language.mix', nested: 'audio.mix' },
  ].map(async ({ path, nested }) => {
    const [idx, bag] = await Promise.all([
      readNested(read, path, [nested, 'audio.idx']), locateNested(read, path, [nested, 'audio.bag']),
    ]);
    return { path, bag, bank: AudioBank.parseIndex(idx, bag.size) };
  }));
  const ini = [IniFile.parse(yrIni), IniFile.parse(baseIni)];
  const decoded = {} as Record<Cue, Decoded>;
  const selections = (Object.entries(EVENTS) as [keyof typeof EVENTS, string][]).map(([cue, event]) => {
    const section = ini.map(file => file.getSection(event)).find(Boolean);
    const name = section?.getString('Sounds').split(/\s+/)[0]?.replace(/^\$/, '').toLowerCase();
    if (!name) throw new Error(`Missing sound event ${event}`);
    const source = banks.find(({ bank }) => bank.has(name));
    if (!source) throw new Error(`Missing sound sample ${name} for ${event}`);
    const entry = source.bank.entry(name)!;
    return { cue, section: section!, name, source, entry };
  });
  for (const source of banks) {
    const chosen = selections.filter(selection => selection.source === source);
    if (!chosen.length) continue;
    const ranges = chosen.map(({ entry }) => ({ offset: source.bag.offset + entry.offset, length: entry.size }));
    const bodies = read.ranges ? await read.ranges(source.path, ranges) : await Promise.all(ranges.map(range => read(source.path, range.offset, range.length)));
    chosen.forEach(({ cue, section, name }, i) => {
      const { samples, sampleRate } = source.bank.decode(name, bodies[i]!)!;
      const limit = section.getInt('Limit');
      decoded[cue] = { samples, sampleRate, limit: limit > 0 ? limit : Infinity, volume: Number(section.getString('Volume', '100')) / 100 };
    });
  }
  const eva = IniFile.parse(evaIni);
  await Promise.all((Object.entries(EVA_EVENTS) as [keyof typeof EVA_EVENTS, string][]).map(async ([cue, event]) => {
    const name = eva.getSection(event)?.getString('Allied');
    if (!name) throw new Error(`Missing EVA announcement ${event}`);
    const { samples, sampleRate } = decodeWav(await readNested(read, 'langmd.mix', ['audiomd.mix', `${name}.wav`]));
    decoded[cue] = { samples, sampleRate, limit: 1, volume: 1 };
  }));
  return decoded;
}

/** Plays the stock cues. Decoded sounds are cached with the course import, so a hit reads no audio from the install. */
export async function loadSounds(read: ReadFile, store: Store = importStore): Promise<{ play(cue: string): void; mute(): void }> {
  const decoded = await cachedImport(store, read, 'sounds', () => decodeSounds(read));
  const context = new AudioContext();
  const master = context.createGain();
  let muted = localStorage.getItem('rhino-mute') === '1';
  master.gain.value = muted ? 0 : 1;
  // Limiter: overlapping cues at full stock volume would clip the OBS mixer channel.
  const limiter = new DynamicsCompressorNode(context, { threshold: -6, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });
  master.connect(limiter).connect(context.destination);
  const loaded = new Map<Cue, Sound>();
  for (const [cue, { samples, sampleRate, limit, volume }] of Object.entries(decoded) as [Cue, Decoded][]) {
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(Float32Array.from(samples, sample => sample / 32768), 0);
    loaded.set(cue, { buffer, limit, volume });
  }
  const active = new Map<Cue, number>();
  const last = new Map<Cue, number>();
  return {
    play(value) {
      if (!loaded.has(value as Cue)) return;
      const cue = value as Cue, sound = loaded.get(cue)!;
      const now = context.currentTime;
      if (now - (last.get(cue) ?? -1) < 0.1 || (active.get(cue) ?? 0) >= sound.limit) return;
      last.set(cue, now);
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = sound.buffer;
      gain.gain.value = sound.volume;
      source.connect(gain).connect(master);
      active.set(cue, (active.get(cue) ?? 0) + 1);
      source.onended = () => active.set(cue, (active.get(cue) ?? 1) - 1);
      source.start();
      void context.resume();
    },
    mute() { muted = !muted; master.gain.value = muted ? 0 : 1; localStorage.setItem('rhino-mute', muted ? '1' : '0'); },
  };
}
