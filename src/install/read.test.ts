import { expect, test } from 'vitest';
import { findInstall } from './read.js';

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
