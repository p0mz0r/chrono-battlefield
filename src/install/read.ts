export interface ByteRange { offset: number; length: number }
type Read = (path: string, offset?: number, length?: number) => Promise<Uint8Array>;

const missingFile = (path: string) => new Error(`Missing install file: ${path}`);
const encode = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** Reads over HTTP from `prefix`: `/ra2/` under `npm run dev` (RA2_DIR), `/abs/<install folder>/` from the launcher. */
const readUrl = (prefix: string): Read => async (path, offset, length) => {
  const res = await fetch(prefix + encode(path), offset === undefined ? undefined : { headers: { Range: `bytes=${offset}-${offset + length! - 1}` } });
  if (!res.ok) throw missingFile(path);
  return new Uint8Array(await res.arrayBuffer());
};

/** Whether a file exists, by absolute path, through the launcher's `/abs/`. */
async function existsAbsolute(path: string): Promise<boolean> {
  try {
    return (await fetch(`/abs/${encode(path)}`, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

/** One request on the single object store `files` of an IndexedDB database. */
export function idb<T>(name: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('files');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('files', mode);
      const req = run(tx.objectStore('files'));
      tx.oncomplete = () => { db.close(); resolve(req.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

let backend: Read = readUrl('/ra2/');

/**
 * Reads one file of the operator's RA2 + YR install, by its path inside the install folder
 * (`ra2.mix`, `Maps/Yuri's Revenge/x.map`). Every install read goes through here (ADR 0009).
 * Throws `Missing install file: <path>`.
 */
export const readInstall = Object.assign(
  (path: string, offset?: number, length?: number) => backend(path, offset, length),
  { ranges: (path: string, ranges: readonly ByteRange[]) => Promise.all(ranges.map((r) => backend(path, r.offset, r.length))) },
);

const PATH_KEY = 'rhino-race.installPath';
export const savedPath = () => localStorage.getItem(PATH_KEY) ?? '';

/** Checks one folder and saves it as the install path. Returns what's wrong with it, if anything. */
export async function useFolder(path: string): Promise<string[]> {
  path = normalizePath(path);
  if (!path) {
    localStorage.removeItem(PATH_KEY);
    return [];
  }
  if (import.meta.env.DEV) return ['The dev page reads the install from RA2_DIR; a folder path works only from the launcher.'];
  const found = await findInstall(path, existsAbsolute, []);
  if (found.root) localStorage.setItem(PATH_KEY, found.root);
  return found.root ? [] : describe(found, path);
}

function describe(found: Discovery, saved?: string): string[] {
  const lines = found.partial.map((p) => `${p.root} is missing ${p.missing.join(', ')}`);
  if (saved && !found.partial.some((p) => p.root === normalizePath(saved))) lines.unshift(`Nothing readable at ${saved}`);
  return lines;
}

/** Picks the install: the saved path, then the Origin, EA app and Steam folders. Returns why none worked (empty when one did). */
export async function openInstall(): Promise<string[]> {
  if (import.meta.env.DEV) return [];
  const saved = savedPath();
  const found = await findInstall(saved, existsAbsolute);
  if (found.root) {
    backend = readUrl(`/abs/${encode(found.root)}/`);
    return [];
  }
  return [...describe(found, saved), 'No install in the Origin, EA app or Steam folders'];
}

/** The files an install must have, beside the maps (language MIXes hold the sounds). */
export const REQUIRED = ['ra2.mix', 'ra2md.mix', 'expandmd01.mix', 'language.mix', 'langmd.mix'];

const GAME = 'Command and Conquer Red Alert II';
// Tried in this order after the saved path: the Origin, EA app and Steam defaults, then the same
// launchers' library folders where people often move them.
// ponytail: a guessed list (the launchers' config doesn't name the folder); the setup screen covers the rest.
const DEFAULT_ROOTS = [
  `C:/Program Files (x86)/Origin Games/${GAME}`,
  `C:/Program Files/EA Games/${GAME}`,
  `C:/Program Files (x86)/Steam/steamapps/common/${GAME}`,
  `D:/Games/Origin/${GAME}`,
  `D:/Origin Games/${GAME}`,
  `D:/EA Games/${GAME}`,
  `D:/SteamLibrary/steamapps/common/${GAME}`,
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
export async function findInstall(
  saved: string | undefined,
  exists: (path: string) => Promise<boolean>,
  defaults = DEFAULT_ROOTS,
): Promise<Discovery> {
  saved = saved && normalizePath(saved);
  const roots = [...new Set([...(saved ? [saved] : []), ...defaults])];
  // One probe per folder, all at once, so absent folders fail side by side rather than in turn.
  const present = await Promise.all(roots.map((root) => root === saved || exists(`${root}/${REQUIRED[0]}`)));
  const partial: Discovery['partial'] = [];
  for (const root of roots.filter((_, i) => present[i])) {
    const found = await Promise.all(REQUIRED.map((f) => exists(`${root}/${f}`)));
    const missing = REQUIRED.filter((_, i) => !found[i]);
    if (!missing.length) return { root, partial };
    if (missing.length < REQUIRED.length) partial.push({ root, missing });
  }
  return { partial };
}
