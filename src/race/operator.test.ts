import { expect, it, onTestFinished, vi } from 'vitest';
import { readChoices } from './operator.js';

it('reads chaos choices and the cheer price back, defaulting to all on at 50 bits', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null });
  onTestFinished(() => { vi.unstubAllGlobals(); });
  expect(readChoices()).toMatchObject({ chaos: ['hype', 'chronoSwap', 'kirov', 'desolator'], cheerBits: 50 });
  storage.set('rhino-race-setup', JSON.stringify({ chaos: ['kirov', 'bogus'], cheerBits: 100 }));
  expect(readChoices()).toMatchObject({ chaos: ['kirov'], cheerBits: 100 });
  storage.set('rhino-race-setup', JSON.stringify({ chaos: [], cheerBits: 0 }));
  expect(readChoices()).toMatchObject({ chaos: [], cheerBits: 50 });
});

