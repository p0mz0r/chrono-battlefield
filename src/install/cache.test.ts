import { expect, it } from 'vitest';
import { describeInstall, readFromDir } from '../../test/install.js';
import type { ReadFile } from '../ra2/mount.js';
import { cachedImport, installKey } from './cache.js';

// A plain (unencrypted) MIX header with no entries; `bodySize` stands in for a changed archive.
const mix = (bodySize: number) => new Uint8Array([0, 0, 0, 0, 0, 0, bodySize, 0, 0, 0]);
const install = (bodySize: number): ReadFile => async (path, offset = 0, length = Infinity) =>
  mix(path === 'ra2md.mix' ? bodySize : 0).slice(offset, offset + length);

const memoryStore = () => {
  const map = new Map<string, unknown>();
  return { map, get: async (k: string) => map.get(k), set: async (k: string, v: unknown) => void map.set(k, v), keys: async () => [...map.keys()], delete: async (k: string) => void map.delete(k) };
};

it('a second load hits the cache, and changing the install misses it and drops the old entries', async () => {
  const store = memoryStore();
  let imports = 0;
  const load = (read: ReadFile, course = 'Hills.mmx') => cachedImport(store, read, course, async () => `import ${++imports}`);

  expect(await load(install(1))).toBe('import 1');
  expect(await load(install(1))).toBe('import 1');
  expect(await load(install(1), 'other.map')).toBe('import 2');
  expect(store.map.size).toBe(2);

  expect(await load(install(2))).toBe('import 3');
  expect(store.map.size).toBe(1);
});

describeInstall('install key', () => {
  it('is read from the top-level MIX indexes alone', async () => {
    const read: ReadFile = async (path, offset, length) => {
      expect(length).toBeLessThan(1024);
      return readFromDir(path, offset, length);
    };
    expect(await installKey(read)).toMatch(/^[0-9a-f]{8}$/);
  });
});
