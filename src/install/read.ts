export interface ByteRange { offset: number; length: number }
type Read = (path: string, offset?: number, length?: number) => Promise<Uint8Array>;

/** Copies the requested ranges out of one streaming pass over an OBS response, discarding the rest; stops after the last. */
export async function selectRanges(response: Response, ranges: readonly ByteRange[]): Promise<Uint8Array[]> {
  if (!response.body) throw new Error('Install response has no body');
  for (const r of ranges) if (!Number.isSafeInteger(r.offset) || !Number.isSafeInteger(r.length) || r.offset < 0 || r.length < 0) throw new Error('Invalid install byte range');
  const output = ranges.map(r => new Uint8Array(r.length));
  const end = Math.max(0, ...ranges.map(r => r.offset + r.length));
  const reader = response.body.getReader();
  let position = 0;
  try {
    while (position < end) {
      const { done, value } = await reader.read();
      if (done) break;
      ranges.forEach((r, i) => {
        const from = Math.max(position, r.offset), to = Math.min(position + value.length, r.offset + r.length);
        if (to > from) output[i]!.set(value.subarray(from - position, to - position), from - r.offset);
      });
      position += value.length;
    }
    if (position < end) throw new Error('Truncated install file');
    return output;
  } finally { await reader.cancel(); }
}

const missingFile = (path: string) => new Error(`Missing install file: ${path}`);

/** Install reads in `npm run dev`: the `/ra2/` middleware serving `RA2_DIR`. */
const readDev: Read = async (path, offset, length) => {
  const res = await fetch(`/ra2/${path.split('/').map(encodeURIComponent).join('/')}`, offset === undefined ? undefined : { headers: { Range: `bytes=${offset}-${offset + length! - 1}` } });
  if (!res.ok) throw missingFile(path);
  return new Uint8Array(await res.arrayBuffer());
};

/** In an OBS Local-file source the page is on `http://absolute/`, which fetches any file by absolute path. */
const inObs = () => location.hostname === 'absolute';
const absoluteUrl = (path: string) => `http://absolute/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Whether a file exists, without reading it (the body is cancelled; a missing file takes OBS ~2.3 s to fail). */
async function existsAbsolute(path: string): Promise<boolean> {
  try {
    const res = await fetch(absoluteUrl(path));
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

function readFolder(root: string): Read {
  return async (path, offset, length) => {
    const res = await fetch(absoluteUrl(`${root}/${path}`)).catch(() => undefined);
    if (!res?.ok) throw missingFile(path);
    if (offset !== undefined) return (await selectRanges(res, [{ offset, length: length! }]))[0]!;
    return new Uint8Array(await res.arrayBuffer());
  };
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

// Uploaded files, stored as-is in IndexedDB, keyed by lower-case file name.
const uploads = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) => idb('rhino-race-uploads', mode, run);

const readUploads: Read = async (path, offset, length) => {
  const file = await uploads<Blob | undefined>('readonly', (s) => s.get(path.slice(path.lastIndexOf('/') + 1).toLowerCase()));
  if (!file) throw missingFile(path);
  return new Uint8Array(await (offset === undefined ? file : file.slice(offset, offset + length!)).arrayBuffer());
};

export const uploadedNames = async () => (await uploads('readonly', (s) => s.getAllKeys())).map(String);
export const clearUploads = () => uploads('readwrite', (s) => s.clear());

/** From a picked install folder, the files the game reads: the required MIXes and the maps (any subfolder). */
export const installFiles = (files: File[]) =>
  files.filter((f) => REQUIRED.includes(f.name.toLowerCase()) || /\.(mmx|yro|map|yrm|mpr)$/i.test(f.name));

/** Stores the files as-is; returns the required names still missing. Once complete, they replace the saved path. */
export async function storeUploads(files: File[]): Promise<string[]> {
  for (const file of files) await uploads('readwrite', (s) => s.put(file, file.name.toLowerCase()));
  const names = await uploadedNames();
  const missing = REQUIRED.filter((n) => !names.includes(n));
  if (!missing.length) localStorage.removeItem(PATH_KEY);
  return missing;
}

let backend: Read = readDev;

/**
 * Reads one file of the operator's RA2 + YR install, by its path inside the install folder
 * (`ra2.mix`, `Maps/Yuri's Revenge/x.map`). Every install read goes through here (ADR 0004).
 * Backends: the dev server's `/ra2/` middleware, a folder over OBS's `http://absolute/`, or uploaded files.
 * Throws `Missing install file: <path>`.
 */
export const readInstall = Object.assign(
  (path: string, offset?: number, length?: number) => backend(path, offset, length),
  { ranges: async (path: string, ranges: readonly ByteRange[]) => {
    if (folderRoot) {
      const response = await fetch(absoluteUrl(`${folderRoot}/${path}`));
      if (!response.ok) throw missingFile(path);
      return selectRanges(response, ranges);
    }
    const result: Uint8Array[] = [];
    for (const r of ranges) result.push(await backend(path, r.offset, r.length));
    return result;
  } },
);
let folderRoot = '';

const PATH_KEY = 'rhino-race.installPath';
export const savedPath = () => localStorage.getItem(PATH_KEY) ?? '';

/** Checks one folder and saves it as the install path. Returns what's wrong with it, if anything. */
export async function useFolder(path: string): Promise<string[]> {
  path = normalizePath(path);
  if (!path) {
    localStorage.removeItem(PATH_KEY);
    return [];
  }
  // Only OBS's `http://absolute/` can read a folder by path; a browser can't, so say so rather than "Nothing readable".
  if (!inObs()) return [import.meta.env.DEV
    ? 'The dev page reads the install from RA2_DIR; a folder path works only in an OBS browser source.'
    : 'A folder path works only in an OBS browser source (Local file). In a browser, upload the files below.'];
  const found = await findInstall(path, existsAbsolute, []);
  if (found.root) localStorage.setItem(PATH_KEY, found.root);
  return found.root ? [] : describe(found, path);
}

function describe(found: Discovery, saved?: string): string[] {
  const lines = found.partial.map((p) => `${p.root} is missing ${p.missing.join(', ')}`);
  if (saved && !found.partial.some((p) => p.root === normalizePath(saved))) lines.unshift(`Nothing readable at ${saved}`);
  return lines;
}

/**
 * Picks the backend: the saved path, then the Origin, EA app and Steam folders, then uploaded files.
 * Uploads come first when the operator's last choice was uploading (which clears the saved path).
 * Returns why none worked (empty when one did).
 */
export async function openInstall(): Promise<string[]> {
  if (import.meta.env.DEV) return [];
  const saved = savedPath();
  const names = await uploadedNames();
  const lacking = REQUIRED.filter((n) => !names.includes(n));
  const uploaded = names.length > 0 && !lacking.length;
  const problems: string[] = [];
  if (inObs() && !(uploaded && !saved)) {
    const found = await findInstall(saved, existsAbsolute);
    if (found.root) {
      folderRoot = found.root;
      backend = readFolder(found.root);
      return [];
    }
    problems.push(...describe(found, saved), 'No install in the Origin, EA app or Steam folders');
  }
  if (uploaded) {
    backend = readUploads;
    return [];
  }
  if (names.length) problems.push(`Uploaded files are missing ${lacking.join(', ')}`);
  return problems.length ? problems : ['No install found'];
}

/** The files an install must have, beside the maps (language MIXes hold the sounds). */
export const REQUIRED = ['ra2.mix', 'ra2md.mix', 'expandmd01.mix', 'language.mix', 'langmd.mix'];

const GAME = 'Command and Conquer Red Alert II';
// Tried in this order after the saved path: the Origin, EA app and Steam defaults, then the same
// launchers' library folders where people often move them.
// ponytail: a guessed list (the launchers' config doesn't name the folder), kept short because each absent
// folder costs OBS ~2.3 s with 6 fetches at a time; the setup screen covers the rest.
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
