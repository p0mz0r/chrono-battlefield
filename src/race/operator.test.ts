import { expect, it, onTestFinished, vi } from 'vitest';
import { duplicateFilter, readChoices } from './operator.js';

it('reads chaos choices and the cheer price back, defaulting to all on at 50 bits', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null });
  onTestFinished(() => { vi.unstubAllGlobals(); });
  expect(readChoices()).toMatchObject({ chaos: ['hype', 'chronoSwap', 'kirov'], cheerBits: 50 });
  storage.set('rhino-race-setup', JSON.stringify({ chaos: ['kirov', 'bogus'], cheerBits: 100 }));
  expect(readChoices()).toMatchObject({ chaos: ['kirov'], cheerBits: 100 });
  storage.set('rhino-race-setup', JSON.stringify({ chaos: [], cheerBits: 0 }));
  expect(readChoices()).toMatchObject({ chaos: [], cheerBits: 50 });
});

it('counts a key and a hotkey for the same action within 200 ms once', () => {
  const duplicate = duplicateFilter();
  expect(duplicate('start', 'key', 0)).toBe(false);
  expect(duplicate('start', 'hotkey', 150)).toBe(true);
  expect(duplicate('end', 'hotkey', 160)).toBe(false);
  expect(duplicate('end', 'hotkey', 170)).toBe(false); // same source repeats: E pressed twice
  expect(duplicate('end', 'key', 500)).toBe(false);
});
