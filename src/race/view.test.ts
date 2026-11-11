import { expect, it } from 'vitest';
import { paintNames, readable, thrownAt } from './view.js';

it('paints whole racer names in their colour, escaped, and leaves the rest of a feed line alone', () => {
  const names = new Map([['Kane', '#ff1919'], ['Kane#2', '#2269d4'], ['<b>', '#fcff10']]);
  expect(paintNames('Kane#2 ▸ shield ▸ Kane', names)).toBe('<span style="color:#2269d4">Kane#2</span> ▸ shield ▸ <span style="color:#ff1919">Kane</span>');
  expect(paintNames('Kane: cooldown 3 s', names)).toBe('<span style="color:#ff1919">Kane</span>: cooldown 3 s');
  expect(paintNames('Kaneda ▸ boost ▸ <b>', names)).toBe('Kaneda ▸ boost ▸ <span style="color:#fcff10">&lt;b&gt;</span>');
});

it('lifts only a dark house colour toward white, for names on the near-black panels', () => {
  expect(readable(0xfcff10)).toBe(0xfcff10); // Gold, already light
  expect(readable(0x000000)).toBe(0x808080); // black, half way to white
});

it('throws a knocked-back tank along its path fast at first, then slowing, from its first point to its last', () => {
  const path = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }]; // 4 cells long, drawn from where it stood
  expect(thrownAt(path, 0)).toEqual({ x: 0, y: 0 });
  expect(thrownAt(path, 0.5)).toEqual({ x: 2, y: 1.5 }); // half the time: 7/8 of the way (cubic ease-out)
  expect(thrownAt(path, 1)).toEqual({ x: 2, y: 2 });
  expect(thrownAt(path, 2)).toEqual({ x: 2, y: 2 });
  expect(thrownAt(path, -1)).toEqual({ x: 0, y: 0 });
});
