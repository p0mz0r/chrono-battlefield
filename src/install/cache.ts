import { crc32 } from '../ra2/index.js';
import { installIndexes, type ReadFile } from '../ra2/mount.js';
import { idb } from './read.js';

/** Bump when the import's output changes shape or content, so caches built by older code are dropped. */
const IMPORT_VERSION = 11;

/** Identifies an install by the CRC-32 of its top-level MIX indexes (which carry each archive's body size). */
export async function installKey(read: ReadFile): Promise<string> {
  const indexes = await installIndexes(read);
  const all = new Uint8Array(indexes.reduce((n, b) => n + b.length, 0));
  indexes.reduce((at, b) => (all.set(b, at), at + b.length), 0);
  return crc32(all).toString(16).padStart(8, '0');
}

export interface Store {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  keys(): Promise<string[]>;
  delete(key: string): Promise<void>;
}

/** Import output in IndexedDB. Never raw MIX bytes: those stay in the install. */
export const importStore: Store = {
  get: (key) => idb('rhino-race-import', 'readonly', (s) => s.get(key)),
  set: async (key, value) => void await idb('rhino-race-import', 'readwrite', (s) => s.put(value, key)),
  keys: async () => (await idb('rhino-race-import', 'readonly', (s) => s.getAllKeys())).map(String),
  delete: async (key) => void await idb('rhino-race-import', 'readwrite', (s) => s.delete(key)),
};

/**
 * Returns the cached import of `name` for this install, or runs `build` and caches its result.
 * A miss drops entries left by another install or import version.
 */
export async function cachedImport<T>(store: Store, read: ReadFile, name: string, build: () => Promise<T>): Promise<T> {
  const prefix = `${await installKey(read)}/v${IMPORT_VERSION}/`;
  const hit = await store.get(prefix + name);
  if (hit !== undefined) return hit as T;
  const value = await build();
  for (const key of await store.keys()) if (!key.startsWith(prefix)) await store.delete(key);
  await store.set(prefix + name, value);
  return value;
}
