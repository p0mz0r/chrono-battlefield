/**
 * Reads one file of the operator's RA2 + YR install, by its path inside the install folder
 * (`ra2.mix`, `Maps/Yuri's Revenge/x.map`). Every install read goes through here (ADR 0004).
 * Backend so far: the dev server's `/ra2/` middleware serving `RA2_DIR`.
 */
export async function readInstall(path: string): Promise<Uint8Array> {
  const res = await fetch(`/ra2/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!res.ok) throw new Error(`Missing install file: ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** The files an install must have, beside the maps. */
export const REQUIRED = ['ra2.mix', 'ra2md.mix', 'expandmd01.mix'];

const GAME = 'Command and Conquer Red Alert II';
// Tried in this order after the saved path. Origin, EA app, Steam defaults first, then the same
// launchers' library folders as people commonly put them on other drives.
// ponytail: a guessed list (the launchers' own config doesn't name the folder); the setup screen covers the rest.
const DEFAULT_ROOTS = [
  `C:/Program Files (x86)/Origin Games/${GAME}`,
  `C:/Program Files/EA Games/${GAME}`,
  `C:/Program Files (x86)/Steam/steamapps/common/${GAME}`,
  ...['C', 'D', 'E', 'F'].flatMap((d) => [
    `${d}:/Origin Games/${GAME}`,
    `${d}:/Games/Origin/${GAME}`,
    `${d}:/Games/Origin Games/${GAME}`,
    `${d}:/EA Games/${GAME}`,
    `${d}:/Games/EA Games/${GAME}`,
    `${d}:/SteamLibrary/steamapps/common/${GAME}`,
    `${d}:/Games/Steam/steamapps/common/${GAME}`,
  ]),
];

/** `D:\Games\RA2\` or `"D:/Games/RA2"` → `D:/Games/RA2`. */
export function normalizePath(path: string): string {
  return path.trim().replace(/^"|"$/g, '').replace(/\\/g, '/').replace(/\/+$/, '');
}

export interface Discovery {
  /** The first folder holding every required file. */
  root?: string;
  /** Otherwise, each tried folder that holds some of them, with the names it lacks. */
  partial: { root: string; missing: string[] }[];
}

/** Tries the saved path, then the default folders. `exists` checks one absolute path. */
export async function findInstall(saved: string | undefined, exists: (path: string) => Promise<boolean>): Promise<Discovery> {
  const roots = [...new Set([...(saved ? [normalizePath(saved)] : []), ...DEFAULT_ROOTS])];
  const partial: Discovery['partial'] = [];
  for (const root of roots) {
    const found = await Promise.all(REQUIRED.map((f) => exists(`${root}/${f}`)));
    const missing = REQUIRED.filter((_, i) => !found[i]);
    if (!missing.length) return { root, partial };
    if (missing.length < REQUIRED.length) partial.push({ root, missing });
  }
  return { partial };
}
