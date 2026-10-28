import { expect, it } from 'vitest';
import { duplicateFilter } from './operator.js';

it('counts a key and a hotkey for the same action within 200 ms once', () => {
  const duplicate = duplicateFilter();
  expect(duplicate('start', 'key', 0)).toBe(false);
  expect(duplicate('start', 'hotkey', 150)).toBe(true);
  expect(duplicate('end', 'hotkey', 160)).toBe(false);
  expect(duplicate('end', 'hotkey', 170)).toBe(false); // same source repeats: E pressed twice
  expect(duplicate('end', 'key', 500)).toBe(false);
});
