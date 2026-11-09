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
  FakeSocket.all = [];
  race = newRace();
  source = connectStreamerBot(race, { Socket: FakeSocket });
  last().open();
});
afterEach(() => { source.close(); vi.useRealTimers(); });

const redeem = (title: string, redemptionId = 'red-1') => last().event('Twitch', 'RewardRedemption', { redemptionId, reward: { id: 'rew-1', title }, user: { id: '7', login: 'vera', name: 'Vera' } });

describe('Streamer.bot chat source', () => {
  it('subscribes to chat on every platform and Twitch redemptions and cheers', () => {
    expect(last().url).toBe('ws://127.0.0.1:8080/');
    expect(last().sent[0]).toMatchObject({ request: 'Subscribe', events: { Twitch: ['ChatMessage', 'RewardRedemption', 'Cheer'], YouTube: ['Message'], Kick: ['ChatMessage'] } });
  });

  it('lets viewers on Twitch, YouTube and Kick join, each under their platform and user ID', () => {
    openJoinWindow(race);
    last().event('Twitch', 'ChatMessage', { user: { id: '123', login: 'vera', name: 'Vera' }, text: '!rhino' });
    last().event('YouTube', 'Message', { user: { id: 'UCabc', name: 'Yuki' }, message: '!rhino' });
    last().event('Kick', 'ChatMessage', { user: { id: '99', login: 'kim', name: 'Kim' }, text: '!rhino' });
    last().event('Twitch', 'ChatMessage', { user: null, text: '!rhino' });
    expect(race.racers.map((r) => [r.viewerId, r.name])).toEqual([['twitch:123', 'Vera'], ['youtube:UCabc', 'Yuki'], ['kick:99', 'Kim']]);
  });

  it('settles a redemption by its reward title through DoAction, and ignores unknown titles', () => {
    redeem('Kirov airship', 'red-1');
    redeem('Hydrate!', 'red-2');
    vi.advanceTimersByTime(1000);
    // Outside a race, so refunded straight away.
    expect(last().actions()).toEqual([{ redemptionId: 'red-1', rewardId: 'rew-1', reward: 'Kirov airship', outcome: 'refunded' }]);
    expect(last().sent.find((m) => m.request === 'DoAction')).toMatchObject({ action: { name: 'Rhino Race settle' } });
  });

  it('matches reward titles regardless of case and spacing', () => {
    redeem('  chrono   SWAP ');
    vi.advanceTimersByTime(1000);
    expect(last().actions()).toHaveLength(1);
  });

  it('turns a cheer of exactly the price into a Chrono swap and ignores any other amount', () => {
    const cheer = (bits: number) => last().event('Twitch', 'Cheer', { bits, messageId: `m${bits}`, user: { id: '7', name: 'Vera' }, text: `Cheer${bits}` });
    cheer(49);
    cheer(51);
    expect(eventChips(race)).toEqual([]);
    cheer(50);
    expect(eventChips(race).map((c) => c.label)).toEqual(['CHRONO SWAP · Vera · next race']);
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
});
