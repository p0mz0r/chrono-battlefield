import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/chat/gameLink.js';
import { rail, type Action } from './rail.js';

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  show: true, phase: 'racing', countdown: 0, field: 10, interactions: ['boost', 'shield', 'missile', 'v3', 'tesla', 'bridge'],
  paid: ['kirov', 'desolator', 'chronosphere'], armed: false, racers: [], ...over,
});
const heard = (over: Partial<Snapshot> = {}, at = 1000) => ({ snapshot: snapshot(over), at });

describe('the rail', () => {
  it('draws nothing before the first snapshot', () => {
    expect(rail(undefined, '42', undefined, 1000)).toEqual({ state: 'none' });
  });

  it('draws nothing while the snapshot hides it: a trial race, or the game link gone offline', () => {
    expect(rail(heard({ show: false }), '42', undefined, 1000)).toEqual({ state: 'none' });
    expect(rail({ snapshot: { show: false } as Snapshot, at: 1000 }, '42', undefined, 1000)).toEqual({ state: 'none' });
  });

  it('draws nothing after about 10 s without a snapshot', () => {
    expect(rail(heard({}, 1000), '42', undefined, 10_999).state).toBe('race');
    expect(rail(heard({}, 1000), '42', undefined, 11_000)).toEqual({ state: 'none' });
  });

  it('shows one between-races tile in race setup, at the results and after a cancelled race', () => {
    for (const phase of ['idle', 'results', 'cancelled'] as const) expect(rail(heard({ phase }), '42', undefined, 1000)).toEqual({ state: 'between' });
  });

  it('offers JOIN in the join window with the countdown and the field out of 10', () => {
    expect(rail(heard({ phase: 'join', countdown: 23, field: 6 }), '42', undefined, 1000))
      .toEqual({ state: 'join', countdown: 23, field: 6, max: 10, shared: true, join: true });
  });

  it('knows when the viewer has not shared identity, so the card can say Twitch will ask', () => {
    expect(rail(heard({ phase: 'join', countdown: 23, field: 6 }), null, undefined, 1000)).toMatchObject({ state: 'join', shared: false, join: true });
    expect(rail(heard(), null, undefined, 1000)).toMatchObject({ state: 'race', shared: false });
  });

  it('drops JOIN for a viewer who already has a tank', () => {
    const racers = [{ id: '42', place: 1, progress: 0, colour: '#ff4fd8', finished: false }];
    expect(rail(heard({ phase: 'join', field: 1, racers }), '42', undefined, 1000)).toMatchObject({ state: 'join', join: false });
  });

  it('shows "race on" and the random-tank tiles to a viewer who is not racing', () => {
    expect(rail(heard(), '42', undefined, 1000))
      .toEqual({ state: 'race', field: 10, me: undefined, shared: true, ownTank: [], randomTank: ['boost', 'missile', 'tesla'], nuke: false });
  });

  it("shows a racer's place, progress and house colour, with Shield and V3 for their own tank", () => {
    const me = { id: '42', place: 8, progress: 63, colour: '#ff4fd8', finished: false };
    expect(rail(heard({ racers: [{ id: '7', place: 1, progress: 90, colour: '#ff5050', finished: false }, me] }), '42', undefined, 1000))
      .toEqual({ state: 'race', field: 10, me, shared: true, ownTank: ['shield', 'v3'], randomTank: ['boost', 'missile', 'tesla'], nuke: false });
  });

  it('keeps the random-tank tiles but drops Shield and V3 once the racer has finished', () => {
    const me = { id: '42', place: 3, progress: 100, colour: '#ff4fd8', finished: true };
    expect(rail(heard({ racers: [me] }), '42', undefined, 1000)).toMatchObject({ me, ownTank: [], randomTank: ['boost', 'missile', 'tesla'] });
  });

  it('never matches a racer to a viewer who has not shared identity', () => {
    const racers = [{ id: '42', place: 8, progress: 63, colour: '#ff4fd8', finished: false }];
    expect(rail(heard({ racers }), null, undefined, 1000)).toMatchObject({ me: undefined, ownTank: [] });
  });

  it('shows the place but no tiles in the countdown, before interactions work', () => {
    const me = { id: '42', place: 4, progress: 0, colour: '#ff4fd8', finished: false };
    expect(rail(heard({ phase: 'countdown', racers: [me], armed: true }), '42', undefined, 1000)).toMatchObject({ me, ownTank: [], randomTank: [], nuke: false });
  });

  it("shows a failed press under the place with the game's reason, or the link's own", () => {
    const me = { id: '42', place: 6, progress: 71, colour: '#ff4fd8', finished: false };
    const failed = (action: Action, reason: string) => rail(heard({ racers: [me] }), '42', { action, result: { ok: false, reason }, at: 1000 }, 2000);
    expect(failed('tesla', 'cooldown 12 s')).toMatchObject({ me, failure: 'Tesla failed: cooldown 12 s' });
    expect(failed('missile', 'target protected')).toMatchObject({ failure: 'Missile failed: target protected' });
    expect(failed('nuke', 'ignored')).toMatchObject({ failure: 'NUKE failed' });
    for (const reason of ['Game offline', 'No answer', "Twitch didn't answer"]) expect(failed('boost', reason)).toMatchObject({ failure: reason });
  });

  it('shows a failed JOIN under the join countdown', () => {
    expect(rail(heard({ phase: 'join', countdown: 20, field: 10 }), '42', { action: 'rhino', result: { ok: false, reason: 'Game offline' }, at: 1000 }, 2000))
      .toMatchObject({ state: 'join', failure: 'Game offline' });
  });

  it('shows no failure after a press that worked, and lets one fade after 8 s', () => {
    const reply = (ok: boolean) => ({ action: 'boost' as const, result: { ok, reason: ok ? 'boost Kane' : 'cooldown 3 s' }, at: 1000 });
    expect(rail(heard(), '42', reply(true), 2000)).toMatchObject({ failure: undefined });
    expect(rail(heard({}, 8000), '42', reply(false), 8999)).toMatchObject({ failure: 'Boost failed: cooldown 3 s' });
    expect(rail(heard({}, 8000), '42', reply(false), 9000)).toMatchObject({ failure: undefined });
  });

  it('shows only the interactions switched on, and the nuke only while the hype meter is armed', () => {
    const me = { id: '42', place: 2, progress: 40, colour: '#ff4fd8', finished: false };
    expect(rail(heard({ racers: [me], interactions: ['v3', 'tesla'], armed: true }), '42', undefined, 1000)).toMatchObject({ ownTank: ['v3'], randomTank: ['tesla'], nuke: true });
  });
});
