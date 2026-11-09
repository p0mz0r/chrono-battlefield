import { expect, test } from 'vitest';
import { findInstall, installFiles, selectRanges } from './read.js';

const ORIGIN = 'C:/Program Files (x86)/Origin Games/Command and Conquer Red Alert II';
const EA_APP = 'C:/Program Files/EA Games/Command and Conquer Red Alert II';

test('discovery tries the saved path, then the Origin, EA app and Steam folders', async () => {
  const installs = new Set<string>();
  const exists = async (path: string) => installs.has(path.slice(0, path.lastIndexOf('/')));

  installs.add(EA_APP).add(ORIGIN).add('E:/RA2');
  expect((await findInstall('E:\\RA2\\', exists)).root).toBe('E:/RA2');
  expect((await findInstall('E:/elsewhere', exists)).root).toBe(ORIGIN);
  installs.delete(ORIGIN);
  expect((await findInstall(undefined, exists)).root).toBe(EA_APP);
});

test('a folder lacking a required file names it', async () => {
  const exists = async (path: string) => path.startsWith('E:/RA2/') && !path.endsWith('/expandmd01.mix');
  expect(await findInstall('E:/RA2', exists)).toEqual({ partial: [{ root: 'E:/RA2', missing: ['expandmd01.mix'] }] });
});

test('one streaming pass copies ranges that span chunk boundaries', async () => {
  const chunks = [[0, 1, 2], [3, 4], [5, 6, 7, 8]].map((c) => new Uint8Array(c));
  const body = new ReadableStream({ start: (c) => { chunks.forEach((x) => c.enqueue(x)); c.close(); } });
  const [a, b] = await selectRanges(new Response(body), [{ offset: 6, length: 2 }, { offset: 2, length: 3 }]);
  expect([...a!, ...b!]).toEqual([6, 7, 2, 3, 4]);
  await expect(selectRanges(new Response(new Uint8Array(4)), [{ offset: 2, length: 3 }])).rejects.toThrow('Truncated');
});

test('a picked install folder keeps only the required MIXes and the maps', () => {
  const names = ['RA2.MIX', 'ra2md.mix', 'expandmd01.mix', 'language.mix', 'langmd.mix', 'Hills.mmx', 'DeepFrze.yro', 'oasis.map', 'game.exe', 'movies01.mix', 'ra2.ini'];
  expect(installFiles(names.map((n) => new File([], n))).map((f) => f.name)).toEqual(names.slice(0, 8));
});
