import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellGrid } from '../movement/index.js';
import { loadCourse, mapHash } from '../race/course.js';
import { createRace, eventChips, openJoinWindow, type Race } from '../race/race.js';
import { connectStreamerBot } from './streamerBot.js';

const MAP = new TextEncoder().encode('[Map]\nTheater=TEMPERATE\n');
const OPEN: CellGrid = { width: 20, height: 10, speed: new Array(200).fill(1), level: new Array(200).fill(0), ramp: new Array(200).fill(0), blocked: new Array(200).fill(false), deck: new Array(200).fill(-1) };
const newRace = () => createRace(loadCourse({ name: 'Test', map: 'test.map', mapHash: mapHash(MAP), source: 'shipped', author: 'tests', link: '', startGrid: [[1, 1], [1, 3], [1, 5]], waypoints: [[10, 2]], laps: [], finish: [18, 2], bridges: [] }, MAP, OPEN), OPEN, 1);

/** Stands in for Streamer.bot's WebSocket server: one per connection attempt. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.drop(); }
  open() { this.readyState = 1; this.onopen?.(); }
  drop() { this.readyState = 3; this.onclose?.(); }
  event(source: string, type: string, data: unknown) { this.onmessage?.({ data: JSON.stringify({ timeStamp: '', event: { source, type }, data }) }); }
  /** The `DoAction` requests sent so far, as their `args`. */
  actions() { return this.sent.filter((m) => m.request === 'DoAction').map((m) => m.args); }
}
const last = () => FakeSocket.all.at(-1)!;

let race: Race;
let source: ReturnType<typeof connectStreamerBot>;
beforeEach(() => {
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  FakeSocket.all = [];
  race = newRace();
  source = connectStreamerBot(race, { Socket: FakeSocket });
  last().open();
});
afterEach(() => { source.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const redeem = (title: string, redemptionId = 'red-1') => last().event('Twitch', 'RewardRedemption', { redemptionId, reward: { id: 'rew-1', title }, user: { id: '7', login: 'vera', name: 'Vera' } });

describe('Streamer.bot chat source', () => {
  it('is neither online nor offline while the first connection is still opening', () => {
    source.close();
    source = connectStreamerBot(race, { Socket: FakeSocket });
    expect(source.online()).toBeUndefined();
    last().drop();
    expect(source.online()).toBe(false);
    source.close();
    source = connectStreamerBot(race, { Socket: FakeSocket });
    last().open();
    expect(source.online()).toBe(true);
  });

  it('subscribes to chat on every platform and Twitch redemptions and cheers', () => {
    expect(last().url).toBe('ws://127.0.0.1:8080/');
    expect(last().sent[0]).toMatchObject({ request: 'Subscribe', events: { Twitch: ['ChatMessage', 'RewardRedemption', 'Cheer'], YouTube: ['Message'], Kick: ['ChatMessage'] } });
  });

  it('lets viewers on Twitch, YouTube and Kick join, each under their platform and user ID', () => {
    openJoinWindow(race);
    last().event('Twitch', 'ChatMessage', { user: { id: '123', login: 'vera', name: 'Vera' }, text: '!rhino' });
    last().event('YouTube', 'Message', { user: { id: 'UCabc', name: 'Yuki' }, message: '!rhino' });
    last().event('Kick', 'ChatMessage', { user: { id: 99, login: 'kim', name: 'Kim' }, text: '!rhino' });
    last().event('Twitch', 'ChatMessage', { user: null, text: '!rhino' });
    expect(race.racers.map((r) => [r.viewerId, r.name])).toEqual([['twitch:123', 'Vera'], ['youtube:UCabc', 'Yuki'], ['kick:99', 'Kim']]);
  });

  it('settles a redemption by its reward title through DoAction, and ignores unknown titles', () => {
    redeem('Kirov', 'red-1');
    redeem('Hydrate!', 'red-2');
    redeem('Kirov airship', 'red-3');
    vi.advanceTimersByTime(1000);
    // Outside a race, so refunded straight away.
    expect(last().actions()).toEqual([{ redemptionId: 'red-1', rewardId: 'rew-1', reward: 'Kirov', outcome: 'refunded' }]);
    expect(last().sent.find((m) => m.request === 'DoAction')).toMatchObject({ action: { name: 'Rhino Race settle' } });
  });

  it('settles a redemption in the shape Streamer.bot 1.0.7 sends it: ID in `id`, viewer in flat user_ fields', () => {
    last().event('Twitch', 'RewardRedemption', { id: '427b1584', user_id: '427115971', user_login: 'p0mz0r', user_name: 'p0mz0r', user_input: '', status: 'unfulfilled',
      reward: { id: 'c8a55d1a', title: 'Chronosphere', cost: 1, prompt: '' }, is_test: false });
    vi.advanceTimersByTime(1000);
    expect(last().actions()).toEqual([{ redemptionId: '427b1584', rewardId: 'c8a55d1a', reward: 'Chronosphere', outcome: 'refunded' }]);
  });

  it('matches reward titles ignoring case and outer spaces, but not inner spacing', () => {
    redeem('  CHRONOsphere ', 'red-1');
    redeem(' desolator', 'red-2');
    redeem('Chrono sphere', 'red-3');
    vi.advanceTimersByTime(1000);
    expect(last().actions()).toMatchObject([{ redemptionId: 'red-1' }, { redemptionId: 'red-2' }]);
  });

  it('turns a cheer of exactly 10, 20 or 50 bits into a Desolator, Kirov or Chronosphere and ignores any other amount', () => {
    const cheer = (bits: number) => last().event('Twitch', 'Cheer', { bits, messageId: `m${bits}`, user: { id: '7', name: 'Vera' }, text: `Cheer${bits}` });
    for (const bits of [9, 49, 51, 100]) cheer(bits);
    expect(eventChips(race)).toEqual([]);
    for (const bits of [10, 20, 50]) cheer(bits);
    last().event('Twitch', 'Cheer', { bits: 50, user: null, text: 'Cheer50' });
    expect(eventChips(race).map((c) => c.label)).toEqual(['DESOLATOR · Vera · next race', 'KIROV · Vera · next race', 'CHRONOSPHERE · Vera · next race', 'CHRONOSPHERE · Anonymous · next race']);
    vi.advanceTimersByTime(1000);
    expect(last().actions()).toEqual([]);
  });

  it('ignores paid events from YouTube and Kick', () => {
    last().event('YouTube', 'SuperChat', { user: { id: 'UCabc', name: 'Yuki' }, amount: 5 });
    last().event('Kick', 'GiftedSubscriptions', { user: { id: '99', name: 'Kim' } });
    vi.advanceTimersByTime(1000);
    expect([eventChips(race), last().actions()]).toEqual([[], []]);
  });

  it('goes offline on a drop, keeps settlements for later and reconnects with growing waits', () => {
    expect(source.online()).toBe(true);
    last().drop();
    expect(source.online()).toBe(false);
    redeem('Desolator');
    const waits: number[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = FakeSocket.all.length;
      let waited = 0;
      while (FakeSocket.all.length === before) { vi.advanceTimersByTime(100); waited += 100; }
      waits.push(waited);
      if (attempt < 3) last().drop();
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000]);
    last().open();
    expect(source.online()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(last().actions()).toMatchObject([{ redemptionId: 'red-1', outcome: 'refunded' }]);
  });

  it('refunds a redemption still unsettled when the page reloads, once the new page connects', () => {
    last().drop();
    redeem('Desolator', 'red-1');
    // Reload: a new race and source, before the refund ever went out.
    source.close();
    race = newRace();
    source = connectStreamerBot(race, { Socket: FakeSocket });
    last().open();
    vi.advanceTimersByTime(1000);
    expect(last().actions()).toEqual([{ redemptionId: 'red-1', rewardId: 'rew-1', reward: 'Desolator', outcome: 'refunded' }]);
    // Settled once: the next reload refunds nothing.
    source.close();
    source = connectStreamerBot(newRace(), { Socket: FakeSocket });
    last().open();
    vi.advanceTimersByTime(1000);
    expect(last().actions()).toEqual([]);
  });
});
