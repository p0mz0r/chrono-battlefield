import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/chat/gameLink.js';
import { hear, rail, type Rail, type Reply } from './rail.js';

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  show: true, phase: 'racing', countdown: 0, field: 10, interactions: ['boost', 'shield', 'missile', 'v3', 'tesla', 'bridge'],
  paid: ['kirov', 'desolator', 'chronosphere'], armed: false, racers: [], ...over,
});
const heard = (over: Partial<Snapshot> = {}, at = 1000) => ({ snapshot: snapshot(over), at, since: 0 });

describe('the rail', () => {
  it('draws nothing before the first snapshot', () => {
    expect(rail(undefined, '42', 1000)).toEqual({ state: 'none' });
  });

  it('draws nothing while the snapshot hides it: a trial race, or the game link gone offline', () => {
    expect(rail(heard({ show: false }), '42', 1000)).toEqual({ state: 'none' });
    expect(rail({ snapshot: { show: false } as Snapshot, at: 1000, since: 0 }, '42', 1000)).toEqual({ state: 'none' });
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
      .toEqual({ state: 'join', countdown: 23, field: 6, max: 10, shared: true, join: true });
  });

  it('knows when the viewer has not shared identity, so the card can say Twitch will ask', () => {
    expect(rail(heard({ phase: 'join', countdown: 23, field: 6 }), null, 1000)).toMatchObject({ state: 'join', shared: false, join: true });
    expect(rail(heard(), null, 1000)).toMatchObject({ state: 'race', shared: false });
  });

  it('drops JOIN for a viewer who already has a tank', () => {
    const racers = [{ id: '42', place: 1, progress: 0, colour: '#ff4fd8', finished: false }];
    expect(rail(heard({ phase: 'join', field: 1, racers }), '42', 1000)).toMatchObject({ state: 'join', join: false });
  });

  it('shows "race on" and the random-tank tiles to a viewer who is not racing', () => {
    expect(rail(heard(), '42', 1000))
      .toEqual({ state: 'race', field: 10, me: undefined, shared: true, ownTank: [], randomTank: ['boost', 'missile', 'tesla'], nuke: false, back: false });
  });

  it("shows a racer's place, progress and house colour, with Shield and V3 for their own tank", () => {
    const me = { id: '42', place: 8, progress: 63, colour: '#ff4fd8', finished: false };
    expect(rail(heard({ racers: [{ id: '7', place: 1, progress: 90, colour: '#ff5050', finished: false }, me] }), '42', 1000))
      .toEqual({ state: 'race', field: 10, me, shared: true, ownTank: ['shield', 'v3'], randomTank: ['boost', 'missile', 'tesla'], nuke: false, back: false });
  });

  it('keeps the random-tank tiles but drops Shield and V3 once the racer has finished', () => {
    const me = { id: '42', place: 3, progress: 100, colour: '#ff4fd8', finished: true };
    expect(rail(heard({ racers: [me] }), '42', 1000)).toMatchObject({ me, ownTank: [], randomTank: ['boost', 'missile', 'tesla'] });
  });

  it('never matches a racer to a viewer who has not shared identity', () => {
    const racers = [{ id: '42', place: 8, progress: 63, colour: '#ff4fd8', finished: false }];
    expect(rail(heard({ racers }), null, 1000)).toMatchObject({ me: undefined, ownTank: [] });
  });

  it('shows the place but no tiles in the countdown, before interactions work', () => {
    const me = { id: '42', place: 4, progress: 0, colour: '#ff4fd8', finished: false };
    expect(rail(heard({ phase: 'countdown', racers: [me], armed: true }), '42', 1000)).toMatchObject({ me, ownTank: [], randomTank: [], nuke: false });
  });

  it('shows only the interactions switched on, and the nuke only while the hype meter is armed', () => {
    const me = { id: '42', place: 2, progress: 40, colour: '#ff4fd8', finished: false };
    expect(rail(heard({ racers: [me], interactions: ['v3', 'tesla'], armed: true }), '42', 1000)).toMatchObject({ ownTank: ['v3'], randomTank: ['tesla'], nuke: true });
  });
});

describe('the cooldown ring', () => {
  const me = { id: '42', place: 8, progress: 63, colour: '#ff4fd8', finished: false };
  const ring = (r: Rail) => r.state === 'race' ? r.cooldown : undefined;
  const reply = (action: Reply['action'], ok: boolean, reason: string, at = 2000): Reply => ({ action, result: { ok, reason }, at });

  it('folds the five personal tiles into a ring for the cooldown of a successful press, captioned with what was used', () => {
    expect(rail(heard({ racers: [me] }, 13_000), '42', 14_000, reply('missile', true, 'missile Seth')))
      .toMatchObject({ ownTank: [], randomTank: [], cooldown: { used: 'missile', left: 18_000, total: 30_000 } });
  });

  it('starts the ring from a bounce off a cooldown started in chat, with nothing to name as used', () => {
    expect(rail(heard({ racers: [me] }, 3000), '42', 3000, reply('tesla', false, 'cooldown 12 s')))
      .toMatchObject({ ownTank: [], randomTank: [], cooldown: { used: undefined, left: 11_000, total: 12_000 } });
  });

  it('leaves the tiles alone after a press that failed for any other reason', () => {
    expect(rail(heard({ racers: [me] }, 3000), '42', 3000, reply('tesla', false, 'target protected')))
      .toEqual(rail(heard({ racers: [me] }, 3000), '42', 3000));
  });

  it('drops a running ring as soon as the snapshot enters a new race, as the game clears every cooldown', () => {
    const tesla = reply('tesla', true, 'tesla Seth', 2000);
    let h = hear(undefined, snapshot({ racers: [me] }), 1000);
    h = hear(h, snapshot({ racers: [me] }), 3000);
    expect(ring(rail(h, '42', 3000, tesla))).toMatchObject({ used: 'tesla' });
    h = hear(h, snapshot({ phase: 'results' }), 5000);
    h = hear(h, snapshot({ phase: 'join', countdown: 10 }), 6000);
    h = hear(h, snapshot({ phase: 'countdown', racers: [me] }), 8000);
    h = hear(h, snapshot({ racers: [me] }), 9000);
    expect(rail(h, '42', 9000, tesla)).toMatchObject({ ownTank: ['shield', 'v3'], randomTank: ['boost', 'missile', 'tesla'] });
    expect(ring(rail(h, '42', 9000, tesla))).toBeUndefined();
  });

  it('keeps the ring across snapshots of the same race', () => {
    const h = hear(hear(undefined, snapshot({ phase: 'countdown', racers: [me] }), 1000), snapshot({ racers: [me] }), 4000);
    expect(ring(rail(h, '42', 4000, reply('boost', true, 'boost Seth', 2000)))).toEqual({ used: 'boost', left: 18_000, total: 20_000 });
  });

  it('never holds the Nuke tile', () => {
    expect(rail(heard({ racers: [me], armed: true }, 3000), '42', 3000, reply('shield', true, 'shield Eva'))).toMatchObject({ nuke: true, cooldown: { used: 'shield' } });
  });

  it('brings the tiles back with a short flash when the ring closes, counting real seconds', () => {
    const v3 = reply('v3', true, 'v3 Eva', 2000), at = (now: number) => rail(heard({ racers: [me] }, now), '42', now, v3);
    expect(ring(at(21_999))).toMatchObject({ left: 1 });
    expect(at(22_000)).toMatchObject({ ownTank: ['shield', 'v3'], randomTank: ['boost', 'missile', 'tesla'], back: true });
    expect(at(22_599)).toMatchObject({ back: true });
    expect(at(22_600)).toMatchObject({ back: false });
  });

  it('keeps the ring through a game link blip mid-race, when the backend broadcasts an offline snapshot', () => {
    let h = hear(undefined, snapshot({ racers: [me] }), 1000);
    h = hear(h, { show: false } as Snapshot, 3000);
    h = hear(h, snapshot({ racers: [me] }), 4000);
    expect(ring(rail(h, '42', 4000, reply('missile', true, 'missile Seth', 2000)))).toMatchObject({ used: 'missile' });
  });
});
