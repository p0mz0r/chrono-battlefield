import { MapFile, Vfs } from './index.js';

/** Reads one install file by its path inside the install folder. The app passes `readInstall`; tests read `RA2_DIR`. */
export type ReadFile = (path: string) => Promise<Uint8Array>;

// Never cncnet.mix or ra2mode.mix: CnCNet's client files change the stock rules.
const TOP_MIXES = ['ra2.mix', 'ra2md.mix', 'expandmd01.mix'] as const;

const COMMON: Record<string, string[]> = {
  'ra2.mix': ['local', 'cache', 'conquer', 'generic', 'isogen'],
  'ra2md.mix': ['localmd', 'cachemd', 'conqmd', 'genermd', 'isogenmd'],
};

// Per theater, the MIXes nested in ra2.mix / ra2md.mix (docs/research/supported-battlefields.md §1).
// The YR theaters have no `md` suffix and live only in ra2md.mix.
const THEATER_MIXES: Record<string, Record<string, string[]>> = {
  temperate: { 'ra2.mix': ['temperat', 'isotemp', 'tem'], 'ra2md.mix': ['isotemmd'] },
  snow: { 'ra2.mix': ['snow', 'isosnow', 'sno'], 'ra2md.mix': ['snowmd', 'isosnomd'] },
  urban: { 'ra2.mix': ['urban', 'isourb', 'urb'], 'ra2md.mix': ['isourbmd'] },
  newurban: { 'ra2md.mix': ['urbann', 'isoubn', 'ubn', 'isoubnmd'] },
  desert: { 'ra2md.mix': ['desert', 'isodes', 'des', 'isodesmd'] },
  lunar: { 'ra2md.mix': ['lunar', 'isolun', 'lun', 'isolunmd'] },
};

/**
 * Mounts the stock game MIXes plus one theater's MIXes, later mounts winning (YR over RA2).
 * Only the map's own theater is mounted, so art from another theater never leaks in.
 */
export async function mountTheater(read: ReadFile, theater: string): Promise<Vfs> {
  const own = THEATER_MIXES[theater.toLowerCase()];
  if (!own) throw new Error(`Unknown theater: ${theater}`);
  const vfs = new Vfs();
  for (const top of TOP_MIXES) {
    const mix = vfs.mountData(await read(top));
    for (const name of [...(COMMON[top] ?? []), ...(own[top] ?? [])]) {
      if (!vfs.mountNested(mix, `${name}.mix`)) throw new Error(`Missing install file: ${top} > ${name}.mix`);
    }
  }
  return vfs;
}

/** Loads a map file: a loose `.map`/`.yrm`/`.mpr`, or a Westwood `.mmx`/`.yro` package. */
export async function loadMap(read: ReadFile, path: string): Promise<MapFile> {
  const bytes = await read(path);
  const pkg = /([^/]+)\.(mmx|yro)$/i.exec(path);
  return pkg ? MapFile.fromPackage(bytes, pkg[1]!) : MapFile.parse(bytes);
}
