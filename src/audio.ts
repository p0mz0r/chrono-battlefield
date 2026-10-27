import { AudioBank, IniFile } from './ra2/index.js';
import { locateNested, readNested, type ReadFile } from './ra2/mount.js';

// Stock sound events. The Rhino ready sample is a voice, not an EVA announcement.
const EVENTS = {
  ready: 'GenSovVehicleSelect', cannon: 'RhinoTankAttack', hit: 'Explosion06',
  v3Launch: 'V3Attack', v3Impact: 'Explosion12',
  missileLaunch: 'DreadnoughtAttack', missileImpact: 'Explosion06',
  teslaCharge: 'TeslaCoilPowerUp', teslaStrike: 'TeslaTankAttack',
  chrono: 'ChronosphereMove', bridgeCollapse: 'Explosion11', bridgeRepair: 'BridgeRepaired',
  boost: 'CrateSpeed', shield: 'ForceShieldStarting',
} as const;

type Cue = keyof typeof EVENTS;
type Sound = { buffer: AudioBuffer; limit: number; volume: number };

export async function loadSounds(read: ReadFile): Promise<{ play(cue: string): void; mute(): void }> {
  const [baseIni, yrIni] = await Promise.all([
    readNested(read, 'ra2.mix', ['local.mix', 'sound.ini']), readNested(read, 'expandmd01.mix', ['soundmd.ini']),
  ]);
  const banks = await Promise.all([
    { path: 'langmd.mix', nested: 'audiomd.mix' }, { path: 'language.mix', nested: 'audio.mix' },
  ].map(async ({ path, nested }) => {
    const [idx, bag] = await Promise.all([
      readNested(read, path, [nested, 'audio.idx']), locateNested(read, path, [nested, 'audio.bag']),
    ]);
    return { path, bag, bank: AudioBank.parseIndex(idx, bag.size) };
  }));
  const context = new AudioContext();
  const master = context.createGain();
  let muted = localStorage.getItem('rhino-mute') === '1';
  master.gain.value = muted ? 0 : 1;
  master.connect(context.destination);
  const ini = [IniFile.parse(yrIni), IniFile.parse(baseIni)];
  const loaded = new Map<Cue, Sound>();
  const selections = (Object.entries(EVENTS) as [Cue, string][]).map(([cue, event]) => {
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
      const decoded = source.bank.decode(name, bodies[i]!)!;
      const buffer = context.createBuffer(1, decoded.samples.length, decoded.sampleRate);
      buffer.copyToChannel(Float32Array.from(decoded.samples, sample => sample / 32768), 0);
      const limit = section.getInt('Limit');
      loaded.set(cue, { buffer, limit: limit > 0 ? limit : Infinity, volume: Number(section.getString('Volume', '1')) });
    });
  }
  const active = new Map<Cue, number>();
  const last = new Map<Cue, number>();
  return {
    play(value) {
      if (!(value in EVENTS)) return;
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
