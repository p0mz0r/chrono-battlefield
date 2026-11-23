import { expect, it, onTestFinished, vi } from 'vitest';
import { readChoices } from './operator.js';

it('reads chaos choices back, defaulting to all on, and drops the old cheer price', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null });
  onTestFinished(() => { vi.unstubAllGlobals(); });
  expect(readChoices()).toMatchObject({ chaos: ['hype', 'chronoSwap', 'kirov', 'desolator'] });
  storage.set('rhino-race-setup', JSON.stringify({ chaos: ['kirov', 'bogus'], cheerBits: 100 }));
  expect(readChoices()).toMatchObject({ chaos: ['kirov'] });
  expect(readChoices()).not.toHaveProperty('cheerBits');
  storage.set('rhino-race-setup', JSON.stringify({ chaos: [] }));
  expect(readChoices()).toMatchObject({ chaos: [] });
});

