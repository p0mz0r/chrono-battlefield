import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/chat/gameLink.js';
import { rail } from './rail.js';

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  show: true, phase: 'racing', countdown: 0, field: 10, interactions: ['boost', 'shield', 'missile', 'v3', 'tesla', 'bridge'],
  paid: ['kirov', 'desolator', 'chronosphere'], armed: false, racers: [], ...over,
});
const heard = (over: Partial<Snapshot> = {}, at = 1000) => ({ snapshot: snapshot(over), at });

describe('the rail', () => {
  it('draws nothing before the first snapshot', () => {
    expect(rail(undefined, '42', 1000)).toEqual({ state: 'none' });
  });

  it('draws nothing while the snapshot hides it: a trial race, or the game link gone offline', () => {
    expect(rail(heard({ show: false }), '42', 1000)).toEqual({ state: 'none' });
    expect(rail({ snapshot: { show: false } as Snapshot, at: 1000 }, '42', 1000)).toEqual({ state: 'none' });
  });

  it('draws nothing after about 10 s without a snapshot', () => {
    expect(rail(heard({}, 1000), '42', 10_999).state).toBe('race');
    expect(rail(heard({}, 1000), '42', 11_000)).toEqual({ state: 'none' });
  });

  it('shows one between-races tile in race setup, at the results and after a cancelled race', () => {
    for (const phase of ['idle', 'results', 'cancelled'] as const) expect(rail(heard({ phase }), '42', 1000)).toEqual({ state: 'between' });
  });

  it('offers JOIN in the join window with the countdown and the field out of 10', () => {
    expect(rail(heard({ phase: 'join', countdown: 23, field: 6 }), '42', 1000))
      .toEqual({ state: 'join', countdown: 23, field: 6, max: 10, shared: true, actions: ['rhino'] });
  });

  it('knows when the viewer has not shared identity, so the card can say Twitch will ask', () => {
    expect(rail(heard({ phase: 'join', countdown: 23, field: 6 }), null, 1000)).toMatchObject({ state: 'join', shared: false, actions: ['rhino'] });
  });

  it('drops JOIN for a viewer who already has a tank', () => {
    const racers = [{ id: '42', place: 1, progress: 0, colour: '#ff4fd8', finished: false }];
    expect(rail(heard({ phase: 'join', field: 1, racers }), '42', 1000)).toMatchObject({ state: 'join', actions: [] });
  });

  it('shows "race on" and the random-tank tiles to a viewer who is not racing', () => {
    expect(rail(heard(), '42', 1000)).toEqual({ state: 'race', field: 10, me: undefined, actions: ['boost', 'missile', 'tesla'] });
  });

  it("shows a racer's place, progress and house colour, with Shield and V3 above the random-tank tiles", () => {
    const me = { id: '42', place: 8, progress: 63, colour: '#ff4fd8', finished: false };
    expect(rail(heard({ racers: [{ id: '7', place: 1, progress: 90, colour: '#ff5050', finished: false }, me] }), '42', 1000))
      .toEqual({ state: 'race', field: 10, me, actions: ['shield', 'v3', 'boost', 'missile', 'tesla'] });
  });

  it('keeps the random-tank tiles but drops Shield and V3 once the racer has finished', () => {
    const me = { id: '42', place: 3, progress: 100, colour: '#ff4fd8', finished: true };
    expect(rail(heard({ racers: [me] }), '42', 1000)).toMatchObject({ me, actions: ['boost', 'missile', 'tesla'] });
  });

  it('never matches a racer to a viewer who has not shared identity', () => {
    const racers = [{ id: '42', place: 8, progress: 63, colour: '#ff4fd8', finished: false }];
    expect(rail(heard({ racers }), null, 1000)).toMatchObject({ me: undefined });
  });

  it('shows the place but no tiles in the countdown, before interactions work', () => {
    const me = { id: '42', place: 4, progress: 0, colour: '#ff4fd8', finished: false };
    expect(rail(heard({ phase: 'countdown', racers: [me] }), '42', 1000)).toEqual({ state: 'race', field: 10, me, actions: [] });
  });

  it('shows only the interactions switched on, and the nuke only while the hype meter is armed', () => {
    const me = { id: '42', place: 2, progress: 40, colour: '#ff4fd8', finished: false };
    expect(rail(heard({ racers: [me], interactions: ['v3', 'tesla'], armed: true }), '42', 1000)).toMatchObject({ actions: ['v3', 'tesla', 'nuke'] });
  });
});
